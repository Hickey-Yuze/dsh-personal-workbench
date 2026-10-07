/**
 * 办公室画布：把引擎接到 <canvas>（rAF 驱动 + 自适应尺寸）。
 * 点击：cellAtPoint 换算地图格（延伸区自动钳到最近可走格）。
 * 视口：view（zoom/pan）由父组件持有；滚轮以鼠标为锚点缩放、拖拽平移
 * （拖拽后抑制紧随的 click，避免误触发拜访/走位），钳制用 clampViewPan。
 */
import { useCallback, useEffect, useRef } from 'react';
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, ReactElement } from 'react';
import type { OfficeEngine } from './engine.js';
import { cellAtPoint, clampViewPan, renderOffice } from './renderer.js';
import type { OfficeView } from './renderer.js';
import type { Vec } from './types.js';

export function OfficeCanvas({
  engine,
  className,
  onCanvasClick,
  onClickCell,
  view,
  onViewChange,
}: {
  engine: OfficeEngine;
  className?: string;
  onCanvasClick?: () => void;
  onClickCell?: (cell: Vec) => void;
  /** 视口（缩放/平移），由父组件持有；不传 = 1 倍适配居中。 */
  view?: OfficeView;
  /** 视口变化回调（滚轮缩放 / 拖拽平移都会触发）。 */
  onViewChange?: (next: OfficeView) => void;
}): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const viewRef = useRef<OfficeView | undefined>(view);
  viewRef.current = view;
  const onViewChangeRef = useRef(onViewChange);
  onViewChangeRef.current = onViewChange;
  const dragRef = useRef<{ x: number; y: number; panX: number; panY: number; moved: boolean } | null>(null);
  const suppressClickRef = useRef(false);

  /** 应用一次视口变更（钳制后交给父组件）。 */
  const applyView = useCallback(
    (zoom: number, panX: number, panY: number): void => {
      const canvas = canvasRef.current;
      if (canvas === null) return;
      const clamped = clampViewPan(panX, panY, zoom, canvas.clientWidth, canvas.clientHeight);
      onViewChangeRef.current?.({ zoom, ...clamped });
    },
    [],
  );

  /* 滚轮缩放：以鼠标为锚点（React onWheel 是 passive，preventDefault 无效 → 原生监听） */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const handler = (e: WheelEvent): void => {
      if (onViewChangeRef.current === undefined) return;
      e.preventDefault();
      const v = viewRef.current ?? {};
      const oldZoom = v.zoom ?? 1;
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      const newZoom = Math.min(2.5, Math.max(0.5, oldZoom * factor));
      if (newZoom === oldZoom) return;
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const ratio = newZoom / oldZoom;
      const panX = v.panX ?? 0;
      const panY = v.panY ?? 0;
      applyView(newZoom, mx - ratio * (mx - panX), my - ratio * (my - panY));
    };
    canvas.addEventListener('wheel', handler, { passive: false });
    return () => canvas.removeEventListener('wheel', handler);
  }, [applyView]);

  const handlePointerDown = (e: ReactPointerEvent<HTMLCanvasElement>): void => {
    if (e.button !== 0) return;
    const v = viewRef.current ?? {};
    dragRef.current = { x: e.clientX, y: e.clientY, panX: v.panX ?? 0, panY: v.panY ?? 0, moved: false };
    try {
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    } catch { /* 已释放则忽略 */ }
  };

  const handlePointerMove = (e: ReactPointerEvent<HTMLCanvasElement>): void => {
    const d = dragRef.current;
    if (d === null) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
    d.moved = true;
    applyView((viewRef.current ?? {}).zoom ?? 1, d.panX + dx, d.panY + dy);
  };

  const handlePointerUp = (e: ReactPointerEvent<HTMLCanvasElement>): void => {
    const d = dragRef.current;
    dragRef.current = null;
    try {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    } catch { /* 已释放则忽略 */ }
    if (d !== null && d.moved) suppressClickRef.current = true; // 拖动后的 click 不当格子交互
  };

  const handleClick = (e: ReactMouseEvent<HTMLCanvasElement>): void => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    onCanvasClick?.(); // 兼容原行为：任何点击都触发
    if (onClickCell === undefined) return;
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const cell = cellAtPoint(e.nativeEvent.offsetX, e.nativeEvent.offsetY, canvas.clientWidth, canvas.clientHeight, viewRef.current);
    if (cell !== null) onClickCell(cell);
  };

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ display: 'block', width: '100%', height: '100%', cursor: onCanvasClick || onClickCell ? 'pointer' : undefined }}
      onClick={handleClick}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    />
  );
}
