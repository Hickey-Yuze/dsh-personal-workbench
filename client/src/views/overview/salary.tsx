/**
 * 实时日薪 —— 观感 1:1 对齐 iTab（用户截图）：
 * · 「今日已赚」每秒跳动，数字 = 元.角分 + 小号厘秒（¥239.91³² 样式）
 * · 距离下行：百分比 + 大号倒计时 + 绿色进度条（下班后 100% 满条）
 * · 发薪日卡：距离天数 + 预计日期
 * · 作息三选一：双休 / 大小周 / 单休（大小周按 ISO 周号奇偶交替）
 * · 法定节假日：自动拉取当年休/班安排（Host 代理）；「节假日照常计薪」开关
 *   默认开（对齐 iTab：数字每天跳），关闭后假期停跳、仅工作日累计
 */
// @ts-nocheck —— 移植自 iTab（原项目自带类型检查），此处不重复校验

import { useEffect, useState } from 'react';
import { Settings2, Loader2, Wallet } from 'lucide-react';
import { SCHEDULE_META, fetchYearHolidays, getManualHolidays, isWorkday, saveManualHolidays, type HolidayMap, type WorkSchedule } from './holidays.js';
import type { RpcFn } from '../../rpc.js';

interface SalaryConfig { monthly: number; payday: number; start: string; end: string; schedule: WorkSchedule; holidayPay: boolean }

const CONFIG_KEY = 'overview_salary_config_v1';
const DEFAULT_CONFIG: SalaryConfig = { monthly: 6000, payday: 15, start: '09:00', end: '18:00', schedule: 'bigsmall', holidayPay: true };

function loadConfig(): SalaryConfig {
  try {
    const raw = localStorage.getItem(`dsh-pwb:${CONFIG_KEY}`);
    if (raw) {
      const c = { ...DEFAULT_CONFIG, ...JSON.parse(raw) } as SalaryConfig;
      if (c.holidayPay === undefined) c.holidayPay = true;
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

export function SalaryWidget({ rpc }: { rpc: RpcFn }) {
  const [config, setConfig] = useState<SalaryConfig>(loadConfig);
  const [editing, setEditing] = useState(false);
  const [manualText, setManualText] = useState('');
  const [now, setNow] = useState(new Date());
  const [holidays, setHolidays] = useState<HolidayMap>(getManualHolidays);
  const [holidayLoading, setHolidayLoading] = useState(false);

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
  const holiday = holidays[`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`];
  const working = isWorkday(now, config.schedule, holidays);
  // 节假日照常计薪（默认开，对齐 iTab 数字一直跳）→ 关闭后假期停跳
  const counting = working || config.holidayPay;
  const earned = counting ? perSecEarn * nowSec : 0;
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

  const openEditor = () => {
    setManualText(Object.entries(holidays).map(([, h]) => `${h.date} ${h.holiday ? '休' : '班'}`).join('\n'));
    setEditing(true);
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
          今日已赚{!working && holiday ? ` · ${holiday.name}放假` : ''}{!working && !holiday ? ' · 今日休息' : ''}
        </div>
        {/* ¥239.91³² —— 主数字每秒跳动，后两位小号 */}
        <div className="text-center font-bold tabular-nums text-primary">
          <span className="text-3xl">¥{earnedStr.slice(0, -2)}</span>
          <span className="text-base align-super">{earnedStr.slice(-2)}</span>
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
        <div className="absolute inset-0 z-10 flex flex-col gap-2.5 overflow-y-auto rounded-2xl bg-white/[0.03] p-4 text-[11px] text-white/60 backdrop-blur-sm">
          <div className="flex items-center">
            <span className="text-sm font-semibold text-white">薪资设置</span>
            <span className="ml-auto text-[10px] text-white/30">回车保存</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1">月薪(元)
              <input type="number" value={config.monthly} onChange={(e) => setConfig((c) => ({ ...c, monthly: Number(e.target.value) || 0 }))} className="w-full rounded-md border border-white/[0.08] bg-white/[0.05] px-2 py-1.5 text-sm text-white" />
            </label>
            <label className="flex flex-col gap-1">发薪日
              <input type="number" min={1} max={31} value={config.payday} onChange={(e) => setConfig((c) => ({ ...c, payday: Math.min(31, Math.max(1, Number(e.target.value) || 1)) }))} className="w-full rounded-md border border-white/[0.08] bg-white/[0.05] px-2 py-1.5 text-sm text-white" />
            </label>
            <label className="flex flex-col gap-1">上班
              <input type="time" value={config.start} onChange={(e) => setConfig((c) => ({ ...c, start: e.target.value }))} className="w-full rounded-md border border-white/[0.08] bg-white/[0.05] px-2 py-1.5 text-sm text-white" />
            </label>
            <label className="flex flex-col gap-1">下班
              <input type="time" value={config.end} onChange={(e) => setConfig((c) => ({ ...c, end: e.target.value }))} className="w-full rounded-md border border-white/[0.08] bg-white/[0.05] px-2 py-1.5 text-sm text-white" />
            </label>
          </div>
          <div>
            <div className="mb-1">作息 · {SCHEDULE_META[config.schedule].desc}</div>
            <div className="flex gap-1.5">
              {(Object.keys(SCHEDULE_META) as WorkSchedule[]).map((k) => (
                <button key={k} className={`flex-1 rounded-md px-2 py-1.5 text-xs ${config.schedule === k ? 'bg-primary font-semibold text-[var(--primary-foreground,#0c1d14)]' : 'border border-white/[0.08] text-white/60'}`} onClick={() => setConfig((c) => ({ ...c, schedule: k }))}>
                  {SCHEDULE_META[k].label}
                </button>
              ))}
            </div>
            <div className="mt-1 text-[10px] text-white/35">日薪按 {SCHEDULE_META[config.schedule].workdays} 天月薪折算</div>
          </div>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={config.holidayPay} onChange={(e) => setConfig((c) => ({ ...c, holidayPay: e.target.checked }))} className="accent-[var(--primary)]" />
            节假日照常计薪（默认开 = 数字每天跳；关 = 假期停跳，仅工作日累计）
          </label>
          <div className="text-[10px] leading-relaxed text-white/35">
            法定节假日自动获取（含调休班）；接口不可用时用下面的手动表兜底，每行一条：`2026-10-01 休` 或 `2026-10-10 班`。
          </div>
          <textarea
            value={manualText}
            onChange={(e) => setManualText(e.target.value)}
            placeholder={'2026-10-01 休\n2026-10-10 班'}
            className="h-16 w-full resize-none rounded-md border border-white/[0.08] bg-white/[0.05] p-2 text-[10px] text-white outline-none placeholder:text-white/25"
          />
          <button
            className="mt-auto w-full rounded-lg bg-primary py-2 text-sm font-semibold text-[var(--primary-foreground,#0c1d14)]"
            onClick={() => { setHolidays((h) => ({ ...h, ...saveManualHolidays(manualText) })); setEditing(false); }}
          >
            保存
          </button>
        </div>
      )}
    </div>
  );
}
