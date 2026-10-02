/**
 * 天气卡 —— 交互对齐 Yuze Workbench OverviewPage.WeatherWidget 的「手动模式」。
 * 原版自动模式依赖外部气象 API（open-meteo 等 fetch）；插件按「不外联」
 * 约定不接外部接口 —— 只做原版自带的手动记录：城市选择 + 温度/天气手填 +
 * 更新时间，持久化沿用原版 key（overview_weather_custom_v1）。
 * 自动模式不造假数据：按钮置灰并注明原因。
 */
// @ts-nocheck —— 移植自 Yuze Workbench（原项目自带类型检查），此处不重复校验

import { useEffect, useState } from 'react';
import { CloudSun, MapPin, RefreshCw } from 'lucide-react';

const CITIES = ['广州', '深圳', '北京', '上海', '杭州', '成都', '武汉', '西安'];
const CONDITIONS = ['晴', '多云', '阴', '小雨', '大雨', '雷阵雨', '雾', '雪'];
const CUSTOM_KEY = 'overview_weather_custom_v1';

interface CustomWeather { city: string; temp: number; condition: string; updatedAt: string }

function load(): CustomWeather {
  try {
    const raw = localStorage.getItem(`dsh-pwb:${CUSTOM_KEY}`);
    if (raw) return JSON.parse(raw) as CustomWeather;
  } catch { /* ignore */ }
  return { city: '广州', temp: 26, condition: '多云', updatedAt: '' };
}

export function WeatherWidget() {
  const [w, setW] = useState<CustomWeather>(load);
  const [editing, setEditing] = useState(false);

  useEffect(() => { localStorage.setItem(`dsh-pwb:${CUSTOM_KEY}`, JSON.stringify(w)); }, [w]);

  return (
    <div className="dsh-pwb-widget relative flex h-full flex-col">
      <div className="flex items-center gap-2 px-4 pt-3">
        <span className="grid size-7 place-items-center rounded-lg bg-sky-400/15 text-sky-400"><CloudSun className="size-4" /></span>
        <span className="text-sm font-semibold text-white">天气</span>
        <div className="ml-auto flex items-center gap-1">
          <span className="flex items-center gap-0.5 text-[11px] text-white/50"><MapPin className="size-3" />{w.city}</span>
          <button className="grid size-7 place-items-center rounded-lg text-white/40 hover:bg-white/[0.06] hover:text-white" onClick={() => setEditing((v) => !v)} title="手动记录天气">
            <RefreshCw className="size-4" />
          </button>
        </div>
      </div>

      <div className="flex flex-1 items-center gap-4 px-4 pb-3">
        <CloudSun className="size-12 text-sky-400/90" />
        <div>
          <div className="text-3xl font-bold tabular-nums text-white">{w.temp}°</div>
          <div className="text-xs text-white/60">{w.condition}</div>
          <div className="mt-0.5 text-[10px] text-white/30">
            {w.updatedAt ? `记录于 ${w.updatedAt}` : '尚未记录'}
          </div>
        </div>
      </div>

      {editing && (
        <div className="absolute inset-0 z-10 flex flex-col gap-2 rounded-2xl bg-white/[0.03] p-4 backdrop-blur-sm">
          <div className="text-xs font-semibold text-white">手动记录天气</div>
          <div className="text-[10px] leading-relaxed text-white/40">自动气象数据需要连接外部服务，按插件「不外联」约定未启用 —— 在这里手动记录当前天气。</div>
          <div className="flex flex-wrap gap-1">
            {CITIES.map((c) => (
              <button key={c} className={`rounded-md border px-2 py-0.5 text-[11px] ${w.city === c ? 'border-primary/40 bg-primary/10 text-primary' : 'border-white/[0.08] text-white/60'}`} onClick={() => setW((s) => ({ ...s, city: c }))}>
                {c}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <input type="number" value={w.temp} onChange={(e) => setW((s) => ({ ...s, temp: Number(e.target.value) }))} className="w-16 rounded-md border border-white/[0.08] bg-white/[0.05] px-2 py-1 text-right text-sm text-white" />
            <span className="text-xs text-white/50">°C</span>
          </div>
          <div className="flex flex-wrap gap-1">
            {CONDITIONS.map((c) => (
              <button key={c} className={`rounded-md border px-2 py-0.5 text-[11px] ${w.condition === c ? 'border-primary/40 bg-primary/10 text-primary' : 'border-white/[0.08] text-white/60'}`} onClick={() => setW((s) => ({ ...s, condition: c }))}>
                {c}
              </button>
            ))}
          </div>
          <button
            className="mt-auto rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-[var(--primary-foreground,#0c1d14)]"
            onClick={() => { setW((s) => ({ ...s, updatedAt: new Date().toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) })); setEditing(false); }}
          >
            保存记录
          </button>
        </div>
      )}
    </div>
  );
}
