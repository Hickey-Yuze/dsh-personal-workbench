/**
 * 办公室画布：把引擎接到 <canvas>（rAF 驱动 + 自适应尺寸）。
 * 同一组件喂两个尺寸：总览小组件预览与模块全面板（内核与外壳分离）。
 * P2：onClickCell —— 点击坐标经 cellAtPoint 换算成地图格回调（墙环/界外不触发）。
 */
import { useEffect, useRef } from 'react';
import type { MouseEvent as ReactMouseEvent, ReactElement } from 'react';
import type { OfficeEngine } from './engine.js';
import { cellAtPoint, renderOffice } from './renderer.js';
import type { Vec } from './types.js';

export function OfficeCanvas({
  engine,
  className,
  onCanvasClick,
  onClickCell,
}: {
  engine: OfficeEngine;
  className?: string;
  onCanvasClick?: () => void;
  onClickCell?: (cell: Vec) => void;
}): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    let raf = 0;
    let last = performance.now();
    const loop = (now: number): void => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      engine.tick(dt);
      renderOffice(canvas, engine.map.furniture, engine.chars, engine.time, {
        bubbles: engine.bubbles,
        meeting: engine.meetingActive,
      });
      raf = window.requestAnimationFrame(loop);
    };
    raf = window.requestAnimationFrame(loop);
    return () => window.cancelAnimationFrame(raf);
  }, [engine]);

  const handleClick = (e: ReactMouseEvent<HTMLCanvasElement>): void => {
    onCanvasClick?.(); // 兼容原行为：任何点击都触发
    if (onClickCell === undefined) return;
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const cell = cellAtPoint(e.nativeEvent.offsetX, e.nativeEvent.offsetY, canvas.clientWidth, canvas.clientHeight);
    if (cell !== null) onClickCell(cell);
  };

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ display: 'block', width: '100%', height: '100%', cursor: onCanvasClick || onClickCell ? 'pointer' : undefined }}
      onClick={handleClick}
    />
  );
}
