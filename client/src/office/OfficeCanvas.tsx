/**
 * 办公室画布：把引擎接到 <canvas>（rAF 驱动 + 自适应尺寸）。
 * 同一组件喂两个尺寸：总览小组件预览与模块全面板（内核与外壳分离）。
 */
import { useEffect, useRef } from 'react';
import type { ReactElement } from 'react';
import type { OfficeEngine } from './engine.js';
import { renderOffice } from './renderer.js';

export function OfficeCanvas({
  engine,
  className,
  onCanvasClick,
}: {
  engine: OfficeEngine;
  className?: string;
  onCanvasClick?: () => void;
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
      renderOffice(canvas, engine.map.furniture, engine.chars, engine.time);
      raf = window.requestAnimationFrame(loop);
    };
    raf = window.requestAnimationFrame(loop);
    return () => window.cancelAnimationFrame(raf);
  }, [engine]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ display: 'block', width: '100%', height: '100%', cursor: onCanvasClick ? 'pointer' : undefined }}
      onClick={onCanvasClick}
    />
  );
}
