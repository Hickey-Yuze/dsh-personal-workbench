/**
 * 办公室画布：把引擎接到 <canvas>（rAF 驱动 + 自适应尺寸）。
 * 点击：cellAtPoint 换算地图格（延伸带地板真实可走，引擎按延伸走位区判定）。
 * 视口：view（zoom/pan）由父组件持有；滚轮以鼠标为锚点缩放、拖拽平移
 * （拖拽后抑制紧随的 click，避免误触发拜访/走位），钳制用 clampViewPan。
 */
import { useCallback, useEffect, useRef } from 'react';
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, ReactElement } from 'react';
import type { OfficeEngine } from './engine.js';
import { MAP_H, MAP_W } from './map.js';
import { cellAtPoint, clampViewPan, renderOffice } from './renderer.js';
import type { OfficeView } from './renderer.js';
import { cellAtPoint3D, clampViewPan3D, renderOffice3D } from './renderer3d.js';
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
  /** 3D 模式（场景 tab）：true = Three.js WebGL 渲染；编辑器仍走 2D topDown。 */
  const mode3dRef = useRef(true);
  const viewRef = useRef<OfficeView | undefined>(view);
  viewRef.current = view;
  const onViewChangeRef = useRef(onViewChange);
  onViewChangeRef.current = onViewChange;
  const dragRef = useRef<{ x: number; y: number; panX: number; panY: number; moved: boolean } | null>(null);
  const suppressClickRef = useRef(false);

  /** 应用一次视口变更（钳制后交给父组件；3D/2D 各自钳制语义）。 */
  const applyView = useCallback(
    (zoom: number, panX: number, panY: number): void => {
      const canvas = canvasRef.current;
      if (canvas === null) return;
      const clamped = mode3dRef.current
        ? clampViewPan3D(panX, panY, zoom, canvas.clientWidth, canvas.clientHeight)
        : clampViewPan(panX, panY, zoom, canvas.clientWidth, canvas.clientHeight);
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

  /* rAF 渲染循环：tick 引擎 + 画一帧（view 从 ref 取，循环不因缩放/平移重建）。
   * 无人在走动时降到 30fps：呼吸/冒泡动画依旧平滑，合成器压力减半，
   * 避免 60fps 满帧重绘把右侧聊天滚动区拖出重影/发糊（GPU 合成纹理复用瑕疵）。 */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    const loop = (now: number): void => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      // 延伸走位区对齐：按当前视口算地图四边可见的延伸格数喂给引擎（内部幂等，区间收 0..24）。
      // 角色因此能走进画布上下左右的延伸地板带；BFS 在扩展坐标空间寻路。
      const cw = canvas.clientWidth;
      const ch = canvas.clientHeight;
      const v = viewRef.current ?? {};
      const zoom = v.zoom !== undefined && Number.isFinite(v.zoom) && v.zoom > 0 ? v.zoom : 1;
      const panX = v.panX !== undefined && Number.isFinite(v.panX) ? v.panX : 0;
      const panY = v.panY !== undefined && Number.isFinite(v.panY) ? v.panY : 0;
      const fit = Math.min(cw / MAP_W, ch / MAP_H);
      const scale = fit * zoom;
      if (scale > 0) {
        const ox = (cw - scale * MAP_W) / 2 + panX;
        const oy = (ch - scale * MAP_H) / 2 + panY;
        engine.setArena(
          Math.ceil(oy / scale),
          Math.ceil((ch - (oy + scale * MAP_H)) / scale),
          Math.ceil(ox / scale),
          Math.ceil((cw - (ox + scale * MAP_W)) / scale),
        );
      }
      engine.tick(dt);
      const moving = engine.chars.some((c) => c.state === 'walking' || c.state === 'visit');
      acc += dt;
      if (moving || acc >= 1 / 30) {
        acc = 0;
        if (mode3dRef.current) {
          renderOffice3D(canvas, engine.map, engine.chars, engine.time, {
            bubbles: engine.bubbles,
            view: viewRef.current,
          });
        } else {
          renderOffice(canvas, engine.map.furniture, engine.chars, engine.time, {
            bubbles: engine.bubbles,
            meeting: engine.meetingActive,
            view: viewRef.current,
          });
        }
      }
      raf = window.requestAnimationFrame(loop);
    };
    raf = window.requestAnimationFrame(loop);
    return () => window.cancelAnimationFrame(raf);
  }, [engine]);

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
    const cell = mode3dRef.current
      ? cellAtPoint3D(canvas, e.nativeEvent.offsetX, e.nativeEvent.offsetY)
      : cellAtPoint(e.nativeEvent.offsetX, e.nativeEvent.offsetY, canvas.clientWidth, canvas.clientHeight, viewRef.current);
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
