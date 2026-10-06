/**
 * 模块：像素办公室 —— P1 场景本体。
 * 整数格地图 + 自己与 6 位 NPC 同事的行为循环（工作/咖啡/拜访/闲逛），
 * canvas 自绘零依赖。P2 加点击互动（走位/拜访/会议），P3 加地图编辑器，
 * P4 加流式对话面板，P5 加三栏数据面板与动作网关。
 */
import { useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { OfficeEngine } from '../office/engine.js';
import { OfficeCanvas } from '../office/OfficeCanvas.js';
import type { MemberStat } from '../office/types.js';

const STATE_TEXT: Record<MemberStat['state'], string> = {
  idle: '摸鱼中',
  walking: '走动中',
  working: '工作中',
  coffee: '咖啡时间',
  visit: '拜访同事',
};

export function OfficeModuleView(): ReactElement {
  const engineRef = useRef<OfficeEngine | null>(null);
  if (engineRef.current === null) engineRef.current = new OfficeEngine();
  const engine = engineRef.current;
  const [members, setMembers] = useState<MemberStat[]>(() => engine.members());

  useEffect(() => {
    const id = window.setInterval(() => setMembers(engine.members()), 900);
    return () => window.clearInterval(id);
  }, [engine]);

  return (
    <div className="dsh-pwb-view">
      <div className="dsh-pwb-view-body">
        <div className="dsh-pwb-office-stage">
          <OfficeCanvas engine={engine} className="dsh-pwb-office-canvas" />
        </div>
        <div className="dsh-pwb-office-status">
          {members.map((m) => (
            <span key={m.id} className={`dsh-pwb-office-chip${m.isSelf ? ' dsh-pwb-office-chip-self' : ''}`}>
              <b>{m.name}</b>
              <i>{m.role}</i>
              <em>{STATE_TEXT[m.state]}</em>
            </span>
          ))}
        </div>
        <div className="dsh-pwb-office-hint">像素办公室 · 同事们各自忙着手头的事（后续版本：点击互动、地图编辑、AI 对话）</div>
      </div>
    </div>
  );
}
