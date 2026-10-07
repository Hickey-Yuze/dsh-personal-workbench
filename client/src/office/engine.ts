/**
 * 办公室引擎 —— 行为驱动场景（NPC 是行为循环状态机，不是贴图动画）：
 * 每个人物 工作/咖啡/拜访/闲逛 四态轮转，逻辑走整数格，渲染层拿浮点坐标插值。
 * P2 互动层：构造函数可注入存档地图；点击走位 / 点击 NPC 寒暄 / 白板会议 / 气泡系统。
 */
import { deskChairCell, buildBlocked, defaultMap, isFree, MAP_H, MAP_W } from './map.js';
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

/** 六名内置 NPC 的稳定身份（id 与 spawn 一致：npc-1..npc-6），供员工面板枚举编辑。 */
export const BUILTIN_STAFF: Array<{ id: string; name: string; role: string }> = NPC_DEFS.map((d, i) => ({
  id: `npc-${i + 1}`,
  name: d.name,
  role: d.role,
}));

const rand = (min: number, max: number): number => min + Math.random() * (max - min);

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)] as T;
}

/** 按职业的自言自语台词（切状态时 ~8% 概率冒 3-6 秒，key = NPC_DEFS.role）。 */
const MUMBLE_LINES: Record<string, string[]> = {
  前端工程师: ['在改 bug', '样式怎么又飘了', '这个兼容性真烦'],
  产品经理: ['需求又变了', '再对一版需求', '先写个 PRD'],
  架构师: ['这个要重构', '得抽个公共层', '耦合还是太重'],
  测试工程师: ['又复现不了', '先提个 bug 单', '回归再跑一遍'],
  设计师: ['配色再看看', '间距再调一调', '出两版对比下'],
  运营: ['数据拉一下', '日报还没整', '复盘一下转化'],
};

/** 点击 NPC 时自己冒泡的打招呼台词。 */
const GREETING_LINES = ['你好呀', '忙不忙？', '进展咋样？'];

/** NPC 按职业冒泡的回复台词（key = NPC_DEFS.role）。 */
const REPLY_LINES: Record<string, string[]> = {
  前端工程师: ['在改 bug', '这个 bug 挺诡异'],
  产品经理: ['需求又变了', '对齐下排期？'],
  架构师: ['这个要重构', '模块边界得理一下'],
  测试工程师: ['又复现不了', '环境我再看看'],
  设计师: ['配色再看看', '这版视觉再打磨'],
  运营: ['数据拉一下', '活动数据还行'],
};

/** 自定义员工（花名册新增）配色池，按 id 哈希取色，避开 NPC_DEFS 已用色。 */
const CUSTOM_COLORS = ['#E91E63','#7C4DFF','#00897B','#F4511E','#5C6BC0','#C0CA33','#8D6E63','#00ACC1'];
const CUSTOM_HAIRS = ['#26221e','#3e2723','#4e342e','#212121'];

export class OfficeEngine {
  map: OfficeMap;
  blocked: Uint8Array;
  chars: Character[] = [];
  time = 0;
  /** 会议进行中（renderer 据此高亮白板）。 */
  meetingActive = false;
  /** 头顶气泡：charId → 文本 + 到期引擎时间（秒），tick 清到期。 */
  bubbles = new Map<string, { text: string; until: number }>();
  private desks: Furniture[] = [];
  private coffee: Furniture | null = null;
  private meetingUntil = 0;
  /** 会议散点分配表（charId → 目标格），散会清空。 */
  private meetingSpots = new Map<string, Vec>();
  private chatTargetId: string | null = null;

  /** map 缺省 defaultMap()；外部可传存档地图替换（spawn 约定不变：desks 最后一座是自己）。 */
  constructor(map?: OfficeMap) {
    this.map = map ?? defaultMap();
    this.blocked = buildBlocked(this.map);
    this.desks = this.map.furniture.filter((f) => f.kind === 'desk');
    this.coffee = this.map.furniture.find((f) => f.kind === 'coffee') ?? null;
    this.spawn();
  }

  /** 延伸走位区：地图四边外圈动态扩的虚拟可走格数（画布可视范围驱动，OfficeCanvas 每帧对齐）。
   *  地板渲染是无限铺的，角色可以走进上下左右延伸带；存档地图仍是 40×12 不受影响。 */
  private arenaTop = 0;
  private arenaBottom = 0;
  private arenaLeft = 0;
  private arenaRight = 0;

  /** 对齐延伸走位区（OfficeCanvas 传可视范围换算的格数，各边收 0..24）；无变化时幂等返回。 */
  setArena(top: number, bottom: number, left: number, right: number): void {
    const t = Math.min(Math.max(Math.round(top), 0), 24);
    const b = Math.min(Math.max(Math.round(bottom), 0), 24);
    const l = Math.min(Math.max(Math.round(left), 0), 24);
    const r = Math.min(Math.max(Math.round(right), 0), 24);
    if (t === this.arenaTop && b === this.arenaBottom && l === this.arenaLeft && r === this.arenaRight) return;
    this.arenaTop = t;
    this.arenaBottom = b;
    this.arenaLeft = l;
    this.arenaRight = r;
    // 区缩小把站在外面的角色钳回区内
    for (const c of this.chars) {
      c.cx = Math.min(Math.max(c.cx, -l), MAP_W - 1 + r);
      c.cy = Math.min(Math.max(c.cy, -t), MAP_H - 1 + b);
    }
  }

  /** 延伸区感知的可走判定：地图内走 blocked，但延伸开启的那一侧边框是「门口」；地图外看 arena 圈。 */
  private free(x: number, y: number): boolean {
    if (x >= 0 && y >= 0 && x < MAP_W && y < MAP_H) {
      if (this.blocked[y * MAP_W + x] === 0) return true;
      if (y === 0 && this.arenaTop > 0) return true;
      if (y === MAP_H - 1 && this.arenaBottom > 0) return true;
      if (x === 0 && this.arenaLeft > 0) return true;
      if (x === MAP_W - 1 && this.arenaRight > 0) return true;
      return false;
    }
    return (
      x >= -this.arenaLeft && x < MAP_W + this.arenaRight &&
      y >= -this.arenaTop && y < MAP_H + this.arenaBottom
    );
  }

  /** 延伸区感知 BFS（坐标可为负；地图内外统一 4 邻接）。 */
  private path(from: Vec, to: Vec): Vec[] {
    if (from.x === to.x && from.y === to.y) return [];
    if (!this.free(from.x, from.y) || !this.free(to.x, to.y)) return [];
    const w = MAP_W + this.arenaLeft + this.arenaRight;
    const h = MAP_H + this.arenaTop + this.arenaBottom;
    const start = (from.y + this.arenaTop) * w + (from.x + this.arenaLeft);
    const target = (to.y + this.arenaTop) * w + (to.x + this.arenaLeft);
    const prev = new Int32Array(w * h).fill(-1);
    const seen = new Uint8Array(w * h);
    seen[start] = 1;
    const queue: number[] = [start];
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
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        if (!this.free(nx - this.arenaLeft, ny - this.arenaTop)) continue;
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
      path.push({ x: x - this.arenaLeft, y: (cur - x) / w - this.arenaTop });
      cur = prev[cur] as number;
    }
    path.reverse();
    return path;
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
    // 自己：中央工位（P2 起可点击操控）
    const selfDesk = this.desks[this.desks.length - 1] as Furniture;
    this.chars.push(
      mkChar('self', { name: 'Yuze', role: '老板', color: '#00B8D9', hair: '#26221e' }, true, selfDesk),
    );
    NPC_DEFS.forEach((def, i) => {
      const desk = this.desks[i];
      if (desk === undefined) return; // 存档地图工位不足时跳过多余 NPC
      this.chars.push(mkChar(`npc-${i + 1}`, def, false, desk));
    });
  }

  /**
   * 花名册新增的自定义员工进场景：优先分配工位（没被占的桌 → 没有空桌则确定性摆新桌），
   * 出生在工位椅格；id 已存在则忽略（重复调用幂等）。
   */
  addRosterChar(id: string, name: string, role: string, preferredDeskId?: string): void {
    if (this.chars.some((c) => c.id === id)) return;
    // 工位分配：老板指定的桌优先（且没被别人占）→ 复用没被占用的桌；没有空桌就在空地确定性摆一张新桌
    // （扫描顺序固定 → 同一张花名册刷新后工位位置一致，不改动用户保存的地图）。
    const usedDeskIds = new Set(this.chars.map((c) => c.deskId).filter((d): d is string => d !== null));
    let desk =
      preferredDeskId !== undefined && preferredDeskId !== ''
        ? this.map.furniture.find((f) => f.kind === 'desk' && f.id === preferredDeskId && !usedDeskIds.has(f.id))
        : undefined;
    if (desk === undefined) desk = this.map.furniture.find((f) => f.kind === 'desk' && !usedDeskIds.has(f.id));
    if (desk === undefined) desk = this.addAutoDesk(`desk-roster-${id}`);
    let spotX = -1;
    let spotY = -1;
    if (desk !== undefined) {
      const chair = deskChairCell(desk);
      if (!this.chars.some((c) => c.cx === chair.x && c.cy === chair.y)) {
        spotX = chair.x;
        spotY = chair.y;
      }
    }
    if (spotX < 0) {
      for (let i = 0; i < 200; i++) {
        const x = 1 + Math.floor(Math.random() * (MAP_W - 2));
        const y = 1 + Math.floor(Math.random() * (MAP_H - 2));
        if (!this.free(x, y)) continue;
        if (this.chars.some((c) => c.cx === x && c.cy === y)) continue;
        spotX = x;
        spotY = y;
        break;
      }
    }
    if (spotX < 0) return;
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
    const color = CUSTOM_COLORS[Math.abs(h) % CUSTOM_COLORS.length] ?? '#E91E63';
    const hair = CUSTOM_HAIRS[Math.abs(h >> 3) % CUSTOM_HAIRS.length] ?? '#26221e';
    this.chars.push({
      id,
      name,
      role,
      color,
      hair,
      isSelf: false,
      cx: spotX,
      cy: spotY,
      rx: spotX + 0.5,
      ry: spotY + 0.5,
      face: 1,
      path: [],
      state: 'idle',
      stateUntil: this.time + rand(2, 8),
      intent: null,
      deskId: desk?.id ?? null,
      phase: Math.random() * Math.PI * 2,
    });
  }

  /** 编辑卡工位下拉用：当前全部桌子（含自动摆的）。 */
  listDesks(): Furniture[] {
    return this.desks.slice();
  }

  /** 指定员工工位：deskId 空串 = 恢复自动分配（清 deskId）；非空 = 换到该桌，idle/working 的角色立即走过去。 */
  assignDesk(charId: string, deskId: string): boolean {
    const c = this.chars.find((x) => x.id === charId);
    if (c === undefined) return false;
    if (deskId === '') {
      c.deskId = null;
      return true;
    }
    const desk = this.map.furniture.find((f) => f.kind === 'desk' && f.id === deskId);
    if (desk === undefined) return false;
    c.deskId = desk.id;
    if (c.state === 'idle' || c.state === 'working') {
      const chair = deskChairCell(desk);
      if (c.cx !== chair.x || c.cy !== chair.y) {
        const path = this.path({ x: c.cx, y: c.cy }, chair);
        if (path.length > 0) this.startWalk(c, path, 'work');
      }
    }
    return true;
  }

  /**
   * 给新员工确定性摆一张新桌（2×2）：从左上往右下扫第一处
   * 「顶行两格可挡 + 底行两格可走」的空位，写进内存地图并补挡位。
   * 不落盘——用户保存的地图不被改动，刷新后由花名册重新推导出相同位置。
   */
  private addAutoDesk(deskId: string): Furniture | undefined {
    for (let y = 2; y <= MAP_H - 4; y++) {
      for (let x = 1; x <= MAP_W - 4; x++) {
        if (!this.free(x, y)) continue;
        if (!this.free(x + 1, y)) continue;
        if (!this.free(x, y + 1)) continue;
        if (!this.free(x + 1, y + 1)) continue;
        const desk: Furniture = { id: deskId, kind: 'desk', x, y, w: 2, h: 2 };
        this.map.furniture.push(desk);
        this.blocked[y * this.map.w + x] = 1;
        this.blocked[y * this.map.w + x + 1] = 1;
        // 同步登记进 desks 索引（tick 回工位按 id 查）；头部插入，保持「末位 = 自己工位」不变式
        this.desks.unshift(desk);
        return desk;
      }
    }
    return undefined;
  }

  /** 改名/改职务（找不到 id 静默忽略；名字与职务 trim 后非空才生效）。 */
  renameChar(id: string, name?: string, role?: string): void {
    const c = this.chars.find((ch) => ch.id === id);
    if (c === undefined) return;
    if (name !== undefined && name.trim() !== '') c.name = name.trim();
    if (role !== undefined && role.trim() !== '') c.role = role.trim();
  }

  /* ───────────── P2 互动 API ───────────── */

  /** 设置角色头顶气泡（durMs 毫秒后自动清除）。 */
  setBubble(charId: string, text: string, durMs: number): void {
    this.bubbles.set(charId, { text, until: this.time + Math.max(0.3, durMs / 1000) });
  }

  /**
   * 点击格子互动：
   * · NPC 所在格 / 其椅位 → 自己走到该工位旁，双方冒泡寒暄（按职业台词）
   * · 白板前缘格 → 发起会议：自己先去，NPC 陆续到白板前集合，全员 state='meeting' 8~15s 后散会
   * · 其他可走空地 → 自己 walkTo 过去，到达后回归正常 decide 循环
   */
  clickCell(x: number, y: number): void {
    if (x < -this.arenaLeft || y < -this.arenaTop || x >= MAP_W + this.arenaRight || y >= MAP_H + this.arenaBottom) return; // 延伸区外的界外；墙环/家具格由 free 判定
    const npc = this.npcAt(x, y);
    if (npc !== null) {
      this.goChatWith(npc);
      return;
    }
    const board = this.whiteboardFrontAt(x, y);
    if (board !== null) {
      this.startMeeting(board);
      return;
    }
    this.walkSelfTo(x, y);
  }

  private self(): Character | null {
    return this.chars.find((c) => c.isSelf) ?? null;
  }

  /** 命中 NPC：所在格或其工位椅位。 */
  private npcAt(x: number, y: number): Character | null {
    for (const c of this.chars) {
      if (c.isSelf) continue;
      if (c.cx === x && c.cy === y) return c;
      const desk = this.desks.find((f) => f.id === c.deskId);
      if (desk === undefined) continue;
      const chair = deskChairCell(desk);
      if (chair.x === x && chair.y === y) return c;
    }
    return null;
  }

  /** 命中白板前缘格（板正下方一排）。 */
  private whiteboardFrontAt(x: number, y: number): Furniture | null {
    for (const f of this.map.furniture) {
      if (f.kind !== 'whiteboard') continue;
      if (y === f.y + f.h && x >= f.x && x < f.x + f.w) return f;
    }
    return null;
  }

  /** 自己走到 (x,y)：闲逛意图，到达后自动回归 decide 循环。 */
  private walkSelfTo(x: number, y: number): void {
    const self = this.self();
    if (self === null) return;
    if (!this.free(x, y)) return; // 家具格 / 不可走点不动
    if (self.cx === x && self.cy === y) {
      self.intent = 'wander';
      this.arrive(self);
      return;
    }
    const path = this.path({ x: self.cx, y: self.cy }, { x, y });
    if (path.length === 0) return;
    this.startWalk(self, path, 'wander');
  }

  /** 走到 NPC 工位旁寒暄：到达后自己冒泡打招呼，NPC 按职业回一句。 */
  private goChatWith(npc: Character): void {
    const self = this.self();
    if (self === null) return;
    const desk = this.desks.find((f) => f.id === npc.deskId);
    if (desk === undefined) return;
    // 工位旁空位：椅位两侧 / 桌前一排
    const spots: Vec[] = [
      { x: desk.x + 1, y: desk.y + 1 },
      { x: desk.x - 1, y: desk.y + 1 },
      { x: desk.x, y: desk.y + 2 },
      { x: desk.x + 1, y: desk.y + 2 },
    ].filter((p) => this.free(p.x, p.y) && !this.occupied(self, p.x, p.y));
    const spot = spots[0];
    if (spot === undefined) return;
    this.chatTargetId = npc.id;
    if (self.cx === spot.x && self.cy === spot.y) {
      self.intent = 'chat';
      this.arrive(self);
      return;
    }
    const path = this.path({ x: self.cx, y: self.cy }, spot);
    if (path.length === 0) {
      this.chatTargetId = null;
      return;
    }
    this.startWalk(self, path, 'chat');
  }

  /** 发起白板会议：全员分配散点陆续出发，8~15 秒后散会（会议中重复点击忽略）。 */
  private startMeeting(board: Furniture): void {
    if (this.meetingActive) return;
    const self = this.self();
    if (self === null) return;
    // 散点：白板正前方两排，前缘 / 居中优先
    const frontY = board.y + board.h;
    const midX = board.x + (board.w - 1) / 2;
    const spots: Vec[] = [];
    for (let dy = 0; dy <= 1; dy++) {
      for (let dx = -1; dx <= board.w; dx++) {
        spots.push({ x: board.x + dx, y: frontY + dy });
      }
    }
    const pool = spots
      .filter((p) => this.free(p.x, p.y))
      .sort((a, b) => (a.y - frontY) * 10 + Math.abs(a.x - midX) - ((b.y - frontY) * 10 + Math.abs(b.x - midX)));
    if (pool.length === 0) return;
    this.meetingActive = true;
    this.meetingUntil = this.time + rand(8, 15);
    this.meetingSpots.clear();
    const selfSpot = pool.shift();
    if (selfSpot !== undefined) {
      this.meetingSpots.set(self.id, selfSpot);
      this.dispatchToMeeting(self); // 自己立即出发
    }
    for (const c of this.chars) {
      if (c.isSelf) continue;
      const spot = pool.shift();
      if (spot === undefined) break; // 散点不足：多余的 NPC 不参会
      this.meetingSpots.set(c.id, spot);
      c.meetingAt = this.time + rand(0.2, 1.8); // 陆续出发
    }
  }

  /** 按分配表走向会议散点；就位即进 meeting 态并冒泡「💬 会议中」。 */
  private dispatchToMeeting(c: Character): void {
    c.meetingAt = undefined;
    const spot = this.meetingSpots.get(c.id);
    if (spot === undefined) return;
    if (c.cx === spot.x && c.cy === spot.y) {
      c.intent = 'meeting';
      this.arrive(c);
      return;
    }
    const path = this.path({ x: c.cx, y: c.cy }, spot);
    if (path.length === 0) return; // 不可达：不参会，保持原行为
    this.startWalk(c, path, 'meeting');
  }

  /** 散会：会议相关角色清路径，立即回归 decide 循环。 */
  private endMeeting(): void {
    this.meetingActive = false;
    this.meetingSpots.clear();
    for (const c of this.chars) {
      c.meetingAt = undefined;
      if (c.intent === 'meeting') {
        c.path = [];
        this.decide(c);
      }
    }
  }

  /* ───────────── 行为循环 ───────────── */

  /** 每帧推进（dt 秒，建议 ≤0.05）。 */
  tick(dt: number): void {
    this.time += dt;
    if (this.meetingActive && this.time >= this.meetingUntil) this.endMeeting();
    for (const c of this.chars) this.tickChar(c, dt);
    for (const [id, b] of this.bubbles) {
      if (b.until <= this.time) this.bubbles.delete(id);
    }
  }

  /** 成员状态快照（状态栏 / P5 数据面板）。 */
  members(): MemberStat[] {
    return this.chars.map((c) => ({ id: c.id, name: c.name, role: c.role, state: c.state, isSelf: c.isSelf }));
  }

  private tickChar(c: Character, dt: number): void {
    if (c.meetingAt !== undefined && this.time >= c.meetingAt) this.dispatchToMeeting(c);
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
      this.mumble(c);
      return true;
    }
    const path = this.path({ x: c.cx, y: c.cy }, chair);
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
      this.mumble(c);
      return true;
    }
    const path = this.path({ x: c.cx, y: c.cy }, use);
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
    ].filter((p) => this.free(p.x, p.y) && !this.occupied(c, p.x, p.y));
    if (spots.length === 0) return false;
    const spot = spots[0] as Vec;
    if (c.cx === spot.x && c.cy === spot.y) {
      c.state = 'visit';
      c.stateUntil = this.time + rand(3, 8);
      this.mumble(c);
      return true;
    }
    const path = this.path({ x: c.cx, y: c.cy }, spot);
    if (path.length === 0) return false;
    this.startWalk(c, path, 'visit');
    return true;
  }

  private goWander(c: Character): void {
    for (let tries = 0; tries < 12; tries++) {
      const x = 1 + Math.floor(Math.random() * (MAP_W - 2));
      const y = 1 + Math.floor(Math.random() * (MAP_H - 2));
      if (!this.free(x, y)) continue;
      if (x === c.cx && y === c.cy) continue;
      const path = this.path({ x: c.cx, y: c.cy }, { x, y });
      if (path.length === 0) continue;
      this.startWalk(c, path, 'wander');
      return;
    }
    c.state = 'idle';
    c.stateUntil = this.time + rand(2, 5);
    this.mumble(c);
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
        this.mumble(c);
        break;
      case 'coffee':
        c.state = 'coffee';
        c.stateUntil = this.time + rand(5, 11);
        this.mumble(c);
        break;
      case 'visit':
        c.state = 'visit';
        c.stateUntil = this.time + rand(3, 8);
        this.mumble(c);
        break;
      case 'chat': {
        // 到达 NPC 工位旁：自己打招呼，NPC 按职业回一句，随后回归 decide
        c.state = 'visit';
        c.stateUntil = this.time + rand(3, 6);
        const npc = this.chars.find((o) => o.id === this.chatTargetId);
        if (npc !== undefined) {
          this.setBubble(c.id, pick(GREETING_LINES), 3200);
          this.setBubble(npc.id, pick(REPLY_LINES[npc.role] ?? ['嗯嗯']), 3200);
        }
        this.chatTargetId = null;
        break;
      }
      case 'meeting':
        // 就位：会议态持续到散会，冒泡覆盖全程
        c.state = 'meeting';
        c.stateUntil = this.meetingUntil;
        this.setBubble(c.id, '💬 会议中', Math.max(0.5, (this.meetingUntil - this.time) * 1000));
        break;
      default:
        c.state = 'idle';
        c.stateUntil = this.time + rand(1.5, 4);
    }
    c.intent = null;
  }

  /** 切状态时的低频自言自语（~8%，3-6 秒，按职业；自己不冒）。 */
  private mumble(c: Character): void {
    if (c.isSelf || Math.random() > 0.08) return;
    const lines = MUMBLE_LINES[c.role];
    if (lines === undefined || lines.length === 0) return;
    this.setBubble(c.id, pick(lines), rand(3, 6) * 1000);
  }
}
