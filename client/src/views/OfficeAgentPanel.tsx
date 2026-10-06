/**
 * 模块：办公室真工位 · 员工面板 —— 自定义员工花名册（宿主 roster 持久化）+ 派活入口 + 移交（互相监督 v1）。
 * 自包含：自己轮询 office/agents 取会话状态与最近汇报尾部；样式全内联（不动 theme.ts）。
 * 互相监督 v1 口径：移交时宿主把交接说明真实写进双方会话，此处只展示宿主返回的真实数据。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactElement } from 'react';
import { addRosterEntry, fetchAgentRows, handoff, isEndpointMissing, loadRoster } from '../office/agentClient.js';
import type { AgentRow, RosterEntry } from '../office/agentClient.js';

export type OfficeAgentPanelProps = {
  /** 派活入口：让老板切到该员工的聊天里派活（id 即 npcId，自定义员工为 custom-<序号>）。 */
  onOpenChat: (id: string, name: string, role: string) => void;
};

const POLL_MS = 2500;

/* ── 内联样式：白底圆角卡片 / 绿 #00c853 主按钮 / 灰 #e5e7eb 次级 ── */
const card: CSSProperties = {
  background: '#fff',
  border: '1px solid #e5e7eb',
  borderRadius: 12,
  padding: '12px 14px',
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  minWidth: 0,
};
const sectionTitle: CSSProperties = { fontSize: 13, fontWeight: 700, color: '#111827', margin: 0 };
const chip: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '4px 10px',
  borderRadius: 999,
  border: '1px solid #e5e7eb',
  background: '#fff',
  fontSize: 12,
  lineHeight: 1.4,
  width: 'fit-content',
};
const chipActive: CSSProperties = { ...chip, borderColor: '#00c853', boxShadow: '0 0 0 1px #00c853' };
const chipBtn: CSSProperties = { border: 'none', background: 'transparent', color: '#00c853', fontSize: 12, cursor: 'pointer', padding: 0, fontWeight: 600 };
const chipBtnGray: CSSProperties = { ...chipBtn, color: '#6b7280', fontWeight: 400 };
const primaryBtn: CSSProperties = {
  background: '#00c853',
  color: '#fff',
  border: 'none',
  borderRadius: 8,
  padding: '6px 14px',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
};
const grayBtn: CSSProperties = {
  background: '#e5e7eb',
  color: '#374151',
  border: 'none',
  borderRadius: 8,
  padding: '6px 14px',
  fontSize: 13,
  cursor: 'pointer',
};
const textInput: CSSProperties = { border: '1px solid #e5e7eb', borderRadius: 8, padding: '6px 10px', fontSize: 13, minWidth: 0 };
const errText: CSSProperties = { color: '#dc2626', fontSize: 12, margin: 0 };
const hintText: CSSProperties = { color: '#6b7280', fontSize: 11, margin: 0, lineHeight: 1.5 };
const tailText: CSSProperties = {
  color: '#6b7280',
  fontSize: 11,
  margin: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  maxWidth: 260,
};

/** chip 状态圆点：颜色 + 文案（working/idle/stopped 均为宿主真实状态；无记录 = 未派活）。 */
function statusDot(row: AgentRow | undefined): { color: string; label: string } {
  if (row === undefined) return { color: '#d1d5db', label: '未派活' };
  if (row.status === 'working') return { color: '#00c853', label: '会话中' };
  if (row.status === 'idle') return { color: '#f59e0b', label: '空闲' };
  if (row.status === 'stopped') return { color: '#9ca3af', label: '已停工' };
  return { color: '#d1d5db', label: '未派活' };
}

export function OfficeAgentPanel({ onOpenChat }: OfficeAgentPanelProps): ReactElement {
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [rosterErr, setRosterErr] = useState('');
  const [agentRows, setAgentRows] = useState<Record<string, AgentRow>>({});
  const [newName, setNewName] = useState('');
  const [newRole, setNewRole] = useState('');
  const [adding, setAdding] = useState(false);
  const [addErr, setAddErr] = useState('');
  /* 移交：点 chip「移交」选中 from；to 走下拉（其余自定义员工 + 有会话的场景同事）；note 必填 */
  const [fromId, setFromId] = useState<string | null>(null);
  const [toId, setToId] = useState('');
  const [note, setNote] = useState('');
  const [handingOff, setHandingOff] = useState(false);
  const [handoffErr, setHandoffErr] = useState('');
  const agentsDeadRef = useRef(false);

  const refreshRoster = useCallback((): void => {
    loadRoster()
      .then((list) => {
        setRoster(list);
        setRosterErr('');
      })
      .catch((err: unknown) =>
        setRosterErr(isEndpointMissing(err) ? '宿主需要 ⌘Q 重启后才有真工位功能' : err instanceof Error ? err.message : '花名册加载失败'),
      );
  }, []);

  useEffect(() => {
    refreshRoster();
  }, [refreshRoster]);

  /* office/agents 轮询：状态圆点 + 最近汇报尾部（旧宿主 404 → 停轮询，同 OfficeModuleView 口径） */
  useEffect(() => {
    let stopped = false;
    const poll = (): void => {
      if (stopped || agentsDeadRef.current) return;
      fetchAgentRows()
        .then((rows) => {
          const next: Record<string, AgentRow> = {};
          for (const row of rows) next[row.npcId] = row;
          setAgentRows(next);
        })
        .catch((err: unknown) => {
          if (isEndpointMissing(err)) {
            agentsDeadRef.current = true;
            setAgentRows({});
          }
        });
    };
    poll();
    const id = window.setInterval(poll, POLL_MS);
    return () => {
      stopped = true;
      window.clearInterval(id);
    };
  }, []);

  const submitAdd = useCallback((): void => {
    const name = newName.trim();
    const role = newRole.trim();
    if (name === '' || role === '' || adding) return;
    setAdding(true);
    setAddErr('');
    addRosterEntry(name, role)
      .then((entry) => {
        setRoster((prev) => [...prev, entry]);
        setNewName('');
        setNewRole('');
      })
      .catch((err: unknown) => setAddErr(err instanceof Error ? err.message : '添加失败'))
      .finally(() => setAdding(false));
  }, [adding, newRole, newName]);

  /* 移交候选：其余自定义员工 + 正在有会话的场景同事（office/agents，按 npcId 去重） */
  const handoffTargets: Array<{ id: string; name: string; role: string }> = [];
  const seen = new Set<string>();
  if (fromId !== null) seen.add(fromId);
  for (const r of roster) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    handoffTargets.push({ id: r.id, name: r.name, role: r.role });
  }
  for (const [npcId, row] of Object.entries(agentRows)) {
    if (row.status === 'stopped' || seen.has(npcId) || row.name === undefined || row.name.trim() === '') continue;
    seen.add(npcId);
    handoffTargets.push({ id: npcId, name: row.name, role: row.role ?? '' });
  }

  const submitHandoff = useCallback((): void => {
    if (fromId === null || toId === '' || note.trim() === '' || handingOff) return;
    setHandingOff(true);
    setHandoffErr('');
    handoff(fromId, toId, note.trim())
      .then(() => {
        setFromId(null);
        setToId('');
        setNote('');
      })
      .catch((err: unknown) => setHandoffErr(err instanceof Error ? err.message : '移交失败'))
      .finally(() => setHandingOff(false));
  }, [fromId, handingOff, note, toId]);

  return (
    <div style={card}>
      <p style={sectionTitle}>我的员工</p>
      {rosterErr !== '' && <p style={errText}>⚠️ {rosterErr}</p>}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'flex-start' }}>
        {roster.length === 0 && rosterErr === '' && <span style={hintText}>还没有自定义员工，先在下面添加一位</span>}
        {roster.map((r) => {
          const row = agentRows[r.id];
          const dot = statusDot(row);
          const isFrom = fromId === r.id;
          return (
            <div key={r.id} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <div style={isFrom ? chipActive : chip}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: dot.color, flexShrink: 0 }} title={dot.label} />
                <b style={{ fontWeight: 600 }}>{r.name}</b>
                <span style={{ color: '#6b7280' }}>{r.role}</span>
                <span style={{ color: '#9ca3af', fontSize: 11 }}>{dot.label}</span>
                <button style={chipBtn} onClick={() => onOpenChat(r.id, r.name, r.role)}>
                  派活
                </button>
                <button
                  style={chipBtnGray}
                  title={row === undefined || row.status === 'stopped' ? '双方都需要先有进行中的会话才能移交' : '把当前工作移交给其他同事'}
                  onClick={() => {
                    setHandoffErr('');
                    setFromId(isFrom ? null : r.id);
                    setToId('');
                  }}
                >
                  移交
                </button>
              </div>
              {row !== undefined && row.status !== 'stopped' && row.lastText.trim() !== '' && (
                <span style={tailText} title={row.lastText}>
                  …{row.lastText.trim().slice(-80)}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* 新增员工：POST office/roster */}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <input style={{ ...textInput, width: 96 }} placeholder="名字" value={newName} onChange={(e) => setNewName(e.target.value)} />
        <input
          style={{ ...textInput, width: 120 }}
          placeholder="职务"
          value={newRole}
          onChange={(e) => setNewRole(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submitAdd();
          }}
        />
        <button style={primaryBtn} disabled={adding || newName.trim() === '' || newRole.trim() === ''} onClick={submitAdd}>
          {adding ? '添加中…' : '添加员工'}
        </button>
      </div>
      {addErr !== '' && <p style={errText}>⚠️ {addErr}</p>}

      {/* 移交（互相监督 v1）：note 会真实写进双方会话 */}
      {fromId !== null && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, borderTop: '1px solid #f3f4f6', paddingTop: 8 }}>
          <p style={hintText}>互相监督 v1：确认后交接说明会写进双方会话，接手方先检查对方产出再继续推进。</p>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, color: '#374151' }}>
              把 <b>{roster.find((r) => r.id === fromId)?.name ?? fromId}</b> 的工作移交给
            </span>
            <select style={textInput} value={toId} onChange={(e) => setToId(e.target.value)}>
              <option value="">选同事…</option>
              {handoffTargets.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}（{t.role}）
                </option>
              ))}
            </select>
            <input
              style={{ ...textInput, flex: 1, minWidth: 150 }}
              placeholder="交接说明（移交原因 / 当前进度）"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitHandoff();
              }}
            />
            <button style={primaryBtn} disabled={handingOff || toId === '' || note.trim() === ''} onClick={submitHandoff}>
              {handingOff ? '移交中…' : '确认移交'}
            </button>
            <button style={grayBtn} onClick={() => { setFromId(null); setHandoffErr(''); }}>
              取消
            </button>
          </div>
          {handoffErr !== '' && <p style={errText}>⚠️ {handoffErr}</p>}
        </div>
      )}
      <p style={hintText}>点「派活」在聊天里给 TA 布置真实任务；绿点 = 会话中，橙点 = 空闲，灰点 = 未派活。</p>
    </div>
  );
}
