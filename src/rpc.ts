/**
 * Host↔Client HTTP 通道：`POST /api/personal-workbench/<endpoint>`。
 * webServer 是可选服务且可能晚于插件 apply 就绪：探测 + 监听 `internal/service` 补挂
 * （与 dsh-cron-board / session-manager 同一模式）。
 *
 * 端点分为两组，全部只操作本机资源：
 *   store/*  —— 插件自有 JSON 存储（待办、日程…），读写 <dataDir>
 *   kb/*     —— Obsidian Local REST API 只读代理（列表/读笔记/搜索），key 不下发前端
 */
import * as fs from 'node:fs';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import type { Context } from '@deepseek-ai/cordis';
import type { PersonalWorkbenchConfig } from './config.js';
import type { JsonStore } from './store.js';
import type { KnowledgeClient } from './knowledge.js';

interface HttpRequestLike {
  url?: string;
  method?: string;
  on(event: 'data', fn: (chunk: Buffer) => void): void;
  on(event: 'end', fn: () => void): void;
}

interface HttpResponseLike {
  writeHead(code: number, headers: Record<string, string>): unknown;
  /** SSE / 流式增量写出（office/chat 用；node ServerResponse.write 的最小结构面）。 */
  write?(body?: string): unknown;
  end(body?: string): unknown;
}

/** 宿主 webServer 服务的最小结构面（session-manager / cron-board 同款注册协议）。 */
interface WebServerLike {
  register(route: {
    kind: 'prefix';
    path: string;
    handler: (req: HttpRequestLike, res: HttpResponseLike) => Promise<void> | void;
  }): unknown;
}

export const API_PREFIX = '/api/personal-workbench';

// ── 音乐平台：酷我接口 Host 代理（浏览器侧有 CORS，Node 侧无）──
const MUSIC_PROXY_DEFAULT = 'https://jsnzkpg4.pages.dev/';
const MUSIC_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 13_2_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.0.3 Mobile/15E148 Safari/604.1';
/** Node 端无 CORS：直连优先，失败回落 pages.dev 代理。 */
async function musicFetchSmart(url: string, ms = 15000, headers?: Record<string, string>): Promise<string> {
  const h = { 'User-Agent': MUSIC_UA, ...headers };
  try {
    return await musicFetch(url, ms, h);
  } catch {
    return await musicFetch(musicWithProxy(url), ms, h);
  }
}
function musicWithProxy(url: string, proxy?: string): string {
  const base = (proxy !== undefined && proxy.trim() !== '' ? proxy.trim() : MUSIC_PROXY_DEFAULT);
  const b = base.endsWith('/') ? base : `${base}/`;
  return `${b}${url}`;
}
async function musicFetch(url: string, ms = 15000, headers?: Record<string, string>): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers });
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}
function musicParseMaybeJsonp(text: string): Record<string, unknown> {
  const t = text.trim();
  if (t.startsWith('callback(') || t.startsWith('jsonp(')) {
    return JSON.parse(t.slice(t.indexOf('(') + 1, t.lastIndexOf(')'))) as Record<string, unknown>;
  }
  return JSON.parse(t) as Record<string, unknown>;
}
function musicDecode(html: string): string {
  return html.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}
function musicArtworkShort2Long(short?: string): string | undefined {
  if (typeof short !== 'string' || short === '') return undefined;
  const idx = short.indexOf('/');
  return idx !== -1 ? `https://img4.kuwo.cn/star/albumcover/1080${short.slice(idx)}` : undefined;
}
function musicKuwoPlayUrl(id: string, level: string): string {
  return `https://music.nxinxz.com/kw.php?id=${encodeURIComponent(id)}&level=${level}&type=mp3`;
}
interface MusicSong { id: string; title: string; artist: string; album: string; duration: number; audioUrl: string; coverUrl?: string }
function musicMapAbslist(data: Record<string, unknown>): { songs: MusicSong[]; isEnd: boolean; total: number } {
  const abslist = Array.isArray(data.abslist) ? (data.abslist as Array<Record<string, unknown>>) : [];
  const songs = abslist.map((it) => {
    const id = String(it.MUSICRID ?? '').replace('MUSIC_', '');
    return {
      id,
      title: musicDecode(String(it.NAME ?? '未知歌曲')),
      artist: musicDecode(String(it.ARTIST ?? '未知歌手')),
      album: musicDecode(String(it.ALBUM ?? '未知专辑')),
      duration: Number(it.DURATION) || 0,
      audioUrl: musicKuwoPlayUrl(id, 'standard'),
      coverUrl: musicArtworkShort2Long(typeof it.web_albumpic_short === 'string' ? it.web_albumpic_short : undefined),
    };
  });
  const total = Number(data.TOTAL) || 0;
  const pn = Number(data.PN) || 0;
  const rn = Number(data.RN) || 30;
  return { songs, isEnd: total > 0 && (pn + 1) * rn >= total, total };
}
const musicSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
/** 发现页缓存（30 分钟）：避免每次进页重复打 16 次搜索。 */
type MusicDiscoverItem = { id: string; title: string; artist: string; album: string; duration: number; coverUrl?: string | undefined };
type MusicDiscover = { hot: MusicDiscoverItem[]; douyin: MusicDiscoverItem[]; singers: Array<{ name: string; coverUrl: string | undefined; sample: { id: string; title: string; artist: string } | null }> };
let discoverCache: MusicDiscover | null = null;
let discoverCacheAt = 0;
/** 歌手热门曲目缓存（30 分钟，按歌手名分键）。 */
const singerCache = new Map<string, { at: number; data: { name: string; songs: Array<{ id: string; title: string; artist: string; album: string; duration: number; audioUrl: string; coverUrl?: string }> } }>();
/** 影视搜索结果缓存（10 分钟，键=片名；值已含补图后的海报）。 */
const videoSearchCache = new Map<string, { at: number; data: { items: VideoBriefHost[] } }>();

/* ── 办公室场景：动作网关队列（模块级；上限 50，溢出丢最旧）── */
type OfficeActionType = 'desk_visit' | 'desk_visit_tour' | 'set_state';
type OfficeAction = { id: number; type: OfficeActionType; payload?: Record<string, unknown> };
const OFFICE_ACTION_MAX = 50;
const OFFICE_ACTION_TYPES: readonly OfficeActionType[] = ['desk_visit', 'desk_visit_tour', 'set_state'];
const officeActions: OfficeAction[] = [];
let officeActionSeq = 0;

/* ── 办公室真工位：NPC 绑定宿主真实 agent 会话（ctx.agents.create 拉起、followup 派活、流事件抓进度）── */
interface OfficeAgentHandle {
  agent: {
    followup(msg: { content: Array<{ type: 'text'; text: string }>; source: { kind: string } }): unknown;
    whenIdle?(): Promise<void>;
  };
  dispose(): unknown;
}
interface OfficeAgentCtx {
  on?(event: string, fn: (payload: unknown) => void): unknown;
  get?(name: string): unknown;
}
interface OfficeAgentsService {
  create(opts: {
    agentOptions?: { provider?: string; model?: string; reasoningEffort?: unknown };
    setup?: (agentCtx: OfficeAgentCtx, agent: unknown) => void;
    sessionId?: unknown;
    /** 写进 session header 的元数据；cwd 供 system-prompt {{cwd}} 变量组装 */
    meta?: { cwd?: string };
  }): Promise<OfficeAgentHandle>;
  list?(): unknown[];
}
type OfficeAgentEntry = {
  name: string;
  role: string;
  task: string;
  status: 'working' | 'idle' | 'stopped';
  lastText: string;
  /** 最近一次完整汇报（turn 正常结束时的 assistant 全文，尾部 4000 字） */
  report?: string;
  reportAt?: number;
  startedAt: number;
  updatedAt: number;
};
const officeAgents = new Map<string, { entry: OfficeAgentEntry; handle: OfficeAgentHandle | null; turnText: string }>();
/** 流帧防御式抽取：start/end 帧切 working/idle，chunk 帧尽量掏出文本增量拼进 lastText（尾部 240 字）。 */
function officeAgentCapture(npcId: string): (payload: unknown) => void {
  return (payload: unknown) => {
    const slot = officeAgents.get(npcId);
    if (!slot) return;
    // dsh-agent-loop 派发的是 { frame } 包装（dispatch.emit("agent/assistant-stream", { frame })），
    // 帧本体：{type:'start'|'chunk'|'end', chunk?: <dsh-llm StreamChunk>, outcome?...}
    const f = (payload as { frame?: unknown } | null | undefined)?.frame ?? payload;
    if (!f || typeof f !== 'object') return;
    const fr = f as {
      type?: string;
      text?: unknown;
      chunk?: { type?: string; text?: unknown };
      delta?: { text?: unknown };
      outcome?: { kind?: string };
    };
    if (fr.type === 'start') {
      slot.turnText = '';
      slot.entry.status = 'working';
      slot.entry.updatedAt = Date.now();
      return;
    }
    if (fr.type === 'end') {
      if (fr.outcome?.kind === 'committed') {
        // turn 正常收尾：把本轮 assistant 全文存为 report，客户端轮询到 reportAt 变化即带回聊天区
        const rep = slot.turnText.trim();
        if (rep !== '') {
          slot.entry.report = rep;
          slot.entry.reportAt = Date.now();
        }
        slot.entry.status = 'idle';
      } else {
        slot.entry.status = 'working';
      }
      slot.entry.updatedAt = Date.now();
      return;
    }
    const raw = fr.chunk?.text ?? fr.delta?.text ?? fr.text;
    if (typeof raw === 'string' && raw !== '' && fr.chunk?.type !== 'reasoning' && fr.chunk?.type !== 'thinking') {
      slot.turnText = (slot.turnText + raw).slice(-4000);
      slot.entry.lastText = (slot.entry.lastText + raw).slice(-240);
      slot.entry.status = 'working';
      slot.entry.updatedAt = Date.now();
    }
  };
}
/** 真工位员工 system 指示：直接干活、干完简短中文汇报。 */
function officeWorkerSystem(name: string, role: string): string {
  return `你是用户工作台「办公室」里的同事 ${name}（${role}），现在被老板派了一个真实工作任务。请直接动手完成（可以读写文件、运行命令、写代码），不要反问老板，遇到小决策自己拿主意；完成后用中文简短汇报：做了什么、改了哪些文件、结果如何。不要寒暄与任务无关的内容。`;
}
/** llm.stream 的 StreamChunk 最小结构面（text-delta 携带正文增量；字段名经 @deepseek-ai/dsh-llm types.d.ts 查证）。 */
type OfficeStreamChunk = { type?: string; text?: unknown };
/** 解析 URL 得 office/<name> 端点名；非 office 端点返回空串，交还既有分发逻辑。 */
function officeNormalizeEndpoint(url: string | undefined): string {
  try {
    const pathname = new URL(url ?? '/', 'http://localhost').pathname.replace(/\/+$/, '');
    const prefixed = '/api/personal-workbench/';
    const rest = pathname.startsWith(prefixed) ? pathname.slice(prefixed.length) : pathname.replace(/^\/+/, '');
    return rest.startsWith('office/') ? rest : '';
  } catch {
    return '';
  }
}

/** 同事 agent 职业口吻（与客户端 P2 寒暄台词同源的键）。 */
const OFFICE_NPC_STYLES: Record<string, string> = {
  前端工程师: '口头禅偏「在改 bug」「样式又炸了」，聊技术但不较真',
  产品经理: '口头禅偏「需求又变了」「对齐一下」，爱提排期',
  架构师: '口头禅偏「这个要重构」「先出方案」，稳重话少',
  测试工程师: '口头禅偏「又复现不了」「提个单」，爱吐槽',
  设计师: '口头禅偏「配色再看看」「留白多一点」，审美挑剔',
  运营: '口头禅偏「数据拉一下」「拉个群」，爱张罗',
};

/** 同事 agent 的 system 提示词：职业人设 + 口语短句约束 + 场景状态。 */
function officeNpcSystem(name: string, role: string, sceneState: string): string {
  const style = OFFICE_NPC_STYLES[role] ?? '性格随和，说话接地气';
  const scene = sceneState.trim() === '' ? '' : `\n当前场景状态：${sceneState}`;
  return [
    `你是像素办公室里的员工「${name}」（${role}）。性格：${style}。`,
    '你正在办公室里和身边同事或老板 Yuze 闲聊、讨论工作。',
    '要求：完全用中文口语短句回复，一次不超过 60 字；不要 markdown、不要堆表情、不要自我介绍或复述身份、不要替别人说话；直接说出你要说的话。',
    '群聊/会议时消息历史以「[说话人] 内容」标注谁在说话，你只以自己「' + name + '」的身份说一句。',
    scene,
  ]
    .filter((l) => l !== '')
    .join('\n');
}

/* ── 影视源：磁力猫橘汁片库（CF adapter 本地索引 + SCF 详情直连） ── */
const VIDEO_CF = 'https://yuze-yingshi-jiekou.pages.dev/api/yuze';
const VIDEO_BASES = ['https://1301366908-k5q7ggear7.ap-guangzhou.tencentscf.com', 'http://103.36.167.27:18004', 'http://juziapp.hzhcbkj.cn', 'http://103.45.131.38:40001'];
type VideoBriefHost = { id: string; name: string; pic?: string; remarks?: string; typeName?: string; year?: string };
function videoMapList(data: { list?: Array<Record<string, unknown>> }): VideoBriefHost[] {
  return (data.list ?? []).map((it) => ({
    id: String(it.vod_id ?? ''),
    name: String(it.vod_name ?? ''),
    pic: typeof it.vod_pic === 'string' && it.vod_pic !== '' ? it.vod_pic.replace(/^http:/, 'https:') : undefined,
    remarks: typeof it.vod_remarks === 'string' ? it.vod_remarks : undefined,
    typeName: typeof it.type_name === 'string' ? it.type_name : undefined,
    year: typeof it.vod_year === 'string' ? it.vod_year : undefined,
  })).filter((x) => x.id !== '' && x.name !== '');
}
async function videoCmsGet(query: string): Promise<{ code?: number; list?: Array<Record<string, unknown>>; total?: number; pagecount?: number }> {
  const res = await fetch(`${VIDEO_CF}?${query}`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
  return (await res.json()) as { code?: number; list?: Array<Record<string, unknown>>; total?: number; pagecount?: number };
}
/** 详情：SCF 直连优先（境内出口免风控，实测 2s），失败走磁力猫多入口容灾。 */
/** 影视海报豆瓣缓存（键=片名，含负缓存：'' 表示查无）。 */
const videoPosterCache = new Map<string, string | undefined>();
/** 按片名从豆瓣镜像 suggest 搜海报；全名搜不到则逐步截短前缀重试（衍生长名「仙逆剧场神临之战」→「仙逆」）。豆瓣图防盗链，Host 抓图转 base64 data URL。 */
async function videoPosterFromDouban(name: string): Promise<string | undefined> {
  const hit = videoPosterCache.get(name);
  if (hit !== undefined) return hit;
  let q = name;
  while (q.length >= 2) {
    try {
      const res = await fetch(`https://movie.douban.cmliussss.com/j/subject_suggest?q=${encodeURIComponent(q)}`, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', Accept: 'application/json' }, signal: AbortSignal.timeout(12000) });
      const arr = (await res.json()) as Array<Record<string, unknown>>;
      const first = arr.find((x) => typeof x.img === 'string' && (x.img as string) !== '');
      if (first !== undefined) {
        const cover = (first.img as string).replace(/^http:/, 'https:');
        const imgRes = await fetch(cover, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', Referer: 'https://movie.douban.com/' }, signal: AbortSignal.timeout(8000) });
        if (imgRes.ok) {
          const buf = Buffer.from(await imgRes.arrayBuffer());
          const mime = imgRes.headers.get('content-type') ?? 'image/jpeg';
          const b64 = `data:${mime};base64,${buf.toString('base64')}`;
          videoPosterCache.set(name, b64);
          return b64;
        }
      }
    } catch { /* 截短重试 */ }
    q = q.slice(0, -2);
  }
  videoPosterCache.set(name, '');
  return undefined;
}

async function videoDetailFetch(id: string): Promise<Record<string, unknown> | null> {
  for (const base of VIDEO_BASES) {
    try {
      const res = await fetch(`${base}/?ac=detail&ids=${encodeURIComponent(id)}`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(30000) });
      const data = (await res.json()) as { code?: number; list?: Array<Record<string, unknown>> };
      if (data.code === 1 && Array.isArray(data.list) && data.list.length > 0) return data.list[0];
    } catch { /* 下一个入口 */ }
  }
  return null;
}
/** 解析播放线路与集数；placeholder.m3u8 占位集全部剔除。 */
function videoParseLines(v: Record<string, unknown>): Array<{ name: string; episodes: Array<{ name: string; url: string }> }> {
  const lineNames = String(v.vod_play_from ?? '').split(',').filter(Boolean);
  const lineGroups = String(v.vod_play_url ?? '').split('$$$');
  return lineNames.map((name, i) => ({
    name,
    episodes: (lineGroups[i] ?? '').split('#').filter(Boolean).map((e) => {
      const seg = e.split('$');
      return { name: (seg[0] ?? '').trim(), url: (seg[1] ?? '').trim() };
    }).filter((ep) => ep.url !== '' && /^https?:\/\//.test(ep.url) && !/placeholder\.m3u8/i.test(ep.url)),
  })).filter((l) => l.episodes.length > 0);
}
type VideoDiscoverBlock = { key: string; title: string; items: VideoBriefHost[] };
let videoDiscoverCache: VideoDiscoverBlock[] | null = null;
let videoDiscoverAt = 0;
/** 豆瓣热门榜单缓存（1 小时，按参数分键）。 */
const doubanCache = new Map<string, { at: number; data: Array<{ title: string; rate: string; cover?: string }> }>();

/** 文件归档根白名单：持久化 ~/.dsh/personal-workbench/roots.json；HOME 永远在列。 */
const ROOTS_FILE = `${process.env.HOME ?? ''}/.dsh/personal-workbench/roots.json`;
function loadRoots(): string[] {
  const home = process.env.HOME ?? '';
  const base = [home];
  try {
    const data = JSON.parse(fs.readFileSync(ROOTS_FILE, 'utf8')) as { roots?: string[] };
    for (const r of Array.isArray(data.roots) ? data.roots : []) {
      if (typeof r === 'string' && r !== '' && !base.includes(r)) base.push(r);
    }
  } catch { /* 无文件 → 仅 HOME */ }
  return base;
}
function saveRoots(roots: string[]): void {
  fs.mkdirSync(`${process.env.HOME ?? ''}/.dsh/personal-workbench`, { recursive: true });
  fs.writeFileSync(ROOTS_FILE, JSON.stringify({ roots }, null, 2), 'utf8');
}
function resolveRoot(raw: string | undefined): string {
  const home = process.env.HOME ?? '';
  if (raw === undefined || raw === '' || raw === home) return home;
  const roots = loadRoots();
  if (!roots.includes(raw)) throw Object.assign(new Error('该根目录未在白名单中，请先添加'), { code: 'bad-root' });
  return raw;
}

/** 文件归档路径安全解析：指定根目录内相对浏览、禁 ..、realpath 校验防 symlink 逃逸。 */
function fsResolveSafe(rel: string, rootRaw?: string): string {
  const root = resolveRoot(rootRaw);
  let rootReal = '';
  try { rootReal = fs.realpathSync(root); } catch { throw Object.assign(new Error('根目录不存在'), { code: 'not-found' }); }
  const parts = rel.split('/').filter((x) => x !== '' && x !== '.');
  if (parts.includes('..')) throw Object.assign(new Error('路径不允许包含 ..'), { code: 'bad-path' });
  const abs = [root, ...parts].join('/');
  try {
    const real = fs.realpathSync(abs);
    if (!real.startsWith(rootReal)) throw Object.assign(new Error('路径越界（符号链接）'), { code: 'bad-path' });
    return real;
  } catch (e) {
    if ((e as { code?: string }).code === 'bad-path') throw e;
    throw Object.assign(new Error('路径不存在'), { code: 'not-found' });
  }
}
const BODY_MAX = 2 * 1024 * 1024;

export interface RpcDeps {
  config: PersonalWorkbenchConfig;
  store: JsonStore;
  knowledge: KnowledgeClient;
  log: { info(m: string): void; warn(m: string): void; error(m: string): void };
}

function fail(code: string, message: string): never {
  throw Object.assign(new Error(message), { code });
}

function asRecord(v: unknown): Record<string, unknown> {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) fail('bad-request', '载荷必须为对象');
  return v as Record<string, unknown>;
}

function asString(v: unknown, field: string, max: number): string {
  if (typeof v !== 'string') fail('bad-request', `${field} 必须为字符串`);
  if (v.length > max) fail('bad-request', `${field} 超长（>${max}）`);
  return v;
}

export function registerRpc(ctx: Context, deps: RpcDeps): void {
  let attached = false;

  function send(res: HttpResponseLike, code: number, body: unknown): void {
    res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(body));
  }

  function readBody(req: HttpRequestLike): Promise<string> {
    return new Promise((resolve, reject) => {
      let size = 0;
      const chunks: Buffer[] = [];
      req.on('data', (chunk) => {
        size += chunk.length;
        if (size > BODY_MAX) {
          reject(Object.assign(new Error('请求体超限'), { code: 'payload-too-large' }));
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
  }

  async function handler(endpoint: string, payload: unknown): Promise<unknown> {
    switch (endpoint) {
      // ── 插件自有存储 ──
      case 'personal-workbench/store/read': {
        const p = asRecord(payload);
        const key = asString(p.key, 'key', 32);
        return { key, value: await deps.store.read<unknown>(key, null) };
      }
      case 'personal-workbench/store/write': {
        const p = asRecord(payload);
        const key = asString(p.key, 'key', 32);
        if (!('value' in p)) fail('bad-request', '缺少 value');
        const result = await deps.store.write(key, p.value);
        return { key, bytes: result.bytes };
      }

      // ── 知识库（本机 Obsidian REST 只读代理）──
      case 'personal-workbench/kb/list': {
        const p = asRecord(payload);
        const dir = p.path === undefined ? '' : asString(p.path, 'path', 512);
        const out = await deps.knowledge.list(dir);
        return { ...out, dir };
      }
      case 'personal-workbench/kb/read': {
        const p = asRecord(payload);
        const notePath = asString(p.path, 'path', 512);
        return await deps.knowledge.read(notePath);
      }
      case 'personal-workbench/kb/write': {
        const p = asRecord(payload);
        const notePath = typeof p.path === 'string' ? p.path : '';
        const content = typeof p.content === 'string' ? p.content : null;
        if (notePath === '' || content === null) fail('bad-request', '缺少笔记路径或内容');
        return await deps.knowledge.write(notePath, content);
      }

      case 'personal-workbench/kb/search': {
        const p = asRecord(payload);
        const query = asString(p.query, 'query', 200);
        return await deps.knowledge.search(query);
      }

      // ── 天气（外联代理：三源逆地理并行 fallback + open-meteo 实况/逐时/每日；无 key 免费服务）──
      case 'personal-workbench/weather/fetch': {
        const p = asRecord(payload);
        const lat = Number(p.lat);
        const lon = Number(p.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) fail('bad-request', '坐标不合法');
        const ua = 'dsh-personal-workbench/1.0 (local harness plugin)';
        const fmtZh = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) ? Math.round(n) : null);
        // 逆地理三源并行：Nominatim（街道级中文）→ BigDataCloud → Open-Meteo Geocoding，取第一个有效结果
        const geoTasks = [
          async (): Promise<string | null> => {
            const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&addressdetails=1&accept-language=zh-CN,zh,en&zoom=18`, { headers: { 'user-agent': ua } });
            if (!r.ok) return null;
            const g = (await r.json()) as { display_name?: string; address?: Record<string, string> };
            const a = g.address ?? {};
            const place = [a.house_number, a.road, a.neighbourhood, a.suburb, a.city ?? a.town ?? a.county].filter(Boolean).join(' ');
            return place || g.display_name || null;
          },
          async (): Promise<string | null> => {
            const r = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=zh`, { headers: { 'user-agent': ua } });
            if (!r.ok) return null;
            const g = (await r.json()) as { locality?: string; city?: string; principalSubdivision?: string };
            return [g.city ?? g.locality, g.principalSubdivision].filter(Boolean).join(' · ') || null;
          },
          async (): Promise<string | null> => {
            const r = await fetch(`https://geocoding-api.open-meteo.com/v1/reverse?latitude=${lat}&longitude=${lon}&count=1&language=zh&format=json`, { headers: { 'user-agent': ua } });
            if (!r.ok) return null;
            const g = (await r.json()) as { results?: Array<{ name?: string; admin1?: string }> };
            const first = g.results?.[0];
            return first ? [first.name, first.admin1].filter(Boolean).join(' · ') : null;
          },
        ];
        const wxUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&timezone=auto&current=temperature_2m,weather_code,relative_humidity_2m,apparent_temperature,wind_speed_10m&hourly=temperature_2m,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min&forecast_days=5`;
        const [geoSettled, wxRes] = await Promise.all([
          Promise.allSettled(geoTasks.map((t) => t())),
          fetch(wxUrl, { headers: { 'user-agent': ua } }),
        ]);
        if (!wxRes.ok) fail('bad-gateway', '气象服务不可达');
        const wx = (await wxRes.json()) as {
          current?: { temperature_2m?: number; weather_code?: number; relative_humidity_2m?: number; apparent_temperature?: number; wind_speed_10m?: number; time?: string };
          hourly?: { time?: string[]; temperature_2m?: number[]; weather_code?: number[] };
          daily?: { time?: string[]; weather_code?: number[]; temperature_2m_max?: number[]; temperature_2m_min?: number[] };
        };
        let place: string | null = null;
        for (const r of geoSettled) { if (r.status === 'fulfilled' && r.value) { place = r.value; break; } }
        // 三源全不可达（网络受限常见）→ 用 IP 定位带来的城市名兜底
        const fallbackPlace = typeof p.fallbackPlace === 'string' && p.fallbackPlace.trim() ? p.fallbackPlace.trim() : null;
        const c = wx.current ?? {};
        // 逐时：取当前时刻起的 10 个整点
        const hourly: Array<{ time: string; temp: number; code: number }> = [];
        const ht = wx.hourly?.time ?? []; const htemp = wx.hourly?.temperature_2m ?? []; const hcode = wx.hourly?.weather_code ?? [];
        const nowIso = (c.time ?? new Date().toISOString()).slice(0, 13);
        let startIdx = ht.findIndex((t) => (t ?? '').slice(0, 13) >= nowIso);
        if (startIdx < 0) startIdx = 0;
        for (let k = startIdx; k < Math.min(ht.length, startIdx + 10); k++) {
          const temp = fmtZh(htemp[k]); const code = hcode[k];
          if (temp === null || typeof code !== 'number') continue;
          hourly.push({ time: (ht[k] ?? '').slice(11, 13), temp, code });
        }
        // 每日：5 天概况
        const daily: Array<{ date: string; code: number; max: number; min: number }> = [];
        const dt = wx.daily?.time ?? []; const dcode = wx.daily?.weather_code ?? []; const dmax = wx.daily?.temperature_2m_max ?? []; const dmin = wx.daily?.temperature_2m_min ?? [];
        for (let k = 0; k < Math.min(dt.length, 5); k++) {
          const max = fmtZh(dmax[k]); const min = fmtZh(dmin[k]); const code = dcode[k];
          if (max === null || min === null || typeof code !== 'number') continue;
          daily.push({ date: dt[k] ?? '', code, max, min });
        }
        return {
          place: place || fallbackPlace || '当前位置',
          temp: fmtZh(c.temperature_2m) ?? 0,
          code: c.weather_code ?? 0,
          humidity: fmtZh(c.relative_humidity_2m) ?? 0,
          feels: fmtZh(c.apparent_temperature) ?? 0,
          wind: fmtZh(c.wind_speed_10m) ?? 0,
          updated: new Date().toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
          hourly,
          daily,
        };
      }

      // ── 空气质量（外联代理：open-meteo air-quality，US AQI + PM10/PM2.5）──
      case 'personal-workbench/weather/air': {
        const p = asRecord(payload);
        const lat = Number(p.lat);
        const lon = Number(p.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) fail('bad-request', '坐标不合法');
        const res = await fetch(`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}&timezone=auto&current=us_aqi,pm10,pm2_5`, { headers: { 'user-agent': 'dsh-personal-workbench/1.0' } });
        if (!res.ok) fail('bad-gateway', '空气质量服务不可达');
        const a = (await res.json()) as { current?: { us_aqi?: number | null; pm10?: number | null; pm2_5?: number | null } };
        const cur = a.current ?? {};
        const round1 = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) ? Math.round(n) : 0);
        return { aqi: round1(cur.us_aqi), pm10: round1(cur.pm10), pm25: round1(cur.pm2_5) };
      }

      // ── IP 定位兜底（geolocation 被宿主拒绝时用；三源顺序 fallback，任一成功即返回）──
      case 'personal-workbench/geo/ip': {
        const sources: Array<() => Promise<{ lat: number; lon: number; city: string } | null>> = [
          async () => {
            const r = await fetch('https://ipwho.is/', { headers: { 'user-agent': 'dsh-personal-workbench/1.0' } });
            if (!r.ok) return null;
            const g = (await r.json()) as { success?: boolean; city?: string; region?: string; latitude?: number; longitude?: number };
            if (g.success !== true || typeof g.latitude !== 'number' || typeof g.longitude !== 'number') return null;
            return { lat: g.latitude, lon: g.longitude, city: [g.region, g.city].filter(Boolean).join(' ') };
          },
          async () => {
            const r = await fetch('http://ip-api.com/json/?lang=zh-CN&fields=status,lat,lon,city,regionName', { headers: { 'user-agent': 'dsh-personal-workbench/1.0' } });
            if (!r.ok) return null;
            const g = (await r.json()) as { status?: string; lat?: number; lon?: number; city?: string; regionName?: string };
            if (g.status !== 'success' || typeof g.lat !== 'number' || typeof g.lon !== 'number') return null;
            return { lat: g.lat, lon: g.lon, city: [g.regionName, g.city].filter(Boolean).join(' ') };
          },
          async () => {
            const r = await fetch('https://ipapi.co/json/', { headers: { 'user-agent': 'dsh-personal-workbench/1.0' } });
            if (!r.ok) return null;
            const g = (await r.json()) as { latitude?: number; longitude?: number; city?: string; region?: string; error?: boolean };
            if (g.error || typeof g.latitude !== 'number' || typeof g.longitude !== 'number') return null;
            return { lat: g.latitude, lon: g.longitude, city: [g.region, g.city].filter(Boolean).join(' ') };
          },
        ];
        for (const get of sources) {
          try {
            const v = await get();
            if (v) return v;
          } catch { /* 单源失败继续下一源 */ }
        }
        fail('bad-gateway', '定位源均不可达');
      }

      // ── 法定节假日（外联代理：国务院安排镜像 holiday-cn 走 jsdelivr，timor 兜底）──
      case 'personal-workbench/holidays/fetch': {
        const p = asRecord(payload);
        const year = Number(p.year);
        if (!Number.isInteger(year) || year < 2020 || year > 2100) fail('bad-request', '年份不合法');
        const out: Record<string, { holiday: boolean; name: string; date: string }> = {};
        const sources: Array<() => Promise<Response>> = [
          () => fetch(`https://cdn.jsdelivr.net/gh/NateScarlet/holiday-cn@master/${year}.json`, { headers: { 'user-agent': 'dsh-personal-workbench/1.0' } }),
          () => fetch(`https://fastly.jsdelivr.net/gh/NateScarlet/holiday-cn@master/${year}.json`, { headers: { 'user-agent': 'dsh-personal-workbench/1.0' } }),
          () => fetch(`https://timor.tech/api/holiday/year/${year}`, { headers: { 'user-agent': 'dsh-personal-workbench/1.0' } }),
        ];
        for (const get of sources) {
          try {
            const res = await get();
            if (!res.ok) continue;
            const text = await res.text();
            const data = JSON.parse(text) as { days?: Array<{ name?: string; date?: string; isOffDay?: boolean }>; holiday?: Record<string, { holiday?: boolean; name?: string; date?: string }> };
            if (Array.isArray(data.days) && data.days.length > 0) {
              // holiday-cn 格式：days[].{name, date, isOffDay}
              for (const d of data.days) {
                if (typeof d.date === 'string') out[d.date] = { holiday: d.isOffDay !== false, name: d.name ?? '', date: d.date };
              }
              return out;
            }
            if (data.holiday && typeof data.holiday === 'object') {
              // timor 格式：holiday[MM-DD].{holiday, name, date}
              for (const v of Object.values(data.holiday)) {
                if (typeof v.date === 'string') out[v.date] = { holiday: v.holiday !== false, name: v.name ?? '', date: v.date };
              }
              return out;
            }
          } catch { /* 换下一个源 */ }
        }
        fail('bad-gateway', '节假日数据源均不可达');
      }

      // ── 文件归档：HOME 下安全浏览/读文本/系统程序打开 ──
      case 'personal-workbench/fs/roots/list':
        return { roots: loadRoots(), home: process.env.HOME ?? '' };
      case 'personal-workbench/music/search': {
        const p = asRecord(payload);
        const q = typeof p.q === 'string' ? p.q.trim() : '';
        const page = Math.max(1, Number(p.page) || 1);
        const proxy = typeof p.proxy === 'string' ? p.proxy : undefined;
        if (q === '') fail('bad-request', '缺少搜索词');
        const url = `http://search.kuwo.cn/r.s?client=kt&all=${encodeURIComponent(q)}&pn=${page - 1}&rn=30&uid=2574109560&ver=kwplayer_ar_8.5.4.2&vipver=1&ft=music&cluster=0&strategy=2012&encoding=utf8&rformat=json&vermerge=1&mobi=1`;
        let data: Record<string, unknown>;
        try {
          data = musicParseMaybeJsonp(await musicFetchSmart(url));
        } catch {
          if (proxy !== undefined) {
            try { data = musicParseMaybeJsonp(await musicFetch(musicWithProxy(url, proxy))); } catch { fail('bad-gateway', '搜索接口不可达'); }
          } else {
            fail('bad-gateway', '搜索接口不可达');
          }
        }
        const m = musicMapAbslist(data);
        return { songs: m.songs, isEnd: m.isEnd, total: m.total };
      }
      case 'personal-workbench/music/discover': {
        // 发现页：策展歌手名单逐个搜索取代表曲（全部真数据，酷我搜索接口）；
        // 结果内存缓存 30 分钟，避免每次进页都打 16 次搜索。
        if (discoverCache !== null && Date.now() - discoverCacheAt < 30 * 60 * 1000) return discoverCache;
        const searchOnce = async (q: string): Promise<ReturnType<typeof musicMapAbslist>['songs']> => {
          const url = `http://search.kuwo.cn/r.s?client=kt&all=${encodeURIComponent(q)}&pn=0&rn=3&uid=2574109560&ver=kwplayer_ar_8.5.4.2&vipver=1&ft=music&cluster=0&strategy=2012&encoding=utf8&rformat=json&vermerge=1&mobi=1`;
          for (let attempt = 0; attempt < 3; attempt++) {
            try {
              const songs = musicMapAbslist(musicParseMaybeJsonp(await musicFetchSmart(url))).songs;
              if (songs.length > 0) return songs;
            } catch { /* 酷我偶发 403/超时，退避重试 */ }
            await musicSleep(300 * (attempt + 1));
          }
          return [];
        };
        const HOT_ARTISTS = ['周杰伦', '林俊杰', '薛之谦', '陈奕迅', '邓紫棋', '汪苏泷', '周深', '毛不易'];
        const DOUYIN_ARTISTS = ['任然', '王贰浪', '花僮', '海伦', '程响', '白小白', '小阿七', '半吨兄弟'];
        const results = await Promise.all([...HOT_ARTISTS.map(searchOnce), ...DOUYIN_ARTISTS.map(searchOnce)]);
        const hot: MusicDiscoverItem[] = [];
        const douyin: typeof hot = [];
        const singers: Array<{ name: string; coverUrl: string | undefined; sample: { id: string; title: string; artist: string } | null }> = [];
        results.forEach((songs, i) => {
          const first = songs.find((x) => x.id !== '');
          if (first === undefined) return;
          const brief = { id: first.id, title: first.title, artist: first.artist };
          if (i < HOT_ARTISTS.length) {
            hot.push(first);
            singers.push({ name: HOT_ARTISTS[i], coverUrl: first.coverUrl, sample: brief });
          } else {
            douyin.push(first);
          }
        });
        const out = { hot, douyin, singers };
        discoverCache = out; discoverCacheAt = Date.now();
        return out;
      }
      case 'personal-workbench/video/search': {
        const p = asRecord(payload);
        const q = typeof p.q === 'string' ? p.q.trim() : '';
        if (q === '') fail('bad-request', '缺少搜索词');
        const skey = `vsearch|${q}`;
        const sh = videoSearchCache.get(skey);
        if (sh !== undefined && Date.now() - sh.at < 10 * 60 * 1000) return sh.data;
        try {
          const data = await videoCmsGet(`ac=detail&wd=${encodeURIComponent(q)}`);
          let items = videoMapList(data);
          // 片库搜索接口不回海报（vod_pic 空）：逐个走多源详情补图（图床无防盗链，直链可显），4 并发防压源
          const need = items.filter((x) => x.pic === undefined);
          if (need.length > 0) {
            const picMap = new Map<string, string>();
            for (let i = 0; i < need.length; i += 4) {
              await Promise.all(need.slice(i, i + 4).map(async (x) => {
                const v = await videoDetailFetch(x.id);
                const pic = v !== null && typeof v.vod_pic === 'string' && (v.vod_pic as string) !== ''
                  ? (v.vod_pic as string).replace(/^http:\/\//, 'https://')
                  : undefined;
                if (pic !== undefined) picMap.set(x.id, pic);
              }));
            }
            if (picMap.size > 0) items = items.map((x) => (picMap.has(x.id) ? { ...x, pic: picMap.get(x.id) } : x));
          }
          // 二级回落：详情源没有的（新片详情库未同步），按片名从豆瓣搜海报（base64）
          const still = items.filter((x) => x.pic === undefined);
          if (still.length > 0) {
            const dbMap = new Map<string, string>();
            for (let i = 0; i < still.length; i += 4) {
              await Promise.all(still.slice(i, i + 4).map(async (x) => {
                const b64 = await videoPosterFromDouban(x.name);
                if (b64 !== undefined && b64 !== '') dbMap.set(x.id, b64);
              }));
            }
            if (dbMap.size > 0) items = items.map((x) => (dbMap.has(x.id) ? { ...x, pic: dbMap.get(x.id) } : x));
          }
          const result = { items };
          videoSearchCache.set(skey, { at: Date.now(), data: result });
          return result;
        } catch {
          fail('bad-gateway', '片库索引不可达');
        }
      }
      case 'personal-workbench/video/category': {
        const p = asRecord(payload);
        const t = typeof p.t === 'string' && p.t !== '' ? p.t : '20';
        const pg = Math.max(1, Number(p.pg) || 1);
        try {
          const data = await videoCmsGet(`ac=detail&t=${encodeURIComponent(t)}&pg=${pg}`);
          return { items: videoMapList(data), total: Number(data.total) || 0, pagecount: Number(data.pagecount) || 1 };
        } catch {
          fail('bad-gateway', '片库索引不可达');
        }
      }
      case 'personal-workbench/video/detail': {
        const p = asRecord(payload);
        const id = typeof p.id === 'string' ? p.id.trim() : '';
        if (id === '') fail('bad-request', '缺少影片 id');
        const v = await videoDetailFetch(id);
        if (v === null) fail('bad-gateway', '详情获取失败，稍后再试');
        const str = (k: string): string | undefined => (typeof v[k] === 'string' && v[k] !== '' ? v[k] as string : undefined);
        return {
          name: String(v.vod_name ?? ''),
          pic: typeof v.vod_pic === 'string' && v.vod_pic !== '' ? (v.vod_pic as string).replace(/^http:/, 'https:') : undefined,
          year: str('vod_year'), typeName: str('type_name'), actor: str('vod_actor'), director: str('vod_director'),
          content: str('vod_content'), remarks: str('vod_remarks'),
          lines: videoParseLines(v),
        };
      }
      case 'personal-workbench/video/discover': {
        if (videoDiscoverCache !== null && Date.now() - videoDiscoverAt < 30 * 60 * 1000) return videoDiscoverCache;
        const defs: Array<{ key: string; title: string; t: string }> = [
          { key: 'movie', title: '热门电影', t: '20' },
          { key: 'series', title: '热播剧集', t: '1' },
        ];
        const blocks: VideoDiscoverBlock[] = [];
        for (const d of defs) {
          try {
            const data = await videoCmsGet(`ac=detail&t=${d.t}&pg=1`);
            blocks.push({ key: d.key, title: d.title, items: videoMapList(data).slice(0, 12) });
          } catch {
            blocks.push({ key: d.key, title: d.title, items: [] });
          }
        }
        videoDiscoverCache = blocks;
        videoDiscoverAt = Date.now();
        return blocks;
      }
      case 'personal-workbench/music/singer': {
        // 歌手热门曲目：酷我搜索该歌手取 30 首（真数据），30 分钟缓存
        const p = asRecord(payload);
        const name = typeof p.name === 'string' ? p.name.trim() : '';
        if (name === '') fail('bad-request', '缺少歌手名');
        const skey = `singer|${name}`;
        const sh = singerCache.get(skey);
        if (sh !== undefined && Date.now() - sh.at < 30 * 60 * 1000) return sh.data;
        const url = `http://search.kuwo.cn/r.s?client=kt&all=${encodeURIComponent(name)}&pn=0&rn=30&uid=2574109560&ver=kwplayer_ar_8.5.4.2&vipver=1&ft=music&cluster=0&strategy=2012&encoding=utf8&rformat=json&vermerge=1&mobi=1`;
        const data = musicParseMaybeJsonp(await musicFetchSmart(url));
        const m = musicMapAbslist(data);
        const filtered = m.songs.filter((x) => x.artist.includes(name));
        const result = { name, songs: filtered.length >= 5 ? filtered : m.songs };
        singerCache.set(skey, { at: Date.now(), data: result });
        return result;
      }
      case 'personal-workbench/video/douban': {
        // 豆瓣热门榜单：cmliussss 镜像（原版影视站同款数据源），Host 代理 + 1 小时缓存
        const p = asRecord(payload);
        const type = p.type === 'tv' ? 'tv' : 'movie';
        const tag = typeof p.tag === 'string' && p.tag.trim() !== '' ? p.tag.trim() : '热门';
        const pageLimit = Math.min(30, Math.max(3, Number(p.pageLimit) || 12));
        const pageStart = Math.min(720, Math.max(0, Number(p.pageStart) || 0));
        const key = `${type}|${tag}|${pageLimit}|${pageStart}`;
        const hit = doubanCache.get(key);
        if (hit !== undefined && Date.now() - hit.at < 60 * 60 * 1000) return { subjects: hit.data };
        const url = `https://movie.douban.cmliussss.com/j/search_subjects?type=${type}&tag=${encodeURIComponent(tag)}&sort=recommend&page_limit=${pageLimit}&page_start=${pageStart}`;
        try {
          const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', Referer: 'https://movie.douban.com/', Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
          const data = (await res.json()) as { subjects?: Array<Record<string, unknown>> };
          const subjects = (data.subjects ?? []).map((it) => ({
            title: String(it.title ?? ''),
            rate: String(it.rate ?? '0'),
            cover: typeof it.cover === 'string' && it.cover !== '' ? it.cover.replace(/^http:/, 'https:') : undefined,
          })).filter((x) => x.title !== '');
          // 豆瓣图防盗链：UA+Referer 双头才放行（仅 UA/裸连 418），浏览器 img 直连必裂 —— Host 抓图转 base64 data URL
          const withPics = await Promise.all(subjects.map(async (sub) => {
            if (sub.cover === undefined) return sub;
            try {
              const imgRes = await fetch(sub.cover, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', Referer: 'https://movie.douban.com/' }, signal: AbortSignal.timeout(8000) });
              if (!imgRes.ok) return { ...sub, cover: undefined };
              const buf = Buffer.from(await imgRes.arrayBuffer());
              const mime = imgRes.headers.get('content-type') ?? 'image/jpeg';
              return { ...sub, cover: `data:${mime};base64,${buf.toString('base64')}` };
            } catch { return { ...sub, cover: undefined }; }
          }));
          doubanCache.set(key, { at: Date.now(), data: withPics });
          return { subjects: withPics };
        } catch {
          fail('bad-gateway', '豆瓣榜单不可达');
        }
      }
      case 'personal-workbench/music/source': {
        // 酷我官方直链（碳酸插件同源）：antiserver convert_url；带 iPhone UA + kuwo Referer
        const p = asRecord(payload);
        const id = typeof p.id === 'string' ? p.id : '';
        const q = typeof p.quality === 'string' ? p.quality : '128k';
        if (id === '' || !/^\d+$/.test(id)) fail('bad-request', '缺少歌曲 id');
        const format = q === 'flac' ? 'flac' : 'mp3';
        try {
          const text = await musicFetch(`http://antiserver.kuwo.cn/anti.s?type=convert_url&rid=${id}&format=${format}&response=url`, 9000, { 'User-Agent': MUSIC_UA, Referer: 'https://www.kuwo.cn/' });
          const url = text.trim();
          if (url.startsWith('http')) return { url };
          fail('bad-gateway', '直链获取失败');
        } catch (e) {
          fail('bad-gateway', e instanceof Error ? e.message : '直链获取失败');
        }
      }
      case 'personal-workbench/music/detail': {
        // 歌词 + 高清封面（同一接口；酷我偶发 301 限流，重试 3 次退避）
        const p = asRecord(payload);
        const id = typeof p.id === 'string' ? p.id : '';
        const proxy = typeof p.proxy === 'string' ? p.proxy : undefined;
        if (id === '' || !/^\d+$/.test(id)) fail('bad-request', '缺少歌曲 id');
        const url = `http://m.kuwo.cn/newh5/singles/songinfoandlrc?musicId=${id}&httpStatus=1`;
        let lastErr = '';
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const data = musicParseMaybeJsonp(await musicFetchSmart(url)) as {
              status?: number; data?: { lrclist?: Array<{ time?: unknown; lineLyric?: unknown }>; songinfo?: { pic?: unknown } };
            };
            if (data.status === 301 || data.data === undefined) { await musicSleep(800 * (attempt + 1)); continue; }
            const lrc = (Array.isArray(data.data.lrclist) ? data.data.lrclist : [])
              .map((line) => {
                const raw = typeof line.time === 'string' ? line.time : String(line.time ?? '0');
                let time = 0;
                if (raw.includes(':')) {
                  const parts = raw.split(':');
                  time = parts.length === 2 ? Number(parts[0]) * 60 + parseFloat(parts[1]) : parseFloat(raw) || 0;
                } else {
                  time = parseFloat(raw) || 0;
                }
                return { time, text: musicDecode(String(line.lineLyric ?? '')) };
              })
              .filter((l) => l.text !== '');
            const pic = typeof data.data.songinfo?.pic === 'string' ? data.data.songinfo.pic.replace('/800/', '/1080/') : undefined;
            return { lyrics: lrc, coverUrl: pic };
          } catch (e) {
            lastErr = e instanceof Error ? e.message : String(e);
            await musicSleep(800 * (attempt + 1));
          }
        }
        fail('bad-gateway', lastErr === '' ? '歌词接口连续失败' : lastErr);
      }
      case 'personal-workbench/music/import': {
        // 歌单分享链接解析：网易云/QQ/酷狗 → queries；酷我/波点 → 可直接播放 songs
        const p = asRecord(payload);
        const link = typeof p.link === 'string' ? p.link.trim() : '';
        const proxy = typeof p.proxy === 'string' ? p.proxy : undefined;
        if (link === '') fail('bad-request', '缺少分享链接');
        const queries: string[] = [];
        const songs: MusicSong[] = [];
        if (link.includes('163cn.tv') || link.includes('music.163.com') || link.includes('163.cn')) {
          const id = link.includes('163cn.tv') ? null : (link.match(/(?:playlist|list)[/?](\d+)/)?.[1] ?? link.match(/id=(\d+)/)?.[1]);
          if (!link.includes('163cn.tv') && id === null) fail('bad-request', '链接里没有歌单 id');
          for (let attempt = 0; attempt < 5 && queries.length === 0; attempt++) {
            const target = link.includes('163cn.tv')
              ? `${link}${link.includes('?') ? '&' : '?'}r=${Date.now().toString(36)}${attempt}`
              : `https://music.163.com/playlist?id=${id}`;
            try {
              const html = await musicFetch(musicWithProxy(target, proxy), 20000);
              const re = /<a href="\/song\?id=\d+">([^<]+)<\/a>/g;
              let m: RegExpExecArray | null;
              while ((m = re.exec(html)) !== null) {
                const title = musicDecode(m[1]).trim();
                if (title !== '' && !queries.includes(title)) queries.push(title);
              }
            } catch { /* 单次失败退避重试 */ }
            if (queries.length === 0) await musicSleep(1200);
          }
        } else if (link.includes('y.qq.com') || link.includes('qq.com')) {
          const id = link.match(/playlist\/(\d+)/)?.[1] ?? link.match(/id=(\d+)/)?.[1];
          if (id === undefined) fail('bad-request', '链接里没有歌单 id');
          const data = musicParseMaybeJsonp(await musicFetch(musicWithProxy(`https://c.y.qq.com/qzone/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg?type=1&json=1&utf8=1&onlysong=0&disstid=${id}&format=json`, proxy), 20000)) as { songlist?: Array<Record<string, unknown>> };
          const list = Array.isArray(data.songlist) ? data.songlist : [];
          for (const song of list) {
            const title = String(song.songname ?? '').trim();
            if (title === '') continue;
            const singers = Array.isArray(song.singer) ? (song.singer as Array<Record<string, unknown>>) : [];
            const artist = singers.map((x) => x.name).filter((x): x is string => typeof x === 'string').join(' ');
            queries.push(artist !== '' ? `${title} - ${artist}` : title);
          }
        } else if (link.includes('kugou.com')) {
          const id = link.match(/special\/single\/(\d+)/)?.[1];
          if (id === undefined) fail('bad-request', '链接里没有歌单 id');
          const html = await musicFetch(musicWithProxy(`https://www.kugou.com/yy/special/single/${id}.html`, proxy), 20000);
          const pat1 = /data-title="([^"]+)"[^>]*data-singer="([^"]+)"/g;
          let m: RegExpExecArray | null;
          while ((m = pat1.exec(html)) !== null) {
            const title = musicDecode(m[1]).trim();
            if (title !== '') queries.push(m[2] !== '' ? `${title} - ${musicDecode(m[2])}` : title);
          }
          if (queries.length === 0) {
            const pat2 = /"filename"\s*:\s*"([^"]+?)-([^"]+?)"/g;
            while ((m = pat2.exec(html)) !== null) {
              const title = musicDecode(m[1]).trim();
              if (title !== '') queries.push(m[2] !== '' ? `${title} - ${musicDecode(m[2])}` : title);
            }
          }
        } else if (link.includes('kuwo.cn')) {
          const pid = link.match(/playlistId=(\d+)/)?.[1];
          if (pid === undefined) fail('bad-request', '链接里没有歌单 id');
          const source = link.match(/source=(\d+)/)?.[1] ?? '5';
          const reqId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
          const res = await fetch(musicWithProxy(`https://bd-api.kuwo.cn/api/service/playlist/${pid}/musicList?reqId=${reqId}&source=${source}&pn=1&rn=100`, proxy), { headers: { plat: 'h5', ver: '' } });
          const data = JSON.parse(await res.text()) as { data?: { list?: Array<Record<string, unknown>>; musicList?: Array<Record<string, unknown>> } };
          const list = data.data?.list ?? data.data?.musicList ?? [];
          for (const song of list) {
            const sid = String(song.id ?? '');
            const pic = typeof song.albumPic === 'string' && song.albumPic !== '' ? song.albumPic.replace('/800/', '/1080/') : undefined;
            songs.push({
              id: sid,
              title: musicDecode(String(song.name ?? '未知歌曲')),
              artist: musicDecode(String(song.artist ?? '未知歌手')),
              album: musicDecode(String(song.album ?? '未知专辑')),
              duration: Number(song.duration) || 0,
              audioUrl: musicKuwoPlayUrl(sid, 'standard'),
              coverUrl: pic,
            });
          }
        } else {
          fail('bad-request', '暂不支持该平台的分享链接（支持网易云/QQ/酷狗/酷我）');
        }
        if (queries.length === 0 && songs.length === 0) fail('bad-gateway', '解析不到歌曲，链接可能失效');
        return { queries, songs };
      }

      case 'personal-workbench/fs/roots/pick': {
        // macOS 原生「选择文件夹」对话框（osascript）；Windows 宿主无此路由，走输入路径
        let picked = '';
        try {
          picked = await new Promise<string>((resolve, reject) => {
            execFile('osascript', ['-e', 'POSIX path of (choose folder with prompt "选择文件归档根目录")'], { timeout: 120_000 }, (err, stdout) => (err !== null ? reject(err) : resolve(String(stdout).trim())));
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (msg.includes('-128') || msg.includes('canceled')) return { ok: false, code: 'cancelled' };
          fail('internal', '系统选择器不可用');
        }
        if (picked === '') return { ok: false, code: 'cancelled' };
        const real = fs.realpathSync(picked.endsWith('/') && picked !== '/' ? picked.slice(0, -1) : picked);
        const st = fs.statSync(real);
        if (!st.isDirectory()) fail('bad-request', '不是目录');
        const roots = loadRoots();
        if (!roots.includes(real)) { roots.push(real); saveRoots(roots); }
        return { ok: true, path: real, roots };
      }

      case 'personal-workbench/fs/roots/add': {
        const p = asRecord(payload);
        const raw = typeof p.path === 'string' ? p.path.trim() : '';
        if (raw === '') fail('bad-request', '缺少目录路径');
        let real = '';
        try { real = fs.realpathSync(raw); } catch { fail('not-found', '目录不存在'); }
        const st = fs.statSync(real);
        if (!st.isDirectory()) fail('bad-request', '不是目录');
        const roots = loadRoots();
        if (!roots.includes(real)) { roots.push(real); saveRoots(roots); }
        return { ok: true, roots };
      }
      case 'personal-workbench/fs/roots/remove': {
        const p = asRecord(payload);
        const raw = typeof p.path === 'string' ? p.path : '';
        const home = process.env.HOME ?? '';
        if (raw === home) fail('bad-request', '主目录不可移除');
        saveRoots(loadRoots().filter((r) => r !== raw));
        return { ok: true };
      }
      case 'personal-workbench/fs/list': {
        const p = asRecord(payload);
        const rel = typeof p.path === 'string' ? p.path : '';
        const rootRaw = typeof p.root === 'string' ? p.root : undefined;
        const abs = fsResolveSafe(rel, rootRaw);
        const dirents = fs.readdirSync(abs, { withFileTypes: true });
        const entries = dirents
          .map((d) => ({
            name: d.name,
            path: rel === '' ? d.name : `${rel}/${d.name}`,
            kind: d.isDirectory() ? 'dir' : 'file',
          }))
          .sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name, 'zh') : a.kind === 'dir' ? -1 : 1));
        return { entries, root: '主目录' };
      }
      case 'personal-workbench/fs/read': {
        const p = asRecord(payload);
        const rel = typeof p.path === 'string' ? p.path : '';
        const abs = fsResolveSafe(rel, typeof p.root === 'string' ? p.root : undefined);
        const st = fs.statSync(abs);
        if (!st.isFile()) fail('bad-request', '不是文件');
        const ext = rel.split('.').pop()?.toLowerCase() ?? '';
        const TEXT_EXT = new Set(['md', 'txt', 'json', 'csv', 'log', 'yaml', 'yml', 'js', 'jsx', 'ts', 'tsx', 'py', 'sh', 'html', 'css', 'xml', 'ini', 'conf', 'env', 'sql']);
        if (st.size > 2 * 1024 * 1024) fail('too-large', '文件超过 2MB，不支持预览（可用系统程序打开）');
        if (!TEXT_EXT.has(ext)) fail('unsupported', '该类型不支持文本预览（可用系统程序打开）');
        return { path: rel, kind: 'text', content: fs.readFileSync(abs, 'utf8'), bytes: st.size };
      }
      case 'personal-workbench/fs/write': {
        const p = asRecord(payload);
        const rel = typeof p.path === 'string' ? p.path : '';
        const content = typeof p.content === 'string' ? p.content : null;
        if (rel === '' || content === null) fail('bad-request', '缺少路径或内容');
        if (content.length > 2 * 1024 * 1024) fail('too-large', '内容超过 2MB');
        const ext = rel.split('.').pop()?.toLowerCase() ?? '';
        const TEXT_EXT2 = new Set(['md', 'txt', 'json', 'csv', 'log', 'yaml', 'yml', 'js', 'jsx', 'ts', 'tsx', 'py', 'sh', 'html', 'css', 'xml', 'ini', 'conf', 'env', 'sql']);
        if (!TEXT_EXT2.has(ext)) fail('unsupported', '该类型不支持编辑保存');
        const abs = fsResolveSafe(rel, typeof p.root === 'string' ? p.root : undefined);
        fs.writeFileSync(abs, content, 'utf8');
        return { ok: true, path: rel, bytes: Buffer.byteLength(content, 'utf8') };
      }

      case 'personal-workbench/fs/open': {
        const p = asRecord(payload);
        const rel = typeof p.path === 'string' ? p.path : '';
        const abs = fsResolveSafe(rel, typeof p.root === 'string' ? p.root : undefined);
        // 先按默认应用打开；无关联应用（如 .py，-10810）→ 回退默认文本编辑器
        await new Promise<void>((resolve, reject) => {
          execFile('open', [abs], { timeout: 10_000 }, (err) => {
            if (!err) return resolve();
            execFile('open', ['-t', abs], { timeout: 10_000 }, (err2) => (err2 ? reject(err2) : resolve()));
          });
        });
        return { ok: true, path: rel };
      }

      // ── 启动器（本机应用，只列 .app 名称 + open 启动）──
      case 'personal-workbench/apps/list': {
        const home = process.env.HOME ?? '';
        const dirs = ['/Applications', `${home}/Applications`];
        const names = new Set<string>();
        for (const dir of dirs) {
          try {
            for (const entry of fs.readdirSync(dir)) {
              if (entry.endsWith('.app')) names.add(entry.replace(/\.app$/, ''));
            }
          } catch {
            // 目录不存在（如无 ~/Applications）→ 跳过
          }
        }
        return { apps: [...names].sort((a, b) => a.localeCompare(b)) };
      }
      case 'personal-workbench/apps/open': {
        const p = asRecord(payload);
        const name = asString(p.name, 'name', 120);
        // 只挡路径穿越/注入字符（名字会拼进 ${name}.app 路径）；中文名合法，存在性校验兜底
        if (name.trim() === '' || /[/\\\u0000]|\.\./.test(name)) fail('bad-request', '应用名含非法字符');
        // 二次校验：必须真实存在于应用目录（白名单，防任意执行）
        const home = process.env.HOME ?? '';
        const candidates = [`/Applications/${name}.app`, `${home}/Applications/${name}.app`];
        if (!candidates.some((c) => fs.existsSync(c))) fail('not-found', `应用不存在：${name}`);
        await new Promise<void>((resolve, reject) => {
          execFile('open', ['-a', name], { timeout: 10_000 }, (err) => (err ? reject(err) : resolve()));
        });
        return { ok: true, name };
      }

      default:
        fail('not-found', `未知端点：${endpoint}`);
    }
  }

  const httpHandler = async (req: HttpRequestLike, res: HttpResponseLike): Promise<void> => {
    // ── GET /fsfile?path=<HOME相对路径>：图片/视频等媒体流式直读（Range 分段，视频可拖动；图片无大小上限）──
    if ((req.method ?? 'GET').toUpperCase() === 'GET' && (req.url ?? '').includes('/fsfile?')) {
      try {
        const u = new URL(req.url ?? '/', 'http://localhost');
        const rel = u.searchParams.get('path') ?? '';
        const abs = fsResolveSafe(rel, u.searchParams.get('root') ?? undefined);
        const st = fs.statSync(abs);
        if (!st.isFile()) {
          send(res, 400, { ok: false, error: { code: 'bad-request', message: '不是文件' } });
          return;
        }
        const ext = rel.split('.').pop()?.toLowerCase() ?? '';
        const MEDIA_MIME = new Map<string, string>([
          ['png', 'image/png'], ['jpg', 'image/jpeg'], ['jpeg', 'image/jpeg'], ['gif', 'image/gif'],
          ['webp', 'image/webp'], ['bmp', 'image/bmp'], ['svg', 'image/svg+xml'], ['avif', 'image/avif'],
          ['mp4', 'video/mp4'], ['m4v', 'video/mp4'], ['webm', 'video/webm'], ['mov', 'video/quicktime'],
          ['mp3', 'audio/mpeg'], ['m4a', 'audio/mp4'], ['wav', 'audio/wav'], ['flac', 'audio/flac'],
        ]);
        const mime = MEDIA_MIME.get(ext);
        if (mime === undefined) {
          send(res, 415, { ok: false, error: { code: 'unsupported', message: '该类型不支持在线预览' } });
          return;
        }
        const headers = (req as unknown as { headers: Record<string, string | string[] | undefined> }).headers ?? {};
        const rangeHeader = typeof headers.range === 'string' ? headers.range : undefined;
        const baseHeaders: Record<string, string> = { 'content-type': mime, 'accept-ranges': 'bytes', 'cache-control': 'private, max-age=3600' };
        const rangeMatch = rangeHeader !== undefined ? /bytes=(\d*)-(\d*)/.exec(rangeHeader) : null;
        if (rangeMatch !== null && (rangeMatch[1] !== '' || rangeMatch[2] !== '')) {
          const start = rangeMatch[1] !== '' ? Number.parseInt(rangeMatch[1], 10) : Math.max(0, st.size - Number.parseInt(rangeMatch[2] ?? '0', 10));
          const end = rangeMatch[2] !== '' ? Math.min(Number.parseInt(rangeMatch[2], 10), st.size - 1) : st.size - 1;
          if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= st.size) {
            send(res, 416, { ok: false, error: { code: 'range-error', message: '请求范围无效' } });
            return;
          }
          res.writeHead(206, { ...baseHeaders, 'content-range': `bytes ${start}-${end}/${st.size}`, 'content-length': String(end - start + 1) });
          fs.createReadStream(abs, { start, end }).pipe(res as unknown as import('node:stream').Writable);
        } else {
          res.writeHead(200, { ...baseHeaders, 'content-length': String(st.size) });
          fs.createReadStream(abs).pipe(res as unknown as import('node:stream').Writable);
        }
      } catch {
        send(res, 500, { ok: false, error: { code: 'internal', message: '媒体读取失败' } });
      }
      return;
    }

    // ── GET /appicon?name=<应用名>：提取本机 .app 图标(icns→sips→png)，磁盘缓存，按需生成 ──
    if ((req.method ?? 'GET').toUpperCase() === 'GET' && (req.url ?? '').includes('/appicon?')) {
      try {
        const u = new URL(req.url ?? '/', 'http://localhost');
        const name = u.searchParams.get('name') ?? '';
        if (name.trim() === '' || /[/\\\u0000]|\.\./.test(name)) {
          send(res, 400, { ok: false, error: { code: 'bad-request', message: '应用名含非法字符' } });
          return;
        }
        const home = process.env.HOME ?? '';
        const appDir = [`/Applications/${name}.app`, `${home}/Applications/${name}.app`].find((c) => fs.existsSync(c));
        if (appDir === undefined) {
          send(res, 404, { ok: false, error: { code: 'not-found', message: '应用不存在' } });
          return;
        }
        const cacheDir = `${home}/.dsh/personal-workbench/appicons`;
        fs.mkdirSync(cacheDir, { recursive: true });
        const cachePath = `${cacheDir}/${createHash('sha1').update(name).digest('hex')}.png`;
        const exists = fs.existsSync(cachePath);
        if (!exists) {
          // 取 Resources 下最大的 .icns（通常即主图标），sips 转 png；无 icns → 404（前端回退色块）
          let icns = '';
          try {
            const res2 = fs.readdirSync(`${appDir}/Contents/Resources`).filter((f) => f.endsWith('.icns'));
            let best = 0;
            for (const f of res2) {
              const full = `${appDir}/Contents/Resources/${f}`;
              const sz = fs.statSync(full).size;
              if (sz > best) { best = sz; icns = full; }
            }
          } catch { /* 无 Resources */ }
          if (icns === '') {
            send(res, 404, { ok: false, error: { code: 'not-found', message: '无可用图标' } });
            return;
          }
          await new Promise<void>((resolve, reject) => {
            execFile('sips', ['-s', 'format', 'png', icns, '--out', cachePath], { timeout: 8000 }, (err) => (err ? reject(err) : resolve()));
          });
        }
        const png = fs.readFileSync(cachePath);
        res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'public, max-age=86400' });
        res.end(png as unknown as string);
      } catch {
        send(res, 500, { ok: false, error: { code: 'internal', message: '图标提取失败' } });
      }
      return;
    }

    // ── 办公室场景（office/*）：chat=SSE 流式对话、action=动作入队、actions=轮询取走、state=心跳 ──
    const officeEndpoint = officeNormalizeEndpoint(req.url);
    if (officeEndpoint !== '') {
      const officeMethod = (req.method ?? 'GET').toUpperCase();
      if (officeEndpoint === 'office/state') {
        if (officeMethod !== 'GET') {
          send(res, 405, { ok: false, error: { code: 'method-not-allowed', message: '仅支持 GET' } });
          return;
        }
        send(res, 200, { ok: true, ts: Date.now() });
        return;
      }
      if (officeEndpoint === 'office/actions') {
        if (officeMethod !== 'GET') {
          send(res, 405, { ok: false, error: { code: 'method-not-allowed', message: '仅支持 GET' } });
          return;
        }
        send(res, 200, { ok: true, actions: officeActions.splice(0, officeActions.length) });
        return;
      }
      if (officeEndpoint === 'office/agents') {
        if (officeMethod !== 'GET') {
          send(res, 405, { ok: false, error: { code: 'method-not-allowed', message: '仅支持 GET' } });
          return;
        }
        const list = [...officeAgents.entries()].map(([npcId, slot]) => ({ npcId, ...slot.entry }));
        send(res, 200, { ok: true, agents: list });
        return;
      }
      if (officeMethod !== 'POST') {
        send(res, 405, { ok: false, error: { code: 'method-not-allowed', message: '仅支持 POST' } });
        return;
      }
      let officeBody: Record<string, unknown> = {};
      try {
        const officeRaw = await readBody(req);
        if (officeRaw.trim() !== '') officeBody = JSON.parse(officeRaw) as Record<string, unknown>;
      } catch (officeErr) {
        const officeCode = (officeErr as { code?: unknown }).code;
        send(res, officeCode === 'payload-too-large' ? 413 : 400, {
          ok: false,
          error: {
            code: typeof officeCode === 'string' && officeCode !== '' ? officeCode : 'bad-json',
            message: officeErr instanceof Error ? officeErr.message : '请求体不是合法 JSON',
          },
        });
        return;
      }
      if (officeEndpoint === 'office/action') {
        const officeType = typeof officeBody.type === 'string' ? officeBody.type : '';
        if (!(OFFICE_ACTION_TYPES as readonly string[]).includes(officeType)) {
          send(res, 400, { ok: false, error: { code: 'bad-request', message: 'type 必须为 desk_visit | desk_visit_tour | set_state' } });
          return;
        }
        const officePayload = officeBody.payload;
        if (officePayload !== undefined && (typeof officePayload !== 'object' || officePayload === null || Array.isArray(officePayload))) {
          send(res, 400, { ok: false, error: { code: 'bad-request', message: 'payload 必须为对象' } });
          return;
        }
        officeActionSeq += 1;
        officeActions.push({
          id: officeActionSeq,
          type: officeType as OfficeActionType,
          ...(officePayload === undefined ? {} : { payload: officePayload as Record<string, unknown> }),
        });
        if (officeActions.length > OFFICE_ACTION_MAX) officeActions.splice(0, officeActions.length - OFFICE_ACTION_MAX);
        send(res, 200, { ok: true, id: officeActionSeq });
        return;
      }
      // office/agent/start：给 NPC 拉起宿主真实 agent 会话并派活（真读写、真执行）
      if (officeEndpoint === 'office/agent/start') {
        const npcId = typeof officeBody.npcId === 'string' ? officeBody.npcId : '';
        const name = typeof officeBody.name === 'string' ? officeBody.name : '';
        const role = typeof officeBody.role === 'string' ? officeBody.role : '';
        const task = typeof officeBody.task === 'string' ? officeBody.task.trim() : '';
        if (npcId === '' || task === '') {
          send(res, 400, { ok: false, error: { code: 'bad-request', message: 'npcId 与 task 必填' } });
          return;
        }
        const agents = ctx.get('agents') as OfficeAgentsService | undefined;
        if (!agents || typeof agents.create !== 'function') {
          send(res, 501, { ok: false, error: { code: 'unavailable', message: 'agents 服务不可用' } });
          return;
        }
        const selection = (ctx.get('agentDefaultModel') as
          | { currentSelection?: () => { provider?: unknown; model?: unknown } }
          | undefined)?.currentSelection?.();
        const provider = typeof selection?.provider === 'string' && selection.provider !== '' ? selection.provider : undefined;
        const model = typeof selection?.model === 'string' && selection.model !== '' ? selection.model : undefined;
        // 工作目录：客户端可传（须为已存在的绝对路径目录），缺省用用户主目录（宿主进程 cwd 可能是 /）。
        let agentCwd = homedir();
        if (typeof officeBody.cwd === 'string' && officeBody.cwd.startsWith('/')) {
          try {
            const st = await fs.promises.stat(officeBody.cwd);
            if (st.isDirectory()) agentCwd = officeBody.cwd;
          } catch { /* 不存在则回退宿主 cwd */ }
        }
        const prev = officeAgents.get(npcId);
        if (prev?.handle) {
          try {
            void prev.handle.dispose();
          } catch { /* 旧句柄清理失败忽略 */ }
        }
        try {
          const handle = await agents.create({
            // sessionId 必传：agent.id 必须与 session.id 一致（AgentRegistry.enter 不变式），
            // 缺省时 agent id 为 undefined 而创建即抛错。
            sessionId: `session-office-${npcId}-${Date.now()}`,
            // cwd 必须随 meta 写进 session header：system-prompt 组装 deployment:persona-suffix
            // 需要 {{cwd}} 变量（variable("cwd", ctx => ctx.agent?.session.header.cwd)），
            // 缺省会让 agent 第 1 步就报 "prompt variable \"{{cwd}}\" has no value" 而挂。
            meta: { cwd: agentCwd },
            agentOptions: { ...(provider ? { provider } : {}), ...(model ? { model } : {}) },
            setup: async (agentCtx) => {
              // 挂载默认 agent 预设：核心工具（bash/read/write/edit…）是预设里的子插件，
              // 不挂预设的 agent 只能看到宿主全局工具（29 个 harness/browser 类），干不了真活。
              try {
                const presets = agentCtx.get?.('agentPresets') as { mount?: (ctx: unknown, id?: string) => Promise<unknown> } | undefined;
                if (presets && typeof presets.mount === 'function') await presets.mount(agentCtx);
              } catch (err) {
                deps.log.warn(`[personal-workbench] office agent 预设挂载失败: ${err instanceof Error ? err.message : '未知错误'}`);
              }
              try {
                agentCtx.on?.('agent/assistant-stream', officeAgentCapture(npcId));
              } catch { /* 监听失败仅影响进度显示 */ }
            },
          });
          officeAgents.set(npcId, {
            handle,
            entry: { name, role, task, status: 'working', lastText: '', startedAt: Date.now(), updatedAt: Date.now() },
            turnText: '',
          });
          handle.agent.followup({
            content: [{ type: 'text', text: `${officeWorkerSystem(name, role)}\n\n任务：${task}` }],
            source: { kind: 'user' },
          });
          send(res, 200, { ok: true });
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'agent 会话创建失败';
          deps.log.warn(`[personal-workbench] office agent spawn 失败: ${msg}`);
          send(res, 500, { ok: false, error: { code: 'spawn-failed', message: msg } });
        }
        return;
      }
      // office/agent/say：给干活中的 NPC 递话（排队下一轮）
      if (officeEndpoint === 'office/agent/say') {
        const npcId = typeof officeBody.npcId === 'string' ? officeBody.npcId : '';
        const text = typeof officeBody.text === 'string' ? officeBody.text.trim() : '';
        const slot = officeAgents.get(npcId);
        if (!slot?.handle) {
          send(res, 404, { ok: false, error: { code: 'not-found', message: '该同事没有进行中的真实会话' } });
          return;
        }
        if (text === '') {
          send(res, 400, { ok: false, error: { code: 'bad-request', message: 'text 必填' } });
          return;
        }
        try {
          slot.handle.agent.followup({ content: [{ type: 'text', text }], source: { kind: 'user' } });
          slot.entry.status = 'working';
          slot.entry.updatedAt = Date.now();
          send(res, 200, { ok: true });
        } catch (err) {
          const msg = err instanceof Error ? err.message : '递话失败';
          send(res, 500, { ok: false, error: { code: 'say-failed', message: msg } });
        }
        return;
      }
      // office/agent/stop：拆掉 NPC 的真实会话
      if (officeEndpoint === 'office/agent/stop') {
        const npcId = typeof officeBody.npcId === 'string' ? officeBody.npcId : '';
        const slot = officeAgents.get(npcId);
        if (slot?.handle) {
          try {
            void slot.handle.dispose();
          } catch { /* dispose 失败忽略 */ }
        }
        if (slot) {
          slot.handle = null;
          slot.entry.status = 'stopped';
          slot.entry.updatedAt = Date.now();
        }
        send(res, 200, { ok: true });
        return;
      }
      // SSE 流式回复公共骨架：llm 软探测 + 默认模型 + 断连中止 + data: delta/[DONE]
      const officeSse = async (
        systemContent: string,
        msgs: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
      ): Promise<void> => {
        const llm = ctx.get('llm') as { stream?: (options: object) => AsyncIterable<OfficeStreamChunk> } | undefined;
        if (!llm || typeof llm.stream !== 'function') {
          send(res, 501, { error: 'llm service 不可用' });
          return;
        }
        const selection = (ctx.get('agentDefaultModel') as
          | { currentSelection?: () => { provider?: unknown; model?: unknown; reasoningEffort?: unknown } }
          | undefined)?.currentSelection?.();
        const officeProvider = typeof selection?.provider === 'string' && selection.provider !== '' ? selection.provider : '';
        const officeModel = typeof selection?.model === 'string' && selection.model !== '' ? selection.model : '';
        if (officeProvider === '' || officeModel === '') {
          send(res, 501, { error: '默认模型未配置' });
          return;
        }
        const officeCtrl = new AbortController();
        const officeClose = (): void => officeCtrl.abort();
        (req as HttpRequestLike & { on(event: string, fn: () => void): unknown }).on('close', officeClose);
        const officeRes = res as HttpResponseLike & { on?(event: string, fn: () => void): unknown };
        if (typeof officeRes.on === 'function') officeRes.on('close', officeClose);
        res.writeHead(200, {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-cache',
          'connection': 'keep-alive',
          'x-accel-buffering': 'no',
        });
        try {
          const seenKinds = new Map<string, number>();
          let contentChars = 0;
          let lastNonTextChunk: unknown = undefined;
          for await (const chunk of llm.stream({
            provider: officeProvider,
            model: officeModel,
            messages: [
              { role: 'system', content: [{ type: 'text', text: systemContent }] },
              ...msgs.map((m) => ({ role: m.role, content: [{ type: 'text', text: m.content }] })),
            ],
            signal: officeCtrl.signal,
            ...(typeof selection?.reasoningEffort === 'string' && selection.reasoningEffort !== ''
              ? { reasoningEffort: selection.reasoningEffort }
              : {}),
          })) {
            if (officeCtrl.signal.aborted) break;
            const kind = typeof chunk?.type === 'string' ? chunk.type : 'unknown';
            seenKinds.set(kind, (seenKinds.get(kind) ?? 0) + 1);
            if (chunk?.type === 'text-delta' && typeof chunk.text === 'string' && chunk.text !== '') {
              contentChars += chunk.text.length;
              res.write?.(`data: ${JSON.stringify({ delta: chunk.text })}\n\n`);
            } else {
              lastNonTextChunk = chunk;
            }
          }
          if (!officeCtrl.signal.aborted) {
            if (contentChars === 0) {
              // 空流自诊断：finish.reason 内嵌真实失败（{kind:'error'|'aborted', failure:{message,code}}）
              const kinds = [...seenKinds.entries()].map(([k, n]) => `${k}×${n}`).join(',') || '无chunk';
              let detail = '';
              const fin = lastNonTextChunk as { type?: string; reason?: { kind?: string; failure?: { message?: string; code?: string } } } | undefined;
              if (fin?.type === 'finish' && fin.reason && typeof fin.reason === 'object') {
                const f = fin.reason.failure;
                detail = `，原因: ${fin.reason.kind ?? 'unknown'}${f?.code ? `/${f.code}` : ''}${f?.message ? `：${String(f.message).slice(0, 160)}` : ''}`;
              } else if (lastNonTextChunk !== undefined) {
                try {
                  const raw = JSON.stringify(lastNonTextChunk);
                  if (raw && raw !== '{}') detail = `，字段: ${raw.slice(0, 200)}`;
                } catch { /* 序列化失败忽略 */ }
              }
              const msg = `模型未返回正文（chunk: ${kinds}${detail}）`;
              deps.log.warn(`[personal-workbench] office SSE 空流: ${msg}`);
              res.write?.(`data: ${JSON.stringify({ error: msg })}\n\n`);
            }
            res.write?.('data: [DONE]\n\n');
          }
        } catch (officeErr) {
          if (!officeCtrl.signal.aborted) {
            res.write?.(`data: ${JSON.stringify({ error: officeErr instanceof Error ? officeErr.message : String(officeErr) })}\n\n`);
            res.write?.('data: [DONE]\n\n');
          }
        } finally {
          res.end();
        }
      };
      // messages/sceneState 校验（chat 与 npc/chat 共用）；system 由各分支自行组装
      const officeParse = (): { msgs: Array<{ role: 'user' | 'assistant'; content: string }>; sceneState: string } | null => {
        const rawMessages = Array.isArray(officeBody.messages) ? officeBody.messages : [];
        if (rawMessages.length === 0 || rawMessages.length > 200) {
          send(res, 400, { ok: false, error: { code: 'bad-request', message: 'messages 必须为 1..200 条的数组' } });
          return null;
        }
        const msgs: Array<{ role: 'user' | 'assistant'; content: string }> = [];
        for (const item of rawMessages) {
          const msgRole = (item as { role?: unknown })?.role;
          const msgContent = (item as { content?: unknown })?.content;
          if ((msgRole !== 'user' && msgRole !== 'assistant') || typeof msgContent !== 'string' || msgContent.length > 32768) {
            send(res, 400, { ok: false, error: { code: 'bad-request', message: 'messages 每项须含 role(user|assistant) 与 content(string,≤32768)' } });
            return null;
          }
          msgs.push({ role: msgRole, content: msgContent });
        }
        const sceneState = typeof officeBody.sceneState === 'string' ? officeBody.sceneState : '';
        if (sceneState.length > 8192) {
          send(res, 400, { ok: false, error: { code: 'bad-request', message: 'sceneState 超长（>8192）' } });
          return null;
        }
        return { msgs, sceneState };
      };
      // office/npc/chat：同事 agent（职业人设，私聊/群聊/会议共用）
      if (officeEndpoint === 'office/npc/chat') {
        const npcName = typeof officeBody.name === 'string' ? officeBody.name : '';
        const npcRole = typeof officeBody.role === 'string' ? officeBody.role : '';
        if (npcName === '' || npcRole === '') {
          send(res, 400, { ok: false, error: { code: 'bad-request', message: 'name/role 必填' } });
          return;
        }
        const parsedNpc = officeParse();
        if (parsedNpc === null) return;
        await officeSse(officeNpcSystem(npcName, npcRole, parsedNpc.sceneState), parsedNpc.msgs);
        return;
      }
      if (officeEndpoint !== 'office/chat') {
        send(res, 404, { ok: false, error: { code: 'not-found', message: '未知 office 端点' } });
        return;
      }
      // office/chat：办公室场景 AI 助手（SSE 流式）
      const parsedChat = officeParse();
      if (parsedChat === null) return;
      await officeSse(`你是办公室场景 AI 助手，当前场景状态：${parsedChat.sceneState}`, parsedChat.msgs);
      return;
    }
    if ((req.method ?? 'GET').toUpperCase() !== 'POST') {
      send(res, 405, { ok: false, error: { code: 'method-not-allowed', message: '仅支持 POST' } });
      return;
    }
    let endpoint = '';
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      endpoint = decodeURIComponent(url.pathname.startsWith(API_PREFIX) ? url.pathname.slice(API_PREFIX.length) : '')
        .replace(/^\/+/, '')
        .replace(/\/+$/, '');
    } catch {
      send(res, 400, { ok: false, error: { code: 'bad-request', message: '路径不合法' } });
      return;
    }
    if (endpoint === '') {
      send(res, 404, { ok: false, error: { code: 'not-found', message: '缺少端点名' } });
      return;
    }
    if (!endpoint.startsWith('personal-workbench/')) endpoint = `personal-workbench/${endpoint}`;
    try {
      const raw = await readBody(req);
      let payload: unknown = {};
      if (raw.trim() !== '') {
        try {
          payload = JSON.parse(raw);
        } catch {
          send(res, 400, { ok: false, error: { code: 'bad-json', message: '请求体不是合法 JSON' } });
          return;
        }
      }
      const value = await handler(endpoint, payload);
      send(res, 200, { ok: true, value });
    } catch (err) {
      const code = (err as { code?: unknown }).code;
      const message = err instanceof Error ? err.message : String(err);
      // 预期内的业务失败（未授权/不存在/超时）只记 debug 级，避免刷日志
      const expected = code === 'unauthorized' || code === 'not-found' || code === 'unreachable' || code === 'timeout';
      if (expected) deps.log.info(`[personal-workbench] ${endpoint}: ${message}`);
      else deps.log.warn(`[personal-workbench] RPC ${endpoint} 失败: ${message}`);
      send(res, 200, {
        ok: false,
        error: { code: typeof code === 'string' && code !== '' ? code : 'internal', message },
      });
    }
  };

  const attach = (): void => {
    if (attached) return;
    const ws = ctx.get('webServer') as unknown as WebServerLike | undefined;
    if (!ws || typeof ws.register !== 'function') return;
    try {
      const disposer = ws.register({ kind: 'prefix', path: API_PREFIX, handler: httpHandler });
      attached = true;
      if (typeof (disposer as { dispose?: unknown })?.dispose === 'function') {
        ctx.effect(() => () => (disposer as { dispose(): unknown }).dispose());
      }
      deps.log.info(`[personal-workbench] API 已挂载（${API_PREFIX}/<endpoint>）`);
    } catch (err) {
      deps.log.error(`[personal-workbench] API 挂载失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  attach();
  if (!attached) {
    try {
      ctx.on('internal/service', () => attach());
    } catch (err) {
      deps.log.warn(
        `[personal-workbench] internal/service 监听失败（API 可能延迟可用）: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

export { fail as rpcFail };
