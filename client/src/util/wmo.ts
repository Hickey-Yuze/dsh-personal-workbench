/**
 * WMO 天气码 → 文案 + lucide 图标（总览天气卡与日程万年历共用）。
 */
import { Cloud, CloudFog, CloudLightning, CloudRain, CloudSun, Snowflake, Sun } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export function wmo(code: number): { label: string; Icon: LucideIcon } {
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

/** 天气自动数据缓存结构（overview_weather_auto_v1，天气卡写入，日程万年历复用）。 */
export interface AutoWeatherShared {
  place: string; temp: number; code: number; humidity: number; feels: number; wind: number; updated: string;
  hourly: Array<{ time: string; temp: number; code: number }>;
  daily: Array<{ date: string; code: number; max: number; min: number }>;
}

export function loadAutoWeather(): AutoWeatherShared | null {
  try {
    const raw = localStorage.getItem('dsh-pwb:overview_weather_auto_v1');
    return raw ? (JSON.parse(raw) as AutoWeatherShared) : null;
  } catch { return null; }
}
