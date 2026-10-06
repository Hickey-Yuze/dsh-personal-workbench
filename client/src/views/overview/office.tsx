/**
 * 办公室小组件 —— 总览页的实时小预览（同一引擎的装配尺寸）。
 * 点击画面打开完整办公室模块。
 */
import { useRef } from 'react';
import type { ReactElement } from 'react';
import { OfficeEngine } from '../../office/engine.js';
import { OfficeCanvas } from '../../office/OfficeCanvas.js';

export function OfficeWidget({ onOpen }: { onOpen: (id: string) => void }): ReactElement {
  const engineRef = useRef<OfficeEngine | null>(null);
  if (engineRef.current === null) engineRef.current = new OfficeEngine();
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
          <OfficeCanvas engine={engine} onCanvasClick={() => onOpen('office')} />
        </div>
      </div>
    </div>
  );
}
