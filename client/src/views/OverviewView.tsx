/**
 * 模块：项目总览 —— 对齐 Yuze Workbench OverviewPage 的一比一复刻版：
 * 8 个组件（文件归档 / 启动器 / 敲木鱼 / 天气 / 实时日薪 / 待办事项 / 便签 / 日历）、
 * 12 列可拖拽网格（DashboardGrid 与原版同款交互：顶部拖动条 + 边缘手柄 + 编辑布局）。
 * 数据源差别（不外联、不造假）：
 * · 文件归档 → 本机 Obsidian 知识库只读代理（原版为 Electron 本机目录）
 * · 启动器 → Host RPC 列 /Applications 并 open 启动（原版为 Electron 枚举）
 * · 天气 → 原版自带的手动记录模式（自动模式依赖外部 API，按约定不接）
 * · 敲木鱼音效 → Web Audio 现场合成（原版为 /muyu/*.mp3 静态文件）
 * 其余（日薪/待办/便签/日历）纯本地，口径与原版一致，key 结构对齐。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import type { ScheduleEvent } from '../../../src/contract.js';
import { fetchYearHolidays, festivalOf, getManualHolidays, lunarText, type HolidayMap } from './overview/holidays.js';
import type { CellConfig } from '../grid.js';
import { useKv } from '../store.js';
import { toDateStr, todayStr } from '../util.js';
import { DashboardGrid, type WidgetDef } from './DashboardGrid.js';
import { ensureWorkbenchStyle } from '../workbench/style.js';
import { ArchiveWidget } from './overview/archive.js';
import { DockWidget } from './overview/dock.js';
import { WoodenFishWidget } from './overview/wooden-fish.js';
import { SalaryWidget } from './overview/salary.js';
import { WeatherWidget } from './overview/weather.js';
import { TodoWidget } from './overview/todo.js';
import type { RpcFn } from '../rpc.js';

/** 默认布局：对齐原版截图的排布（12 列 × 5 行内）。 */
const DEFAULT_LAYOUT: CellConfig[] = [
  { id: 'archive', col: 1, row: 1, colSpan: 3, rowSpan: 2 },
  { id: 'dock', col: 4, row: 1, colSpan: 3, rowSpan: 2 },
  { id: 'muyu', col: 7, row: 1, colSpan: 3, rowSpan: 2 },
  { id: 'weather', col: 10, row: 1, colSpan: 3, rowSpan: 1 },
  { id: 'salary', col: 10, row: 2, colSpan: 3, rowSpan: 2 },
  { id: 'todo', col: 1, row: 3, colSpan: 3, rowSpan: 2 },
  { id: 'notes', col: 4, row: 3, colSpan: 3, rowSpan: 2 },
  { id: 'calendar', col: 10, row: 4, colSpan: 3, rowSpan: 3 },
];

const LAYOUT_KEY = 'overview_layout_v2';

/* ─────────────────────────── 卡片外壳 ─────────────────────────── */

function Panel({ title, extra, children }: { title: string; extra?: ReactNode; children: ReactNode }): ReactElement {
  return (
    <div className="dsh-pwb-widget">
      <div className="dsh-pwb-widget-head">
        <span className="dsh-pwb-widget-title">{title}</span>
        {extra}
      </div>
      <div className="dsh-pwb-widget-body">{children}</div>
    </div>
  );
}

/* ─────────────────────────── 日历 / 时钟 / 便签 ─────────────────────────── */

function CalendarWidget({ events, onOpen, rpc }: { events: ScheduleEvent[]; onOpen: (id: string) => void; rpc: RpcFn }): ReactElement {
  const today = todayStr();
  const base = new Date();
  const year = base.getFullYear();
  const month = base.getMonth();
  // 法定节假日（缓存 7 天，失败回退手动表）
  const [holidays, setHolidays] = useState<HolidayMap>(getManualHolidays);
  useEffect(() => {
    let alive = true;
    void fetchYearHolidays(year, async (y) => {
      try { const out = await rpc('personal-workbench/holidays/fetch', { year: y }); return { ok: out.ok, value: out.value }; } catch { return { ok: false, value: null }; }
    }).then((map) => { if (alive) setHolidays({ ...map, ...getManualHolidays() }); });
    return () => { alive = false; };
    // 手动标记变更（薪资设置里点选日历保存后）即时重读，保持与日薪口径一致
    const onHolidaysChanged = () => setHolidays({ ...getManualHolidays() });
    window.addEventListener('dsh-pwb-holidays-changed', onHolidaysChanged);
    return () => window.removeEventListener('dsh-pwb-holidays-changed', onHolidaysChanged);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year]);
  const cells = useMemo(() => {
    const first = new Date(year, month, 1);
    const start = new Date(year, month, 1 - first.getDay());
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      const date = toDateStr(d);
      const lunar = lunarText(d);
      const fest = festivalOf(d, holidays);
      // 万年历格内文字：节日名 > 农历（初一显示月份）
      const sub = fest || (lunar.startsWith('初一') ? lunar.slice(0, 1) + '月' : lunar);
      return { date, day: d.getDate(), inMonth: d.getMonth() === month, isToday: date === today, sub, off: holidays[date]?.holiday === true, work: holidays[date]?.holiday === false };
    });
  }, [year, month, today, holidays]);
  const marked = useMemo(() => new Set(events.map((e) => e.date)), [events]);
  return (
    <Panel
      title="日历"
      extra={
        <button type="button" className="dsh-pwb-link" onClick={() => onOpen('daily')}>
          打开模块
        </button>
      }
    >
      <div className="dsh-pwb-cal">
        {['日', '一', '二', '三', '四', '五', '六'].map((w) => (
          <div key={w} className="dsh-pwb-cal-head">
            {w}
          </div>
        ))}
        {cells.map((c) => (
          <div
            key={c.date}
            title={`${c.date}${c.off ? ' · 休' : c.work ? ' · 调休班' : ''}`}
            className={[
              'dsh-pwb-cal-cell',
              'dsh-pwb-cal-cell-static',
              c.inMonth ? '' : 'dsh-pwb-cal-out',
              c.isToday ? 'dsh-pwb-cal-today' : '',
              c.off ? 'dsh-pwb-cal-off' : '',
              c.work ? 'dsh-pwb-cal-work' : '',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            <span className="dsh-pwb-cal-day">{c.day}</span>
            {c.sub ? <span className="dsh-pwb-cal-lunar">{c.sub}</span> : null}
            {marked.has(c.date) ? (
              <span className="dsh-pwb-cal-dots">
                <i className="dsh-pwb-dot-live" />
              </span>
            ) : null}
          </div>
        ))}
      </div>
    </Panel>
  );
}

function ClockWidget(): ReactElement {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const progress = Math.round(((now.getTime() - dayStart) / 86400000) * 100);
  const week = ['日', '一', '二', '三', '四', '五', '六'][now.getDay()] ?? '';
  return (
    <Panel title="当前时间">
      <div className="dsh-pwb-clock">
        {hh}:{mm}
        <span className="dsh-pwb-clock-sec">:{ss}</span>
      </div>
      <div className="dsh-pwb-dimtext">
        {now.getMonth() + 1} 月 {now.getDate()} 日 周{week}
      </div>
      <div className="dsh-pwb-progress-wrap">
        <div className="dsh-pwb-progress">
          <div className="dsh-pwb-progress-fill" style={{ width: `${progress}%` }} />
        </div>
        <span className="dsh-pwb-dimtext">今日已过 {progress}%</span>
      </div>
    </Panel>
  );
}

function NotesWidget({ rpc }: { rpc: RpcFn }): ReactElement {
  const { value, save } = useKv<string>(rpc, 'overview_note', '');
  return (
    <Panel title="便签">
      <textarea
        className="dsh-pwb-notes"
        placeholder="随手记点什么，自动保存在本机…"
        value={value}
        onChange={(e) => save(e.target.value)}
        spellCheck={false}
      />
    </Panel>
  );
}

/* ─────────────────────────── 页面 ─────────────────────────── */

export function OverviewView({
  rpc,
  onOpen,
  onBack,
}: {
  rpc: RpcFn;
  onOpen: (id: string) => void;
  onBack?: () => void;
}): ReactElement {
  const { value: events } = useKv<ScheduleEvent[]>(rpc, 'events', []);
  const { value: layout, save: saveLayout } = useKv<CellConfig[]>(rpc, LAYOUT_KEY, DEFAULT_LAYOUT);
  const [editMode, setEditMode] = useState(false);
  const [adding, setAdding] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => { ensureWorkbenchStyle(); }, []);

  const allWidgets: WidgetDef[] = useMemo(
    () => [
      { id: 'archive', title: '文件归档', render: () => <ArchiveWidget rpc={rpc} /> },
      { id: 'dock', title: '启动器', render: () => <DockWidget rpc={rpc} /> },
      { id: 'muyu', title: '敲木鱼', render: () => <WoodenFishWidget /> },
      { id: 'weather', title: '天气', render: () => <WeatherWidget rpc={rpc} /> },
      { id: 'salary', title: '实时日薪', render: () => <SalaryWidget rpc={rpc} /> },
      { id: 'todo', title: '待办事项', render: () => <TodoWidget rpc={rpc} onOpen={onOpen} /> },
      { id: 'notes', title: '便签', render: () => <NotesWidget rpc={rpc} /> },
      { id: 'calendar', title: '日历', render: () => <CalendarWidget events={events} onOpen={onOpen} rpc={rpc} /> },
    ],
    [rpc, onOpen, events],
  );

  const placed = useMemo(() => new Set(layout.map((c) => c.id)), [layout]);
  const available = allWidgets.filter((w) => !placed.has(w.id));

  const commit = useCallback((next: CellConfig[]) => saveLayout(next), [saveLayout]);

  const removeWidget = useCallback(
    (id: string) => {
      saveLayout((prev) => prev.filter((c) => c.id !== id));
      setAdding(false);
    },
    [saveLayout],
  );

  const addWidget = useCallback(
    (id: string) => {
      saveLayout((prev) => {
        const maxRow = prev.reduce((m, c) => Math.max(m, c.row + c.rowSpan - 1), 1);
        return [...prev, { id, col: 1, row: maxRow + 1, colSpan: 3, rowSpan: 2 }];
      });
      setAdding(false);
    },
    [saveLayout],
  );

  return (
    <div className="dsh-pwb-dark dsh-pwb-view dsh-pwb-ovpage">
      {/* 标题块放在总览容器内部：与下方网格共用同一条缩进链，天然左对齐 */}
      {onBack !== undefined ? (
        <div className="dsh-pwb-head dsh-pwb-head-slim" style={{ padding: '12px 0' }}>
          <button type="button" className="dsh-pwb-btn" style={{ background: 'var(--pwb-card, #fff)', border: '1px solid var(--pwb-border, rgba(20,20,30,0.1))' }} onClick={onBack}>← 返回工作台</button>
        </div>
      ) : null}
      <div className="dsh-pwb-head dsh-pwb-head-ov">
        <div className="dsh-pwb-head-main">
          <div className="dsh-pwb-title-row">
            <span className="dsh-pwb-title-mark">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 13h6V4H4v9Zm0 7h6v-5H4v5Zm10 0h6v-9h-6v9Zm0-16v5h6V4h-6Z" /></svg>
            </span>
            <span className="dsh-pwb-title">项目总览</span>
          </div>
          <div className="dsh-pwb-sub">待办、日程与知识库的聚合视图</div>
        </div>
      </div>
      <div className="dsh-pwb-toolbar">
        {editMode ? (
          <>
            <button type="button" className="dsh-pwb-btn dsh-pwb-btn-primary" onClick={() => setEditMode(false)}>
              完成编辑
            </button>
            <div className="dsh-pwb-addwrap">
              <button type="button" className="dsh-pwb-btn" onClick={() => setAdding((v) => !v)}>
                + 添加组件
              </button>
              {adding ? (
                <div className="dsh-pwb-addmenu">
                  {available.length === 0 ? (
                    <div className="dsh-pwb-addempty">所有组件都已添加</div>
                  ) : (
                    available.map((w) => (
                      <button key={w.id} type="button" className="dsh-pwb-additem" onClick={() => addWidget(w.id)}>
                        {w.title}
                      </button>
                    ))
                  )}
                </div>
              ) : null}
            </div>
            <button type="button" className="dsh-pwb-btn" onClick={() => saveLayout(DEFAULT_LAYOUT)}>
              恢复默认
            </button>
            <span className="dsh-pwb-toolbar-right">顶部拖动条可移动卡片，边缘手柄调节大小</span>
          </>
        ) : (
          <>
            <button type="button" className="dsh-pwb-btn" onClick={() => setEditMode(true)}>
              编辑布局
            </button>
            <span className="dsh-pwb-toolbar-right">
              {layout.length} 个组件 · 点「编辑布局」可拖动与改大小
            </span>
          </>
        )}
      </div>

      <div className="dsh-pwb-view-body" ref={scrollRef}>
        <DashboardGrid
          widgets={allWidgets}
          layout={layout}
          onCommit={commit}
          onRemove={removeWidget}
          scrollRef={scrollRef}
          editMode={editMode}
        />
      </div>
    </div>
  );
}
