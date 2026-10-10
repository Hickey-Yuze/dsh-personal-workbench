/**
 * 办公室画布：把引擎接到 <canvas>（rAF 驱动 + 自适应尺寸）。
 * 点击：cellAtPoint 换算地图格（延伸带地板真实可走，引擎按延伸走位区判定）。
 * 视口：view（zoom/pan）由父组件持有；滚轮以鼠标为锚点缩放、拖拽平移
 * （拖拽后抑制紧随的 click，避免误触发拜访/走位），钳制用 clampViewPan。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, ReactElement } from 'react';
import type { OfficeEngine } from './engine.js';
import { MAP_H, MAP_W } from './map.js';
import { cellAtPoint, clampViewPan, renderOffice } from './renderer.js';
import type { OfficeView } from './renderer.js';
import { renderScene3d } from './scene3d.js';
import type { Vec } from './types.js';

export function OfficeCanvas({
  engine,
  className,
  onCanvasClick,
  onClickCell,
  view,
  onViewChange,
  char3d,
}: {
  engine: OfficeEngine;
  className?: string;
  onCanvasClick?: () => void;
  onClickCell?: (cell: Vec) => void;
  /** 视口（缩放/平移），由父组件持有；不传 = 1 倍适配居中。 */
  view?: OfficeView;
  /** 视口变化回调（滚轮缩放 / 拖拽平移都会触发）。 */
  onViewChange?: (next: OfficeView) => void;
  /** true = 人物用 3D OBJ 模型（Three.js 覆盖层），2D 只画家具。 */
  char3d?: boolean;
}): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null); // 3D 模式：WebGL 场景画布
  const bubbleRef = useRef<HTMLCanvasElement | null>(null); // 3D 模式：气泡 2D 覆盖层
  const [overlayFailed, setOverlayFailed] = useState(false);
  const viewRef = useRef<OfficeView | undefined>(view);
  viewRef.current = view;
  const onViewChangeRef = useRef(onViewChange);
  onViewChangeRef.current = onViewChange;
  const dragRef = useRef<{ x: number; y: number; panX: number; panY: number; moved: boolean; rot?: number; rotStartX?: number } | null>(null);
  const suppressClickRef = useRef(false);

  /** 应用一次视口变更（钳制后交给父组件；3D/2D 各自钳制语义）。 */
  const applyView = useCallback(
    (zoom: number, panX: number, panY: number): void => {
      const canvas = canvasRef.current;
      if (canvas === null) return;
      const clamped = clampViewPan(panX, panY, zoom, canvas.clientWidth, canvas.clientHeight, viewRef.current?.rot);
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
    const gl = overlayRef.current; // 3D 模式主画布是 WebGL overlay（2D 主画布只在回退时存在）
    if (canvas === null && gl === null) return;
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    const loop = (now: number): void => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const host = (overlayRef.current ?? canvasRef.current);
      if (host === null) {
        raf = window.requestAnimationFrame(loop);
        return;
      }
      // 延伸走位区对齐：按当前视口算地图四边可见的延伸格数喂给引擎（内部幂等，区间收 0..24）。
      // 角色因此能走进画布上下左右的延伸地板带；BFS 在扩展坐标空间寻路。
      const cw = host.clientWidth;
      const ch = host.clientHeight;
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
        const use3d = char3d === true && !overlayFailed;
        if (use3d) {
          // 全 3D 场景：WebGL 主画布 + 2D 气泡覆盖层；视口 (zoom/pan/rot) 与 2D 同源
          const oc = overlayRef.current;
          const bc = bubbleRef.current;
          if (oc !== null && bc !== null) {
            const v = viewRef.current ?? {};
            renderScene3d(oc, bc, engine.map.furniture, engine.chars, engine.time, {
              zoom: v.zoom !== undefined && Number.isFinite(v.zoom) && v.zoom > 0 ? v.zoom : 1,
              panX: v.panX !== undefined && Number.isFinite(v.panX) ? v.panX : 0,
              panY: v.panY !== undefined && Number.isFinite(v.panY) ? v.panY : 0,
              rot: v.rot !== undefined && Number.isFinite(v.rot) ? v.rot : 0,
              meeting: engine.meetingActive,
              bubbles: engine.bubbles,
            });
          }
        } else {
          const canvas = canvasRef.current;
          if (canvas !== null) {
            renderOffice(canvas, engine.map.furniture, engine.chars, engine.time, {
              bubbles: engine.bubbles,
              meeting: engine.meetingActive,
              view: viewRef.current,
            });
          }
        }
      }
      raf = window.requestAnimationFrame(loop);
    };
    raf = window.requestAnimationFrame(loop);
    return () => window.cancelAnimationFrame(raf);
  }, [engine, char3d, overlayFailed]);

  const handlePointerDown = (e: ReactPointerEvent<HTMLElement>): void => {
    const v = viewRef.current ?? {};
    // 右键 = 视角旋转（左右拖拽，每 90px 转 90°）；左键 = 平移
    if (e.button === 2) {
      dragRef.current = { x: e.clientX, y: e.clientY, panX: v.panX ?? 0, panY: v.panY ?? 0, moved: false, rot: v.rot ?? 0, rotStartX: e.clientX };
    } else if (e.button === 0) {
      dragRef.current = { x: e.clientX, y: e.clientY, panX: v.panX ?? 0, panY: v.panY ?? 0, moved: false };
    } else return;
    try {
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    } catch { /* 已释放则忽略 */ }
  };

  const handlePointerMove = (e: ReactPointerEvent<HTMLElement>): void => {
    const d = dragRef.current;
    if (d === null) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
    d.moved = true;
    if (d.rot !== undefined && d.rotStartX !== undefined) {
      // 旋转拖拽：以按下时的 rot 为基准，向右拖 = 顺时针
      const rot = ((((d.rot + Math.round((e.clientX - d.rotStartX) / 90)) % 4) + 4) % 4);
      const v = viewRef.current ?? {};
      onViewChangeRef.current?.({ zoom: v.zoom ?? 1, panX: v.panX ?? 0, panY: v.panY ?? 0, rot });
      return;
    }
    applyView((viewRef.current ?? {}).zoom ?? 1, d.panX + dx, d.panY + dy);
  };

  const handlePointerUp = (e: ReactPointerEvent<HTMLElement>): void => {
    const d = dragRef.current;
    dragRef.current = null;
    try {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    } catch { /* 已释放则忽略 */ }
    if (d !== null && d.moved) suppressClickRef.current = true; // 拖动后的 click 不当格子交互
  };

  const handleClick = (e: ReactMouseEvent<HTMLElement>): void => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    onCanvasClick?.(); // 兼容原行为：任何点击都触发
    if (onClickCell === undefined) return;
    const host = e.currentTarget;
    const rect = host.getBoundingClientRect();
    const offsetX = e.clientX - rect.left;
    const offsetY = e.clientY - rect.top;
    const cell = cellAtPoint(offsetX, offsetY, host.clientWidth, host.clientHeight, viewRef.current);
    if (cell !== null) onClickCell(cell);
  };

  if (char3d !== true || overlayFailed) {
    return (
      <canvas
        ref={canvasRef}
        className={className}
        onContextMenu={(e) => e.preventDefault()}
        style={{ display: 'block', width: '100%', height: '100%', cursor: onCanvasClick || onClickCell ? 'pointer' : undefined }}
        onClick={handleClick}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      />
    );
  }
  // 3D 模式：WebGL 场景画布（承载一切）+ 2D 气泡覆盖层；交互事件全在容器上
  return (
    <div
      style={{ position: 'relative', width: '100%', height: '100%', cursor: onCanvasClick || onClickCell ? 'pointer' : undefined }}
      onClick={handleClick}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onContextMenu={(e) => e.preventDefault()}
    >
      <canvas
        ref={(el) => {
          overlayRef.current = el;
          if (el === null) return;
          // WebGL 创建失败（上下文丢失等）→ 永久回退纯 2D
          const test = el.getContext('webgl2') ?? el.getContext('webgl');
          if (test === null) setOverlayFailed(true);
        }}
        style={{ display: 'block', width: '100%', height: '100%' }}
      />
      <canvas
        ref={bubbleRef}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
      />
    </div>
  );
}
