/**
 * 默认地图与寻路 —— 整数格协议：
 * · 外圈一圈墙；家具按固定尺寸占格（桌 2×2、白板 2×1、盆栽/咖啡机 1×1）
 * · 桌子只锁「桌面行」（上排），下排是工位过道：椅位 = 桌左下格，人物坐进去
 * · BFS 四向最短路；逻辑层只认整数格，渲染层再做插值
 */
import type { Furniture, FurnitureKind, OfficeMap, Vec } from './types.js';

export const MAP_W = 40;
export const MAP_H = 12;

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

/** 默认办公室（40×12）：1:1 复刻参考图布局——黑框玻璃隔出右上里间（双工位）、左前地毯+圆桌会议区、右侧沿墙工位排、中央自己。 */
export function defaultMap(): OfficeMap {
  furnSeq = 0;
  const furniture: Furniture[] = [
    // ── 里间（黑框玻璃墙围出，右上）──
    // 竖排玻璃墙 gx=10（gy=1..4），横排玻璃墙 gy=5（gx=10..23），gx=24,gy=5 处留缺口当门
    mk('wall', 10, 1),
    mk('wall', 10, 2),
    mk('wall', 10, 3),
    mk('wall', 10, 4),
    mk('wall', 11, 5),
    mk('wall', 12, 5),
    mk('wall', 13, 5),
    mk('wall', 14, 5),
    mk('wall', 15, 5),
    mk('wall', 16, 5),
    mk('wall', 17, 5),
    mk('wall', 18, 5),
    mk('wall', 19, 5),
    mk('wall', 20, 5),
    mk('wall', 21, 5),
    mk('wall', 22, 5),
    mk('wall', 23, 5),
    // 里间工位（背贴后墙，iMac 面朝南）
    mk('desk', 13, 2),
    mk('desk', 18, 2),
    // 里间绿植小点缀
    mk('plant', 11, 1),
    // ── 外间会议区（左前：米色地毯 + 白圆桌，对应参考图左下）──
    mk('carpet', 4, 7),
    mk('roundtable', 5, 8),
    mk('whiteboard', 14, 9),
    // ── 右外沿墙工位排（对应参考图右侧沿墙一排 iMac）──
    mk('desk', 27, 2),
    mk('desk', 32, 2),
    mk('desk', 37, 2),
    mk('desk', 27, 7),
    mk('desk', 32, 7),
    // 工位旁白色抽屉柜
    mk('cabinet', 26, 1),
    mk('cabinet', 31, 1),
    mk('cabinet', 36, 1),
    // ── 绿植（角落 + 会议区旁）──
    mk('plant', 1, 1),
    mk('plant', 1, 10),
    mk('plant', 9, 10),
    mk('plant', 39, 10),
    // 咖啡机（外间右上角）
    mk('coffee', 26, 9),
    // 冰箱（右后角）
    mk('fridge', 39, 1),
    // 自己的中央外间工位（必须是最后一张桌：spawn 约定 desks 最后一座是自己）
    mk('desk', 21, 8),
    mk('cabinet', 23, 9),
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
