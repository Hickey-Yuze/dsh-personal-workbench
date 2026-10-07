/**
 * 模块：办公室真工位 · 员工面板 —— 全员列表（六内置 NPC + 自定义员工）+ 派活入口 + 移交（互相监督 v1）。
 * 每行：状态点 + 名字职务 + 自觉工作开关 + 「编辑」展开卡（名称/职务/性格/同事链/工作记录）。
 * 自包含：自己轮询 office/agents 取会话状态与最近汇报尾部；样式内联 + theme.ts 的 dsh-pwb-office-emp-*。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactElement } from 'react';
import { BUILTIN_STAFF } from '../office/engine.js';
import { fetchAgentRows, fetchMemory, handoff, isEndpointMissing, loadRoster, saveBuiltin, setAutopilot } from '../office/agentClient.js';
import type { AgentRow, BuiltinOverride, MemoryNote, RosterEntry } from '../office/agentClient.js';

export type OfficeAgentPanelProps = {
  /** 派活入口：让老板切到该员工的聊天里派活（id 即 npcId，自定义员工为 custom-<序号>）。 */
  onOpenChat: (id: string, name: string, role: string) => void;
  /** 编辑卡保存后回调（lead 用于同步场景 renameChar/assignDesk 与聊天标题）。 */
  onBuiltinSaved?: (id: string, name?: string, role?: string, deskId?: string) => void;
  /** 工位下拉选项（lead 从引擎实时取：id + 展示名）。 */
  desks?: Array<{ id: string; label: string }>;
};

const POLL_MS = 2500;
const MEM_SHOW = 5;

/* ── 内联样式：软 3D 玩具风（无硬描边 / 柔影 / 胶囊按钮），与场景和 theme.ts 统一 ── */
const card: CSSProperties = {
  background: '#fff',
  border: '1px solid rgba(20, 20, 30, 0.05)',
  boxShadow: '0 2px 14px rgba(20, 20, 30, 0.06)',
  borderRadius: 16,
  padding: '14px 15px',
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  minWidth: 0,
};
const sectionTitle: CSSProperties = { fontSize: 13, fontWeight: 700, color: '#111827', margin: 0 };
const primaryBtn: CSSProperties = {
  background: '#00c853',
  color: '#fff',
  border: 'none',
  borderRadius: 999,
  padding: '6px 14px',
  fontSize: 12.5,
  fontWeight: 600,
  cursor: 'pointer',
  boxShadow: '0 1px 6px rgba(0, 200, 106, 0.24)',
};
const grayBtn: CSSProperties = {
  background: '#f5f6f8',
  color: '#374151',
  border: '1px solid rgba(20, 20, 30, 0.06)',
  borderRadius: 999,
  padding: '6px 14px',
  fontSize: 12.5,
  cursor: 'pointer',
};
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

export function OfficeAgentPanel({ onOpenChat, onBuiltinSaved, desks }: OfficeAgentPanelProps): ReactElement {
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [rosterErr, setRosterErr] = useState('');
  const [agentRows, setAgentRows] = useState<Record<string, AgentRow>>({});
  /** 员工属性覆盖（宿主 roster.builtin；旧宿主 undefined → 面板按原始资料展示，保存会报「宿主待重启」）。 */
  const [builtin, setBuiltin] = useState<Record<string, BuiltinOverride> | undefined>(undefined);
  /* 移交：点 chip「移交」选中 from；to 走下拉（其余自定义员工 + 有会话的场景同事）；note 必填 */
  const [fromId, setFromId] = useState<string | null>(null);
  const [toId, setToId] = useState('');
  const [note, setNote] = useState('');
  const [handingOff, setHandingOff] = useState(false);
  const [handoffErr, setHandoffErr] = useState('');
  /** 编辑卡：展开的员工 id + 表单草稿 + 记忆区。 */
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [draft, setDraft] = useState({ name: '', role: '', persona: '', links: '', desk: '' });
  const [mem, setMem] = useState<{ loading: boolean; notes: MemoryNote[]; err: string }>({ loading: false, notes: [], err: '' });
  const [empErr, setEmpErr] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedHint, setSavedHint] = useState('');
  const agentsDeadRef = useRef(false);

  const refreshRoster = useCallback((): void => {
    loadRoster()
      .then((res) => {
        setRoster(res.roster);
        setBuiltin(res.builtin ?? {});
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

  /* 全员列表：六内置 NPC 在前 + 自定义员工；名字/职务优先取宿主覆盖 */
  const employees: Array<{ id: string; name: string; role: string }> = [
    ...BUILTIN_STAFF.map((b) => ({ id: b.id, name: builtin?.[b.id]?.name ?? b.name, role: builtin?.[b.id]?.role ?? b.role })),
    ...roster.map((r) => ({ id: r.id, name: builtin?.[r.id]?.name ?? r.name, role: builtin?.[r.id]?.role ?? r.role })),
  ];

  /** 自觉工作开关。 */
  const toggleAuto = useCallback(
    (id: string): void => {
      const cur = builtin?.[id]?.autopilot === true;
      setEmpErr('');
      setAutopilot(id, !cur)
        .then(() => {
          setBuiltin((prev) => ({ ...(prev ?? {}), [id]: { ...(prev ?? {})[id], autopilot: !cur } }));
        })
        .catch((err: unknown) =>
          setEmpErr(isEndpointMissing(err) ? '宿主需要 ⌘Q 重启后才有此功能' : err instanceof Error ? err.message : '设置失败'),
        );
    },
    [builtin],
  );

  /** 展开编辑卡：草稿取宿主覆盖（缺省回落当前名字职务），并拉取该员工的工作记忆。 */
  const openEditor = useCallback(
    (emp: { id: string; name: string; role: string }): void => {
      const ov = builtin?.[emp.id] ?? {};
      setExpandedId(emp.id);
      setDraft({ name: ov.name ?? emp.name, role: ov.role ?? emp.role, persona: ov.persona ?? '', links: (ov.links ?? []).join('\n'), desk: ov.deskId ?? '' });
      setMem({ loading: true, notes: [], err: '' });
      setEmpErr('');
      setSavedHint('');
      fetchMemory(emp.id)
        .then((notes) => setMem({ loading: false, notes, err: '' }))
        .catch((err: unknown) => setMem({ loading: false, notes: [], err: err instanceof Error ? err.message : '记忆加载失败' }));
    },
    [builtin],
  );

  /** 保存属性覆盖：宿主持久化 + 通知 lead 同步场景与聊天标题。 */
  const saveEmp = useCallback((): void => {
    if (expandedId === null || saving) return;
    const name = draft.name.trim().slice(0, 20);
    const role = draft.role.trim().slice(0, 20);
    if (name === '' || role === '') {
      setEmpErr('名称与职务不能为空');
      return;
    }
    const persona = draft.persona.trim().slice(0, 300);
    const links = draft.links
      .split('\n')
      .map((l) => l.trim().slice(0, 40))
      .filter((l) => l !== '')
      .slice(0, 20);
    setSaving(true);
    setEmpErr('');
    saveBuiltin(expandedId, {
      name,
      role,
      deskId: draft.desk.trim(),
      ...(persona !== '' ? { persona } : {}),
      ...(links.length > 0 ? { links } : {}),
    })
      .then(() => {
        setBuiltin((prev) => ({
          ...(prev ?? {}),
          [expandedId]: {
            ...(prev ?? {})[expandedId],
            name,
            role,
            ...(draft.desk.trim() !== '' ? { deskId: draft.desk.trim() } : {}),
            ...(persona !== '' ? { persona } : {}),
            ...(links.length > 0 ? { links } : {}),
          },
        }));
        onBuiltinSaved?.(expandedId, name, role, draft.desk.trim());
        setSavedHint('已保存 ✓');
        window.setTimeout(() => setSavedHint(''), 2500);
      })
      .catch((err: unknown) =>
        setEmpErr(isEndpointMissing(err) ? '宿主需要 ⌘Q 重启后才有此功能' : err instanceof Error ? err.message : '保存失败'),
      )
      .finally(() => setSaving(false));
  }, [draft, expandedId, onBuiltinSaved, saving]);

  /* 移交候选：其余自定义员工 + 正在有会话的场景同事（office/agents，按 npcId 去重） */
  const handoffTargets: Array<{ id: string; name: string; role: string }> = [];
  const seen = new Set<string>();
  if (fromId !== null) seen.add(fromId);
  for (const e of employees) {
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    handoffTargets.push(e);
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
      <div className="dsh-pwb-office-emp-list">
        {employees.map((emp) => {
          const row = agentRows[emp.id];
          const dot = statusDot(row);
          const isFrom = fromId === emp.id;
          const auto = builtin?.[emp.id]?.autopilot === true;
          const expanded = expandedId === emp.id;
          return (
            <div key={emp.id} className="dsh-pwb-office-emp-item">
              <div className="dsh-pwb-office-emp-line">
                <span className="dsh-pwb-office-emp-dot" style={{ background: dot.color }} title={dot.label} />
                <b className="dsh-pwb-office-emp-name">{emp.name}</b>
                <span className="dsh-pwb-office-emp-role">{emp.role}</span>
                {auto && <span className="dsh-pwb-office-emp-autotag">自觉中</span>}
                <span className="dsh-pwb-office-emp-status">{dot.label}</span>
                <span className="dsh-pwb-office-emp-spacer" />
                <button
                  className={`dsh-pwb-office-emp-switch${auto ? ' on' : ''}`}
                  title="自觉工作：开着不派活也会自己找活干"
                  onClick={() => toggleAuto(emp.id)}
                >
                  <i />
                </button>
                <button className="dsh-pwb-office-emp-act" onClick={() => onOpenChat(emp.id, emp.name, emp.role)}>
                  派活
                </button>
                <button
                  className="dsh-pwb-office-emp-act gray"
                  title={row === undefined || row.status === 'stopped' ? '双方都需要先有进行中的会话才能移交' : '把当前工作移交给其他同事'}
                  onClick={() => {
                    setHandoffErr('');
                    setFromId(isFrom ? null : emp.id);
                    setToId('');
                  }}
                >
                  移交
                </button>
                <button
                  className={`dsh-pwb-office-emp-act${expanded ? ' active' : ''}`}
                  onClick={() => {
                    if (expanded) setExpandedId(null);
                    else openEditor(emp);
                  }}
                >
                  {expanded ? '收起' : '编辑'}
                </button>
              </div>
              {expanded && (
                <div className="dsh-pwb-office-emp-edit">
                  <div className="dsh-pwb-office-emp-grid">
                    <input
                      className="dsh-pwb-office-emp-input"
                      value={draft.name}
                      maxLength={20}
                      placeholder="名称（≤20 字）"
                      onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                    />
                    <input
                      className="dsh-pwb-office-emp-input"
                      value={draft.role}
                      maxLength={20}
                      placeholder="职务（≤20 字）"
                      onChange={(e) => setDraft((d) => ({ ...d, role: e.target.value }))}
                    />
                  </div>
                  <textarea
                    className="dsh-pwb-office-emp-area"
                    rows={3}
                    maxLength={300}
                    placeholder="性格（≤300 字）：会作为人设喂给 TA 的 agent，比如——说话直接、爱吐槽、对排期敏感"
                    value={draft.persona}
                    onChange={(e) => setDraft((d) => ({ ...d, persona: e.target.value }))}
                  />
                  <textarea
                    className="dsh-pwb-office-emp-area"
                    rows={2}
                    placeholder="同事链（每行一条 ≤40 字）：如「前端做完移交给大鹏测试」"
                    value={draft.links}
                    onChange={(e) => setDraft((d) => ({ ...d, links: e.target.value }))}
                  />
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: '#374151' }}>
                    工位
                    <select
                      value={draft.desk}
                      onChange={(e) => setDraft((d) => ({ ...d, desk: e.target.value }))}
                      style={{ flex: 1, minWidth: 0, padding: '5px 8px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 12.5, background: '#fff', color: '#111827' }}
                    >
                      <option value="">自动分配</option>
                      {(desks ?? []).map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="dsh-pwb-office-emp-mem">
                    {mem.loading
                      ? '记忆加载中…'
                      : mem.err !== ''
                        ? `⚠️ ${mem.err}`
                        : mem.notes.length === 0
                          ? '暂无工作记录（派活后这里会出现 TA 的真实工作记录）'
                          : `【工作记录】共 ${mem.notes.length} 条（最近 ${Math.min(MEM_SHOW, mem.notes.length)} 条）`}
                    {mem.notes.slice(-MEM_SHOW).map((n, i) => (
                      <div key={i} className="dsh-pwb-office-emp-mem-item" title={n.text}>
                        {n.text}
                      </div>
                    ))}
                  </div>
                  <div className="dsh-pwb-office-emp-actions">
                    <button style={primaryBtn} disabled={saving} onClick={saveEmp}>
                      {saving ? '保存中…' : '保存'}
                    </button>
                    <button style={grayBtn} onClick={() => setExpandedId(null)}>
                      收起
                    </button>
                    {savedHint !== '' && <span className="dsh-pwb-office-emp-saved">{savedHint}</span>}
                  </div>
                </div>
              )}
              {row !== undefined && row.status !== 'stopped' && row.lastText.trim() !== '' && (
                <span style={tailText} title={row.lastText}>
                  …{row.lastText.trim().slice(-80)}
                </span>
              )}
            </div>
          );
        })}
      </div>
      {empErr !== '' && <p style={errText}>⚠️ {empErr}</p>}

      {/* 移交（互相监督 v1）：note 会真实写进双方会话 */}
      {fromId !== null && (
        <div className="dsh-pwb-office-emp-handoff">
          <p style={hintText}>互相监督 v1：确认后交接说明会写进双方会话，接手方先检查对方产出再继续推进。</p>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, color: '#374151' }}>
              把 <b>{employees.find((e) => e.id === fromId)?.name ?? fromId}</b> 的工作移交给
            </span>
            <select className="dsh-pwb-office-emp-select" value={toId} onChange={(e) => setToId(e.target.value)}>
              <option value="">选同事…</option>
              {handoffTargets.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}（{t.role}）
                </option>
              ))}
            </select>
            <input
              className="dsh-pwb-office-emp-select"
              style={{ flex: 1, minWidth: 150 }}
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
      <p style={hintText}>点「派活」在聊天里给 TA 布置真实任务；绿点 = 会话中，橙点 = 空闲，灰点 = 未派活。自觉开关开着时 TA 会自己找活干。</p>
    </div>
  );
}
