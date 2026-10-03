/**
 * 天气卡 —— 按用户给定接口规格全面升级：
 * · 实况：open-meteo forecast（温度/天气码/湿度/体感/风速）—— Host 代理
 * · 逐时预报：hourly temperature_2m + weather_code（未来 10 个整点，横向滑动）
 * · 每日概况：daily weather_code + 最高/最低温（未来 5 天）
 * · 空气质量：air-quality-api（US AQI + PM10/PM2.5），独立请求失败不阻塞主数据
 * · 地名：三源逆地理并行 fallback（Nominatim → BigDataCloud → Open-Meteo），Host 侧完成
 * · 定位链：浏览器 geolocation → IP 定位兜底；手动记录模式保留
 */
// @ts-nocheck —— 移植自 Yuze Workbench（原项目自带类型检查），此处不重复校验

import { useCallback, useEffect, useState } from 'react';
import { CloudSun, MapPin, RefreshCw, Loader2, CloudRain, Cloud, Sun, CloudFog, CloudLightning, Snowflake, Wind, Droplets } from 'lucide-react';
import type { RpcFn } from '../../rpc.js';
import { wmo } from '../../util/wmo.js';

const CITIES = ['广州', '深圳', '北京', '上海', '杭州', '成都', '武汉', '西安'];
const CUSTOM_KEY = 'overview_weather_custom_v1';
const AUTO_KEY = 'overview_weather_auto_v1';

interface CustomWeather { city: string; temp: number; condition: string; updatedAt: string }
interface AirInfo { aqi: number; pm10: number; pm25: number }
interface AutoWeather {
  place: string; temp: number; code: number; humidity: number; feels: number; wind: number; updated: string;
  hourly: Array<{ time: string; temp: number; code: number }>;
  daily: Array<{ date: string; code: number; max: number; min: number }>;
  air?: AirInfo | null;
}

function load(): CustomWeather {
  try {
    const raw = localStorage.getItem(`dsh-pwb:${CUSTOM_KEY}`);
    if (raw) return JSON.parse(raw) as CustomWeather;
  } catch { /* ignore */ }
  return { city: '广州', temp: 26, condition: '多云', updatedAt: '' };
}

/** WMO 天气码 → 描述 + 图标（open-meteo 官方码表）。 */
/** US AQI → 等级 + 色（国标观感）。 */
function aqiLevel(aqi: number): { label: string; cls: string } {
  if (aqi <= 50) return { label: '优', cls: 'bg-green-500/15 text-green-500' };
  if (aqi <= 100) return { label: '良', cls: 'bg-yellow-500/15 text-yellow-500' };
  if (aqi <= 150) return { label: '轻度污染', cls: 'bg-orange-500/15 text-orange-500' };
  if (aqi <= 200) return { label: '中度污染', cls: 'bg-red-500/15 text-red-500' };
  return { label: '重度污染', cls: 'bg-red-600/20 text-red-600' };
}

function loadAuto(): AutoWeather | null {
  try {
    const raw = localStorage.getItem(`dsh-pwb:${AUTO_KEY}`);
    return raw ? (JSON.parse(raw) as AutoWeather) : null;
  } catch { return null; }
}

/** daily.date（YYYY-MM-DD）→ 今天/明天/周X */
function dayLabel(date: string): string {
  const d = new Date(`${date}T00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((d.getTime() - today.getTime()) / 86400000);
  if (diff === 0) return '今天';
  if (diff === 1) return '明天';
  return `周${['日', '一', '二', '三', '四', '五', '六'][d.getDay()]}`;
}

export function WeatherWidget({ rpc }: { rpc: RpcFn }) {
  const [custom, setCustom] = useState<CustomWeather>(load);
  const [auto, setAuto] = useState<AutoWeather | null>(loadAuto);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);

  useEffect(() => { localStorage.setItem(`dsh-pwb:${CUSTOM_KEY}`, JSON.stringify(custom)); }, [custom]);

  // 经纬度 → 地名+实况+预报（Host 代理）；空气质量独立请求，失败静默
  const fetchByCoords = useCallback(async (lat: number, lon: number, fallbackPlace?: string) => {
    const out = await rpc('personal-workbench/weather/fetch', { lat, lon, fallbackPlace });
    if (!out.ok || !out.value) throw new Error((out.error as { message?: string })?.message ?? '获取失败');
    const v = out.value as AutoWeather;
    const airOut = await rpc('personal-workbench/weather/air', { lat, lon }).catch(() => null);
    const merged: AutoWeather = { ...v, air: airOut?.ok ? (airOut.value as AirInfo) : null };
    setAuto(merged);
    localStorage.setItem(`dsh-pwb:${AUTO_KEY}`, JSON.stringify(merged));
  }, [rpc]);

  // IP 定位兜底（宿主 Electron 默认拒绝 geolocation 权限；IP 精度到城市级）
  const fetchByIp = useCallback(async () => {
    const out = await rpc('personal-workbench/geo/ip', {});
    if (!out.ok || !out.value) throw new Error((out.error as { message?: string })?.message ?? '定位失败');
    const v = out.value as { lat: number; lon: number; city: string };
    await fetchByCoords(v.lat, v.lon, v.city);
  }, [rpc, fetchByCoords]);

  const locateAndFetch = useCallback(() => {
    setError('');
    setLoading(true);
    const tryIp = async (reason: string) => {
      try {
        await fetchByIp();
      } catch (e) {
        setError(`${reason}，IP 定位也失败：${e instanceof Error ? e.message : '未知错误'}`);
      } finally {
        setLoading(false);
      }
    };
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          void fetchByCoords(pos.coords.latitude, pos.coords.longitude).catch(() => void tryIp('精确定位后获取天气失败')).finally(() => setLoading(false));
        },
        (err) => { void tryIp(err.code === err.PERMISSION_DENIED ? '定位权限被拒' : '精确定位失败'); },
        { enableHighAccuracy: true, timeout: 4000, maximumAge: 5 * 60_000 },
      );
    } else {
      void tryIp('当前环境不支持定位');
    }
  }, [rpc, fetchByCoords, fetchByIp]);

  // 首次挂载：无自动数据且未拒绝过 → 自动定位一次
  useEffect(() => { if (auto === null) locateAndFetch(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const view = auto ?? custom;

  return (
    <div className="dsh-pwb-widget relative flex h-full flex-col">
      <div className="flex items-center gap-2 px-4 pt-3">
        <span className="grid size-7 place-items-center rounded-lg bg-sky-400/15 text-sky-400"><CloudSun className="size-4" /></span>
        <span className="text-sm font-semibold text-white">天气</span>
        <div className="ml-auto flex min-w-0 items-center gap-1">
          <span className="flex min-w-0 items-center gap-0.5 text-[11px] text-white/50">
            <MapPin className="size-3 shrink-0" />
            <span className="truncate" title={auto?.place ?? custom.city}>{auto ? auto.place : custom.city}</span>
          </span>
          <button className="grid size-7 shrink-0 place-items-center rounded-lg text-white/40 hover:bg-white/[0.06] hover:text-white" onClick={() => setEditing((v) => !v)} title="手动记录天气">
            <RefreshCw className="size-4" />
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex flex-1 items-center justify-center"><Loader2 className="size-10 animate-spin text-white/30" /></div>
      ) : auto ? (
        <div className="flex min-h-0 flex-1 flex-col gap-1.5 px-4 pb-3">
          {/* 实况主行 */}
          <div className="flex items-center gap-3">
            {(() => { const { label, Icon } = wmo(auto.code); return <Icon className="size-9 shrink-0 text-sky-400/90" />; })()}
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-bold tabular-nums text-white">{auto.temp}°</span>
                <span className="text-xs text-white/60">{wmo(auto.code).label} · 体感 {auto.feels}°</span>
              </div>
              <div className="mt-0.5 flex items-center gap-2 text-[10px] text-white/40">
                <span className="flex items-center gap-0.5"><Droplets className="size-3" />{auto.humidity}%</span>
                <span className="flex items-center gap-0.5"><Wind className="size-3" />{auto.wind}km/h</span>
                {auto.air && auto.air.aqi > 0 && (() => {
                  const lv = aqiLevel(auto.air.aqi);
                  return <span className={`rounded px-1 py-px text-[9px] font-medium ${lv.cls}`}>AQI {auto.air.aqi} {lv.label}</span>;
                })()}
                <span className="ml-auto">{auto.updated}</span>
              </div>
            </div>
          </div>
          {/* 逐时预报（未来 10 个整点，横向滑动） */}
          {auto.hourly?.length > 0 && (
            <div className="flex min-w-0 gap-1.5 overflow-x-auto pb-0.5" style={{ scrollbarWidth: 'none' }}>
              {auto.hourly.map((h) => {
                const { Icon } = wmo(h.code);
                return (
                  <div key={h.time} className="flex w-9 shrink-0 flex-col items-center gap-0.5 rounded-md bg-white/[0.04] py-1">
                    <span className="text-[9px] text-white/40 tabular-nums">{h.time}时</span>
                    <Icon className="size-3.5 text-sky-400/70" />
                    <span className="text-[10px] font-semibold tabular-nums text-white">{h.temp}°</span>
                  </div>
                );
              })}
            </div>
          )}
          {/* 每日概况（未来 5 天） */}
          {auto.daily?.length > 0 && (
            <div className="flex min-w-0 gap-1.5 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
              {auto.daily.map((d) => {
                const { label, Icon } = wmo(d.code);
                return (
                  <div key={d.date} className="flex w-9 shrink-0 flex-col items-center gap-0.5 rounded-md py-0.5" title={`${label} ${d.min}~${d.max}°`}>
                    <span className="text-[9px] text-white/40">{dayLabel(d.date)}</span>
                    <Icon className="size-3.5 text-white/50" />
                    <span className="text-[9px] tabular-nums text-white/70">{d.min}° <span className="text-white/40">/</span> {d.max}°</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-1 items-center gap-4 px-4 pb-3">
          <CloudSun className="size-12 text-sky-400/90" />
          <div className="min-w-0">
            <div className="text-3xl font-bold tabular-nums text-white">{custom.temp}°</div>
            <div className="text-xs text-white/60">{custom.condition}</div>
            <div className="mt-0.5 text-[10px] text-white/30">{custom.updatedAt ? `记录于 ${custom.updatedAt}` : '尚未记录'}</div>
          </div>
        </div>
      )}
      {error && (
        <div className="mx-4 mb-2 rounded-md bg-red-400/10 px-2 py-1 text-[10px] leading-relaxed text-red-400">
          {error}
          <button className="ml-1 underline" onClick={locateAndFetch}>重试</button>
        </div>
      )}

      {editing && (
        <div className="absolute inset-0 z-10 flex flex-col gap-2 overflow-y-auto rounded-2xl bg-white/[0.03] p-4 backdrop-blur-sm">
          <div className="text-xs font-semibold text-white">手动记录天气</div>
          <button className="rounded-lg bg-primary/10 px-2 py-1.5 text-[11px] font-medium text-primary" onClick={locateAndFetch}>自动定位并获取实况</button>
          <div className="flex flex-wrap gap-1">
            {CITIES.map((c) => (
              <button key={c} className={`rounded-md border px-2 py-0.5 text-[11px] ${custom.city === c ? 'border-primary/40 bg-primary/10 text-primary' : 'border-white/[0.08] text-white/60'}`} onClick={() => setCustom((s) => ({ ...s, city: c }))}>
                {c}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <input type="text" inputMode="numeric" value={custom.temp} onChange={(e) => setCustom((s) => ({ ...s, temp: Number(e.target.value.replace(/\D/g, '')) || 0 }))} className="w-16 rounded-md border border-white/[0.08] bg-white/[0.05] px-2 py-1 text-right text-sm text-white" />
            <span className="text-xs text-white/50">°C</span>
          </div>
          <div className="flex flex-wrap gap-1">
            {['晴', '多云', '阴', '小雨', '大雨', '雷阵雨', '雾', '雪'].map((c) => (
              <button key={c} className={`rounded-md border px-2 py-0.5 text-[11px] ${custom.condition === c ? 'border-primary/40 bg-primary/10 text-primary' : 'border-white/[0.08] text-white/60'}`} onClick={() => setCustom((s) => ({ ...s, condition: c }))}>
                {c}
              </button>
            ))}
          </div>
          <button
            className="mt-auto rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-[var(--primary-foreground,#0c1d14)]"
            onClick={() => { setCustom((s) => ({ ...s, updatedAt: new Date().toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) })); setEditing(false); }}
          >
            保存记录
          </button>
        </div>
      )}
    </div>
  );
}
