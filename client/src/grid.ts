/**
 * 仪表盘网格布局算法 —— 逐条对齐 Yuze Workbench `OverviewPage` 的实现：
 *   12 列 / 行高 150px / 间距 16px；指针事件拖动 + 8 向缩放；
 *   基于「拖拽起始基准」计算位移（避免逐帧累加误差）；重叠自动下推；
 *   拖到滚动区上下边缘时自动滚动，并带「虚拟偏移」（滚到顶后多余位移仍然生效）。
 * 这些常量与算法与原项目保持一致，改这里等于改行为。
 */
import type { CSSProperties } from 'react';

export interface CellConfig {
  id: string;
  /** 起始列（1-based）。 */
  col: number;
  /** 起始行（1-based）。 */
  row: number;
  colSpan: number;
  rowSpan: number;
}

export const GRID_COLS = 12;
export const ROW_HEIGHT = 150;
export const GRID_GAP = 16;
/** 卡片最小宽度（列）。原项目同样是 2。 */
export const MIN_COL_SPAN = 2;

export type ResizeDir = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

export interface RectBase {
  col: number;
  row: number;
  colSpan: number;
  rowSpan: number;
}

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function overlaps(a: CellConfig, b: CellConfig): boolean {
  return (
    a.col < b.col + b.colSpan &&
    a.col + a.colSpan > b.col &&
    a.row < b.row + b.rowSpan &&
    a.row + a.rowSpan > b.row
  );
}

/**
 * 重叠消解：被压在下面的卡片整体下推到冲突卡的下方，直到收敛（带 100 轮护栏）。
 * fixedId 是本次操作的主动卡（正在被拖拽/缩放的那张）：它绝不被下推 ——
 * 否则指针还在原地、卡片却自己跳到别人下面，还会被逐帧推得越来越远。
 */
export function resolveOverlaps(list: CellConfig[], fixedId?: string): CellConfig[] {
  const result = list.map((c) => ({ ...c }));
  let changed = true;
  let guard = 0;
  while (changed && guard < 100) {
    changed = false;
    guard += 1;
    for (const a of result) {
      for (const b of result) {
        if (a === b || b.id === fixedId) continue;
        if (overlaps(a, b)) {
          const newRow = a.row + a.rowSpan;
          if (b.row !== newRow) {
            b.row = newRow;
            changed = true;
          }
        }
      }
    }
  }
  return result;
}

/** 拖动移动：列被夹在网格内，行不设上限（可往下无限延伸）。 */
export function moveCell(list: CellConfig[], id: string, dxCols: number, dyRows: number, base: RectBase): CellConfig[] {
  const col = clamp(Math.round(base.col + dxCols), 1, GRID_COLS - base.colSpan + 1);
  const row = Math.max(1, Math.round(base.row + dyRows));
  return resolveOverlaps(list.map((c) => (c.id === id ? { ...c, col, row } : c)), id);
}

/** 8 方向缩放：以拖拽起点为基准，方向由 dir 的字符决定（n/s/e/w 可组合）。 */
export function resizeCell(
  list: CellConfig[],
  id: string,
  dir: ResizeDir,
  dxCols: number,
  dyRows: number,
  base: RectBase,
): CellConfig[] {
  let col = base.col;
  let row = base.row;
  let colSpan = base.colSpan;
  let rowSpan = base.rowSpan;
  const right = base.col + base.colSpan;
  const bottom = base.row + base.rowSpan;

  if (dir.includes('e')) {
    colSpan = Math.max(MIN_COL_SPAN, Math.round(base.colSpan + dxCols));
  }
  if (dir.includes('w')) {
    const newCol = clamp(Math.round(base.col + dxCols), 1, right - MIN_COL_SPAN);
    col = newCol;
    colSpan = right - newCol;
  }
  if (dir.includes('s')) {
    rowSpan = Math.max(1, Math.round(base.rowSpan + dyRows));
  }
  if (dir.includes('n')) {
    const newRow = clamp(Math.round(base.row + dyRows), 1, bottom - 1);
    row = newRow;
    rowSpan = bottom - newRow;
  }

  colSpan = clamp(colSpan, MIN_COL_SPAN, GRID_COLS - col + 1);
  rowSpan = Math.max(1, Math.round(rowSpan));

  return resolveOverlaps(list.map((c) => (c.id === id ? { ...c, col, row, colSpan, rowSpan } : c)), id);
}

/** 8 个方向的缩放手柄：位置/光标/内部刻线（对应原项目 RESIZE_HANDLES）。 */
export const RESIZE_HANDLES: {
  dir: ResizeDir;
  style: CSSProperties;
  cursor: string;
  inner: CSSProperties;
}[] = [
  {
    dir: 'n',
    cursor: 'ns-resize',
    style: { top: 0, left: '50%', transform: 'translate(-50%, -50%)', height: 8, width: 28 },
    inner: { width: 16, height: 1 },
  },
  {
    dir: 's',
    cursor: 'ns-resize',
    style: { bottom: 0, left: '50%', transform: 'translate(-50%, 50%)', height: 8, width: 28 },
    inner: { width: 16, height: 1 },
  },
  {
    dir: 'e',
    cursor: 'ew-resize',
    style: { right: 0, top: '50%', transform: 'translate(50%, -50%)', width: 8, height: 28 },
    inner: { width: 1, height: 16 },
  },
  {
    dir: 'w',
    cursor: 'ew-resize',
    style: { left: 0, top: '50%', transform: 'translate(-50%, -50%)', width: 8, height: 28 },
    inner: { width: 1, height: 16 },
  },
  {
    dir: 'ne',
    cursor: 'nesw-resize',
    style: { top: 0, right: 0, transform: 'translate(50%, -50%)', width: 14, height: 14 },
    inner: { width: 6, height: 6, borderTopWidth: 2, borderRightWidth: 2 },
  },
  {
    dir: 'nw',
    cursor: 'nwse-resize',
    style: { top: 0, left: 0, transform: 'translate(-50%, -50%)', width: 14, height: 14 },
    inner: { width: 6, height: 6, borderTopWidth: 2, borderLeftWidth: 2 },
  },
  {
    dir: 'se',
    cursor: 'nwse-resize',
    style: { bottom: 0, right: 0, transform: 'translate(50%, 50%)', width: 14, height: 14 },
    inner: { width: 6, height: 6, borderBottomWidth: 2, borderRightWidth: 2 },
  },
  {
    dir: 'sw',
    cursor: 'nesw-resize',
    style: { bottom: 0, left: 0, transform: 'translate(-50%, 50%)', width: 14, height: 14 },
    inner: { width: 6, height: 6, borderBottomWidth: 2, borderLeftWidth: 2 },
  },
];

export interface AutoScrollHandle {
  update(ev: PointerEvent): void;
  stop(): void;
}

/**
 * 拖拽到滚动区边缘时的自动滚动。
 * 只上报「真实滚动位移」：卡片相对指针的位移由 grid 的 (clientY - startY) 承担。
 * 不要再叠加「虚拟偏移」—— 那会让按住卡片顶部拖动条（指针本就贴着容器上沿）时
 * 卡片被每 16ms 反向拽一点，表现为「往下拖却被硬拽上去」，还会连带挤压上方卡片。
 */
export function createAutoScroll(
  getScroller: () => HTMLElement | null,
  startScrollTop: number,
  onScroll: (totalDelta: number) => void,
): AutoScrollHandle {
  let timer: number | undefined;
  let speed = 0;

  const stop = (): void => {
    if (timer !== undefined) {
      window.clearInterval(timer);
      timer = undefined;
    }
  };

  const tick = (): void => {
    const scroller = getScroller();
    if (scroller === null) {
      stop();
      return;
    }
    const maxScroll = scroller.scrollHeight - scroller.clientHeight;
    if (maxScroll <= 0) {
      onScroll(0);
      return;
    }
    const next = scroller.scrollTop + speed;
    scroller.scrollTop = next < 0 ? 0 : next > maxScroll ? maxScroll : next;
    onScroll(scroller.scrollTop - startScrollTop);
  };

  return {
    update(ev: PointerEvent): void {
      const scroller = getScroller();
      if (scroller === null) return;
      // 容器没有可滚空间：不做自动滚动（否则指针贴着上沿时会持续反向拽卡片）。
      if (scroller.scrollHeight - scroller.clientHeight <= 0) {
        speed = 0;
        stop();
        return;
      }
      const rect = scroller.getBoundingClientRect();
      const zone = 72;
      const maxSpeed = 18;
      if (ev.clientY < rect.top + zone) {
        speed = -Math.round(((rect.top + zone - ev.clientY) / zone) * maxSpeed);
      } else if (ev.clientY > rect.bottom - zone) {
        speed = Math.round(((ev.clientY - (rect.bottom - zone)) / zone) * maxSpeed);
      } else {
        speed = 0;
      }
      if (speed !== 0) {
        if (timer === undefined) timer = window.setInterval(tick, 16);
      } else {
        stop();
      }
    },
    stop,
  };
}
