/**
 * 实时日薪 —— 观感 1:1 对齐 iTab（用户截图）：
 * · 「今日已赚」每秒跳动，数字 = 元.角分 + 小号厘秒（¥239.91³² 样式）
 * · 距离下行：百分比 + 大号倒计时 + 绿色进度条（下班后 100% 满条）
 * · 发薪日卡：距离天数 + 预计日期
 * · 作息三选一：双休 / 大小周 / 单休（大小周按 ISO 周号奇偶交替）
 * · 法定节假日：自动拉取当年休/班安排（Host 代理）；「节假日照常计薪」开关
 *   默认开（对齐 iTab：数字每天跳），关闭后假期停跳、仅工作日累计
 * · 设置弹窗：独立居中模态；节假日维护 = 可点选迷你月历
 *   （点日期循环 无→休→班→清除，自动获取数据淡显、手动标记高亮）
 */
// @ts-nocheck —— 移植自 iTab（原项目自带类型检查），此处不重复校验

import { useEffect, useMemo, useState } from 'react';
import { Settings2, Loader2, Wallet, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { SCHEDULE_META, fetchYearHolidays, getManualHolidays, isWorkday, saveManualHolidays, type HolidayEntry, type HolidayMap, type WorkSchedule } from './holidays.js';
import type { RpcFn } from '../../rpc.js';

interface SalaryConfig { monthly: number; payday: number; start: string; end: string; schedule: WorkSchedule }

const CONFIG_KEY = 'overview_salary_config_v1';
const DEFAULT_CONFIG: SalaryConfig = { monthly: 6000, payday: 15, start: '09:00', end: '18:00', schedule: 'bigsmall' };

function loadConfig(): SalaryConfig {
  try {
    const raw = localStorage.getItem(`dsh-pwb:${CONFIG_KEY}`);
    if (raw) {
      const c = { ...DEFAULT_CONFIG, ...JSON.parse(raw) } as SalaryConfig;
      delete (c as { holidayPay?: boolean }).holidayPay; // 旧版开关已废弃：口径统一为「日历标记优先，作息兜底」
      return c;
    }
  } catch { /* ignore */ }
  return DEFAULT_CONFIG;
}

const toSec = (hm: string) => {
  const [h, m] = hm.split(':').map(Number);
  return (h || 0) * 3600 + (m || 0) * 60;
};
const fmtHms = (s: number) => [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map((x) => String(x).padStart(2, '0')).join(':');
const isoOf = (y: number, m: number, d: number) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const shiftHm = (hm: string, deltaMin: number) => {
  const total = ((toSec(hm) + deltaMin) % 86400 + 86400) % 86400;
  return `${String(Math.floor(total / 3600)).padStart(2, '0')}:${String(Math.floor((total % 3600) / 60)).padStart(2, '0')}`;
};

/** 时间步进器：两侧 ±30 分钟按钮（onPointerDown 即按即走）+ 中间原生时间选择器。 */
function TimeStepper({ value, onStep, onChange, ariaLabel }: { value: string; onStep: (dir: 1 | -1) => void; onChange: (v: string) => void; ariaLabel: string }) {
  return (
    <div className="flex h-9 items-center gap-1 rounded-lg border border-white/[0.1] bg-white/[0.04] px-1" aria-label={ariaLabel}>
      <button type="button" className="grid size-7 shrink-0 place-items-center rounded-md bg-transparent text-white/45 transition-colors hover:bg-white/[0.08] hover:text-white" style={{ appearance: 'none' }} onPointerDown={() => onStep(-1)} title="减 30 分钟">
        <ChevronLeft className="size-4" />
      </button>
      <input type="time" value={value} onChange={(e) => e.target.value && onChange(e.target.value)} onClick={(e) => { try { (e.target as HTMLInputElement).showPicker?.(); } catch { /* 已打开等情况静默 */ } }} className="h-7 min-w-0 flex-1 cursor-pointer rounded-md bg-transparent px-1 text-center text-sm tabular-nums text-white outline-none" style={{ appearance: 'none' }} />
      <button type="button" className="grid size-7 shrink-0 place-items-center rounded-md bg-transparent text-white/45 transition-colors hover:bg-white/[0.08] hover:text-white" style={{ appearance: 'none' }} onPointerDown={() => onStep(1)} title="加 30 分钟">
        <ChevronRight className="size-4" />
      </button>
    </div>
  );
}

/** 步进器：纯 button+span 结构（零 input 元素），左右调节，观感对齐 iTab。 */
function Stepper({ value, onStep, ariaLabel }: { value: string; onStep: (dir: 1 | -1) => void; ariaLabel: string }) {
  return (
    <div className="flex h-9 items-center justify-between rounded-lg border border-white/[0.1] bg-white/[0.04] px-1" aria-label={ariaLabel}>
      <button type="button" className="grid size-7 shrink-0 place-items-center rounded-md bg-transparent text-white/45 transition-colors hover:bg-white/[0.08] hover:text-white" style={{ appearance: 'none' }} onPointerDown={() => onStep(-1)} title="减小">
        <ChevronLeft className="size-4" />
      </button>
      <span className="min-w-12 text-center text-sm tabular-nums text-white">{value}</span>
      <button type="button" className="grid size-7 shrink-0 place-items-center rounded-md bg-transparent text-white/45 transition-colors hover:bg-white/[0.08] hover:text-white" style={{ appearance: 'none' }} onPointerDown={() => onStep(1)} title="增大">
        <ChevronRight className="size-4" />
      </button>
    </div>
  );
}

export function SalaryWidget({ rpc }: { rpc: RpcFn }) {
  const [config, setConfig] = useState<SalaryConfig>(loadConfig);
  const [editing, setEditing] = useState(false);
  const [now, setNow] = useState(new Date());
  const [holidays, setHolidays] = useState<HolidayMap>(getManualHolidays);
  const [holidayLoading, setHolidayLoading] = useState(false);
  // 设置弹窗：节假日日历的当前月份 + 手动标记表
  const [calY, setCalY] = useState(() => new Date().getFullYear());
  const [calM, setCalM] = useState(() => new Date().getMonth());
  const [manualMap, setManualMap] = useState<Record<string, HolidayEntry>>({});

  useEffect(() => { localStorage.setItem(`dsh-pwb:${CONFIG_KEY}`, JSON.stringify(config)); }, [config]);

  // 拉当年法定节假日（缓存 7 天；失败回退手动表）
  useEffect(() => {
    let alive = true;
    setHolidayLoading(true);
    void fetchYearHolidays(now.getFullYear(), async (year) => {
      try {
        const out = await rpc('personal-workbench/holidays/fetch', { year });
        return { ok: out.ok, value: out.value };
      } catch {
        return { ok: false, value: null };
      }
    }).then((map) => { if (alive) setHolidays({ ...map, ...getManualHolidays() }); })
      .finally(() => { if (alive) setHolidayLoading(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rpc, now.getFullYear()]);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const dayEarn = config.monthly / (SCHEDULE_META[config.schedule]?.workdays ?? 24.25);
  const perSecEarn = dayEarn / 86400; // 全天 24h 匀速累计
  const nowSec = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
  const todayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  // 生效表：手动标记最高优先级（保存即落 localStorage，这里每次重算都并入，确保标班/标休立刻生效）
  const holidaysNow = useMemo(() => ({ ...holidays, ...getManualHolidays() }), [holidays]);
  const holiday = holidaysNow[todayIso];
  const working = isWorkday(now, config.schedule, holidaysNow);
  // 口径：日历标记优先（班=上班累计 / 休=不上班），未标记的日期按作息判断 —— 所见即所得
  const earned = working ? perSecEarn * nowSec : 0;
  const earnedStr = earned.toFixed(4); // 元.角分厘秒：239.9132
  const endSec = toSec(config.end);
  const startSec = toSec(config.start);
  const dayPct = Math.min(100, Math.max(0, ((nowSec - startSec) / Math.max(1, endSec - startSec)) * 100));
  const leftToOff = Math.max(0, endSec - nowSec);
  const offWork = nowSec >= endSec || !working;
  const daysToPay = (() => {
    const d = new Date(now);
    for (let i = 0; i < 31; i++) {
      d.setDate(d.getDate() + 1);
      if (d.getDate() === config.payday) return i + 1;
    }
    return 0;
  })();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');

  /* ─── 设置弹窗：节假日迷你月历 ─── */
  const calCells = useMemo(() => {
    const first = new Date(calY, calM, 1);
    const start = new Date(calY, calM, 1 - first.getDay());
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      return { date: isoOf(d.getFullYear(), d.getMonth(), d.getDate()), day: d.getDate(), inMonth: d.getMonth() === calM };
    });
  }, [calY, calM]);
  const manualCount = Object.keys(manualMap).length;

  const openEditor = () => {
    setManualMap(getManualHolidays());
    setCalY(new Date().getFullYear());
    setCalM(new Date().getMonth());
    setEditing(true);
  };

  /** 手动表落盘 + 即时生效（不等保存按钮，点日历立刻反映到时薪/日历卡） */
  const applyManual = (m: Record<string, HolidayEntry>) => {
    setManualMap(m);
    const text = Object.values(m).map((h) => `${h.date} ${h.holiday === null ? '无' : h.holiday ? '休' : '班'}`).sort().join('\n');
    setHolidays((h) => ({ ...h, ...saveManualHolidays(text) }));
    window.dispatchEvent(new CustomEvent('dsh-pwb-holidays-changed'));
  };

  // 点日期三态循环：休 → 班 → 无（覆盖自动数据）→ 休 —— 即点即存，所见即所得
  const toggleDay = (date: string) => {
    const shown = manualMap[date] ?? holidays[date];
    const cur = shown ? (shown.holiday === null ? '无' : shown.holiday ? '休' : '班') : '无';
    const next = cur === '休' ? '班' : cur === '班' ? '无' : '休';
    const n = { ...manualMap };
    n[date] = { holiday: next === '休' ? true : next === '班' ? false : null, name: next === '休' ? '手动节假日' : next === '班' ? '调休上班' : '手动覆盖为无', date };
    applyManual(n);
  };

  const saveEditor = () => {
    // 节假日标记在点选时已即时落盘，这里只关弹窗（月薪等字段经 config useEffect 自动保存）
    setEditing(false);
  };

  return (
    <div className="dsh-pwb-widget relative flex h-full flex-col">
      <div className="flex items-center gap-2 px-4 pt-3">
        <span className="grid size-7 place-items-center rounded-lg bg-primary/15 text-primary"><Wallet className="size-4" /></span>
        <span className="text-sm font-semibold text-white">实时日薪</span>
        {holidayLoading && <Loader2 className="size-3.5 animate-spin text-white/30" />}
        <span className="ml-auto tabular-nums text-[11px] text-white/40">{hh}:{mm}:{ss}</span>
        <button className="grid size-7 place-items-center rounded-lg text-white/40 hover:bg-white/[0.06] hover:text-white" onClick={openEditor} title="薪资设置">
          <Settings2 className="size-4" />
        </button>
      </div>

      <div className="flex flex-1 flex-col justify-center gap-1.5 px-5 pb-4">
        <div className="text-center text-[11px] text-white/45">
          今日已赚{!working ? ' · 今日休息（日历标休或作息休息日）' : holiday?.holiday === false ? ' · 调休班已计入' : ''}
        </div>
        {/* ¥239.91³² —— 主数字每秒跳动，厘秒位小号 + pop 动画强化跳动感 */}
        <div className="text-center font-bold tabular-nums text-primary">
          <span className="text-3xl">¥{earnedStr.slice(0, -2)}</span>
          <span key={earnedStr.slice(-2)} className="dsh-pwb-sec-pop text-base align-super">{earnedStr.slice(-2)}</span>
        </div>

        <div className="mt-1 flex items-center justify-between text-[11px] text-white/45">
          <span>距离下班</span>
          <span>{offWork ? '100%' : `${dayPct.toFixed(0)}%`}</span>
        </div>
        <div className="text-center text-2xl font-bold tabular-nums text-white">{offWork ? '00:00:00' : fmtHms(leftToOff)}</div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.08]">
          <div className="h-full rounded-full bg-primary transition-[width] duration-1000" style={{ width: `${offWork ? 100 : dayPct}%` }} />
        </div>

        <div className="mt-1 rounded-lg bg-white/[0.04] px-2.5 py-1.5 text-center">
          <div className="text-[10px] text-white/40">距离发薪日</div>
          <div className="text-lg font-bold text-white">{daysToPay} 天</div>
          <div className="text-[10px] text-white/30">预计 {now.getMonth() + 1} 月 {config.payday} 日</div>
        </div>
      </div>

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={() => setEditing(false)}>
          <div className="dsh-pwb-card relative isolate z-10 flex max-h-[88vh] w-96 flex-col gap-4 overflow-y-auto rounded-2xl p-5 text-[11px] text-white/60 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            {/* 头部 */}
            <div className="flex items-center">
              <span className="text-base font-semibold text-white">薪资设置</span>
              <button className="ml-auto grid size-7 place-items-center rounded-lg text-white/40 hover:bg-white/[0.08] hover:text-white" onClick={() => setEditing(false)} title="关闭">
                <X className="size-4" />
              </button>
            </div>

            {/* 基本信息 */}
            <div className="flex flex-wrap gap-x-3 gap-y-2.5 [&>div]:w-[calc(50%-6px)]">
              <div className="flex flex-col gap-1" style={{ display: 'flex', flexDirection: 'column' }}>
                <span className="text-[10px] text-white/40">月薪(元)</span>
                <input type="text" inputMode="numeric" value={config.monthly || ''} onChange={(e) => setConfig((c) => ({ ...c, monthly: Number(e.target.value.replace(/\D/g, '')) || 0 }))} placeholder="6000" className="h-9 w-28 rounded-lg border border-white/[0.1] bg-white/[0.04] px-3 text-sm text-white outline-none transition-colors hover:border-white/[0.18]" style={{ width: '7rem', display: 'block' }} />
              </div>
              <div className="flex flex-col gap-1" style={{ display: 'flex', flexDirection: 'column' }}>
                <span className="text-[10px] text-white/40">发薪日(几号)</span>
                <Stepper value={`${config.payday} 号`} ariaLabel="发薪日" onStep={(dir) => setConfig((c) => ({ ...c, payday: Math.min(31, Math.max(1, c.payday + dir)) }))} />
              </div>
              <div className="flex flex-col gap-1" style={{ display: 'flex', flexDirection: 'column' }}>
                <span className="text-[10px] text-white/40">上班</span>
                <TimeStepper value={config.start} ariaLabel="上班时间" onStep={(dir) => setConfig((c) => ({ ...c, start: shiftHm(c.start, dir * 30) }))} onChange={(v) => setConfig((c) => ({ ...c, start: v }))} />
              </div>
              <div className="flex flex-col gap-1" style={{ display: 'flex', flexDirection: 'column' }}>
                <span className="text-[10px] text-white/40">下班</span>
                <TimeStepper value={config.end} ariaLabel="下班时间" onStep={(dir) => setConfig((c) => ({ ...c, end: shiftHm(c.end, dir * 30) }))} onChange={(v) => setConfig((c) => ({ ...c, end: v }))} />
              </div>
            </div>

            {/* 作息 */}
            <div>
              <div className="mb-1.5 text-[10px] text-white/40">作息 · {SCHEDULE_META[config.schedule].desc}</div>
              <div className="grid grid-cols-3 gap-1 rounded-lg bg-white/[0.05] p-1">
                {(Object.keys(SCHEDULE_META) as WorkSchedule[]).map((k) => (
                  <button key={k} className={`rounded-md py-1.5 text-xs transition-colors ${config.schedule === k ? 'bg-primary font-semibold text-[var(--primary-foreground,#0c1d14)] shadow-sm' : 'text-white/55 hover:text-white'}`} onClick={() => setConfig((c) => ({ ...c, schedule: k }))}>
                    {SCHEDULE_META[k].label}
                  </button>
                ))}
              </div>
              <div className="mt-1 text-[10px] text-white/35">日薪按 {SCHEDULE_META[config.schedule].workdays} 天月薪折算 · 只对日历里「未标记」的日期生效，日历标记（休/班）优先</div>
            </div>

            {/* 节假日：可点选迷你月历 */}
            <div>
              <div className="mb-1.5 flex items-center">
                <span className="text-[10px] text-white/40">节假日 · 点日期循环 休 / 班 / 无</span>
                <div className="ml-auto flex items-center gap-0.5">
                  <button className="grid size-5 place-items-center rounded text-white/40 hover:bg-white/[0.08] hover:text-white" onClick={() => setCalM((m) => (m === 0 ? (setCalY((y) => y - 1), 11) : m - 1))}><ChevronLeft className="size-3.5" /></button>
                  <span className="min-w-19 text-center text-[11px] tabular-nums text-white/70">{calY} 年 {calM + 1} 月</span>
                  <button className="grid size-5 place-items-center rounded text-white/40 hover:bg-white/[0.08] hover:text-white" onClick={() => setCalM((m) => (m === 11 ? (setCalY((y) => y + 1), 0) : m + 1))}><ChevronRight className="size-3.5" /></button>
                </div>
              </div>
              <div className="grid grid-cols-7 gap-0.5 pb-0.5 text-center text-[9px] text-white/30">
                {['日', '一', '二', '三', '四', '五', '六'].map((w) => <div key={w}>{w}</div>)}
              </div>
              <div className="grid grid-cols-7 gap-0.5">
                {calCells.map((c) => {
                  const manual = manualMap[c.date];
                  const auto = holidays[c.date];
                  const eff = manual ?? auto;
                  const isOff = eff ? (eff.holiday === null ? undefined : eff.holiday) : undefined;
                  const marked = Boolean(eff && eff.holiday !== null);
                  const isManual = Boolean(manual);
                  const isToday = c.date === todayIso;
                  return (
                    <button
                      key={c.date}
                      onClick={() => toggleDay(c.date)}
                      title={`${c.date}${isOff === true ? ' · 休' : isOff === false ? ' · 调休班' : ''}${isManual ? '（手动）' : ''}`}
                      className={[
                        'flex h-8 flex-col items-center justify-center rounded-md text-[10px] leading-none transition-colors',
                        !c.inMonth ? 'opacity-30' : '',
                        isOff === true ? (isManual ? 'bg-red-400/25 font-semibold text-red-500' : 'bg-red-400/10 text-red-400/70') : '',
                        isOff === false ? (isManual ? 'bg-green-500/25 font-semibold text-green-500 ring-1 ring-green-500/60' : 'text-green-500/70 ring-1 ring-green-500/25') : '',
                        !marked ? 'text-white/55 hover:bg-white/[0.07]' : '',
                        isToday && !marked ? 'ring-1 ring-primary/60' : '',
                      ].filter(Boolean).join(' ')}
                    >
                      <span className="tabular-nums">{c.day}</span>
                      {marked ? <span className="mt-px text-[8px]">{isOff ? '休' : '班'}</span> : null}
                    </button>
                  );
                })}
              </div>
              <div className="mt-1.5 flex items-center gap-2.5 text-[9px] text-white/30">
                <span><i className="mr-0.5 inline-block size-1.5 rounded-full bg-red-400 align-middle" /> 休（当天不累计）</span>
                <span><i className="mr-0.5 inline-block size-1.5 rounded-full bg-green-500 align-middle" /> 班（当天累计）</span>
                <span>标记优先于作息 · 淡色=自动 鲜色=手动</span>
                {manualCount > 0 && (
                  <button className="ml-auto text-primary underline" onClick={() => applyManual({})}>清除手动标记（{manualCount}）</button>
                )}
              </div>
            </div>

            {/* 计薪开关 */}
            <button
              className="w-full rounded-lg bg-primary py-2.5 text-sm font-semibold text-[var(--primary-foreground,#0c1d14)] transition-opacity hover:opacity-90"
              onClick={saveEditor}
            >
              保存
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
