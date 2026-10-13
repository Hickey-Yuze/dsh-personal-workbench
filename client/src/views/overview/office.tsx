/**
 * 办公室小组件 —— 总览页的实时小预览（同一引擎 / 同一张地图 / 同一套 3D 渲染）。
 * 点击画面打开完整办公室模块。
 *
 * 与「办公室」模块保持一致的两点（此前不一致）：
 * 1) 地图来源：读同一份存档 `loadOfficeMap()`（编辑器保存后总览立刻同步）；
 *    以前直接 `new OfficeEngine()` 只拿 defaultMap，所以总览永远是默认图、和模块对不上。
 * 2) 渲染模式：传 char3d，走与模块场景 tab 相同的 WebGL 3D 场景
 *    （以前不传 = 走 2D 等距绘制，画风与模块的 3D 场景完全不同）。
 */
import { useRef } from 'react';
import type { ReactElement } from 'react';
import { OfficeEngine } from '../../office/engine.js';
import { OfficeCanvas } from '../../office/OfficeCanvas.js';
import { loadOfficeMap } from '../../office/store.js';

export function OfficeWidget({ onOpen }: { onOpen: (id: string) => void }): ReactElement {
  const engineRef = useRef<OfficeEngine | null>(null);
  if (engineRef.current === null) {
    engineRef.current = new OfficeEngine(loadOfficeMap() ?? undefined);
  }
  const engine = engineRef.current;
  return (
    <div className="dsh-pwb-widget">
      <div className="dsh-pwb-widget-head">
        <span className="dsh-pwb-widget-title">办公室</span>
        <button type="button" className="dsh-pwb-link" onClick={() => onOpen('office')}>
          打开模块
        </button>
      </div>
      <div className="dsh-pwb-widget-body">
        <div className="dsh-pwb-office-mini">
          <OfficeCanvas engine={engine} char3d onCanvasClick={() => onOpen('office')} />
        </div>
      </div>
    </div>
  );
}
