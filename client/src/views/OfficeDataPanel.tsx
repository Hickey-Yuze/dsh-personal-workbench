/**
 * 模块：像素办公室 —— P5 数据面板（纯只读，纯新文件，不依赖 office/ 内部实现）。
 * 顶部指标条：统计数字全部来自 localStorage 真实数据；键缺失/解析失败/非数组的指标直接不做（不造假）。
 * 左栏「同事」：props.members（MemberStat）只读快照，状态徽章文案口径沿用 OfficeModuleView 的 STATE_TEXT。
 * 右栏「任务流」：待办模块同源键（dsh-pwb:task_board_tasks）真数据只读列表，最新在前，最多 10 条。
 * 约定：JSON.parse 全部 try/catch（统一走 readArray）；根类名 dsh-pwb-office-dp，
 * 内部 dsh-pwb-office-dp-* 前缀（theme 样式后续补充，此处关键布局用内联样式保底）；
 * 浅色面板适配：颜色走 theme CSS 变量 + 语义色，不写死深色背景、不用蓝色元素。
 */
import { useEffect, useState } from 'react';
import type { CSSProperties, ReactElement } from 'react';
import type { MemberStat } from '../office/types.js';

/** 状态 → 文案（口径沿用 OfficeModuleView.tsx STATE_TEXT；CharState 之外预留 meeting，未知状态显示原文）。 */
const STATE_TEXT: Record<string, string> = {
  idle: '摸鱼中',
  walking: '走动中',
  working: '工作中',
  coffee: '咖啡时间',
  visit: '拜访同事',
  meeting: '会议中',
};

/** 状态徽章语义色（避开蓝色系；working 用主色 var(--pwb-accent) 的兜底值）。 */
const STATE_COLOR: Record<string, string> = {
  idle: '#8a8f98',
  walking: '#A78BFA',
  working: '#00b862',
  coffee: '#F59E0B',
  visit: '#F472B6',
  meeting: '#FB7185',
};

// —— localStorage 真实存储键（均经源码 grep 核实，出处见注释）——
/** 待办任务（overview/todo.tsx:38，与待办看板同 key） */
const TASKS_KEY = 'dsh-pwb:task_board_tasks';
/** 影视收藏（VideoModuleView.tsx:19） */
const VIDEO_FAV_KEY = 'dsh-pwb:video_favorites_v2';
/** 影视播放历史（VideoModuleView.tsx:20） */
const VIDEO_HIST_KEY = 'dsh-pwb:video_history_v2';
/** 音乐歌单（MusicModuleView.tsx:25） */
const MUSIC_PLAYLISTS_KEY = 'dsh-pwb:music_playlists_v3';
/** 启动器 dock 自定义应用（overview/dock.tsx:38，读取模板 `dsh-pwb:${DOCK_KEY}` dock.tsx:44） */
const DOCK_KEY = 'dsh-pwb:overview_dock_items_v1';

/**
 * 安全读取 localStorage 数组。
 * 返回 null = 键缺失 / JSON 解析失败 / 不是数组 → 对应指标直接不做、任务流显示待接入空态；
 * 返回 [] = 键存在且为合法空数组 → 正常渲染（计数 0 / 暂无待办）。
 */
const readArray = (key: string): unknown[] | null => {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

interface Metric {
  key: string;
  label: string;
  value: number;
}

/** 顶部指标条数据：全部真实键，缺键的指标不出现在结果里。 */
const loadMetrics = (): Metric[] => {
  const out: Metric[] = [];
  const tasks = readArray(TASKS_KEY);
  if (tasks !== null) {
    // 口径同待办卡的「待办计数」：未完成条数（overview/todo.tsx:70/109，status !== 'completed'）
    const open = tasks.filter((t) => (t as { status?: unknown }).status !== 'completed').length;
    out.push({ key: 'todo', label: '待办', value: open });
  }
  const favs = readArray(VIDEO_FAV_KEY);
  if (favs !== null) out.push({ key: 'fav', label: '影视收藏', value: favs.length });
  const hist = readArray(VIDEO_HIST_KEY);
  if (hist !== null) out.push({ key: 'hist', label: '播放历史', value: hist.length });
  const playlists = readArray(MUSIC_PLAYLISTS_KEY);
  if (playlists !== null) out.push({ key: 'playlist', label: '歌单', value: playlists.length });
  const dock = readArray(DOCK_KEY);
  if (dock !== null) out.push({ key: 'dock', label: '启动器应用', value: dock.length });
  return out;
};

interface TaskRow {
  id: string;
  title: string;
  done: boolean;
  /** createdAt 毫秒时间戳；缺失/非法为 0（排序时按存储顺序兜底）。 */
  ts: number;
}

/**
 * 任务流数据（只读）：标题 + 完成状态；最新在前，最多 10 条。
 * 返回 null = 键缺失/解析失败 → 空态「任务流待接入」。
 */
const loadTaskRows = (): TaskRow[] | null => {
  const list = readArray(TASKS_KEY);
  if (list === null) return null;
  const rows: TaskRow[] = [];
  list.forEach((it, idx) => {
    const obj = (it ?? null) as { title?: unknown; status?: unknown; createdAt?: unknown } | null;
    if (obj === null || typeof obj.title !== 'string' || obj.title.length === 0) return;
    const parsedTs = typeof obj.createdAt === 'string' ? Date.parse(obj.createdAt) : Number.NaN;
    rows.push({
      id: `dp-task-${idx}`,
      title: obj.title,
      done: obj.status === 'completed',
      ts: Number.isNaN(parsedTs) ? 0 : parsedTs,
    });
  });
  // 最新在前：createdAt 降序（Array#sort 在 ES2020 目标下为稳定排序），
  // 无时间戳/同时间戳的保持存储顺序（当前写入方 overview/todo.tsx 头插，存储序本身即最新在前）。
  rows.sort((a, b) => b.ts - a.ts);
  return rows.slice(0, 10);
};

// —— 内联样式保底（theme 样式补充后可迁移到 dsh-pwb-office-dp-* 类；颜色全部浅色适配）——
const rootStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  padding: 14,
  borderRadius: 12,
  border: '1px solid var(--pwb-border, rgba(20, 20, 30, 0.1))',
  background: 'var(--pwb-card, #ffffff)',
  color: 'var(--pwb-text, #1c1c22)',
  boxSizing: 'border-box',
};
const metricsRowStyle: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 10 };
const metricCardStyle: CSSProperties = {
  flex: '1 1 110px',
  minWidth: 100,
  padding: '10px 14px',
  borderRadius: 10,
  background: 'var(--pwb-card-hi, #f5f6f8)',
  boxSizing: 'border-box',
};
const metricValueStyle: CSSProperties = { display: 'block', fontSize: 24, fontWeight: 700, lineHeight: 1.2 };
const metricLabelStyle: CSSProperties = { display: 'block', marginTop: 2, fontSize: 12, color: 'var(--pwb-dim, #6b7280)' };
const colsRowStyle: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'stretch' };
const colCardStyle: CSSProperties = {
  flex: '1 1 260px',
  minWidth: 240,
  padding: '12px 14px',
  borderRadius: 10,
  border: '1px solid var(--pwb-border, rgba(20, 20, 30, 0.1))',
  boxSizing: 'border-box',
};
const colTitleStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600 };
const countBadgeStyle: CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  lineHeight: '16px',
  padding: '0 7px',
  borderRadius: 999,
  background: 'var(--pwb-card-hi, #f5f6f8)',
  color: 'var(--pwb-dim, #6b7280)',
};
const rowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 10,
  padding: '7px 0',
  // 最后一行的分隔线由后续 theme 类收尾（.dsh-pwb-office-dp-*:last-child 可覆盖）
  borderBottom: '1px solid var(--pwb-border, rgba(20, 20, 30, 0.08))',
};
const memberInfoStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 };
const memberNameStyle: CSSProperties = { fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };
const memberRoleStyle: CSSProperties = { fontSize: 11, color: 'var(--pwb-dim, #6b7280)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };
const taskTitleStyle: CSSProperties = {
  fontSize: 13,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};
const emptyStyle: CSSProperties = {
  padding: '18px 0',
  textAlign: 'center',
  fontSize: 12,
  color: 'var(--pwb-dim, #6b7280)',
};
const badgeBaseStyle: CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  lineHeight: '18px',
  padding: '1px 8px',
  borderRadius: 999,
  whiteSpace: 'nowrap',
  flexShrink: 0,
};
/** 状态徽章样式：语义色 10% 透明底 + 同色深字，浅色面板可读。 */
const stateBadgeStyle = (state: string): CSSProperties => {
  const color = STATE_COLOR[state] ?? '#8a8f98';
  return { ...badgeBaseStyle, color, background: `${color}1A` };
};
const doneBadgeStyle: CSSProperties = { ...badgeBaseStyle, color: '#00b862', background: '#00b8621A' };
const todoBadgeStyle: CSSProperties = { ...badgeBaseStyle, color: 'var(--pwb-dim, #6b7280)', background: 'var(--pwb-card-hi, #f5f6f8)' };

/**
 * P5 数据面板：顶部指标条 + 左栏同事 + 右栏任务流（全部真实数据，只读）。
 * members 由父级传入（像素办公室引擎快照，参考 OfficeModuleView 的轮询写法）。
 */
export function OfficeDataPanel(props: { members: MemberStat[] }): ReactElement {
  const { members } = props;
  const [metrics, setMetrics] = useState<Metric[]>(() => loadMetrics());
  const [tasks, setTasks] = useState<TaskRow[] | null>(() => loadTaskRows());

  // 数据读取：挂载后再刷一次（读 localStorage 是同步幂等操作，此处双保险保证拿到最新值）
  useEffect(() => {
    setMetrics(loadMetrics());
    setTasks(loadTaskRows());
  }, []);

  const badgeText = (state: MemberStat['state']): string => STATE_TEXT[state] ?? state;

  return (
    <div className="dsh-pwb-office-dp" style={rootStyle}>
      {/* 顶部指标条：真实 localStorage 计数；全部缺键时显示占位说明 */}
      <div className="dsh-pwb-office-dp-metrics" style={metricsRowStyle}>
        {metrics.length === 0 ? (
          <div className="dsh-pwb-office-dp-empty" style={emptyStyle}>暂无可用指标</div>
        ) : (
          metrics.map((m) => (
            <div key={m.key} className="dsh-pwb-office-dp-metric" style={metricCardStyle}>
              <b className="dsh-pwb-office-dp-metric-value" style={metricValueStyle}>{m.value}</b>
              <span className="dsh-pwb-office-dp-metric-label" style={metricLabelStyle}>{m.label}</span>
            </div>
          ))
        )}
      </div>

      <div className="dsh-pwb-office-dp-cols" style={colsRowStyle}>
        {/* 左栏：同事（props.members 只读快照） */}
        <div className="dsh-pwb-office-dp-col" style={colCardStyle}>
          <div className="dsh-pwb-office-dp-col-title" style={colTitleStyle}>
            同事
            <span className="dsh-pwb-office-dp-count" style={countBadgeStyle}>{members.length}</span>
          </div>
          {members.length === 0 ? (
            <div className="dsh-pwb-office-dp-empty" style={emptyStyle}>暂无同事数据</div>
          ) : (
            members.map((m) => (
              <div key={m.id} className="dsh-pwb-office-dp-member" style={rowStyle}>
                <div className="dsh-pwb-office-dp-member-info" style={memberInfoStyle}>
                  <b className="dsh-pwb-office-dp-member-name" style={memberNameStyle}>
                    {m.name}
                    {m.isSelf ? '（我）' : ''}
                  </b>
                  <span className="dsh-pwb-office-dp-member-role" style={memberRoleStyle}>{m.role}</span>
                </div>
                <span className="dsh-pwb-office-dp-badge" style={stateBadgeStyle(m.state)}>{badgeText(m.state)}</span>
              </div>
            ))
          )}
        </div>

        {/* 右栏：任务流（待办模块真数据只读，最新在前，最多 10 条） */}
        <div className="dsh-pwb-office-dp-col" style={colCardStyle}>
          <div className="dsh-pwb-office-dp-col-title" style={colTitleStyle}>
            任务流
            {tasks !== null ? (
              <span className="dsh-pwb-office-dp-count" style={countBadgeStyle}>{tasks.length}</span>
            ) : null}
          </div>
          {tasks === null ? (
            <div className="dsh-pwb-office-dp-empty" style={emptyStyle}>任务流待接入</div>
          ) : tasks.length === 0 ? (
            <div className="dsh-pwb-office-dp-empty" style={emptyStyle}>暂无待办</div>
          ) : (
            tasks.map((t) => (
              <div key={t.id} className="dsh-pwb-office-dp-task" style={rowStyle}>
                <span className="dsh-pwb-office-dp-task-title" style={taskTitleStyle} title={t.title}>{t.title}</span>
                <span className="dsh-pwb-office-dp-badge" style={t.done ? doneBadgeStyle : todoBadgeStyle}>
                  {t.done ? '已完成' : '未完成'}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
