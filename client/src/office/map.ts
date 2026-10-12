/**
 * 默认地图与寻路 —— 整数格协议：
 * · 外圈一圈墙；家具按固定尺寸占格（桌 2×2、白板 2×1、盆栽/咖啡机 1×1）
 * · 桌子只锁「桌面行」（上排），下排是工位过道：椅位 = 桌左下格，人物坐进去
 * · BFS 四向最短路；逻辑层只认整数格，渲染层再做插值
 */
import type { Furniture, FurnitureKind, OfficeMap, Vec } from './types.js';

export const MAP_W = 24;
export const MAP_H = 15;

/** 各家具固定尺寸（整数格协议）。 */
export const FURN_SIZE: Record<FurnitureKind, { w: number; h: number }> = {
  desk: { w: 2, h: 2 },
  whiteboard: { w: 2, h: 1 },
  plant: { w: 1, h: 1 },
  coffee: { w: 1, h: 1 },
  wall: { w: 1, h: 1 },
  microwave: { w: 1, h: 1 },
  fridge: { w: 1, h: 1 },
  carpet: { w: 4, h: 3 },
  roundtable: { w: 2, h: 2 },
  cabinet: { w: 1, h: 1 },
};

let furnSeq = 0;
function mk(kind: FurnitureKind, x: number, y: number): Furniture {
  const s = FURN_SIZE[kind];
  furnSeq += 1;
  return { id: `${kind}-${furnSeq}`, kind, x, y, w: s.w, h: s.h };
}

/** 默认办公室（24×15，紧凑方厅，比例≈画布 1.6:1）：砖墙里间（上中双工位）、左侧白板、右侧沿墙工位、左下会议区、下排工位、中央自己。 */
export function defaultMap(): OfficeMap {
  furnSeq = 0;
  const furniture: Furniture[] = [
    // ── 砖墙里间（上中）：竖排 x=5（y=1..5）+ 横排 y=6（x=6..12）──
    mk('wall', 5, 1),
    mk('wall', 5, 2),
    mk('wall', 5, 3),
    mk('wall', 5, 4),
    mk('wall', 5, 5),
    mk('wall', 6, 6),
    mk('wall', 7, 6),
    mk('wall', 8, 6),
    mk('wall', 9, 6),
    mk('wall', 10, 6),
    mk('wall', 11, 6),
    mk('wall', 12, 6),
    // 里间工位（2 桌）+ 绿植
    mk('desk', 7, 2),
    mk('desk', 11, 2),
    mk('plant', 6, 1),
    // ── 左上：白板 + 绿植 ──
    mk('whiteboard', 1, 2),
    mk('plant', 1, 4),
    // ── 右侧沿墙工位（上排 + 中排）+ 抽屉柜 ──
    mk('desk', 16, 2),
    mk('desk', 20, 2),
    mk('cabinet', 15, 1),
    mk('cabinet', 19, 1),
    mk('desk', 16, 8),
    mk('desk', 20, 8),
    mk('cabinet', 15, 7),
    mk('cabinet', 19, 7),
    // ── 会议区（左下：地毯 + 圆桌）──
    mk('carpet', 2, 9),
    mk('roundtable', 3, 10),
    // ── 下排工位（3 桌）──
    mk('desk', 2, 12),
    mk('desk', 17, 12),
    mk('desk', 20, 12),
    // ── 自己的中央工位（必须是最后一张桌：spawn 约定 desks 最后一座是自己）──
    mk('desk', 12, 11),
    mk('cabinet', 14, 12),
    // ── 绿植点缀 ──
    mk('plant', 1, 13),
    mk('plant', 22, 13),
    mk('plant', 10, 13),
    mk('plant', 22, 6),
    // ── 咖啡机 / 冰箱 ──
    mk('coffee', 1, 9),
    mk('fridge', 22, 12),
  ];
  return { w: MAP_W, h: MAP_H, furniture };
}

/**
 * 不可通行格：外圈墙 + 家具占格。
 * 桌子特殊：只锁桌面行（dy < h-1），最后一行是椅位/过道，允许走。
 */
export function buildBlocked(map: OfficeMap): Uint8Array {
  const blocked = new Uint8Array(map.w * map.h);
  for (let x = 0; x < map.w; x++) {
    blocked[x] = 1;
    blocked[(map.h - 1) * map.w + x] = 1;
  }
  for (let y = 0; y < map.h; y++) {
    blocked[y * map.w] = 1;
    blocked[y * map.w + map.w - 1] = 1;
  }
  for (const f of map.furniture) {
    if (f.kind === 'carpet') continue; // 地毯可通行（只是地面装饰）
    const lastRow = f.kind === 'desk' ? f.h - 1 : -1; // 桌子留出最后一行走人
    for (let dy = 0; dy < f.h; dy++) {
      if (dy === lastRow) continue;
      for (let dx = 0; dx < f.w; dx++) {
        blocked[(f.y + dy) * map.w + (f.x + dx)] = 1;
      }
    }
  }
  return blocked;
}

export function isFree(map: OfficeMap, blocked: Uint8Array, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < map.w && y < map.h && blocked[y * map.w + x] === 0;
}

/** 工位椅位 = 桌左下格（下排是过道，可走可坐）。 */
export function deskChairCell(f: Furniture): Vec {
  return { x: f.x, y: f.y + f.h - 1 };
}

/** BFS 四向最短路。返回不含起点的格序列；不可达/起点即终点返回 []。 */
export function findPath(map: OfficeMap, blocked: Uint8Array, from: Vec, to: Vec): Vec[] {
  if (from.x === to.x && from.y === to.y) return [];
  if (!isFree(map, blocked, to.x, to.y)) return [];
  const w = map.w;
  const start = from.y * w + from.x;
  const target = to.y * w + to.x;
  const prev = new Int32Array(w * map.h).fill(-1);
  const seen = new Uint8Array(w * map.h);
  const queue: number[] = [start];
  seen[start] = 1;
  let head = 0;
  while (head < queue.length) {
    const cur = queue[head] as number;
    head += 1;
    if (cur === target) break;
    const cx = cur % w;
    const cy = (cur - cx) / w;
    const nexts: Array<[number, number]> = [
      [cx + 1, cy],
      [cx - 1, cy],
      [cx, cy + 1],
      [cx, cy - 1],
    ];
    for (const [nx, ny] of nexts) {
      if (!isFree(map, blocked, nx, ny)) continue;
      const ni = ny * w + nx;
      if (seen[ni] === 1) continue;
      seen[ni] = 1;
      prev[ni] = cur;
      queue.push(ni);
    }
  }
  if (seen[target] !== 1) return [];
  const path: Vec[] = [];
  let cur = target;
  while (cur !== start) {
    const x = cur % w;
    path.push({ x, y: (cur - x) / w });
    cur = prev[cur] as number;
  }
  path.reverse();
  return path;
}
