/**
 * dsh-personal-workbench — browser half（TS/TSX 源，scripts/build-client.mjs 经 esbuild
 * 打包为 dist/client.js 单文件 bundle）。
 *
 * 1. 侧栏入口（DOM 注入）：插在「定时任务」（dsh-cron-board 注入的入口按钮）正下方；
 *    cron 入口尚未挂载时退化为插在「新会话」行之后，cron 出现后由 MutationObserver
 *    自动把我的按钮移到它下面——因此顺序恒为「新会话 → 定时任务 → 个人工作台」。
 * 2. 中央面板（main 键位，key = dsh-personal-workbench，不遮蔽会话页）。
 *
 * 产物形态对齐官方 client bundle 的 handoff 协议：
 *   window.__ModuleLoader__.load({ id, factory })，
 *   factory(require) 返回 { apply, inject }（wrapper 由构建脚本生成）。
 */
import { ctxGet, type WorkbenchClientCtx } from './env.js';
import { initI18n, t } from './i18n.js';
import { PANEL_ID, WorkbenchPanel } from './panel.js';
import { makeRpc } from './rpc.js';
import { setSessionFinder, setSessionOpener, type JumpReport } from './sessionNav.js';
import { ensureThemeStyle } from './theme.js';

export const inject = ['slots', 'layout', 'locale'];

/** uiWorkspace 的最小结构（宿主客户端服务：openSession + 它持有的 sessions 控制器）。 */
type OfficeUiWorkspace = {
  openSession?: (target: unknown) => void;
  sessions?: OfficeSessionsService;
};

/** 宿主 Session Controller（客户端）：retain 标 mainView 决定主区显示哪个会话。 */
type OfficeSessionsService = {
  retain?: (target: string, options: { source: string }) => unknown;
  list?: {
    getSnapshot?: () => {
      ids?: unknown;
      byId?: Record<string, { title?: unknown; retainedBy?: { mainView?: number } }>;
    };
  };
};

/** 宿主 shortcuts 服务（客户端）：invoke 跑注册过的命令，用来展开左栏。 */
type OfficeShortcutsService = { invoke?: (id: string, context: unknown) => unknown };

async function jumpLanded(sessionId: string): Promise<boolean> {
  await new Promise((resolve) => setTimeout(resolve, 260));
  if (typeof document === 'undefined') return true;
  if (document.querySelector('.dsh-pwb-view') === null) return true;
  const row = document.querySelector<HTMLElement>(`[data-row-key="session:${sessionId}"]`);
  return row !== null && /selected/i.test(row.className);
}

/**
 * 兜底跳转：直接点宿主侧栏里那一行会话（宿主用 data-row-key 标记行）。
 * 会话所在分组可能折叠着，先展开折叠的分组与「更多」折叠按钮，等 React 重渲染后再找一次。
 */
async function clickSidebarSessionRow(sessionId: string, expandSidebar: () => void): Promise<boolean> {
  if (typeof document === 'undefined') return false;
  const find = (): HTMLElement | null => document.querySelector<HTMLElement>(`[data-row-key="session:${sessionId}"]`);
  let row = find();
  if (row === null) {
    // 分组折叠 / 会话被「更多」收起的：先展开折叠分组与折叠按钮，等 React 重渲染后再找
    for (const node of Array.from(document.querySelectorAll<HTMLElement>('[data-row-key^="workspace:"][aria-expanded="false"]'))) node.click();
    for (const node of Array.from(document.querySelectorAll<HTMLElement>('[data-row-key^="overflow:"]'))) node.click();
    await new Promise((resolve) => setTimeout(resolve, 180));
    row = find();
  }
  if (row === null && document.querySelector('[data-row-key^="session:"]') === null) {
    // 一处会话行都没有 = 整个左栏收起着：先让宿主把左栏展开，再找一次
    expandSidebar();
    await new Promise((resolve) => setTimeout(resolve, 240));
    row = find();
  }
  if (row === null) return false;
  row.scrollIntoView({ block: 'nearest' });
  row.click();
  return true;
}

/** 「个人工作台」图标：四宫格 + 底部基线。 */
const ICON_SVG =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>';

/**
 * 侧栏入口按钮的 DOM 注入。
 * root = logoRow 的父元素（与 dsh-cron-board 同一结构判定）；
 * 锚点优先级：定时任务按钮 > 新会话按钮。
 */
function injectSidebarEntry(ctx: WorkbenchClientCtx): () => void {
  const ROW_ATTR = 'data-dsh-personal-workbench-entry';
  const ROW_SELECTOR = `[${ROW_ATTR}]`;
  const CRON_SELECTOR = '[data-dsh-cron-board-entry]';

  // DOM 级幂等：重复 apply / HMR 重注入 / 残留模块再次挂载时绝不创建第二个入口
  if (typeof document !== 'undefined' && document.querySelector(ROW_SELECTOR) !== null) {
    return () => {};
  }

  let disposed = false;
  let root: HTMLElement | undefined;
  let placed = false;
  let rootObserver: MutationObserver | undefined;
  let bodyObserver: MutationObserver | undefined;
  let resizeObserver: ResizeObserver | undefined;
  let observedRef: HTMLElement | undefined;

  /** 侧栏 UI root：column > wrapper > root(logoRow 所有者)。 */
  function sidebarRoot(): HTMLElement | undefined {
    const column = document.querySelector<HTMLElement>('[data-pane="sidebar"], [class*="sidebarCol"]');
    if (column === null) return undefined;
    const logoOwner = column.querySelector<HTMLElement>('[class*="logoRow"]')?.parentElement;
    return logoOwner ?? (column.firstElementChild as HTMLElement | undefined);
  }

  /** 「新会话」按钮：当前 shell 嵌在 logo 行里，旧 shell 是 root 直接子级。 */
  function newSessionButton(r: HTMLElement): HTMLButtonElement | undefined {
    const nested = r.querySelector<HTMLButtonElement>('button[class*="newSession"]');
    if (nested != null) return nested;
    for (const child of r.children) {
      if (child.tagName === 'BUTTON') return child as HTMLButtonElement;
    }
    return undefined;
  }

  /** 锚点元素：优先「定时任务」入口，其次「新会话」按钮（或其所在行）。 */
  function anchorElement(r: HTMLElement): HTMLElement | undefined {
    const cron = r.querySelector<HTMLElement>(CRON_SELECTOR);
    if (cron !== null && cron.isConnected) return cron;
    const newBtn = newSessionButton(r);
    if (newBtn === undefined) return undefined;
    const row = newBtn.closest<HTMLElement>('[class*="logoRow"]');
    return row !== null && row.parentElement === r ? row : newBtn;
  }

  /** 入口按钮（detach 状态创建一次；shell 重建时整体重插）。 */
  function createEntry(): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute(ROW_ATTR, '');
    btn.className = 'dsh-pwb-sidebar-btn';
    btn.setAttribute('aria-label', t('panel.label'));
    btn.title = t('panel.label');
    // 接线标记：构建脚本检查产物含该字符串；UI 由本 DOM 注入提供。
    btn.dataset.wire = 'sidebar-entry';
    btn.dataset.panel = PANEL_ID;
    btn.innerHTML = `<span class="dsh-pwb-sidebar-icon">${ICON_SVG}</span><span class="dsh-pwb-sidebar-label"></span>`;
    const label = btn.querySelector<HTMLElement>('.dsh-pwb-sidebar-label');
    if (label) label.textContent = t('panel.label');
    btn.addEventListener('click', () => {
      ctx.layout.selectPanel(PANEL_ID);
    });
    return btn;
  }

  const entry = createEntry();

  /**
   * 与宿主「新会话」按钮同步**宽度**（侧栏拖动时跟随）。
   * 水平位置交给 CSS 的 `margin: 4px auto 8px !important` —— 与 dsh-cron-board 一致：
   * 该 !important 本来就会覆盖 inline margin-left，写它只会造成两套几何互相打架。
   */
  function syncGeometry(reference: HTMLElement | undefined): void {
    if (reference === undefined) return;
    const apply = (): void => {
      if (disposed || !reference.isConnected) return;
      const width = `${Math.round(reference.getBoundingClientRect().width)}px`;
      // 仅在数值真的变化时写 DOM：MutationObserver 回调频繁，避免无意义样式写入
      if (entry.style.width !== width) entry.style.width = width;
    };
    apply();
    if (observedRef !== reference) {
      resizeObserver?.disconnect();
      resizeObserver = new ResizeObserver(apply);
      resizeObserver.observe(reference);
      observedRef = reference;
    }
  }

  /** 把入口摆到锚点之后（幂等：位置正确时什么都不做，避免 observer 抖动）。 */
  function placeEntry(r: HTMLElement): boolean {
    const anchor = anchorElement(r);
    if (anchor === undefined) return false;
    if (entry.parentElement !== r) {
      r.insertBefore(entry, anchor.nextElementSibling);
    } else if (entry.previousElementSibling !== anchor) {
      // 「定时任务」按钮晚于本入口出现：重新贴到它下面
      anchor.insertAdjacentElement('afterend', entry);
    }
    syncGeometry(newSessionButton(r) ?? anchor);
    return true;
  }

  function tryPlace(): void {
    if (disposed) return;
    if (root !== undefined && !root.isConnected) {
      // shell 重建了整个侧栏 pane：root observer 随旧树消亡，从头重查。
      rootObserver?.disconnect();
      rootObserver = undefined;
      root = undefined;
      placed = false;
    }
    if (placed) {
      if (document.body.contains(entry)) return; // 仍挂着：廉价短路
      rootObserver?.disconnect();
      rootObserver = undefined;
      root = undefined;
      placed = false;
    }
    root ??= sidebarRoot();
    if (root === undefined) return;
    placed = placeEntry(root);
    if (placed) {
      rootObserver ??= new MutationObserver(() => {
        if (root === undefined || !root.isConnected) {
          placed = false;
          tryPlace();
          return;
        }
        // 位置漂移（定时任务入口后到、React 重排）→ 重新贴合
        if (!root.contains(entry)) placed = placeEntry(root);
        else placeEntry(root);
      });
      rootObserver.observe(root, { childList: true, subtree: true });
    }
  }

  // body 级 watcher：整树重建的兜底（root observer 随旧树消亡时只有它能发现新 pane）。
  bodyObserver = new MutationObserver(() => tryPlace());
  bodyObserver.observe(document.body, { childList: true, subtree: true });
  tryPlace();

  return () => {
    disposed = true;
    rootObserver?.disconnect();
    bodyObserver?.disconnect();
    resizeObserver?.disconnect();
    entry.remove();
  };
}

export function apply(ctx: WorkbenchClientCtx): void {
  const rpc = makeRpc();
  initI18n(ctx.locale);
  ensureThemeStyle();

  /* 「跳到会话」桥：宿主 uiWorkspace.openSession(id) 把主区切到该会话（侧栏随之把该行标为当前）。
     服务软取（每次调用时再取：workspace UI 插件可能晚于本插件挂载）：ctxGet → ctx.root.get → ctx 属性。 */
  /* 宿主客户端服务必须先 inject 才能访问——否则 cordis 直接抛
     `cannot get property "uiWorkspace" without inject`（这正是之前跳转失败的根因）。
     这里用 ctx.inject 做懒绑定：依赖就绪才回调，不阻塞本插件自身挂载，服务晚挂也能拿到。 */
  let uiWorkspaceService: OfficeUiWorkspace | undefined;
  let sessionsService: OfficeSessionsService | undefined;
  let shortcutsService: OfficeShortcutsService | undefined;
  const bind = (deps: string[], assign: (scope: Record<string, unknown>) => void): void => {
    const inject = (ctx as unknown as { inject?(deps: string[], cb: (scope: unknown) => void): unknown }).inject;
    if (typeof inject !== 'function') {
      console.warn('[personal-workbench] ctx.inject 不可用，无法绑定', deps.join(','));
      return;
    }
    try {
      inject.call(ctx, deps, (scope: unknown) => assign((scope ?? {}) as Record<string, unknown>));
    } catch (err) {
      console.warn('[personal-workbench] 服务绑定失败', deps.join(','), err);
    }
  };
  bind(['uiWorkspace'], (scope) => {
    uiWorkspaceService = scope['uiWorkspace'] as OfficeUiWorkspace | undefined;
  });
  bind(['sessions'], (scope) => {
    sessionsService = scope['sessions'] as OfficeSessionsService | undefined;
  });
  bind(['shortcuts'], (scope) => {
    shortcutsService = scope['shortcuts'] as OfficeShortcutsService | undefined;
  });

  const resolveUiWorkspace = (): OfficeUiWorkspace | undefined => {
    if (uiWorkspaceService !== undefined && typeof uiWorkspaceService.openSession === 'function') return uiWorkspaceService;
    const viaGet = ctxGet(ctx, 'uiWorkspace') as OfficeUiWorkspace | undefined;
    return typeof viaGet?.openSession === 'function' ? viaGet : undefined;
  };

  setSessionOpener(async (sessionId: string): Promise<JumpReport> => {
    const notes: string[] = [];
    const reason = (err: unknown): string => (err instanceof Error ? err.message : String(err));

    const sessions = sessionsService ?? resolveUiWorkspace()?.sessions;
    if (sessions === undefined) notes.push('取不到 sessions 服务');
    else if (sessions.list?.getSnapshot?.()?.byId?.[sessionId] === undefined) notes.push('客户端会话目录里没有这个 id');

    const expandSidebar = (): void => {
      if (typeof shortcutsService?.invoke !== 'function') {
        notes.push('也没有 shortcuts 服务可展开左栏');
        return;
      }
      try {
        shortcutsService.invoke('sidebar.left.toggle', { target: document.body, region: 'main', modal: null });
        notes.push('已调 sidebar.left.toggle 展开左栏');
      } catch (err) {
        notes.push(`展开左栏命令抛错：${reason(err)}`);
      }
    };

    // ① 官方通道：uiWorkspace.openSession（主区切到该会话 + 关掉办公面板）
    const service = resolveUiWorkspace();
    if (service?.openSession === undefined) {
      notes.push('取不到 uiWorkspace 服务');
    } else {
      try {
        service.openSession(sessionId);
        if (await jumpLanded(sessionId)) return { ok: true, detail: 'service' };
        notes.push('openSession 调用了但没落地（面板没关、侧栏该行也没成为当前行）');
      } catch (err) {
        notes.push(`openSession 抛错：${reason(err)}`);
      }
    }

    // ② 自己按官方语义切主区：retain 标 mainView（生效才关面板，避免白跑还关掉当前面板）
    if (typeof sessions?.retain !== 'function') {
      notes.push('sessions 上没 retain');
    } else {
      try {
        sessions.retain(sessionId, { source: 'mainView' });
        const held = (sessions.list?.getSnapshot?.()?.byId?.[sessionId]?.retainedBy?.mainView ?? 0) > 0;
        if (!held) {
          notes.push('retain 调用了但 retainedBy.mainView 还是 0');
        } else {
          ctx.layout.selectPanel(null);
          if (await jumpLanded(sessionId)) return { ok: true, detail: 'retain' };
          notes.push('retain 生效、面板也关了，但侧栏该行没成为当前行');
        }
      } catch (err) {
        notes.push(`retain 抛错：${reason(err)}`);
      }
    }

    // ③ 兜底：点宿主左栏里那一行（等于用户手点：展开分组 + 定位 + 高亮 + 打开主区）
    if (typeof document !== 'undefined') {
      const allRows = document.querySelectorAll('[data-row-key]').length;
      const sessionRows = document.querySelectorAll('[data-row-key^="session:"]').length;
      notes.push(`左栏 DOM：data-row-key ${allRows} 行 / 会话行 ${sessionRows} 行`);
    }
    if (await clickSidebarSessionRow(sessionId, expandSidebar)) {
      if (await jumpLanded(sessionId)) return { ok: true, detail: 'sidebar' };
      notes.push('点了侧栏那一行但没落地');
    } else {
      notes.push('左栏里没有该会话行');
    }
    const detail = notes.join('；');
    console.warn('[personal-workbench] 跳转会话失败', sessionId, detail);
    return { ok: false, detail };
  });

  /* 兜底：宿主重启后 office/agents 的内存派活记录会清空 → 按会话 id 前缀 office-<npcId>- 在宿主
     会话列表里找 TA 最近的会话（同一个人多次派活时取尾部时间戳最大者）。 */
  setSessionFinder((npcId: string): string | null => {
    const list = resolveUiWorkspace()?.sessions?.list?.getSnapshot?.();
    const ids: unknown[] = Array.isArray(list?.ids) ? (list?.ids as unknown[]) : [];
    const prefix = `office-${npcId}-`;
    const stamp = (id: string): number => {
      const m = /-(\d{10,})$/.exec(id);
      return m === null ? 0 : Number(m[1]);
    };
    let best: { id: string; at: number } | null = null;
    for (const raw of ids) {
      if (typeof raw !== 'string' || !raw.startsWith(prefix)) continue;
      const at = stamp(raw);
      if (best === null || at > best.at) best = { id: raw, at };
    }
    return best === null ? null : best.id;
  });

  const disposeSidebar = injectSidebarEntry(ctx);

  // 中央看板（main keyed：同一 id 寻址；不遮蔽 conversation）
  ctx.slots.inject('main', () => {
    return ctx.slots.register(
      {
        name: 'main',
        key: PANEL_ID,
        inject: () => ({ rpc }),
      },
      WorkbenchPanel,
    );
  });

  // DOM 注入清理由 disposeSidebar 持有（当前生命周期 = 页面级，刷新即重置）。
  void disposeSidebar;
}
