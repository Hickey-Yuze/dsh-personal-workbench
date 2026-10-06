/**
 * 办公室引擎 —— 行为驱动场景（NPC 是行为循环状态机，不是贴图动画）：
 * 每个人物 工作/咖啡/拜访/闲逛 四态轮转，逻辑走整数格，渲染层拿浮点坐标插值。
 * P1 只内置自主行为循环；P2 在此追加公开互动方法（点击走位/拜访/会议）。
 */
import { deskChairCell, buildBlocked, defaultMap, findPath, isFree, MAP_H, MAP_W } from './map.js';
import type { Character, Furniture, Intent, MemberStat, OfficeMap, Vec } from './types.js';

const SPEED = 2.4; // 格 / 秒

interface NpcDef {
  name: string;
  role: string;
  color: string;
  hair: string;
}

const NPC_DEFS: NpcDef[] = [
  { name: '小周', role: '前端工程师', color: '#4C8EF7', hair: '#2f2f2f' },
  { name: '阿琳', role: '产品经理', color: '#F2994A', hair: '#5b3a29' },
  { name: '老王', role: '架构师', color: '#9B51E0', hair: '#707070' },
  { name: '大鹏', role: '测试工程师', color: '#27AE60', hair: '#141414' },
  { name: '小陈', role: '设计师', color: '#EB5757', hair: '#3b2c20' },
  { name: '阿福', role: '运营', color: '#2D9CDB', hair: '#1f1f1f' },
];

const rand = (min: number, max: number): number => min + Math.random() * (max - min);

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)] as T;
}

export class OfficeEngine {
  map: OfficeMap;
  blocked: Uint8Array;
  chars: Character[] = [];
  time = 0;
  private desks: Furniture[] = [];
  private coffee: Furniture | null = null;

  constructor() {
    this.map = defaultMap();
    this.blocked = buildBlocked(this.map);
    this.desks = this.map.furniture.filter((f) => f.kind === 'desk');
    this.coffee = this.map.furniture.find((f) => f.kind === 'coffee') ?? null;
    this.spawn();
  }

  private spawn(): void {
    const mkChar = (id: string, def: NpcDef, isSelf: boolean, desk: Furniture): Character => {
      const chair = deskChairCell(desk);
      return {
        id,
        name: def.name,
        role: def.role,
        color: def.color,
        hair: def.hair,
        isSelf,
        cx: chair.x,
        cy: chair.y,
        rx: chair.x + 0.5,
        ry: chair.y + 0.5,
        face: 1,
        path: [],
        state: 'working',
        stateUntil: rand(6, 18),
        intent: null,
        deskId: desk.id,
        phase: Math.random() * Math.PI * 2,
      };
    };
    // 自己：中央工位（P2 起改为可点击操控）
    const selfDesk = this.desks[this.desks.length - 1] as Furniture;
    this.chars.push(
      mkChar('self', { name: 'Yuze', role: '老板', color: '#00B8D9', hair: '#26221e' }, true, selfDesk),
    );
    NPC_DEFS.forEach((def, i) => {
      this.chars.push(mkChar(`npc-${i + 1}`, def, false, this.desks[i] as Furniture));
    });
  }

  /** 每帧推进（dt 秒，建议 ≤0.05）。 */
  tick(dt: number): void {
    this.time += dt;
    for (const c of this.chars) this.tickChar(c, dt);
  }

  /** 成员状态快照（状态栏 / P5 数据面板）。 */
  members(): MemberStat[] {
    return this.chars.map((c) => ({ id: c.id, name: c.name, role: c.role, state: c.state, isSelf: c.isSelf }));
  }

  /* ───────────── 行为循环 ───────────── */

  private tickChar(c: Character, dt: number): void {
    if (c.state === 'walking') {
      this.advance(c, dt);
      return;
    }
    if (this.time < c.stateUntil) return;
    this.decide(c);
  }

  private decide(c: Character): void {
    const r = Math.random();
    if (r < 0.5 && this.goWork(c)) return;
    if (r < 0.68 && this.goCoffee(c)) return;
    if (r < 0.85 && this.goVisit(c)) return;
    this.goWander(c); // 兜底：闲逛总能走
  }

  private occupied(c: Character, x: number, y: number): boolean {
    return this.chars.some((o) => o !== c && o.cx === x && o.cy === y && o.state !== 'walking');
  }

  private goWork(c: Character): boolean {
    const desk = this.desks.find((f) => f.id === c.deskId);
    if (desk === undefined) return false;
    const chair = deskChairCell(desk);
    if (this.occupied(c, chair.x, chair.y)) return false;
    if (c.cx === chair.x && c.cy === chair.y) {
      c.state = 'working';
      c.stateUntil = this.time + rand(14, 34);
      return true;
    }
    const path = findPath(this.map, this.blocked, { x: c.cx, y: c.cy }, chair);
    if (path.length === 0) return false;
    this.startWalk(c, path, 'work');
    return true;
  }

  private goCoffee(c: Character): boolean {
    const cf = this.coffee;
    if (cf === null) return false;
    const use = { x: cf.x, y: cf.y + 1 }; // 咖啡机使用格 = 正下方
    if (this.occupied(c, use.x, use.y)) return false;
    if (c.cx === use.x && c.cy === use.y) {
      c.state = 'coffee';
      c.stateUntil = this.time + rand(5, 11);
      return true;
    }
    const path = findPath(this.map, this.blocked, { x: c.cx, y: c.cy }, use);
    if (path.length === 0) return false;
    this.startWalk(c, path, 'coffee');
    return true;
  }

  private goVisit(c: Character): boolean {
    const others = this.chars.filter((o) => o !== c && o.deskId !== null && o.deskId !== c.deskId);
    if (others.length === 0) return false;
    const target = pick(others);
    const desk = this.desks.find((f) => f.id === target.deskId);
    if (desk === undefined) return false;
    // 站到对方工位旁（椅位右邻 / 桌前一排）
    const spots: Vec[] = [
      { x: desk.x + 1, y: desk.y + 1 },
      { x: desk.x, y: desk.y + 2 },
      { x: desk.x + 1, y: desk.y + 2 },
    ].filter((p) => isFree(this.map, this.blocked, p.x, p.y) && !this.occupied(c, p.x, p.y));
    if (spots.length === 0) return false;
    const spot = spots[0] as Vec;
    if (c.cx === spot.x && c.cy === spot.y) {
      c.state = 'visit';
      c.stateUntil = this.time + rand(3, 8);
      return true;
    }
    const path = findPath(this.map, this.blocked, { x: c.cx, y: c.cy }, spot);
    if (path.length === 0) return false;
    this.startWalk(c, path, 'visit');
    return true;
  }

  private goWander(c: Character): void {
    for (let tries = 0; tries < 12; tries++) {
      const x = 1 + Math.floor(Math.random() * (MAP_W - 2));
      const y = 1 + Math.floor(Math.random() * (MAP_H - 2));
      if (!isFree(this.map, this.blocked, x, y)) continue;
      if (x === c.cx && y === c.cy) continue;
      const path = findPath(this.map, this.blocked, { x: c.cx, y: c.cy }, { x, y });
      if (path.length === 0) continue;
      this.startWalk(c, path, 'wander');
      return;
    }
    c.state = 'idle';
    c.stateUntil = this.time + rand(2, 5);
  }

  private startWalk(c: Character, path: Vec[], intent: Intent): void {
    c.path = path;
    c.intent = intent;
    c.state = 'walking';
    c.stateUntil = this.time + 60; // 保险丝：走路最长 60s 必到
  }

  private advance(c: Character, dt: number): void {
    const t = c.path[0];
    if (t === undefined) {
      this.arrive(c);
      return;
    }
    const tx = t.x + 0.5;
    const ty = t.y + 0.5;
    const dx = tx - c.rx;
    const dy = ty - c.ry;
    const dist = Math.hypot(dx, dy);
    const step = SPEED * dt;
    if (Math.abs(dx) > 0.08) c.face = dx > 0 ? 1 : -1;
    if (dist <= step) {
      c.rx = tx;
      c.ry = ty;
      c.cx = t.x;
      c.cy = t.y;
      c.path.shift();
      if (c.path.length === 0) this.arrive(c);
    } else {
      c.rx += (dx / dist) * step;
      c.ry += (dy / dist) * step;
    }
  }

  private arrive(c: Character): void {
    c.path = [];
    switch (c.intent) {
      case 'work':
        c.state = 'working';
        c.stateUntil = this.time + rand(14, 34);
        break;
      case 'coffee':
        c.state = 'coffee';
        c.stateUntil = this.time + rand(5, 11);
        break;
      case 'visit':
        c.state = 'visit';
        c.stateUntil = this.time + rand(3, 8);
        break;
      default:
        c.state = 'idle';
        c.stateUntil = this.time + rand(1.5, 4);
    }
    c.intent = null;
  }
}
