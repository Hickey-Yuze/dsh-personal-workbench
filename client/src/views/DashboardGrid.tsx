/**
 * 可拖拽 / 8 向可缩放的仪表盘网格容器。
 * 交互与几何算法来自 client/src/grid.ts（对齐 Yuze Workbench OverviewPage）：
 *   · 编辑模式下每张卡顶部出现拖动条、四角/四边出现 8 个手柄
 *   · 拖拽全程用 window 级 pointermove（指针可离开卡片），松手才提交布局
 *   · 拖到滚动区上下边缘自动滚动
 * 非编辑模式下完全不干预，卡片内部组件照常交互。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactElement, ReactNode, RefObject } from 'react';
import {
  GRID_COLS,
  GRID_GAP,
  ROW_HEIGHT,
  RESIZE_HANDLES,
  createAutoScroll,
  moveCell,
  resizeCell,
  type CellConfig,
  type RectBase,
  type ResizeDir,
} from '../grid.js';

export interface WidgetDef {
  id: string;
  title: string;
  render: () => ReactNode;
}

export interface DashboardGridProps {
  widgets: WidgetDef[];
  layout: CellConfig[];
  onCommit: (next: CellConfig[]) => void;
  onRemove: (id: string) => void;
  scrollRef: RefObject<HTMLElement | null>;
  editMode: boolean;
}

/** 拖动条把手图标（三点两列）。 */
function GripIcon(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" aria-hidden="true">
      <circle cx="9" cy="6" r="1.5" />
      <circle cx="15" cy="6" r="1.5" />
      <circle cx="9" cy="12" r="1.5" />
      <circle cx="15" cy="12" r="1.5" />
      <circle cx="9" cy="18" r="1.5" />
      <circle cx="15" cy="18" r="1.5" />
    </svg>
  );
}

export function DashboardGrid({
  widgets,
  layout,
  onCommit,
  onRemove,
  scrollRef,
  editMode,
}: DashboardGridProps): ReactElement {
  const [cells, setCells] = useState<CellConfig[]>(layout);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const cellsRef = useRef<CellConfig[]>(cells);
  cellsRef.current = cells;

  // 外部布局变化（首次拉取、重置）时同步内部状态；拖拽过程不会改 layout，故不会打断
  const layoutKey = useMemo(() => JSON.stringify(layout), [layout]);
  const lastKey = useRef(layoutKey);
  useEffect(() => {
    if (layoutKey === lastKey.current) return;
    lastKey.current = layoutKey;
    setCells(layout);
    // layout 由 key 代表，避免引用变化引起无谓同步
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutKey]);

  /** 共用：监听 window 的 pointermove / pointerup，松手提交。 */
  function trackPointer(
    e: ReactPointerEvent,
    id: string,
    apply: (dxCols: number, dyRows: number, scrollTotal: number) => void,
  ): void {
    e.preventDefault();
    e.stopPropagation();
    const container = containerRef.current;
    if (container === null) return;
    const startX = e.clientX;
    const startY = e.clientY;
    const colW = container.offsetWidth / GRID_COLS;
    const rowH = ROW_HEIGHT + GRID_GAP;
    const scroller = scrollRef.current;
    const startScrollTop = scroller?.scrollTop ?? 0;
    const virtualDelta = { current: 0 };
    const latest = { x: startX, y: startY };
    let moved = false;

    setDraggingId(id);

    const autoScroll = createAutoScroll(
      () => scrollRef.current,
      startScrollTop,
      (total) => {
        virtualDelta.current = total - ((scrollRef.current?.scrollTop ?? 0) - startScrollTop);
        apply((latest.x - startX) / colW, (latest.y - startY + total) / rowH, total);
      },
    );

    const onMove = (ev: PointerEvent): void => {
      latest.x = ev.clientX;
      latest.y = ev.clientY;
      if (Math.abs(ev.clientX - startX) > 2 || Math.abs(ev.clientY - startY) > 2) moved = true;
      autoScroll.update(ev);
      const scrollTotal = (scrollRef.current?.scrollTop ?? 0) - startScrollTop + virtualDelta.current;
      apply((ev.clientX - startX) / colW, (ev.clientY - startY + scrollTotal) / rowH, scrollTotal);
    };

    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      autoScroll.stop();
      virtualDelta.current = 0;
      setDraggingId(null);
      if (moved) {
        const snapshot = cellsRef.current;
        lastKey.current = JSON.stringify(snapshot);
        onCommit(snapshot);
      }
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }

  function startMove(e: ReactPointerEvent, id: string): void {
    const target = cellsRef.current.find((c) => c.id === id);
    if (target === undefined) return;
    const base: RectBase = { col: target.col, row: target.row, colSpan: target.colSpan, rowSpan: target.rowSpan };
    trackPointer(e, id, (dx, dy) => {
      setCells((prev) => {
        const next = moveCell(prev, id, dx, dy, base);
        // 同步 ref：松手时无需等下一帧渲染就能拿到最终布局
        cellsRef.current = next;
        return next;
      });
    });
  }

  function startResize(e: ReactPointerEvent, id: string, dir: ResizeDir): void {
    const target = cellsRef.current.find((c) => c.id === id);
    if (target === undefined) return;
    const base: RectBase = { col: target.col, row: target.row, colSpan: target.colSpan, rowSpan: target.rowSpan };
    trackPointer(e, id, (dx, dy) => {
      setCells((prev) => {
        const next = resizeCell(prev, id, dir, dx, dy, base);
        cellsRef.current = next;
        return next;
      });
    });
  }

  const canvasStyle: CSSProperties = {
    display: 'grid',
    gridTemplateColumns: `repeat(${GRID_COLS}, minmax(0, 1fr))`,
    gridAutoRows: `${ROW_HEIGHT}px`,
    gap: `${GRID_GAP}px`,
  };

  return (
    <div ref={containerRef} className={`dsh-pwb-canvas${editMode ? ' dsh-pwb-canvas-edit' : ''}`} style={canvasStyle}>
      {cells.map((cell) => {
        const def = widgets.find((w) => w.id === cell.id);
        return (
          <div
            key={cell.id}
            className={`dsh-pwb-cell${draggingId === cell.id ? ' dsh-pwb-cell-drag' : ''}`}
            style={{
              gridColumn: `${cell.col} / ${cell.col + cell.colSpan}`,
              gridRow: `${cell.row} / ${cell.row + cell.rowSpan}`,
            }}
          >
            <div className="dsh-pwb-cell-body">{def?.render() ?? null}</div>

            {editMode ? (
              <>
                <div
                  className="dsh-pwb-dragbar"
                  onPointerDown={(e) => startMove(e, cell.id)}
                  title="拖拽移动卡片"
                  role="button"
                  tabIndex={-1}
                >
                  <GripIcon />
                </div>
                <button
                  type="button"
                  className="dsh-pwb-cell-del"
                  onClick={() => onRemove(cell.id)}
                  title="移除卡片"
                  aria-label="移除卡片"
                >
                  ×
                </button>
                <div className="dsh-pwb-cell-size">
                  {cell.colSpan}×{cell.rowSpan}
                </div>
                {RESIZE_HANDLES.map((h) => (
                  <div
                    key={h.dir}
                    className="dsh-pwb-handle"
                    style={{ ...h.style, cursor: h.cursor }}
                    onPointerDown={(e) => startResize(e, cell.id, h.dir)}
                    title={`调整大小（${h.dir}）`}
                    role="button"
                    tabIndex={-1}
                  >
                    <span className="dsh-pwb-handle-inner" style={h.inner} />
                  </div>
                ))}
              </>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
