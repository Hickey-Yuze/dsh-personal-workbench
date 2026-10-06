/**
 * P3 地图编辑器 —— 地图持久化与编辑器纯函数工具。
 * localStorage 键 `dsh-pwb:office_map_v1`；载入时全量校验
 * （地图尺寸 / 家具 kind 合法 / 固定尺寸协议 / 坐标在墙内 / id 唯一 / 彼此不重叠），
 * 任何一项不合法整包拒绝（返回 null，调用方回退 defaultMap()），绝不带病渲染。
 */
import { FURN_SIZE, MAP_H, MAP_W } from './map.js';
import type { Furniture, FurnitureKind, OfficeMap } from './types.js';

const STORAGE_KEY = 'dsh-pwb:office_map_v1';

const KINDS: readonly FurnitureKind[] = ['desk', 'whiteboard', 'plant', 'coffee'];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isFurnitureKind(v: unknown): v is FurnitureKind {
  return typeof v === 'string' && (KINDS as readonly string[]).includes(v);
}

function isCellInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v);
}

/** 家具矩形与 (x,y,w,h) 矩形是否重叠（完整矩形 AABB，桌的椅位行也计入）。 */
export function rectsOverlap(f: Furniture, x: number, y: number, w: number, h: number): boolean {
  return f.x < x + w && x < f.x + f.w && f.y < y + h && y < f.y + f.h;
}

/** 矩形是否完全落在内墙之内（不占外圈墙环；墙环即 x=0 / y=0 / x=MAP_W-1 / y=MAP_H-1 一圈）。 */
export function inWalls(x: number, y: number, w: number, h: number): boolean {
  return x >= 1 && y >= 1 && x + w <= MAP_W - 1 && y + h <= MAP_H - 1;
}

/**
 * 放置/拖动合法性：不占墙环 + 与除 ignoreId 外的所有家具都不重叠。
 * 尺寸由 kind 的固定协议（FURN_SIZE）决定，不信任调用方传入的宽高。
 */
export function furnitureFits(
  furniture: Furniture[],
  kind: FurnitureKind,
  x: number,
  y: number,
  ignoreId: string | null = null,
): boolean {
  const s = FURN_SIZE[kind];
  if (!inWalls(x, y, s.w, s.h)) return false;
  return !furniture.some((f) => f.id !== ignoreId && rectsOverlap(f, x, y, s.w, s.h));
}

function parseFurniture(v: unknown): Furniture | null {
  if (!isRecord(v)) return null;
  const { id, kind, x, y, w, h } = v;
  if (typeof id !== 'string' || id === '') return null;
  if (!isFurnitureKind(kind)) return null;
  if (!isCellInt(x) || !isCellInt(y) || !isCellInt(w) || !isCellInt(h)) return null;
  const size = FURN_SIZE[kind];
  if (w !== size.w || h !== size.h) return null;
  if (!inWalls(x, y, w, h)) return null;
  return { id, kind, x, y, w, h };
}

function parseOfficeMap(v: unknown): OfficeMap | null {
  if (!isRecord(v)) return null;
  if (v.w !== MAP_W || v.h !== MAP_H) return null;
  if (!Array.isArray(v.furniture)) return null;
  const furniture: Furniture[] = [];
  const seenIds = new Set<string>();
  for (const item of v.furniture) {
    const f = parseFurniture(item);
    if (f === null) return null;
    if (seenIds.has(f.id)) return null;
    seenIds.add(f.id);
    if (furniture.some((g) => rectsOverlap(g, f.x, f.y, f.w, f.h))) return null;
    furniture.push(f);
  }
  return { w: MAP_W, h: MAP_H, furniture };
}

/** 读取本地保存的地图；键不存在 / JSON 解析失败 / 任何校验不通过都返回 null。 */
export function loadOfficeMap(): OfficeMap | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return null;
    return parseOfficeMap(JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

/** 保存地图到 localStorage；写入失败（隐私模式/配额）静默忽略，地图仍会经 onSave 交给调用方。 */
export function saveOfficeMap(map: OfficeMap): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // 存储不可用时静默：编辑结果仍通过 onSave 回调上交
  }
}

let idSeq = 0;
/** 编辑器新放家具的唯一 id（`-ed-` 段与 map.ts 默认家具的 id 空间隔离）。 */
export function genFurnId(kind: FurnitureKind): string {
  idSeq += 1;
  return `${kind}-ed-${idSeq}-${Date.now().toString(36)}`;
}
