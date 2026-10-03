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
  'personal-workbench/fs/list': { path?: string };
  'personal-workbench/fs/read': { path: string };
  'personal-workbench/fs/open': { path: string };
  'personal-workbench/fs/write': { path: string; content: string };
  'personal-workbench/kb/search': { query: string };
}

/** 端点名 → 响应值。 */
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
  'personal-workbench/fs/read': { path: string; kind: 'text'; content: string; bytes: number } | { path: string; kind: 'image'; dataUrl: string; bytes: number };
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
