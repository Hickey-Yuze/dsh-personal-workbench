/**
 * 员工「待办事项」——员工档案里手写的一行一条活，勾选即完成。
 * 存 `~/.dsh/personal-workbench/office_todos/<charId>.json`（每个员工最多 50 条）。
 *
 * 「自觉工作」开着且空闲时，按创建顺序取**第一条未完成**的待办派给自己（派出去即自动打勾，
 * 打勾条目会记下派出时间/派给谁；在档案里取消勾选 = 允许再派一次）。读写静默失败 = 空列表。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const TODO_DIR = path.join(`${process.env.HOME ?? ''}/.dsh/personal-workbench`, 'office_todos');
/** 每个员工最多保留的待办条数（超出先丢最旧的已完成项）。 */
const MAX_TODOS = 50;
/** 单条待办文本上限（防止粘一整篇文档进来）。 */
const TEXT_MAX = 200;

export type OfficeTodo = {
  /** 稳定 id（客户端勾选/删除用）。 */
  id: string;
  text: string;
  /** 创建时间。 */
  at: number;
  /** 打勾时间（未完成 = undefined）。 */
  doneAt?: number;
  /** 自动派活时间（= 派出去时自动打勾的时间）。 */
  dispatchedAt?: number;
  /** 派给了谁（员工名，便于回溯这条是自己派的还是自觉得的）。 */
  dispatchedTo?: string;
};

/** charId 只允许 ASCII 安全字符（与员工 id 约定一致）。 */
function safeCharId(charId: string): string {
  const safe = charId.replace(/[^A-Za-z0-9_-]/g, '');
  return safe === '' ? 'unknown' : safe;
}

/** 该员工的待办文件路径。 */
export function todoFile(charId: string): string {
  return path.join(TODO_DIR, `${safeCharId(charId)}.json`);
}

/** 读该员工待办（文件不存在/坏 JSON = 空列表）。 */
export function loadTodos(charId: string): OfficeTodo[] {
  try {
    const obj: unknown = JSON.parse(fs.readFileSync(todoFile(charId), 'utf8'));
    const list = typeof obj === 'object' && obj !== null ? (obj as { todos?: unknown }).todos : undefined;
    if (!Array.isArray(list)) return [];
    return list.filter(
      (t): t is OfficeTodo =>
        typeof t === 'object' && t !== null && typeof (t as OfficeTodo).id === 'string' && typeof (t as OfficeTodo).text === 'string',
    );
  } catch {
    return [];
  }
}

/** 落盘（失败抛错：调用方决定是报错还是静默）。 */
function persist(charId: string, list: OfficeTodo[]): void {
  fs.mkdirSync(TODO_DIR, { recursive: true });
  fs.writeFileSync(todoFile(charId), JSON.stringify({ todos: list }));
}

/** 加一条待办（空文本忽略），返回最新列表。 */
export function addTodo(charId: string, text: string): OfficeTodo[] {
  const clean = text.trim().slice(0, TEXT_MAX);
  const list = loadTodos(charId);
  if (clean === '') return list;
  list.push({ id: `td-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`, text: clean, at: Date.now() });
  while (list.length > MAX_TODOS) {
    const doneIdx = list.findIndex((t) => t.doneAt !== undefined);
    list.splice(doneIdx >= 0 ? doneIdx : 0, 1);
  }
  persist(charId, list);
  return list;
}

/** 勾选/取消勾选（取消勾选顺带清掉派活痕迹 = 允许再派一次）。 */
export function toggleTodo(charId: string, id: string): OfficeTodo[] {
  const list = loadTodos(charId);
  const t = list.find((x) => x.id === id);
  if (t === undefined) return list;
  if (t.doneAt === undefined) {
    t.doneAt = Date.now();
  } else {
    delete t.doneAt;
    delete t.dispatchedAt;
    delete t.dispatchedTo;
  }
  persist(charId, list);
  return list;
}

/** 删一条；没删到返回 false。 */
export function removeTodo(charId: string, id: string): boolean {
  const list = loadTodos(charId);
  const next = list.filter((t) => t.id !== id);
  if (next.length === list.length) return false;
  persist(charId, next);
  return true;
}

/** 清空该员工待办。 */
export function clearTodos(charId: string): void {
  persist(charId, []);
}

/** 第一条未完成的待办（自觉工作的任务源）；没有 = undefined。 */
export function takeTodo(charId: string): OfficeTodo | undefined {
  return loadTodos(charId).find((t) => t.doneAt === undefined);
}

/** 派活后自动打勾（记录派活时间与派给谁；已打勾的不动）。 */
export function markTodoDone(charId: string, id: string, who: string): void {
  const list = loadTodos(charId);
  const t = list.find((x) => x.id === id);
  if (t === undefined || t.doneAt !== undefined) return;
  t.doneAt = Date.now();
  t.dispatchedAt = t.doneAt;
  t.dispatchedTo = who;
  persist(charId, list);
}
