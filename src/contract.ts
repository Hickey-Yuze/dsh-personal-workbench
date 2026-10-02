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
  'personal-workbench/store/read': { key: string };
  'personal-workbench/store/write': { key: string; value: unknown };
  'personal-workbench/kb/list': { path?: string };
  'personal-workbench/kb/read': { path: string };
  'personal-workbench/kb/search': { query: string };
}

/** 端点名 → 响应值。 */
export interface PersonalWorkbenchResponseMap {
  'personal-workbench/apps/list': { apps: string[] };
  'personal-workbench/apps/open': { ok: boolean; name: string };
  'personal-workbench/store/read': { key: string; value: unknown };
  'personal-workbench/store/write': { key: string; bytes: number };
  'personal-workbench/kb/list': { entries: KbEntry[]; total: number; dir: string };
  'personal-workbench/kb/read': { path: string; content: string; bytes: number };
  'personal-workbench/kb/search': { hits: KbSearchHit[]; total: number };
}

export type PersonalWorkbenchEndpoint = keyof PersonalWorkbenchRequestMap;

/** 宿主 RPC 信封（ok=false 时 value 缺省、error 必填）。 */
export interface RpcEnvelope<T> {
  ok: boolean;
  value?: T;
  error?: { code: string; message: string };
}
