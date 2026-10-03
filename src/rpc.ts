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

/** 文件归档路径安全解析：HOME 相对、禁 ..、realpath 校验防 symlink 逃逸。 */
function fsResolveSafe(rel: string): string {
  const home = process.env.HOME ?? '';
  if (home === '') throw Object.assign(new Error('无法定位主目录'), { code: 'internal' });
  const parts = rel.split('/').filter((x) => x !== '' && x !== '.');
  if (parts.includes('..')) throw Object.assign(new Error('路径不允许包含 ..'), { code: 'bad-path' });
  const abs = [home, ...parts].join('/');
  if (!abs.startsWith(home)) throw Object.assign(new Error('路径越界'), { code: 'bad-path' });
  try {
    const real = fs.realpathSync(abs);
    if (!real.startsWith(fs.realpathSync(home))) throw Object.assign(new Error('路径越界（符号链接）'), { code: 'bad-path' });
  } catch (e) {
    if ((e as { code?: string }).code === 'bad-path') throw e;
    throw Object.assign(new Error('路径不存在'), { code: 'not-found' });
  }
  return abs;
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
      case 'personal-workbench/fs/list': {
        const p = asRecord(payload);
        const rel = typeof p.path === 'string' ? p.path : '';
        const abs = fsResolveSafe(rel);
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
        const abs = fsResolveSafe(rel);
        const st = fs.statSync(abs);
        if (!st.isFile()) fail('bad-request', '不是文件');
        if (st.size > 2 * 1024 * 1024) fail('too-large', '文件超过 2MB，不支持预览（可用系统程序打开）');
        const ext = rel.split('.').pop()?.toLowerCase() ?? '';
        const TEXT_EXT = new Set(['md', 'txt', 'json', 'csv', 'log', 'yaml', 'yml', 'js', 'jsx', 'ts', 'tsx', 'py', 'sh', 'html', 'css', 'xml', 'ini', 'conf', 'env', 'sql']);
        if (!TEXT_EXT.has(ext)) fail('unsupported', '该类型不支持文本预览（可用系统程序打开）');
        return { path: rel, content: fs.readFileSync(abs, 'utf8'), bytes: st.size };
      }
      case 'personal-workbench/fs/open': {
        const p = asRecord(payload);
        const rel = typeof p.path === 'string' ? p.path : '';
        const abs = fsResolveSafe(rel);
        await new Promise<void>((resolve, reject) => {
          execFile('open', [abs], { timeout: 10_000 }, (err) => (err ? reject(err) : resolve()));
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
