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
import type { WorkbenchClientCtx } from './env.js';
import { initI18n, t } from './i18n.js';
import { PANEL_ID, WorkbenchPanel } from './panel.js';
import { makeRpc } from './rpc.js';
import { ensureThemeStyle } from './theme.js';

export const inject = ['slots', 'layout', 'locale'];

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

  // 侧栏入口（DOM 注入；样式与「新会话」「定时任务」按钮同款）
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
