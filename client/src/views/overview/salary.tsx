/**
 * 实时日薪 —— 移植自 Yuze Workbench OverviewPage.SalaryWidget（口径 1:1）：
 * 日薪 = 月薪 ÷ 应出勤天数（单休 26.75 / 双休 21.75）；
 * 今日已赚按全天 24h 匀速累计、每秒跳动（仅工作日累计）；
 * 距下班倒计时 = 下班时刻 - 当前；发薪日提示 = 距下个发薪日。
 * 配置沿用原版 key（overview_salary_config_v1）。
 */
// @ts-nocheck —— 移植自 Yuze Workbench（原项目自带类型检查），此处不重复校验

import { useEffect, useState } from 'react';
import { Wallet, Settings2 } from 'lucide-react';

interface SalaryConfig { monthly: number; payday: number; start: string; end: string; schedule: 'double' | 'single' }

const CONFIG_KEY = 'overview_salary_config_v1';
const DEFAULT_CONFIG: SalaryConfig = { monthly: 12000, payday: 10, start: '09:00', end: '18:00', schedule: 'double' };
const SCHEDULE_META: Record<SalaryConfig['schedule'], { label: string; workdays: number }> = {
  double: { label: '双休', workdays: 21.75 },
  single: { label: '单休', workdays: 26.75 },
};

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

export function SalaryWidget() {
  const [config, setConfig] = useState<SalaryConfig>(loadConfig);
  const [editing, setEditing] = useState(false);
  const [now, setNow] = useState(new Date());

  useEffect(() => { localStorage.setItem(`dsh-pwb:${CONFIG_KEY}`, JSON.stringify(config)); }, [config]);
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const dayEarn = config.monthly / (SCHEDULE_META[config.schedule]?.workdays ?? 21.75);
  const perSecEarn = dayEarn / 86400; // 全天 24h 匀速累计
  const nowSec = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
  // 单休：周日上班；双休：周六日休
  const isWorkday = config.schedule === 'single' ? now.getDay() !== 0 : now.getDay() !== 0 && now.getDay() !== 6;
  const earned = isWorkday ? perSecEarn * nowSec : 0;
  const endSec = toSec(config.end);
  const leftToOff = isWorkday ? Math.max(0, endSec - nowSec) : 0;
  const fmtHms = (s: number) => [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map((x) => String(x).padStart(2, '0')).join(':');
  // 距下个发薪日
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

  return (
    <div className="dsh-pwb-widget relative flex h-full flex-col">
      <div className="flex items-center gap-2 px-4 pt-3">
        <span className="grid size-7 place-items-center rounded-lg bg-primary/15 text-primary"><Wallet className="size-4" /></span>
        <span className="text-sm font-semibold text-white">实时日薪</span>
        <span className="ml-auto tabular-nums text-[11px] text-white/40">{hh}:{mm}:{ss}</span>
        <button className="grid size-7 place-items-center rounded-lg text-white/40 hover:bg-white/[0.06] hover:text-white" onClick={() => setEditing((v) => !v)} title="薪资配置">
          <Settings2 className="size-4" />
        </button>
      </div>

      <div className="flex flex-1 flex-col justify-center gap-2 px-4 pb-3">
        <div className="text-[11px] text-white/40">今日已赚</div>
        <div className="text-2xl font-bold tabular-nums text-primary">
          ¥{earned.toFixed(2)}
          <span className="text-sm text-white/40">/{dayEarn.toFixed(0)} 元·天</span>
        </div>
        <div className="flex items-center justify-between text-[11px] text-white/40">
          <span>距下班</span><span>{isWorkday ? `${Math.round((leftToOff / Math.max(1, endSec - toSec(config.start))) * 100)}%` : '休'}</span>
        </div>
        <div className="text-xl font-bold tabular-nums text-white">{isWorkday ? fmtHms(leftToOff) : '00:00:00'}</div>
        <div className="rounded-lg bg-white/[0.04] px-2.5 py-1.5 text-center">
          <div className="text-[10px] text-white/40">距离发薪日</div>
          <div className="text-sm font-bold text-white">{daysToPay} 天</div>
          <div className="text-[10px] text-white/30">预计 {new Date(now.getFullYear(), now.getMonth(), config.payday).getMonth() + 1} 月 {config.payday} 日</div>
        </div>
      </div>

      {editing && (
        <div className="absolute inset-0 z-10 flex flex-col gap-2 rounded-2xl bg-white/[0.03] p-4 text-[11px] text-white/60 backdrop-blur-sm">
          <div className="text-sm font-semibold text-white">薪资配置</div>
          <label className="flex items-center justify-between gap-2">月薪 ¥
            <input type="number" value={config.monthly} onChange={(e) => setConfig((c) => ({ ...c, monthly: Number(e.target.value) || 0 }))} className="w-24 rounded-md border border-white/[0.08] bg-white/[0.05] px-2 py-1 text-right text-white" />
          </label>
          <label className="flex items-center justify-between gap-2">发薪日
            <input type="number" min={1} max={31} value={config.payday} onChange={(e) => setConfig((c) => ({ ...c, payday: Math.min(31, Math.max(1, Number(e.target.value) || 1)) }))} className="w-24 rounded-md border border-white/[0.08] bg-white/[0.05] px-2 py-1 text-right text-white" />
          </label>
          <label className="flex items-center justify-between gap-2">上班
            <input type="time" value={config.start} onChange={(e) => setConfig((c) => ({ ...c, start: e.target.value }))} className="rounded-md border border-white/[0.08] bg-white/[0.05] px-2 py-1 text-white" />
          </label>
          <label className="flex items-center justify-between gap-2">下班
            <input type="time" value={config.end} onChange={(e) => setConfig((c) => ({ ...c, end: e.target.value }))} className="rounded-md border border-white/[0.08] bg-white/[0.05] px-2 py-1 text-white" />
          </label>
          <div className="flex gap-1">
            {(Object.keys(SCHEDULE_META) as SalaryConfig['schedule'][]).map((k) => (
              <button key={k} onClick={() => setConfig((c) => ({ ...c, schedule: k }))} className={`flex-1 rounded-md border px-2 py-1 ${config.schedule === k ? 'border-primary/40 bg-primary/10 text-primary' : 'border-white/[0.08] text-white/60'}`}>
                {SCHEDULE_META[k].label}
              </button>
            ))}
          </div>
          <button className="mt-auto rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-[var(--primary-foreground,#0c1d14)]" onClick={() => setEditing(false)}>完成</button>
        </div>
      )}
    </div>
  );
}
