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
      case 'personal-workbench/kb/search': {
        const p = asRecord(payload);
        const query = asString(p.query, 'query', 200);
        return await deps.knowledge.search(query);
      }

      // ── 天气（外联代理：Nominatim 街道级反查 + open-meteo 实况；无 key 免费服务）──
      case 'personal-workbench/weather/fetch': {
        const p = asRecord(payload);
        const lat = Number(p.lat);
        const lon = Number(p.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) fail('bad-request', '坐标不合法');
        const ua = 'dsh-personal-workbench/1.0 (local harness plugin)';
        const [geoRes, wxRes] = await Promise.all([
          fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&zoom=18&accept-language=zh-CN&format=json`, { headers: { 'user-agent': ua } }),
          fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code,relative_humidity_2m,wind_speed_10m`, { headers: { 'user-agent': ua } }),
        ]);
        if (!geoRes.ok || !wxRes.ok) fail('bad-gateway', '气象服务不可达');
        const geo = (await geoRes.json()) as { display_name?: string; address?: Record<string, string> };
        const wx = (await wxRes.json()) as { current?: { temperature_2m?: number; weather_code?: number; relative_humidity_2m?: number; wind_speed_10m?: number } };
        const a = geo.address ?? {};
        // 具体到街巷：门牌/道路 → 街区 → 区 → 市
        const place = [a.house_number, a.road, a.neighbourhood, a.suburb, a.city ?? a.town ?? a.county].filter(Boolean).join(' ');
        const c = wx.current ?? {};
        return {
          place: place || geo.display_name || '当前位置',
          temp: Math.round(c.temperature_2m ?? 0),
          code: c.weather_code ?? 0,
          humidity: Math.round(c.relative_humidity_2m ?? 0),
          wind: Math.round(c.wind_speed_10m ?? 0),
          updated: new Date().toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
        };
      }

      // ── IP 定位兜底（geolocation 被宿主拒绝时用；ip-api.com 免费无 key，中文）──
      case 'personal-workbench/geo/ip': {
        const res = await fetch('http://ip-api.com/json/?lang=zh-CN&fields=status,lat,lon,city,regionName');
        if (!res.ok) fail('bad-gateway', '定位服务不可达');
        const geo = (await res.json()) as { status?: string; lat?: number; lon?: number; city?: string; regionName?: string };
        if (geo.status !== 'success' || typeof geo.lat !== 'number' || typeof geo.lon !== 'number') fail('bad-gateway', '定位失败');
        return { lat: geo.lat, lon: geo.lon, city: [geo.regionName, geo.city].filter(Boolean).join(' ') };
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
        if (!/^[\w .()（）\-·、]+$/.test(name)) fail('bad-request', '应用名含非法字符');
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
