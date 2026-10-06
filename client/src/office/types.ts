/**
 * 像素办公室核心类型 —— 移植 PixOffice 的整数格协议思想：
 * 逻辑全部走整数格（人物 1×1、桌椅 2×2、白板 2×1、盆栽/咖啡机 1×1），
 * 渲染层用浮点坐标做平滑插值，逻辑与表现分离（内核与外壳分离）。
 */

export interface Vec {
  x: number;
  y: number;
}

export type FurnitureKind = 'desk' | 'whiteboard' | 'plant' | 'coffee';

export interface Furniture {
  id: string;
  kind: FurnitureKind;
  /** 左上角格（整数格）。 */
  x: number;
  y: number;
  w: number;
  h: number;
}

export type CharState = 'idle' | 'walking' | 'working' | 'coffee' | 'visit';

export type Intent = 'work' | 'wander' | 'coffee' | 'visit';

export interface Character {
  id: string;
  name: string;
  role: string;
  /** 上衣颜色。 */
  color: string;
  hair: string;
  isSelf: boolean;
  /** 逻辑位置（当前所在整数格）。 */
  cx: number;
  cy: number;
  /** 渲染位置（浮点，格中心坐标系）。 */
  rx: number;
  ry: number;
  face: 1 | -1;
  path: Vec[];
  state: CharState;
  /** 该状态保持到的引擎时间（秒）。 */
  stateUntil: number;
  intent: Intent | null;
  /** 分配的工位桌 id（working 状态的落点）。 */
  deskId: string | null;
  /** 动画相位偏移，避免全员同步摆动。 */
  phase: number;
}

export interface OfficeMap {
  w: number;
  h: number;
  furniture: Furniture[];
}

/** 成员状态快照（状态栏 / 后续 P5 数据面板用）。 */
export interface MemberStat {
  id: string;
  name: string;
  role: string;
  state: CharState;
  isSelf: boolean;
}
