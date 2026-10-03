/**
 * Host↔Client RPC 类型契约（唯一事实源）：**仅类型**，两端 import type 引用，
 * esbuild 构建期被擦除，不产生运行时依赖。字段与 src/rpc.ts 的手工校验一一对应。
 */

/** 待办事项。 */
export interface TodoItem {
  id: string;
  title: string;
  done: boolean;
  /** 分组（看板列）。 */
  group: string;
  priority: 'low' | 'normal' | 'high';
  /** 截止日 YYYY-MM-DD。 */
  due?: string;
  note?: string;
  createdAt: string;
  completedAt?: string;
}

/** 日程 / 日常管理条目。 */
export interface ScheduleEvent {
  id: string;
  title: string;
  /** YYYY-MM-DD。 */
  date: string;
  startTime?: string;
  endTime?: string;
  location?: string;
  done?: boolean;
  createdAt: string;
}

/** 知识库目录条目。 */
export interface KbEntry {
  name: string;
  path: string;
  kind: 'file' | 'dir';
}

export interface KbSearchHit {
  path: string;
  score: number;
  matches: number;
  snippet: string;
}

/** 端点名 → 请求载荷。 */
export interface PersonalWorkbenchRequestMap {
  'personal-workbench/apps/list': Record<string, never>;
  'personal-workbench/apps/open': { name: string };
  'personal-workbench/weather/fetch': { lat: number; lon: number; fallbackPlace?: string };
  'personal-workbench/weather/air': { lat: number; lon: number };
  'personal-workbench/geo/ip': Record<string, never>;
  'personal-workbench/holidays/fetch': { year: number };
  'personal-workbench/store/read': { key: string };
  'personal-workbench/store/write': { key: string; value: unknown };
  'personal-workbench/kb/list': { path?: string };
  'personal-workbench/kb/read': { path: string };
  'personal-workbench/kb/write': { path: string; content: string };
  'personal-workbench/fs/list': { path?: string; root?: string };
  'personal-workbench/fs/roots/list': Record<string, never>;
  'personal-workbench/music/search': { q: string; page?: number; proxy?: string };
  'personal-workbench/music/singer': { name: string };
  'personal-workbench/music/source': { id: string; quality?: string };
  'personal-workbench/music/discover': Record<string, never>;
  'personal-workbench/video/search': { q: string };
  'personal-workbench/video/category': { t: string; pg: number };
  'personal-workbench/video/detail': { id: string };
  'personal-workbench/video/discover': Record<string, never>;
  'personal-workbench/video/douban': { type: string; tag: string; pageLimit?: number; pageStart?: number };
  'personal-workbench/music/detail': { id: string; proxy?: string };
  'personal-workbench/music/import': { link: string; proxy?: string };
  'personal-workbench/fs/roots/pick': Record<string, never>;
  'personal-workbench/fs/roots/add': { path: string };
  'personal-workbench/fs/roots/remove': { path: string };
  'personal-workbench/fs/read': { path: string; root?: string };
  'personal-workbench/fs/open': { path: string; root?: string };
  'personal-workbench/fs/write': { path: string; content: string; root?: string };
  'personal-workbench/kb/search': { query: string };
}

/** 端点名 → 响应值。 */
export type VideoBrief = { id: string; name: string; pic?: string; remarks?: string; typeName?: string; year?: string };

export interface PersonalWorkbenchResponseMap {
  'personal-workbench/apps/list': { apps: string[] };
  'personal-workbench/apps/open': { ok: boolean; name: string };
  'personal-workbench/weather/fetch': {
    place: string; temp: number; code: number; humidity: number; feels: number; wind: number; updated: string;
    hourly: Array<{ time: string; temp: number; code: number }>;
    daily: Array<{ date: string; code: number; max: number; min: number }>;
  };
  'personal-workbench/weather/air': { aqi: number; pm10: number; pm25: number };
  'personal-workbench/geo/ip': { lat: number; lon: number; city: string };
  'personal-workbench/holidays/fetch': Record<string, { holiday: boolean; name: string; date: string }>;
  'personal-workbench/store/read': { key: string; value: unknown };
  'personal-workbench/store/write': { key: string; bytes: number };
  'personal-workbench/kb/list': { entries: KbEntry[]; total: number; dir: string };
  'personal-workbench/kb/read': { path: string; content: string; bytes: number };
  'personal-workbench/kb/write': { path: string; bytes: number };
  'personal-workbench/fs/list': { entries: Array<{ name: string; path: string; kind: 'dir' | 'file' }>; root: string };
  'personal-workbench/fs/roots/list': { roots: string[]; home: string };
  'personal-workbench/music/search': { songs: Array<{ id: string; title: string; artist: string; album: string; duration: number; audioUrl: string; coverUrl?: string }>; isEnd: boolean; total: number };
  'personal-workbench/music/singer': { name: string; songs: Array<{ id: string; title: string; artist: string; album: string; duration: number; audioUrl: string; coverUrl?: string }> };
  'personal-workbench/music/source': { url: string };
  'personal-workbench/music/discover': { hot: Array<{ id: string; title: string; artist: string; album: string; duration: number; coverUrl?: string | undefined }>; douyin: Array<{ id: string; title: string; artist: string; album: string; duration: number; coverUrl?: string | undefined }>; singers: Array<{ name: string; coverUrl: string | undefined; sample: { id: string; title: string; artist: string } | null }> };
  'personal-workbench/video/search': { items: VideoBrief[] };
  'personal-workbench/video/category': { items: VideoBrief[]; total: number; pagecount: number };
  'personal-workbench/video/detail': { name: string; pic?: string; year?: string; typeName?: string; actor?: string; director?: string; content?: string; remarks?: string; lines: Array<{ name: string; episodes: Array<{ name: string; url: string }> }> };
  'personal-workbench/video/discover': { blocks: Array<{ key: string; title: string; items: VideoBrief[] }> };
  'personal-workbench/video/douban': { subjects: Array<{ title: string; rate: string; cover?: string }> };
  'personal-workbench/music/detail': { lyrics: Array<{ time: number; text: string }>; coverUrl?: string };
  'personal-workbench/music/import': { queries: string[]; songs: Array<{ id: string; title: string; artist: string; album: string; duration: number; audioUrl: string; coverUrl?: string }> };
  'personal-workbench/fs/roots/pick': { ok: boolean; path: string; roots: string[] } | { ok: false; code: 'cancelled' };
  'personal-workbench/fs/roots/add': { ok: boolean; roots: string[] };
  'personal-workbench/fs/roots/remove': { ok: boolean };
  'personal-workbench/fs/read': { path: string; kind: 'text'; content: string; bytes: number };
  'personal-workbench/fs/open': { ok: boolean; path: string };
  'personal-workbench/fs/write': { ok: boolean; path: string; bytes: number };
  'personal-workbench/kb/search': { hits: KbSearchHit[]; total: number };
}

export type PersonalWorkbenchEndpoint = keyof PersonalWorkbenchRequestMap;

/** 宿主 RPC 信封（ok=false 时 value 缺省、error 必填）。 */
export interface RpcEnvelope<T> {
  ok: boolean;
  value?: T;
  error?: { code: string; message: string };
}
