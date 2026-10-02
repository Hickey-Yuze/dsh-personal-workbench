/**
 * 兼容层 —— 让从 Yuze Workbench 搬来的待办看板源码「零改动」跑在插件里。
 *
 * 被替换掉的宿主依赖：
 *   · @lark-apaas/client-toolkit-lite → scopedStorage（同步 API，底层 localStorage，
 *     写入时异步同步一份到插件自己的数据目录，保证数据仍落 ~/.dsh/personal-workbench/）
 *   · sonner                          → 轻量 DOM toast（不引第三方，样式由插件 CSS 提供）
 *   · @/lib/desktop, @/lib/archiveSync → 非 Electron 的降级实现
 *   · react-router-dom                → 插件内的模块跳转
 *
 * 关键约束：scopedStorage 会被组件在**渲染期同步调用**，所以它不能是 hook、不能是异步。
 */
import type { KbEntry } from '../../../../../src/contract.js';
import type { RpcFn } from '../../../rpc.js';

/* ───────────────────────── 桥（由 TodoView 注入） ───────────────────────── */

interface Bridge {
  rpc: RpcFn;
  openModule?: (id: string) => void;
}

let bridge: Bridge | null = null;

export function attachWorkbenchBridge(next: Bridge): void {
  bridge = next;
}

/* ───────────────────────── scopedStorage ───────────────────────── */

const LS_PREFIX = 'dsh-pwb:';

/** 落盘到插件目录的节流器：合并 300ms 内的连续写入，避免拖拽时打爆 RPC。 */
const pending = new Map<string, string>();
let flushTimer: number | null = null;

function flush(): void {
  flushTimer = null;
  const entries = [...pending.entries()];
  pending.clear();
  const b = bridge;
  if (b === null) return;
  for (const [key, value] of entries) {
    let parsed: unknown = value;
    try {
      parsed = JSON.parse(value) as unknown;
    } catch {
      /* 非 JSON 值按原样存 */
    }
    void b.rpc('personal-workbench/store/write', { key, value: parsed }).catch(() => {
      /* 宿主未就绪时静默：localStorage 里仍有副本 */
    });
  }
}

export const scopedStorage = {
  getItem(key: string): string | null {
    try {
      return window.localStorage.getItem(LS_PREFIX + key);
    } catch {
      return null;
    }
  },
  setItem(key: string, value: string): void {
    try {
      window.localStorage.setItem(LS_PREFIX + key, value);
    } catch {
      /* 配额满等情况：继续走落盘 */
    }
    pending.set(key, value);
    if (flushTimer === null) flushTimer = window.setTimeout(flush, 300);
  },
  removeItem(key: string): void {
    try {
      window.localStorage.removeItem(LS_PREFIX + key);
    } catch {
      /* ignore */
    }
  },
};

/* ───────────────────────── toast ───────────────────────── */

type ToastKind = 'success' | 'error' | 'info' | 'warning';

function toastHost(): HTMLElement {
  const id = 'dsh-pwb-toasts';
  const found = document.getElementById(id);
  if (found !== null) return found;
  const host = document.createElement('div');
  host.id = id;
  host.className = 'dsh-pwb-toasts';
  document.body.appendChild(host);
  return host;
}

function push(kind: ToastKind, message: string): void {
  if (typeof document === 'undefined') return;
  const el = document.createElement('div');
  el.className = `dsh-pwb-toast dsh-pwb-toast-${kind}`;
  el.textContent = message;
  toastHost().appendChild(el);
  window.setTimeout(() => {
    el.classList.add('dsh-pwb-toast-out');
    window.setTimeout(() => el.remove(), 220);
  }, 2600);
}

export const toast = {
  success: (m: string): void => push('success', m),
  error: (m: string): void => push('error', m),
  info: (m: string): void => push('info', m),
  warning: (m: string): void => push('warning', m),
  message: (m: string): void => push('info', m),
};

/* ───────────────────────── 文件系统降级 ───────────────────────── */

export interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  modified?: number;
  extension?: string;
  children?: FileNode[];
}

export const isElectron = false;
export const storageMode: 'electron' | 'fsa' | 'vfs' = 'vfs';

function toNode(entry: KbEntry): FileNode {
  return {
    name: entry.name,
    path: entry.path,
    type: entry.kind === 'dir' ? 'directory' : 'file',
    extension: entry.kind === 'file' && entry.name.includes('.') ? entry.name.split('.').pop() : undefined,
  };
}

/**
 * 非 Electron 环境下的「文件树」：这里接到本机的 Obsidian 知识库（Host 侧代理，仅回环）。
 * 每层只多请求一次子目录，够画 3D 环上的文件夹与计数。
 */
async function readTree(): Promise<FileNode | null> {
  const b = bridge;
  if (b === null) return null;
  const res = await b.rpc('personal-workbench/kb/list', { path: '' });
  if (!res.ok) return null;
  const entries = (res.value?.entries ?? []) as KbEntry[];
  const children: FileNode[] = [];
  for (const entry of entries) {
    if (entry.kind !== 'dir') {
      children.push(toNode(entry));
      continue;
    }
    let sub: FileNode[] = [];
    try {
      const inner = await b.rpc('personal-workbench/kb/list', { path: entry.path });
      if (inner.ok) sub = ((inner.value?.entries ?? []) as KbEntry[]).map(toNode);
    } catch {
      /* 子目录读不到就当空 */
    }
    children.push({ ...toNode(entry), children: sub });
  }
  return { name: '知识库', path: '', type: 'directory', children };
}

export const desktopApi = {
  openDirectory: (): Promise<FileNode | null> => readTree(),
  openDirectoryAt: (_dir?: string): Promise<FileNode | null> => readTree(),
  listDirectory: async (): Promise<FileNode[] | null> => (await readTree())?.children ?? null,
  openFile: async (): Promise<void> => undefined,
  readFile: async (): Promise<string> => '',
  writeFile: async (): Promise<boolean> => false,
  createFile: async (): Promise<boolean> => false,
  createDirectory: async (): Promise<boolean> => false,
  deleteItem: async (): Promise<boolean> => false,
  renameItem: async (): Promise<boolean> => false,
  saveFileByDialog: async (): Promise<boolean> => false,
  openFileByDialog: async (): Promise<{ path: string; content: string } | null> => null,
};

/* ───────────────────────── 归档根目录（沿用原键名） ───────────────────────── */

export const ARCHIVE_ROOT_KEY = 'archive_root_v1';
export const ARCHIVE_LEGACY_OVERVIEW_KEY = 'overview_archive_root_v1';
export const ARCHIVE_CHANGED_EVENT = 'dsh-pwb-archive-changed';

/** 未配置归档根目录时的回落目标：本机知识库根（3D 环因此直接展示知识库目录结构）。 */
const KB_FALLBACK_ROOT = 'kb:/';

export function getArchiveRoot(): string | null {
  const stored = scopedStorage.getItem(ARCHIVE_ROOT_KEY) ?? scopedStorage.getItem(ARCHIVE_LEGACY_OVERVIEW_KEY);
  // 文件归档模块还没落地，先回落到本机知识库；一旦配置过归档根目录就以配置为准。
  return stored !== null && stored !== '' ? stored : KB_FALLBACK_ROOT;
}

export function setArchiveRoot(root: string): void {
  scopedStorage.setItem(ARCHIVE_ROOT_KEY, root);
  notifyArchiveChanged('root');
}

export function notifyArchiveChanged(type: 'root' | 'content' = 'content'): void {
  window.dispatchEvent(new CustomEvent(ARCHIVE_CHANGED_EVENT, { detail: { type } }));
}

export function onArchiveChanged(cb: (type: 'root' | 'content') => void): () => void {
  const handler = (e: Event): void => {
    const detail = (e as CustomEvent<{ type?: 'root' | 'content' }>).detail;
    cb(detail?.type ?? 'content');
  };
  window.addEventListener(ARCHIVE_CHANGED_EVENT, handler);
  return () => window.removeEventListener(ARCHIVE_CHANGED_EVENT, handler);
}

/* ───────────────────────── 路由 ───────────────────────── */

/** 原项目用 react-router 的 useNavigate；插件里换成模块跳转（无路由）。 */
export function useNavigate(): (to: string) => void {
  return (to: string) => {
    const id = to.replace(/^\//, '');
    bridge?.openModule?.(id === '' ? 'overview' : id);
  };
}
