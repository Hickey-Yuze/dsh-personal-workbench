/**
 * 实时日薪 —— 口径与原版一致，新增两项：
 * · 作息三选一：双休 / 单休 / 大小周（大小周按 ISO 周号奇偶交替休 1 天或 2 天）
 * · 智能跳过法定节假日：拉取当年国务院休/班安排（timor 接口，Host 代理），
 *   「休」不累计、「调休班」照常累计；接口失败回退手动维护表
 * 今日已赚仍为全天 24h 匀速累计、每秒跳动（仅工作日累计）。
 */
// @ts-nocheck —— 移植自 Yuze Workbench（原项目自带类型检查），此处不重复校验

import { useEffect, useState } from 'react';
import { Wallet, Settings2, Loader2 } from 'lucide-react';
import { SCHEDULE_META, fetchYearHolidays, getManualHolidays, isWorkday, saveManualHolidays, type HolidayMap, type WorkSchedule } from './holidays.js';
import type { RpcFn } from '../../rpc.js';

interface SalaryConfig { monthly: number; payday: number; start: string; end: string; schedule: WorkSchedule }

const CONFIG_KEY = 'overview_salary_config_v1';
const DEFAULT_CONFIG: SalaryConfig = { monthly: 12000, payday: 10, start: '09:00', end: '18:00', schedule: 'double' };

function loadConfig(): SalaryConfig {
  try {
    const raw = localStorage.getItem(`dsh-pwb:${CONFIG_KEY}`);
    if (raw) return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
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

  const dayEarn = config.monthly / (SCHEDULE_META[config.schedule]?.workdays ?? 21.75);
  const perSecEarn = dayEarn / 86400; // 全天 24h 匀速累计
  const nowSec = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
  const working = isWorkday(now, config.schedule, holidays);
  const earned = working ? perSecEarn * nowSec : 0;
  const endSec = toSec(config.end);
  const leftToOff = working ? Math.max(0, endSec - nowSec) : 0;
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
  const holidayName = Object.values(holidays).find((h) => h.date === `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`)?.name;

  return (
    <div className="dsh-pwb-widget relative flex h-full flex-col">
      <div className="flex items-center gap-2 px-4 pt-3">
        <span className="grid size-7 place-items-center rounded-lg bg-primary/15 text-primary"><Wallet className="size-4" /></span>
        <span className="text-sm font-semibold text-white">实时日薪</span>
        {holidayLoading && <Loader2 className="size-3.5 animate-spin text-white/30" />}
        <span className="ml-auto tabular-nums text-[11px] text-white/40">{hh}:{mm}:{ss}</span>
        <button className="grid size-7 place-items-center rounded-lg text-white/40 hover:bg-white/[0.06] hover:text-white" onClick={() => { setManualText(Object.entries(holidays).map(([, h]) => `${h.date} ${h.holiday ? '休' : '班'}`).join('\n')); setEditing((v) => !v); }} title="薪资与节假日配置">
          <Settings2 className="size-4" />
        </button>
      </div>

      <div className="flex flex-1 flex-col justify-center gap-2 px-4 pb-3">
        <div className="text-[11px] text-white/40">今日已赚{!working && holidayName ? ` · ${holidayName}放假` : !working ? ' · 今日休息' : ''}</div>
        <div className="text-2xl font-bold tabular-nums text-primary">
          ¥{earned.toFixed(2)}
          <span className="text-sm text-white/40">/{dayEarn.toFixed(0)} 元·天</span>
        </div>
        <div className="flex items-center justify-between text-[11px] text-white/40">
          <span>距下班</span><span>{working ? `${Math.round((leftToOff / Math.max(1, endSec - toSec(config.start))) * 100)}%` : '休'}</span>
        </div>
        <div className="text-xl font-bold tabular-nums text-white">{working ? fmtHms(leftToOff) : '00:00:00'}</div>
        <div className="rounded-lg bg-white/[0.04] px-2.5 py-1.5 text-center">
          <div className="text-[10px] text-white/40">距离发薪日</div>
          <div className="text-sm font-bold text-white">{daysToPay} 天</div>
          <div className="text-[10px] text-white/30">预计 {now.getMonth() + 1} 月 {config.payday} 日（遇节假日顺延以实际为准）</div>
        </div>
      </div>

      {editing && (
        <div className="absolute inset-0 z-10 flex flex-col gap-2 overflow-y-auto rounded-2xl bg-white/[0.03] p-4 text-[11px] text-white/60 backdrop-blur-sm">
          <div className="text-sm font-semibold text-white">薪资配置</div>
          <label className="flex items-center justify-between gap-2">月薪 ¥
            <input type="number" value={config.monthly} onChange={(e) => setConfig((c) => ({ ...c, monthly: Number(e.target.value) || 0 }))} className="w-24 rounded-md border border-white/[0.08] bg-white/[0.05] px-2 py-1 text-right text-white" />
          </label>
          <label className="flex items-center justify-between gap-2">发薪日
            <input type="number" min={1} max={31} value={config.payday} onChange={(e) => setConfig((c) => ({ ...c, payday: Math.min(31, Math.max(1, Number(e.target.value) || 1)) }))} className="w-24 rounded-md border border-white/[0.08] bg-white/[0.05] px-2 py-1 text-right text-white" />
          </label>
          <div className="flex gap-1">
            <label className="flex flex-1 items-center gap-1">上班
              <input type="time" value={config.start} onChange={(e) => setConfig((c) => ({ ...c, start: e.target.value }))} className="w-full rounded-md border border-white/[0.08] bg-white/[0.05] px-1.5 py-1 text-white" />
            </label>
            <label className="flex flex-1 items-center gap-1">下班
              <input type="time" value={config.end} onChange={(e) => setConfig((c) => ({ ...c, end: e.target.value }))} className="w-full rounded-md border border-white/[0.08] bg-white/[0.05] px-1.5 py-1 text-white" />
            </label>
          </div>
          <div className="flex gap-1">
            {(Object.keys(SCHEDULE_META) as WorkSchedule[]).map((k) => (
              <button key={k} title={SCHEDULE_META[k].desc} className={`flex-1 rounded-md border px-2 py-1 ${config.schedule === k ? 'border-primary/40 bg-primary/10 text-primary' : 'border-white/[0.08] text-white/60'}`} onClick={() => setConfig((c) => ({ ...c, schedule: k }))}>
                {SCHEDULE_META[k].label}
              </button>
            ))}
          </div>
          <div className="mt-1 text-[10px] leading-relaxed text-white/35">
            法定节假日已自动获取并智能跳过（含调休班）；接口不可用时用下面的手动表兜底，每行一条：`2026-10-01 休` 或 `2026-10-10 班`。
          </div>
          <textarea
            value={manualText}
            onChange={(e) => setManualText(e.target.value)}
            placeholder={'2026-10-01 休\n2026-10-10 班'}
            className="h-16 w-full resize-none rounded-md border border-white/[0.08] bg-white/[0.05] p-2 text-[10px] text-white outline-none placeholder:text-white/25"
          />
          <div className="flex gap-1.5">
            <button className="flex-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-[var(--primary-foreground,#0c1d14)]" onClick={() => { setHolidays((h) => ({ ...h, ...saveManualHolidays(manualText) })); setEditing(false); }}>保存</button>
          </div>
        </div>
      )}
    </div>
  );
}
