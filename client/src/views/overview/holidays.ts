/**
 * 万年历数据层：日历卡与实时日薪共用。
 * · 农历/节日：原生 Intl 中历（系统内置历法表，零误差、纯本地计算）
 * · 法定节假日：拉取当年国务院安排（timor 免费接口，Host 代理外联），
 *   localStorage 缓存；拉取失败回退手动维护表（overview_holidays_manual_v1）
 * · isWorkday：先查节假日（休→false / 调休班→true），再按作息（双休/单休/大小周）
 */

export interface HolidayEntry { holiday: boolean | null; name: string; date: string } // holiday:null = 手动覆盖为「无」

const HOLIDAY_CACHE_KEY = 'overview_holidays_cache_v1';
const HOLIDAY_MANUAL_KEY = 'overview_holidays_manual_v1';

export type HolidayMap = Record<string, HolidayEntry>; // key: YYYY-MM-DD

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(`dsh-pwb:${key}`);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch { return null; }
}

/** 手动维护表：每行「YYYY-MM-DD 休|班」，供离线/接口失败兜底。 */
export function parseManual(text: string): HolidayMap {
  const map: HolidayMap = {};
  for (const line of text.split('\n')) {
    const m = line.trim().match(/^(\d{4}-\d{2}-\d{2})\s*(休|班|无)/);
    const key = m?.[1];
    const kind = m?.[2];
    if (key && kind) map[key] = { holiday: kind === '休' ? true : kind === '班' ? false : null, name: kind === '休' ? '手动节假日' : kind === '班' ? '调休上班' : '手动覆盖为无', date: key };
  }
  return map;
}
export function getManualHolidays(): HolidayMap {
  return readJson<Record<string, HolidayEntry>>(HOLIDAY_MANUAL_KEY) ?? {};
}
export function saveManualHolidays(text: string): HolidayMap {
  const map = parseManual(text);
  localStorage.setItem(`dsh-pwb:${HOLIDAY_MANUAL_KEY}`, JSON.stringify(map));
  return map;
}

/** 拉取指定年份法定节假日（Host 代理 timor 接口，fetch 由调用方传入避免循环依赖）。 */
export async function fetchYearHolidays(year: number, rpcLike: (y: number) => Promise<{ ok: boolean; value?: unknown }>): Promise<HolidayMap> {
  const cacheKey = `${HOLIDAY_CACHE_KEY}:${year}`;
  const cached = readJson<{ fetchedAt: number; map: HolidayMap }>(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < 7 * 86400_000) return cached.map;
  try {
    const res = await rpcLike(year);
    const data = (res.ok ? res.value : null) as Record<string, { holiday?: boolean; name?: string; date?: string }> | null;
    if (!data || typeof data !== 'object') throw new Error('bad payload');
    const map: HolidayMap = {};
    for (const [md, v] of Object.entries(data)) {
      if (!v || typeof v.date !== 'string') continue;
      map[v.date] = { holiday: v.holiday !== false, name: v.name ?? '', date: v.date };
    }
    localStorage.setItem(`dsh-pwb:${cacheKey}`, JSON.stringify({ fetchedAt: Date.now(), map }));
    return map;
  } catch {
    return getManualHolidays();
  }
}

export type WorkSchedule = 'double' | 'single' | 'bigsmall';

/** 作息元数据：应出勤天数（月薪折算口径，与原版一致）。 */
export const SCHEDULE_META: Record<WorkSchedule, { label: string; workdays: number; desc: string }> = {
  double: { label: '双休', workdays: 21.75, desc: '每周休周六、周日' },
  single: { label: '单休', workdays: 26.75, desc: '每周仅休周日' },
  bigsmall: { label: '大小周', workdays: 24.25, desc: '单周休一天、双周休两天，按 ISO 周号奇偶交替' },
};

const toISODate = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** 是否工作日：节假日表优先（休→false、调休班→true），再按作息判断周末。 */
export function isWorkday(d: Date, schedule: WorkSchedule, holidays: HolidayMap): boolean {
  const iso = toISODate(d);
  const h = holidays[iso];
  if (h && h.holiday !== null) return !h.holiday; // 「休」= 放假不上班；「班」= 调休要上班
  // holiday === null = 手动覆盖为「无」→ 按普通周末逻辑判定
  const dow = d.getDay();
  if (schedule === 'single') return dow !== 0;
  if (schedule === 'bigsmall') {
    // 大小周：ISO 周号奇偶交替 —— 奇数周休周六日，偶数周仅休周日（下周反之）
    const jan1 = new Date(d.getFullYear(), 0, 1);
    const weekNo = Math.ceil(((d.getTime() - jan1.getTime()) / 86400000 + jan1.getDay() + 1) / 7);
    return weekNo % 2 === 1 ? dow !== 0 && dow !== 6 : dow !== 0;
  }
  return dow !== 0 && dow !== 6;
}

/* ───────────────────────── 农历（Intl 中历，纯本地） ───────────────────────── */

const lunarFmt = new Intl.DateTimeFormat('zh-u-ca-chinese', { month: 'numeric', day: 'numeric' });
const LUNAR_MONTHS = ['正', '二', '三', '四', '五', '六', '七', '八', '九', '十', '冬', '腊'];
const LUNAR_DAYS = ['初一', '初二', '初三', '初四', '初五', '初六', '初七', '初八', '初九', '初十',
  '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十',
  '廿一', '廿二', '廿三', '廿四', '廿五', '廿六', '廿七', '廿八', '廿九', '三十'];

/** 农历月日：返回如「五初五」「八月十五」（月/日分开取，Intl 输出形如 5-5）。 */
export function lunarText(d: Date): string {
  try {
    const parts = lunarFmt.formatToParts(d);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
    const month = Number(get('month'));
    const day = Number(get('day'));
    if (!month || !day) return '';
    return `${LUNAR_MONTHS[(month - 1) % 12]}${LUNAR_DAYS[(day - 1) % 30]}`;
  } catch { return ''; }
}

/** 农历月、日数字（节日判断用）。 */
export function lunarParts(d: Date): { month: number; day: number } {
  try {
    const parts = lunarFmt.formatToParts(d);
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
    return { month: get('month'), day: get('day') };
  } catch { return { month: 0, day: 0 }; }
}

/** 当天节日名（农历节日 + 公历节日），无则空串。 */
export function festivalOf(d: Date, holidays: HolidayMap): string {
  const iso = toISODate(d);
  const h = holidays[iso];
  if (h?.name && h.name !== '调休上班' && h.name !== '手动节假日' && h.name !== '手动覆盖为无' && h.holiday !== null) return h.name;
  const { month, day } = lunarParts(d);
  if (month === 1 && day === 1) return '春节';
  if (month === 1 && day === 15) return '元宵';
  if (month === 5 && day === 5) return '端午';
  if (month === 7 && day === 7) return '七夕';
  if (month === 8 && day === 15) return '中秋';
  if (month === 9 && day === 9) return '重阳';
  if (month === 12 && day === 8) return '腊八';
  // 除夕：明天是正月初一
  const tmr = lunarParts(new Date(d.getTime() + 86400000));
  if (tmr.month === 1 && tmr.day === 1) return '除夕';
  const m = d.getMonth() + 1, dd = d.getDate();
  if (m === 1 && dd === 1) return '元旦';
  if (m === 5 && dd === 1) return '劳动节';
  if (m === 6 && dd === 1) return '儿童节';
  if (m === 10 && dd === 1) return '国庆节';
  return '';
}
