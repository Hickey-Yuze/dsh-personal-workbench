/**
 * 员工档案：游戏角色卡式精准定位——性格 / 能力（七维 0-100）/ 关系链 / 记忆 集中编辑。
 * 数据源：roster + builtin（office/roster）+ memory（office/memory）；保存走 roster/builtin PATCH。
 * 真会话工作记录由宿主在 capture committed 时自动入档，本页只做展示与增删。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { addMemoryNote, assessSkills, clearMemory, fetchMemory, listAssetFiles, officeListModels, removeMemoryNote, saveBuiltin, type AssessResult } from '../office/agentClient.js';
import type { BuiltinOverride, MemoryNote, OfficeModelOption, RosterEntry } from '../office/agentClient.js';
import { BUILTIN_STAFF } from '../office/engine.js';
import { modelForChar } from '../office/objModels.js';
import { modelThumb } from '../office/modelThumb.js';
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
  /** 工位下拉选项（lead 从引擎实时取：id + 展示名）。 */
  desks?: Array<{ id: string; label: string }>;
  /** 工位改选后同步引擎：空串 = 恢复自动分配。 */
  onDeskAssigned?: (id: string, deskId: string) => void;
  /** 名字改后同步引擎改名（场景/聊天气泡/名牌）。 */
  onRenamed?: (id: string, name: string) => void;
};

type Draft = { name: string; persona: string; links: string[]; skills: Record<string, number>; avatar: string; desk: string; llm: string };

export function OfficeProfileView({ members, roster, builtin, onBuiltinSaved, desks, onDeskAssigned, onRenamed }: Props): ReactElement {
  // 左栏列表必须套用档案里保存的 name/role 覆盖：BUILTIN_STAFF 是静态数组，
  // 改名保存后不套用的话列表永远显示旧名（用户报「左边的员工名字没有修改到」）。
  const chars = useMemo(
    () =>
      [...BUILTIN_STAFF, ...roster].map((c) => {
        const ov = builtin[c.id];
        if (ov === undefined) return c;
        return {
          ...c,
          name: typeof ov.name === 'string' && ov.name !== '' ? ov.name : c.name,
          role: typeof ov.role === 'string' && ov.role !== '' ? ov.role : c.role,
        };
      }),
    [roster, builtin],
  );
  const [selId, setSelId] = useState('');
  const sel = chars.find((c) => c.id === selId) ?? chars[0];
  const ov: BuiltinOverride = builtin[sel?.id ?? ''] ?? {};

  const [draft, setDraft] = useState<Draft>({ name: '', persona: '', links: [], skills: {}, avatar: '', desk: '', llm: '' });
  const [assessing, setAssessing] = useState(false);
  const [assessInfo, setAssessInfo] = useState<AssessResult | null>(null);

  /** 能力自动评估：宿主从工作记忆/验收结论推导 7 维分，回填滑杆（可再手改）。 */
  const runAssess = useCallback(async (): Promise<void> => {
    if (sel === undefined || assessing) return;
    setAssessing(true);
    try {
      const r = await assessSkills(sel.id);
      setAssessInfo(r);
      setDraft((d) => ({ ...d, skills: { ...r.scores } }));
      setSaveMsg(`已按 ${r.stat.work} 条工作记录自动评估`);
    } catch (err) {
      setSaveMsg(err instanceof Error ? err.message : '评估失败');
    } finally {
      setAssessing(false);
    }
  }, [assessing, sel]);
  /** 可选 3D 人物模型（assets/models 下的 .gltf/.glb）。 */
  const [models, setModels] = useState<string[]>([]);
  /** 模型头像（文件名 → dataURL）：员工列表/档案头与选型预览共用。 */
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  /** 当前选中模型的全身预览图。 */
  const [preview, setPreview] = useState('');
  /** 可选 LLM 模型（宿主 office/models；失败 = 空，下拉只剩「跟随默认」）。 */
  const [modelOptions, setModelOptions] = useState<OfficeModelOption[]>([]);
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
    const sel0 = chars.find((c) => c.id === id);
    setDraft({
      persona: typeof cur.persona === 'string' ? cur.persona : '',
      links: Array.isArray(cur.links) ? [...cur.links] : [],
      skills: cur.skills !== undefined && typeof cur.skills === 'object' ? { ...cur.skills } : {},
      name: typeof cur.name === 'string' && cur.name !== '' ? cur.name : (sel0?.name ?? ''),
      avatar: typeof cur.avatar === 'string' ? cur.avatar : '',
      desk: typeof cur.deskId === 'string' ? cur.deskId : '',
      llm:
        typeof cur.provider === 'string' && cur.provider !== '' && typeof cur.model === 'string' && cur.model !== ''
          ? `${cur.provider}::${cur.model}`
          : '',
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
    if (draft.name !== (typeof cur.name === 'string' && cur.name !== '' ? cur.name : (sel?.name ?? ''))) return true;
    if (draft.avatar !== (typeof cur.avatar === 'string' ? cur.avatar : '')) return true;
    if (draft.desk !== (typeof cur.deskId === 'string' ? cur.deskId : '')) return true;
    const curLlm =
      typeof cur.provider === 'string' && cur.provider !== '' && typeof cur.model === 'string' && cur.model !== ''
        ? `${cur.provider}::${cur.model}`
        : '';
    if (draft.llm !== curLlm) return true;
    return false;
  }, [builtin, draft, sel?.id]);

  const save = useCallback(async () => {
    if (sel === undefined || saving) return;
    setSaving(true);
    setSaveMsg('');
    try {
      const sep = draft.llm.indexOf('::');
      const llmProvider = sep > 0 ? draft.llm.slice(0, sep) : '';
      const llmModel = sep > 0 ? draft.llm.slice(sep + 2) : '';
      const table = await saveBuiltin(sel.id, {
        ...(draft.name.trim() !== '' ? { name: draft.name.trim() } : {}),
        persona: draft.persona,
        links: draft.links,
        skills: draft.skills,
        avatar: draft.avatar,
        deskId: draft.desk,
        provider: llmProvider,
        model: llmModel,
      });
      onBuiltinSaved(table);
      // 工位只影响场景座位：同步给引擎（空串 = 恢复自动分配）
      onDeskAssigned?.(sel.id, draft.desk);
      if (draft.name.trim() !== '' && draft.name.trim() !== sel.name) onRenamed?.(sel.id, draft.name.trim());
      setSaveMsg('已保存 ✓');
    } catch (err) {
      setSaveMsg(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  }, [draft, onBuiltinSaved, onDeskAssigned, onRenamed, saving, sel]);

  /* LLM 模型清单：挂载时拉一次（失败静默，下拉只剩「跟随默认」） */
  useEffect(() => {
    let alive = true;
    void officeListModels().then((list) => {
      if (alive) setModelOptions(list);
    });
    return () => {
      alive = false;
    };
  }, []);

  /* 3D 模型清单：挂载时拉一次（失败静默，下拉只剩「自动分配」） */
  useEffect(() => {
    let alive = true;
    void listAssetFiles().then((files) => {
      if (alive) setModels(files.filter((f) => f.endsWith('.gltf') || f.endsWith('.glb')));
    });
    return () => {
      alive = false;
    };
  }, []);

  /** 员工实际会用的模型文件：档案指定 > 名字自动分配。 */
  const modelOf = useCallback(
    (id: string, name: string): string => {
      const av = builtin[id]?.avatar;
      return typeof av === 'string' && av !== '' ? av : modelForChar(name);
    },
    [builtin],
  );

  /* 员工头像：用模型渲半身图（失败保持文字头像回退）；键为角色 id */
  useEffect(() => {
    let alive = true;
    void Promise.all(
      chars.map(async (c) => [c.id, await modelThumb(modelOf(c.id, c.name), 'bust', 96, c.name)] as const),
    ).then((pairs) => {
      if (!alive) return;
      const next: Record<string, string> = {};
      for (const [id, url] of pairs) if (url !== null) next[id] = url;
      setThumbs(next);
    });
    return () => {
      alive = false;
    };
  }, [chars, modelOf]);

  /* 选型预览：跟随下拉（未指定时预览该员工自动分配的模型） */
  const previewFile = draft.avatar !== '' ? draft.avatar : sel !== undefined ? modelForChar(sel.name) : '';
  useEffect(() => {
    let alive = true;
    if (previewFile === '') {
      setPreview('');
      return () => {
        alive = false;
      };
    }
    void modelThumb(previewFile, 'full', 160, sel?.name ?? '').then((url) => {
      if (alive) setPreview(url ?? '');
    });
    return () => {
      alive = false;
    };
  }, [previewFile, sel?.name]);

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
              {thumbs[c.id] !== undefined ? (
                <img className="dsh-pwb-office-prof-avatar dsh-pwb-office-prof-avatar-img" src={thumbs[c.id]} alt="" />
              ) : (
                <span className="dsh-pwb-office-prof-avatar" style={{ background: avatarColor(c.id) }}>
                  {c.name.slice(0, 1)}
                </span>
              )}
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
          {thumbs[sel.id] !== undefined ? (
            <img
              className="dsh-pwb-office-prof-avatar dsh-pwb-office-prof-avatar-img"
              src={thumbs[sel.id]}
              alt=""
              style={{ width: 44, height: 44, borderRadius: 14 }}
            />
          ) : (
            <span className="dsh-pwb-office-prof-avatar" style={{ background: avatarColor(sel.id), width: 44, height: 44, borderRadius: 14, fontSize: 18 }}>
              {sel.name.slice(0, 1)}
            </span>
          )}
          <span>
            <input
              className="dsh-pwb-office-prof-head-name dsh-pwb-office-prof-name-input"
              value={draft.name}
              maxLength={20}
              placeholder="员工名字"
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
            />
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
            工位<i>场景里该员工坐哪张桌子；自动分配 = 由引擎安排空位</i>
          </div>
          <select
            className="dsh-pwb-office-prof-input"
            value={draft.desk}
            onChange={(e) => setDraft((d) => ({ ...d, desk: e.target.value }))}
          >
            <option value="">自动分配</option>
            {(desks ?? []).map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
          </select>
        </div>

        <div className="dsh-pwb-office-prof-section">
          <div className="dsh-pwb-office-prof-sec-title">
            3D 人物模型<i>场景里该员工的长相；自动分配 = 按名字固定挑一个</i>
          </div>
          <select
            className="dsh-pwb-office-prof-input"
            value={draft.avatar}
            onChange={(e) => setDraft((d) => ({ ...d, avatar: e.target.value }))}
          >
            <option value="">自动分配</option>
            {models.map((m) => (
              <option key={m} value={m}>
                {m.replace(/\.(gltf|glb)$/, '')}
              </option>
            ))}
          </select>
          <div className="dsh-pwb-office-prof-mpreview">
            {preview !== '' ? (
              <img className="dsh-pwb-office-prof-mpreview-img" src={preview} alt="" />
            ) : (
              <span className="dsh-pwb-office-prof-mpreview-empty">预览加载中…</span>
            )}
            <span className="dsh-pwb-office-prof-mpreview-name">
              {previewFile === '' ? '' : previewFile.replace(/\.(gltf|glb)$/, '')}
              {draft.avatar === '' && previewFile !== '' ? '（自动分配）' : ''}
            </span>
          </div>
        </div>

        <div className="dsh-pwb-office-prof-section">
          <div className="dsh-pwb-office-prof-sec-title">
            AI 模型<i>该员工派活/私聊时用哪个 LLM；跟随默认 = 用宿主全局选择</i>
          </div>
          <select
            className="dsh-pwb-office-prof-input"
            value={draft.llm}
            onChange={(e) => setDraft((d) => ({ ...d, llm: e.target.value }))}
          >
            <option value="">跟随默认</option>
            {modelOptions.map((m) => (
              <option key={`${m.provider}::${m.id}`} value={`${m.provider}::${m.id}`}>
                {m.provider} / {m.name}
              </option>
            ))}
          </select>
        </div>

        <div className="dsh-pwb-office-prof-section">
          <div className="dsh-pwb-office-prof-sec-title">
            能力<i>0-100 分；「自动评估」按工作记录与验收结论真数据打分，滑杆可再手改</i>
            <button
              className="dsh-pwb-office-prof-ghost"
              disabled={assessing || sel === undefined}
              style={{ marginLeft: 'auto', fontSize: 12 }}
              onClick={() => void runAssess()}
            >
              {assessing ? '评估中…' : '自动评估'}
            </button>
          </div>
          {assessInfo !== null && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
              <svg width="120" height="96" viewBox="0 0 240 192" style={{ flex: '0 0 auto' }}>
                {/* 7 维雷达图：中心 (120,100)，半径 72，维度从顶部顺时针 */}
                {[1, 0.75, 0.5, 0.25].map((f) => (
                  <polygon
                    key={f}
                    points={SKILL_DIMS.map((_, i) => {
                      const a = -Math.PI / 2 + (i * 2 * Math.PI) / SKILL_DIMS.length;
                      return `${120 + Math.cos(a) * 72 * f},${100 + Math.sin(a) * 72 * f}`;
                    }).join(' ')}
                    fill="none"
                    stroke="rgba(20,20,30,0.12)"
                    strokeWidth="1"
                  />
                ))}
                <polygon
                  points={SKILL_DIMS.map((dim, i) => {
                    const a = -Math.PI / 2 + (i * 2 * Math.PI) / SKILL_DIMS.length;
                    const r = (72 * Math.max(0, Math.min(100, assessInfo.scores[dim] ?? 0))) / 100;
                    return `${120 + Math.cos(a) * r},${100 + Math.sin(a) * r}`;
                  }).join(' ')}
                  fill="rgba(0,200,110,0.18)"
                  stroke="var(--pwb-accent, #00c853)"
                  strokeWidth="2"
                />
                {SKILL_DIMS.map((dim, i) => {
                  const a = -Math.PI / 2 + (i * 2 * Math.PI) / SKILL_DIMS.length;
                  return (
                    <text
                      key={dim}
                      x={120 + Math.cos(a) * 86}
                      y={100 + Math.sin(a) * 86 + 3}
                      textAnchor="middle"
                      fontSize="10"
                      fill="#6b7280"
                    >
                      {dim}
                    </text>
                  );
                })}
              </svg>
              <span style={{ fontSize: 12, color: '#6b7280', lineHeight: 1.7 }}>
                工作记录 {assessInfo.stat.work} 条 · 验收通过 {assessInfo.stat.pass} · 不通过 {assessInfo.stat.fail}
                <br />
                自动分已回填滑杆（60% 自动 + 40% 手填加权），可再调整后保存。
              </span>
            </div>
          )}
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
          {(() => {
            // 关系图谱：从全员关系链短句自动提取「员工→被提到的人」连线（纯文本匹配，无假数据）
            const allNames = [...BUILTIN_STAFF, ...roster].map((c) => c.name);
            const edges: Array<{ from: string; to: string; label: string }> = [];
            for (const c of [...BUILTIN_STAFF, ...roster]) {
              const ls = c.id === sel?.id ? draft.links : ((builtin[c.id]?.links ?? []) as string[]);
              for (const l of ls) {
                for (const n of allNames) {
                  if (n !== c.name && l.includes(n)) edges.push({ from: c.name, to: n, label: l });
                }
              }
            }
            if (edges.length === 0) return null;
            const uniq = Array.from(new Map(edges.map((e) => [`${e.from}→${e.to}`, e])).values());
            const names = Array.from(new Set(uniq.flatMap((e) => [e.from, e.to])));
            const W = 520;
            const H = Math.max(120, names.length * 46);
            const pos = new Map(names.map((n, i) => [n, { x: i % 2 === 0 ? 110 : W - 110, y: 30 + i * 46 }]));
            return (
              <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ maxHeight: 190, marginBottom: 8 }}>
                {uniq.map((e, i) => {
                  const a = pos.get(e.from);
                  const b = pos.get(e.to);
                  if (a === undefined || b === undefined) return null;
                  const mx = (a.x + b.x) / 2;
                  const my = (a.y + b.y) / 2 - 14;
                  return (
                    <g key={i}>
                      <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="rgba(20,20,30,0.18)" strokeWidth="1.5" />
                      <text x={mx} y={my} textAnchor="middle" fontSize="9" fill="#9ca3af">
                        {e.label.slice(0, 14)}
                      </text>
                    </g>
                  );
                })}
                {names.map((n) => {
                  const p = pos.get(n);
                  if (p === undefined) return null;
                  return (
                    <g key={n}>
                      <circle cx={p.x} cy={p.y} r={16} fill={n === (sel?.name ?? '') ? 'rgba(0,200,110,0.15)' : '#fff'} stroke="rgba(20,20,30,0.18)" strokeWidth="1.5" />
                      <text x={p.x} y={p.y + 3} textAnchor="middle" fontSize="10" fill="#374151">
                        {n}
                      </text>
                    </g>
                  );
                })}
              </svg>
            );
          })()}
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
            记忆<i>工作记录 {notes.length}/50 · 派活自动入档</i>
            {notes.length > 0 && (
              <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 6 }}>
                <button
                  type="button"
                  className="dsh-pwb-office-prof-ghost"
                  style={{ padding: '3px 10px', fontSize: 11 }}
                  title="把该员工的工作记录导出为 Markdown 知识库文件"
                  onClick={() => {
                    const md = [
                      `# ${sel?.name ?? sel?.id ?? ''} 的工作记录`,
                      '',
                      `> 导出自像素办公室员工档案 · ${new Date().toLocaleString()}`,
                      '',
                      ...[...notes].reverse().map((n) => `- ${new Date(n.t).toLocaleString()} — ${n.text}`),
                    ].join('\n');
                    const url = URL.createObjectURL(new Blob([md], { type: 'text/markdown' }));
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `办公室知识库-${sel?.name ?? sel?.id ?? '员工'}.md`;
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                >
                  导出 .md
                </button>
                <button type="button" className="dsh-pwb-office-prof-ghost" style={{ padding: '3px 10px', fontSize: 11 }} onClick={() => void memClear()}>
                  清空
                </button>
              </span>
            )}
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
