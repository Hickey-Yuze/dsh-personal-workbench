/**
 * 农历/黄历封装 —— lunar-typescript（纯本地算法包，随 bundle 打包，无网络依赖）。
 * 口径：传统历法推算；宜忌为民俗参考项，不作任何决策依据。
 */
import { Lunar, Solar } from 'lunar-typescript';

export interface LunarDay {
  /** 格子用短文本：初一显示月名（如「九月」），其余显示日名（如「初五」） */
  short: string;
  /** 完整月日（如「九月十六」） */
  monthDay: string;
  /** 干支纪年（如「丙午」） */
  yearGZ: string;
  /** 生肖（如「马」） */
  zodiac: string;
  /** 宜（民俗参考） */
  yi: string[];
  /** 忌（民俗参考） */
  ji: string[];
  /** 节日/节气名（公历节日 > 农历节日 > 节气），无则 undefined */
  festival?: string;
}

export function lunarOf(dateStr: string): LunarDay {
  const parts = dateStr.split('-').map(Number);
  const y = parts[0] ?? 2026;
  const m = parts[1] ?? 1;
  const d = parts[2] ?? 1;
  const dt = new Date(y, m - 1, d);
  const l = Lunar.fromDate(dt);
  const solar = Solar.fromDate(dt);
  const dayName = l.getDayInChinese();
  return {
    short: dayName === '初一' ? `${l.getMonthInChinese()}月` : dayName,
    monthDay: `${l.getMonthInChinese()}月${dayName}`,
    yearGZ: l.getYearInGanZhi(),
    zodiac: l.getYearShengXiao(),
    yi: l.getDayYi(),
    ji: l.getDayJi(),
    festival: solar.getFestivals()[0] ?? l.getFestivals()[0] ?? (l.getJieQi() !== '' ? l.getJieQi() : undefined),
  };
}
