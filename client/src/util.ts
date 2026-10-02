/** 客户端小工具：id、日期格式化。 */

export function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 本地日期 → YYYY-MM-DD。 */
export function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function todayStr(): string {
  return toDateStr(new Date());
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** YYYY-MM-DD → 中文短日期（M月D日 + 周几）。 */
export function humanDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map((n) => Number(n));
  if (!y || !m || !d) return dateStr;
  const dt = new Date(y, m - 1, d);
  const week = ['日', '一', '二', '三', '四', '五', '六'][dt.getDay()] ?? '';
  return `${m}月${d}日 周${week}`;
}

/** 相对今天的人话（今天/明天/昨天/N 天前）。 */
export function relativeDay(dateStr: string): string {
  const today = new Date();
  const [y, m, d] = dateStr.split('-').map((n) => Number(n));
  if (!y || !m || !d) return '';
  const target = new Date(y, m - 1, d);
  const base = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const diff = Math.round((target.getTime() - base.getTime()) / 86400000);
  if (diff === 0) return '今天';
  if (diff === 1) return '明天';
  if (diff === -1) return '昨天';
  if (diff > 1) return `${diff} 天后`;
  return `${Math.abs(diff)} 天前`;
}

/** 截断长文本（列表预览用）。 */
export function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}
