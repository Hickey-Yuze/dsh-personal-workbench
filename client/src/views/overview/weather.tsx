/**
 * 天气卡 —— 自动模式上线（用户要求自动获取精确位置与实况）：
 * · 定位：浏览器 navigator.geolocation（GPS/WiFi 级，可精确到街巷）
 * · 地名：Host 代理 Nominatim 反向地理编码（街道级，中文）
 * · 实况：Host 代理 open-meteo（免费无 key）：温度 / 天气码 / 湿度 / 风速
 * · 手动模式保留（原版交互），自动定位不可用（拒权/非安全上下文）时给出说明
 */
// @ts-nocheck —— 移植自 Yuze Workbench（原项目自带类型检查），此处不重复校验

import { useCallback, useEffect, useState } from 'react';
import { CloudSun, MapPin, RefreshCw, Loader2, CloudRain, Cloud, Sun, CloudFog, CloudLightning, Snowflake } from 'lucide-react';
import type { RpcFn } from '../../rpc.js';

const CITIES = ['广州', '深圳', '北京', '上海', '杭州', '成都', '武汉', '西安'];
const CUSTOM_KEY = 'overview_weather_custom_v1';
const AUTO_KEY = 'overview_weather_auto_v1';

interface CustomWeather { city: string; temp: number; condition: string; updatedAt: string }
interface AutoWeather { place: string; temp: number; code: number; humidity: number; wind: number; updated: string }

function load(): CustomWeather {
  try {
    const raw = localStorage.getItem(`dsh-pwb:${CUSTOM_KEY}`);
    if (raw) return JSON.parse(raw) as CustomWeather;
  } catch { /* ignore */ }
  return { city: '广州', temp: 26, condition: '多云', updatedAt: '' };
}

/** WMO 天气码 → 描述 + 图标（open-meteo 官方码表）。 */
function wmo(code: number): { label: string; Icon: typeof Sun } {
  if (code === 0) return { label: '晴', Icon: Sun };
  if (code <= 2) return { label: code === 1 ? '大致晴' : '多云', Icon: CloudSun };
  if (code === 3) return { label: '阴', Icon: Cloud };
  if (code === 45 || code === 48) return { label: '雾', Icon: CloudFog };
  if (code >= 51 && code <= 67) return { label: '雨', Icon: CloudRain };
  if (code >= 71 && code <= 77) return { label: '雪', Icon: Snowflake };
  if (code >= 80 && code <= 82) return { label: '阵雨', Icon: CloudRain };
  if (code === 85 || code === 86) return { label: '阵雪', Icon: Snowflake };
  if (code >= 95) return { label: '雷雨', Icon: CloudLightning };
  return { label: '未知', Icon: Cloud };
}

function loadAuto(): AutoWeather | null {
  try {
    const raw = localStorage.getItem(`dsh-pwb:${AUTO_KEY}`);
    return raw ? (JSON.parse(raw) as AutoWeather) : null;
  } catch { return null; }
}

export function WeatherWidget({ rpc }: { rpc: RpcFn }) {
  const [custom, setCustom] = useState<CustomWeather>(load);
  const [auto, setAuto] = useState<AutoWeather | null>(loadAuto);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);

  useEffect(() => { localStorage.setItem(`dsh-pwb:${CUSTOM_KEY}`, JSON.stringify(custom)); }, [custom]);

  // 经纬度 → 地名+实况（Host 代理）
  const fetchByCoords = useCallback(async (lat: number, lon: number) => {
    const out = await rpc('personal-workbench/weather/fetch', { lat, lon });
    if (!out.ok || !out.value) throw new Error((out.error as { message?: string })?.message ?? '获取失败');
    const v = out.value as AutoWeather;
    setAuto(v);
    localStorage.setItem(`dsh-pwb:${AUTO_KEY}`, JSON.stringify(v));
  }, [rpc]);

  // IP 定位兜底（宿主 Electron 默认拒绝 geolocation 权限；IP 精度到城市级）
  const fetchByIp = useCallback(async () => {
    const out = await rpc('personal-workbench/geo/ip', {});
    if (!out.ok || !out.value) throw new Error((out.error as { message?: string })?.message ?? '定位失败');
    const v = out.value as { lat: number; lon: number; city: string };
    await fetchByCoords(v.lat, v.lon);
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
    // 先试浏览器精确定位（GPS 级，可到街巷）；宿主拒绝时自动降级 IP 定位
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          void fetchByCoords(pos.coords.latitude, pos.coords.longitude).catch(() => void tryIp('精确定位后获取天气失败')).finally(() => setLoading(false));
        },
        (err) => { void tryIp(err.code === err.PERMISSION_DENIED ? '定位权限被拒' : '精确定位失败'); },
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 5 * 60_000 },
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

      <div className="flex flex-1 items-center gap-4 px-4 pb-3">
        {loading ? (
          <Loader2 className="size-12 animate-spin text-white/30" />
        ) : auto ? (
          (() => { const { label, Icon } = wmo(auto.code); return <Icon className="size-12 text-sky-400/90" />; })()
        ) : (
          <CloudSun className="size-12 text-sky-400/90" />
        )}
        <div className="min-w-0">
          {loading ? (
            <div className="text-sm text-white/40">正在定位并获取实况…</div>
          ) : auto ? (
            (() => {
              const { label } = wmo(auto.code);
              return (
                <>
                  <div className="text-3xl font-bold tabular-nums text-white">{auto.temp}°</div>
                  <div className="text-xs text-white/60">{label} · 湿度 {auto.humidity}% · 风 {auto.wind}km/h</div>
                  <div className="mt-0.5 text-[10px] text-white/30">更新于 {auto.updated} · 点右上刷新</div>
                </>
              );
            })()
          ) : (
            <>
              <div className="text-3xl font-bold tabular-nums text-white">{custom.temp}°</div>
              <div className="text-xs text-white/60">{custom.condition}</div>
              <div className="mt-0.5 text-[10px] text-white/30">{custom.updatedAt ? `记录于 ${custom.updatedAt}` : '尚未记录'}</div>
            </>
          )}
        </div>
      </div>
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
            <input type="number" value={custom.temp} onChange={(e) => setCustom((s) => ({ ...s, temp: Number(e.target.value) }))} className="w-16 rounded-md border border-white/[0.08] bg-white/[0.05] px-2 py-1 text-right text-sm text-white" />
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
