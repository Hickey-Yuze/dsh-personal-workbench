/**
 * 员工档案：游戏角色卡式精准定位——性格 / 能力（七维 0-100）/ 关系链 / 记忆 集中编辑。
 * 数据源：roster + builtin（office/roster）+ memory（office/memory）；保存走 roster/builtin PATCH。
 * 真会话工作记录由宿主在 capture committed 时自动入档，本页只做展示与增删。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { addMemoryNote, clearMemory, fetchMemory, removeMemoryNote, saveBuiltin } from '../office/agentClient.js';
import type { BuiltinOverride, MemoryNote, RosterEntry } from '../office/agentClient.js';
import { BUILTIN_STAFF } from '../office/engine.js';
import type { MemberStat } from '../office/types.js';

/** 能力维度（与宿主 OFFICE_SKILL_DIMS 顺序一致）。 */
const SKILL_DIMS: readonly string[] = ['代码', '架构', '测试', '设计', '沟通', '业务', '数据'];

/** 头像底色（按 id 哈希取色，同一个人永远同色）。 */
const AVATAR_COLORS = ['#0ea5e9', '#00b45f', '#f59e0b', '#8b5cf6', '#ef4444', '#14b8a6', '#64748b', '#d946ef', '#0d9488'];

function avatarColor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length] ?? AVATAR_COLORS[0]!;
}

/** 状态 → 圆点色 / 文案（与成员状态条同语义）。 */
function stateTone(state: MemberStat['state']): { dot: string; text: string } {
  switch (state) {
    case 'working':
      return { dot: '#00b45f', text: '工作中' };
    case 'meeting':
      return { dot: '#00b45f', text: '会议中' };
    case 'walking':
      return { dot: '#e08a00', text: '走动中' };
    case 'coffee':
      return { dot: '#e08a00', text: '咖啡时间' };
    case 'visit':
      return { dot: '#e08a00', text: '拜访同事' };
    default:
      return { dot: '#9ca3af', text: '摸鱼中' };
  }
}

function fmtTime(t: number): string {
  const d = new Date(t);
  const now = new Date();
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return d.toDateString() === now.toDateString() ? hm : `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
}

type Props = {
  members: MemberStat[];
  roster: RosterEntry[];
  builtin: Record<string, BuiltinOverride>;
  onBuiltinSaved: (builtin: Record<string, BuiltinOverride>) => void;
};

type Draft = { persona: string; links: string[]; skills: Record<string, number> };

export function OfficeProfileView({ members, roster, builtin, onBuiltinSaved }: Props): ReactElement {
  const chars = useMemo(() => [...BUILTIN_STAFF, ...roster], [roster]);
  const [selId, setSelId] = useState('');
  const sel = chars.find((c) => c.id === selId) ?? chars[0];
  const ov: BuiltinOverride = builtin[sel?.id ?? ''] ?? {};

  const [draft, setDraft] = useState<Draft>({ persona: '', links: [], skills: {} });
  const [linkInput, setLinkInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState(''); // '' | '已保存 ✓' | 错误文案
  const [notes, setNotes] = useState<MemoryNote[]>([]);
  const [memInput, setMemInput] = useState('');
  const [memBusy, setMemBusy] = useState(false);
  const selRef = useRef('');

  /* 切换员工 → 重载草稿 + 记忆 */
  useEffect(() => {
    const id = sel?.id ?? '';
    if (id === selRef.current) return;
    selRef.current = id;
    const cur: BuiltinOverride = builtin[id] ?? {};
    setDraft({
      persona: typeof cur.persona === 'string' ? cur.persona : '',
      links: Array.isArray(cur.links) ? [...cur.links] : [],
      skills: cur.skills !== undefined && typeof cur.skills === 'object' ? { ...cur.skills } : {},
    });
    setLinkInput('');
    setSaveMsg('');
    setNotes([]);
    if (id !== '') {
      let alive = true;
      void fetchMemory(id).then((list) => {
        if (alive) setNotes(list);
      });
      return () => {
        alive = false;
      };
    }
  }, [builtin, sel?.id]);

  const dirty = useMemo(() => {
    const cur: BuiltinOverride = builtin[sel?.id ?? ''] ?? {};
    const curSkills = (cur.skills ?? {}) as Record<string, number>;
    if (draft.persona !== (typeof cur.persona === 'string' ? cur.persona : '')) return true;
    if (JSON.stringify(draft.links) !== JSON.stringify(Array.isArray(cur.links) ? cur.links : [])) return true;
    if (JSON.stringify(draft.skills) !== JSON.stringify(curSkills)) return true;
    return false;
  }, [builtin, draft, sel?.id]);

  const save = useCallback(async () => {
    if (sel === undefined || saving) return;
    setSaving(true);
    setSaveMsg('');
    try {
      const table = await saveBuiltin(sel.id, { persona: draft.persona, links: draft.links, skills: draft.skills });
      onBuiltinSaved(table);
      setSaveMsg('已保存 ✓');
    } catch (err) {
      setSaveMsg(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  }, [draft, onBuiltinSaved, saving, sel]);

  const refreshMemory = useCallback(async (id: string): Promise<void> => {
    try {
      setNotes(await fetchMemory(id));
    } catch {
      /* 拉取失败保持现状 */
    }
  }, []);

  const memAdd = useCallback(async () => {
    if (sel === undefined || memBusy) return;
    const text = memInput.trim();
    if (text === '') return;
    setMemBusy(true);
    try {
      await addMemoryNote(sel.id, text);
      setMemInput('');
      await refreshMemory(sel.id);
    } catch (err) {
      setSaveMsg(err instanceof Error ? err.message : '记忆写入失败');
    } finally {
      setMemBusy(false);
    }
  }, [memBusy, memInput, refreshMemory, sel]);

  const memRemove = useCallback(
    async (index: number) => {
      if (sel === undefined) return;
      try {
        await removeMemoryNote(sel.id, index);
        await refreshMemory(sel.id);
      } catch (err) {
        setSaveMsg(err instanceof Error ? err.message : '删除失败');
      }
    },
    [refreshMemory, sel],
  );

  const memClear = useCallback(async () => {
    if (sel === undefined || notes.length === 0) return;
    if (!window.confirm(`清空 ${sel.name} 的全部 ${notes.length} 条记忆？（自生长会重新积累）`)) return;
    try {
      await clearMemory(sel.id);
      setNotes([]);
    } catch (err) {
      setSaveMsg(err instanceof Error ? err.message : '清空失败');
    }
  }, [notes.length, sel]);

  if (sel === undefined) return <div className="dsh-pwb-office-prof-empty">还没有员工</div>;

  const member = members.find((m) => m.id === sel.id && !m.isSelf);
  const tone = stateTone(member?.state ?? 'idle');
  const saveMsgTone = saveMsg === '已保存 ✓' ? 'dsh-pwb-office-prof-ok' : 'dsh-pwb-office-prof-err';

  return (
    <div className="dsh-pwb-office-prof">
      <aside className="dsh-pwb-office-prof-list">
        <div className="dsh-pwb-office-prof-list-title">
          员工档案<span>{chars.length}</span>
        </div>
        {chars.map((c) => {
          const m = members.find((x) => x.id === c.id && !x.isSelf);
          const t = stateTone(m?.state ?? 'idle');
          const active = c.id === sel.id;
          return (
            <button key={c.id} type="button" className={`dsh-pwb-office-prof-item${active ? ' dsh-pwb-office-prof-item-active' : ''}`} onClick={() => setSelId(c.id)}>
              <span className="dsh-pwb-office-prof-avatar" style={{ background: avatarColor(c.id) }}>
                {c.name.slice(0, 1)}
              </span>
              <span style={{ minWidth: 0 }}>
                <span className="dsh-pwb-office-prof-item-name" style={{ display: 'block' }}>
                  {c.name}
                </span>
                <span className="dsh-pwb-office-prof-item-role" style={{ display: 'block' }}>
                  {c.role}
                </span>
              </span>
              <span className="dsh-pwb-office-prof-item-state">
                <span className="dsh-pwb-office-prof-dot" style={{ background: t.dot }} />
                {t.text}
              </span>
            </button>
          );
        })}
      </aside>

      <section className="dsh-pwb-office-prof-card">
        <div className="dsh-pwb-office-prof-head">
          <span className="dsh-pwb-office-prof-avatar" style={{ background: avatarColor(sel.id), width: 44, height: 44, borderRadius: 14, fontSize: 18 }}>
            {sel.name.slice(0, 1)}
          </span>
          <span>
            <div className="dsh-pwb-office-prof-head-name">{sel.name}</div>
            <div className="dsh-pwb-office-prof-head-role">
              {sel.role} · {sel.id}
            </div>
          </span>
          <span className="dsh-pwb-office-prof-chip" style={{ background: `${tone.dot}1f`, color: tone.dot }}>
            {tone.text}
          </span>
        </div>

        <div className="dsh-pwb-office-prof-section">
          <div className="dsh-pwb-office-prof-sec-title">
            性格<i>人设关键词，随派活与私聊注入提示词</i>
          </div>
          <textarea
            className="dsh-pwb-office-prof-persona"
            value={draft.persona}
            maxLength={300}
            placeholder="如：雷厉风行，说话直接，喜欢用数据说话；对新手耐心"
            onChange={(e) => setDraft((d) => ({ ...d, persona: e.target.value }))}
          />
        </div>

        <div className="dsh-pwb-office-prof-section">
          <div className="dsh-pwb-office-prof-sec-title">
            能力<i>0-100 分，决定派活分工与产出标准</i>
          </div>
          <div className="dsh-pwb-office-prof-skills">
            {SKILL_DIMS.map((dim) => {
              const v = draft.skills[dim];
              const val = typeof v === 'number' ? v : 0;
              return (
                <label key={dim} className="dsh-pwb-office-prof-skill">
                  <b>{dim}</b>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    value={val}
                    title={typeof v === 'number' ? `${dim} ${val}` : `${dim} 未评估（拖动即评分）`}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      setDraft((d) => ({ ...d, skills: { ...d.skills, [dim]: n } }));
                    }}
                  />
                  <i>{typeof v === 'number' ? String(val) : '未评'}</i>
                </label>
              );
            })}
          </div>
        </div>

        <div className="dsh-pwb-office-prof-section">
          <div className="dsh-pwb-office-prof-sec-title">
            关系链<i>协作关系短句，逐条注入提示词</i>
          </div>
          <div className="dsh-pwb-office-prof-links">
            {draft.links.map((l, i) => (
              <span key={`${i}-${l}`} className="dsh-pwb-office-prof-link">
                {l}
                <button type="button" title="删除" onClick={() => setDraft((d) => ({ ...d, links: d.links.filter((_, j) => j !== i) }))}>
                  ×
                </button>
              </span>
            ))}
            {draft.links.length === 0 && <span className="dsh-pwb-office-prof-item-role">暂无</span>}
          </div>
          <div className="dsh-pwb-office-prof-linkadd">
            <input
              className="dsh-pwb-office-prof-input"
              value={linkInput}
              maxLength={40}
              placeholder="如：遇到性能问题先找老王确认方案"
              onChange={(e) => setLinkInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && linkInput.trim() !== '' && draft.links.length < 10) {
                  setDraft((d) => ({ ...d, links: [...d.links, linkInput.trim().slice(0, 40)] }));
                  setLinkInput('');
                }
              }}
            />
            <button
              type="button"
              className="dsh-pwb-office-prof-ghost"
              disabled={linkInput.trim() === '' || draft.links.length >= 10}
              onClick={() => {
                setDraft((d) => ({ ...d, links: [...d.links, linkInput.trim().slice(0, 40)] }));
                setLinkInput('');
              }}
            >
              添加
            </button>
          </div>
        </div>

        <div className="dsh-pwb-office-prof-section">
          <div className="dsh-pwb-office-prof-sec-title">
            记忆<i>
              工作记录 {notes.length}/50 · 派活自动入档
              {notes.length > 0 && (
                <button type="button" className="dsh-pwb-office-prof-ghost" style={{ marginLeft: 'auto', padding: '3px 10px', fontSize: 11 }} onClick={() => void memClear()}>
                  清空
                </button>
              )}
            </i>
          </div>
          <div className="dsh-pwb-office-prof-mems">
            {notes.map((n, i) => (
              <div key={`${n.t}-${i}`} className="dsh-pwb-office-prof-mem">
                <time>{fmtTime(n.t)}</time>
                <span>{n.text}</span>
                <button type="button" title="删除这条" onClick={() => void memRemove(i)}>
                  ×
                </button>
              </div>
            ))}
            {notes.length === 0 && <span className="dsh-pwb-office-prof-item-role">还没有记忆——派活验收后自动记录</span>}
          </div>
          <div className="dsh-pwb-office-prof-linkadd">
            <input
              className="dsh-pwb-office-prof-input"
              value={memInput}
              maxLength={400}
              placeholder="手动补一条记忆，如：7/12 上线了签到功能"
              onChange={(e) => setMemInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void memAdd();
              }}
            />
            <button type="button" className="dsh-pwb-office-prof-ghost" disabled={memBusy || memInput.trim() === ''} onClick={() => void memAdd()}>
              记一条
            </button>
          </div>
        </div>

        <div className="dsh-pwb-office-prof-savebar">
          <button type="button" className="dsh-pwb-office-prof-btn" disabled={saving || !dirty} onClick={() => void save()}>
            {saving ? '保存中…' : '保存档案'}
          </button>
          {dirty && saveMsg === '' && <span className="dsh-pwb-office-prof-item-role">有未保存修改</span>}
          {saveMsg !== '' && <span className={saveMsgTone}>{saveMsg}</span>}
        </div>
      </section>
    </div>
  );
}
