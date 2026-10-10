/**
 * canvas 2D 渲染器 —— 像素风自绘（零依赖、避开 PixOffice 版权素材）。
 * 质感对齐 pixoffice 参考稿：暖白低对比地板 + 确定性浅斑、扁平圆角家具 +
 * 克制的多层椭圆软阴影、显示器屏幕发光、会议光环 / 白板呼吸高亮、气泡渐隐。
 * 只读引擎的浮点坐标做插值绘制；逻辑仍在整数格（renderer 不参与决策）。
 * 性能：静态层（地板/斑块/外框阴影）按主画布尺寸离屏缓存，尺寸不变时每帧
 * 只 drawImage 一次；斑块由格子坐标哈希预计算，运行期无 Math.random。
 * P2：气泡绘制（最上层）、会议中白板高亮、头顶 💬 兜底、cellAtPoint 点击换算。
 */
import { MAP_H, MAP_W } from './map.js';
import type { Character, Furniture, Vec } from './types.js';

/* ───────────── 调色板（暖白低饱和，向 pixoffice 质感看齐） ───────────── */

const FLOOR_A = '#f3efe6';
const FLOOR_B = '#ece7da';
const DESK_TOP = '#d9bc90';
const DESK_TOP_LIT = '#f0dfbd';
const DESK_SIDE = '#c2a070';
const SCREEN_BEZEL = '#363c44';
const SCREEN_BG = '#a9d3ef';
const SCREEN_LIT = '#d9edfb';
const CHAIR_BACK = '#c9d2dc';
const CHAIR_SEAT = '#93a7ba';
const POT_BODY = '#cf7a52';
const POT_RIM = '#e09468';
const LEAF_BACK = '#3e7a44';
const LEAF_MID = '#549a54';
const LEAF_FRONT = '#6fb86a';
const LEAF_LIT = '#8fce86';

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(x, y, w, h, r);
  } else {
    ctx.rect(x, y, w, h);
  }
}

/** 确定格子坐标 → [0,1) 稳定伪随机（Math.imul 32 位雪崩，运行期零随机调用）。 */
function cellHash(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** 斑点类型（按格子坐标稳定哈希）：0 无 / 1 浅色亮斑 / 2 暖色暗斑 / 3 细走线。地图内外同一规则，地板可无限延伸。 */
function patchTypeAt(x: number, y: number): number {
  const h = cellHash(x, y);
  if (h < 0.05) return 1;
  if (h < 0.1) return 2;
  if (h < 0.14) return 3;
  return 0;
}

/* ───────────── 点击换算 ───────────── */

/** 视口状态：zoom 缩放倍率（1=适配）、panX/panY 平移偏移（CSS 像素）。 */
export interface OfficeView {
  zoom?: number;
  panX?: number;
  panY?: number;
  /** 视角旋转：0-3（×90°，顺时针）。0 = 默认（两面墙在画面上方）。 */
  rot?: number;
}

/** 旋转视角：把格坐标绕地图中心旋转 r×90°（顺时针）。40×12 非正方形 → 用 min(W,H) 中心对称旋转。 */
function rotCell(gx: number, gy: number, r: number): { x: number; y: number } {
  const rot = ((r % 4) + 4) % 4;
  if (rot === 0) return { x: gx, y: gy };
  // 绕中心旋转矩形网格：rot=1 → (x,y)→(H-1-y,x)；rot=2 → (W-1-x,H-1-y)；rot=3 → (y,W-1-x)
  if (rot === 1) return { x: MAP_H - 1 - gy, y: gx };
  if (rot === 2) return { x: MAP_W - 1 - gx, y: MAP_H - 1 - gy };
  return { x: gy, y: MAP_W - 1 - gx };
}

/** 当前视角下的有效网格尺寸（rot 奇数时 W/H 互换）。 */
function rotDims(r: number): { w: number; h: number } {
  const rot = ((r % 4) + 4) % 4;
  return rot % 2 === 1 ? { w: MAP_H, h: MAP_W } : { w: MAP_W, h: MAP_H };
}

/** 把视图状态解析成确定的 (zoom, panX, panY)。 */
function resolveView(view?: OfficeView): { zoom: number; panX: number; panY: number; rot: number } {
  const zoom = view?.zoom !== undefined && Number.isFinite(view.zoom) && view.zoom > 0 ? view.zoom : 1;
  const panX = view?.panX !== undefined && Number.isFinite(view.panX) ? view.panX : 0;
  const panY = view?.panY !== undefined && Number.isFinite(view.panY) ? view.panY : 0;
  const rot = view?.rot !== undefined && Number.isFinite(view.rot) ? ((Math.round(view.rot) % 4) + 4) % 4 : 0;
  return { zoom, panX, panY, rot };
}

/**
 * 平移钳制（等距投影）：地图包围盒 = (MAP_W+MAP_H)k 宽 × 一半高；
 * pan 围绕 0 对称 ±(box-css)/2——放大后边缘恰好贴到画布边缘；小于画布锁定 0。
 */
export function clampViewPan(panX: number, panY: number, zoom: number, cssW: number, cssH: number, rot = 0): { panX: number; panY: number } {
  const { w, h } = rotDims(rot);
  const k = Math.min(cssW / (w + h), (cssH * 2) / (w + h)) * zoom;
  const mapW = k * (w + h);
  const mapH = (k * (w + h)) / 2;
  const slackX = (mapW - cssW) / 2;
  const slackY = (mapH - cssH) / 2;
  const cx = mapW > cssW ? Math.min(Math.max(panX, -slackX), slackX) : 0;
  const cy = mapH > cssH ? Math.min(Math.max(panY, -slackY), slackY) : 0;
  return { panX: cx, panY: cy };
}

/**
 * 点击坐标（CSS 像素）→ 地图格：等距投影逆变换（与 renderOffice iso 数学同源）。
 * 延伸带地板真实可走（引擎 arena 判定），原样返回让引擎决定走不走。
 */
export function cellAtPoint(cssX: number, cssY: number, cssW: number, cssH: number, view?: OfficeView): Vec | null {
  const v = resolveView(view);
  const { w, h } = rotDims(v.rot);
  const k = Math.min(cssW / (w + h), (cssH * 2) / (w + h)) * v.zoom;
  if (!(k > 0)) return null;
  const ox = (cssW - (w + h) * k) / 2 + h * k + v.panX;
  const oy = (cssH - ((w + h) * k) / 2) / 2 + v.panY;
  const wx = cssX - ox;
  const wy = cssY - oy;
  const a = (wy * 2) / k; // 旋转系 gx'+gy'
  const b = wx / k; // gx'-gy'
  const rx = Math.floor((a + b) / 2);
  const ry = Math.floor((a - b) / 2);
  if (!Number.isFinite(rx) || !Number.isFinite(ry)) return null;
  // 旋转系 → 地图系（rotCell 的逆变换）
  const rot = v.rot;
  if (rot === 0) return { x: rx, y: ry };
  if (rot === 1) return { x: ry, y: MAP_H - 1 - rx };
  if (rot === 2) return { x: MAP_W - 1 - rx, y: MAP_H - 1 - ry };
  return { x: MAP_W - 1 - ry, y: rx };
}

/* ───────────── 静态层（地板 + 斑块 + 圆角外框阴影，离屏缓存） ───────────── */

const staticLayers = new WeakMap<HTMLCanvasElement, { key: string; layer: HTMLCanvasElement }>();

/** 双层椭圆软阴影（像素风下代替 radial gradient，避免每帧建渐变对象）。 */
function softShadow(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
): void {
  ctx.fillStyle = 'rgba(70,62,48,0.10)';
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(70,62,48,0.07)';
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx * 0.72, ry * 0.7, 0, 0, Math.PI * 2);
  ctx.fill();
}

function buildStaticLayer(pxW: number, pxH: number, dpr: number, cssW: number, cssH: number, view?: OfficeView): HTMLCanvasElement {
  const layer = document.createElement('canvas');
  layer.width = pxW;
  layer.height = pxH;
  const c = layer.getContext('2d');
  if (c === null) return layer;
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.imageSmoothingEnabled = false;

  const v = resolveView(view);
  const scale = Math.min(cssW / MAP_W, cssH / MAP_H) * v.zoom;
  const ox = (cssW - scale * MAP_W) / 2 + v.panX;
  const oy = (cssH - scale * MAP_H) / 2 + v.panY;

  // 柔和双色棋盘（对比弱化的暖白）：铺满整个画布——地图外的延伸区画成连续地板，
  // 舞台被拉高/拉宽时不再留白边，视觉上是办公室的开阔地面。
  const x0 = Math.floor(-ox / scale) - 1;
  const x1 = Math.ceil((cssW - ox) / scale) + 1;
  const y0 = Math.floor(-oy / scale) - 1;
  const y1 = Math.ceil((cssH - oy) / scale) + 1;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      c.fillStyle = (x + y) % 2 === 0 ? FLOOR_A : FLOOR_B;
      c.fillRect(ox + x * scale, oy + y * scale, scale + 0.5, scale + 0.5);
    }
  }
  // 确定性斑块点缀（查格子哈希，地图内外同一规则，永无随机闪动）
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const t = patchTypeAt(x, y);
      if (t === 0) continue;
      const px = ox + x * scale;
      const py = oy + y * scale;
      const h = cellHash(x * 3 + 1, y * 7 + 5);
      if (t === 1) {
        c.fillStyle = 'rgba(255,255,255,0.55)';
        c.fillRect(px + scale * (0.1 + h * 0.4), py + scale * (0.12 + h * 0.4), scale * 0.34, scale * 0.3);
      } else if (t === 2) {
        c.fillStyle = 'rgba(196,182,152,0.20)';
        c.fillRect(px + scale * (0.08 + h * 0.5), py + scale * (0.5 + h * 0.2), scale * 0.3, scale * 0.26);
      } else {
        c.fillStyle = 'rgba(196,182,152,0.14)';
        c.fillRect(px + scale * 0.12, py + scale * (0.3 + h * 0.3), scale * 0.72, Math.max(1.5, scale * 0.07));
      }
    }
  }

  // 圆角外框 + 轻阴影（围绕整个画布=房间边界；延伸地板一直铺到墙边）
  const fr = Math.max(6, scale * 0.5);
  c.fillStyle = 'rgba(70,62,48,0.08)';
  rr(c, 1.5, 3, cssW - 3, cssH - 3, fr);
  c.fill();
  const lw = Math.max(1.5, scale * 0.08);
  c.strokeStyle = 'rgba(122,112,92,0.30)';
  c.lineWidth = lw;
  rr(c, lw / 2, lw / 2, cssW - lw, cssH - lw, fr);
  c.stroke();
  // 框内 1px 高光，柔和过渡
  c.strokeStyle = 'rgba(255,255,255,0.5)';
  c.lineWidth = 1;
  rr(c, 1.5, 1.5, cssW - 3, cssH - 3, Math.max(4, fr - 1.5));
  c.stroke();
  return layer;
}

/* ───────────── 家具 ───────────── */

function drawDesk(ctx: CanvasRenderingContext2D, f: Furniture, s: number, ox: number, oy: number, time: number): void {
  const X = ox + f.x * s;
  const Y = oy + f.y * s;
  // 桌底软投影（整个 2×2 下缘）
  softShadow(ctx, X + s, Y + s * 1.95, s * 1.02, s * 0.18);
  // 椅位垫（下排，浅色过道）
  ctx.fillStyle = 'rgba(96,88,72,0.05)';
  ctx.fillRect(X + 1, Y + s + 1, s * 2 - 2, s - 2);
  // 椅子（下排左格）：底影 → 椅背 → 坐垫（人绘制时覆盖坐垫形成就坐层次）
  softShadow(ctx, X + s * 0.5, Y + s * 1.84, s * 0.3, s * 0.08);
  ctx.fillStyle = CHAIR_BACK;
  rr(ctx, X + s * 0.22, Y + s * 1.16, s * 0.56, s * 0.36, s * 0.07);
  ctx.fill();
  ctx.fillStyle = CHAIR_SEAT;
  rr(ctx, X + s * 0.16, Y + s * 1.48, s * 0.68, s * 0.32, s * 0.08);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.fillRect(X + s * 0.22, Y + s * 1.53, s * 0.56, Math.max(1.5, s * 0.06));
  // 桌面（上排两格）：主体 + 顶部高光边 + 底部厚度侧板
  ctx.fillStyle = DESK_TOP;
  ctx.fillRect(X + 1, Y + 1, s * 2 - 2, s - 2);
  ctx.fillStyle = DESK_TOP_LIT;
  ctx.fillRect(X + 1, Y + 1, s * 2 - 2, Math.max(2, s * 0.16));
  ctx.fillStyle = DESK_SIDE;
  ctx.fillRect(X + 1, Y + s - Math.max(2, s * 0.16) - 1, s * 2 - 2, Math.max(2, s * 0.16));
  // 显示器（上排左格，正对椅位）：泛光 → 外壳 → 发光屏 → 顶部高光 → 支架
  const mw = s * 0.6;
  const mh = s * 0.42;
  const mx = X + s * 0.2;
  const my = Y + s * 0.14;
  const glow = 0.24 + 0.1 * Math.sin(time * 1.8 + f.x * 1.7 + f.y);
  ctx.fillStyle = `rgba(150,200,240,${glow.toFixed(3)})`;
  rr(ctx, mx - s * 0.05, my - s * 0.05, mw + s * 0.1, mh + s * 0.1, s * 0.05);
  ctx.fill();
  ctx.fillStyle = SCREEN_BEZEL;
  rr(ctx, mx, my, mw, mh, s * 0.04);
  ctx.fill();
  ctx.fillStyle = SCREEN_BG;
  ctx.fillRect(mx + 2, my + 2, mw - 4, mh - 4);
  ctx.fillStyle = SCREEN_LIT;
  ctx.fillRect(mx + 2, my + 2, mw - 4, Math.max(2, (mh - 4) * 0.42));
  ctx.fillStyle = SCREEN_BEZEL;
  ctx.fillRect(mx + mw / 2 - s * 0.05, my + mh, s * 0.1, s * 0.16);
  ctx.fillStyle = '#454c55';
  ctx.fillRect(mx + mw / 2 - s * 0.14, my + mh + s * 0.14, s * 0.28, Math.max(1.5, s * 0.05));
  // 马克杯（上排右格）：珊瑚红 + 把手 + 杯口高光
  ctx.fillStyle = '#e8654f';
  ctx.fillRect(X + s * 1.55, Y + s * 0.55, s * 0.24, s * 0.2);
  ctx.fillRect(X + s * 1.79, Y + s * 0.6, Math.max(1.5, s * 0.05), s * 0.1);
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.fillRect(X + s * 1.58, Y + s * 0.57, Math.max(1, s * 0.05), Math.max(1, s * 0.04));
}

function drawWhiteboard(ctx: CanvasRenderingContext2D, f: Furniture, s: number, ox: number, oy: number): void {
  const X = ox + f.x * s;
  const Y = oy + f.y * s;
  softShadow(ctx, X + s, Y + s * 1.02, s * 0.95, s * 0.13);
  // 深灰边框
  ctx.fillStyle = '#5b6470';
  rr(ctx, X + 1, Y + 1, s * 2 - 2, s - 2, s * 0.08);
  ctx.fill();
  // 白板面（内缩）
  ctx.fillStyle = '#fdfdfc';
  ctx.fillRect(X + s * 0.12, Y + s * 0.14, s * 1.76, s * 0.62);
  // 板书
  ctx.fillStyle = '#4a90d9';
  ctx.fillRect(X + s * 0.28, Y + s * 0.26, s * 0.6, s * 0.07);
  ctx.fillRect(X + s * 0.28, Y + s * 0.42, s * 0.42, s * 0.07);
  ctx.fillStyle = '#e14d4d';
  ctx.fillRect(X + s * 1.1, Y + s * 0.26, s * 0.5, s * 0.07);
  ctx.fillRect(X + s * 1.1, Y + s * 0.42, s * 0.3, s * 0.07);
  // 笔托 + 三色笔
  ctx.fillStyle = '#8b93a1';
  ctx.fillRect(X + s * 0.2, Y + s * 0.8, s * 1.6, Math.max(2, s * 0.09));
  ctx.fillStyle = '#e14d4d';
  ctx.fillRect(X + s * 0.34, Y + s * 0.72, Math.max(1.5, s * 0.05), Math.max(2, s * 0.09));
  ctx.fillStyle = '#4a90d9';
  ctx.fillRect(X + s * 0.46, Y + s * 0.72, Math.max(1.5, s * 0.05), Math.max(2, s * 0.09));
  ctx.fillStyle = '#3a3f4a';
  ctx.fillRect(X + s * 0.58, Y + s * 0.72, Math.max(1.5, s * 0.05), Math.max(2, s * 0.09));
}

function drawPlant(ctx: CanvasRenderingContext2D, f: Furniture, s: number, ox: number, oy: number): void {
  const X = ox + f.x * s;
  const Y = oy + f.y * s;
  // 花盆底影
  softShadow(ctx, X + s * 0.5, Y + s * 0.93, s * 0.3, s * 0.08);
  // 三层叶色（后 → 中 → 前高光）
  ctx.fillStyle = LEAF_BACK;
  ctx.fillRect(X + s * 0.2, Y + s * 0.34, s * 0.28, s * 0.28);
  ctx.fillStyle = LEAF_MID;
  ctx.fillRect(X + s * 0.52, Y + s * 0.26, s * 0.3, s * 0.32);
  ctx.fillStyle = LEAF_FRONT;
  ctx.fillRect(X + s * 0.38, Y + s * 0.14, s * 0.26, s * 0.26);
  ctx.fillStyle = LEAF_LIT;
  ctx.fillRect(X + s * 0.44, Y + s * 0.19, s * 0.1, s * 0.1);
  ctx.fillRect(X + s * 0.58, Y + s * 0.32, s * 0.09, s * 0.09);
  // 花盆：盆身 + 盆沿高光
  ctx.fillStyle = POT_BODY;
  ctx.fillRect(X + s * 0.28, Y + s * 0.6, s * 0.44, s * 0.3);
  ctx.fillStyle = POT_RIM;
  ctx.fillRect(X + s * 0.26, Y + s * 0.58, s * 0.48, Math.max(2, s * 0.1));
  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  ctx.fillRect(X + s * 0.31, Y + s * 0.64, Math.max(1.5, s * 0.05), s * 0.2);
}

function drawCoffee(ctx: CanvasRenderingContext2D, f: Furniture, s: number, ox: number, oy: number, time: number): void {
  const X = ox + f.x * s;
  const Y = oy + f.y * s;
  softShadow(ctx, X + s * 0.5, Y + s * 0.9, s * 0.34, s * 0.09);
  // 机身（微圆角）+ 左侧高光条
  ctx.fillStyle = '#6b7280';
  rr(ctx, X + s * 0.18, Y + s * 0.15, s * 0.64, s * 0.7, s * 0.06);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.14)';
  ctx.fillRect(X + s * 0.23, Y + s * 0.2, Math.max(1.5, s * 0.06), s * 0.58);
  // 顶部豆仓 + 出咖啡口 + 接杯台
  ctx.fillStyle = '#4b5563';
  ctx.fillRect(X + s * 0.18, Y + s * 0.15, s * 0.64, s * 0.2);
  ctx.fillStyle = '#59626f';
  ctx.fillRect(X + s * 0.3, Y + s * 0.2, s * 0.4, s * 0.1);
  ctx.fillStyle = '#374151';
  ctx.fillRect(X + s * 0.3, Y + s * 0.55, s * 0.4, s * 0.18);
  // 指示灯：常亮灯芯 + 呼吸光晕（sin 调 alpha，柔和闪烁）
  const pulse = 0.3 + 0.25 * Math.sin(time * 2.4 + f.x);
  ctx.fillStyle = `rgba(255,107,107,${pulse.toFixed(3)})`;
  ctx.beginPath();
  ctx.arc(X + s * 0.72, Y + s * 0.26, s * 0.09, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ff6b6b';
  ctx.fillRect(X + s * 0.68, Y + s * 0.22, s * 0.08, s * 0.08);
}

/** 隔断墙：灰蓝墙体 + 顶部高光 + 交错砖缝（1×1，阻挡走位）。 */
function drawWall(ctx: CanvasRenderingContext2D, f: Furniture, s: number, ox: number, oy: number): void {
  const X = ox + f.x * s;
  const Y = oy + f.y * s;
  softShadow(ctx, X + s * 0.5, Y + s * 0.92, s * 0.36, s * 0.07);
  ctx.fillStyle = '#aeb6c2';
  rr(ctx, X + s * 0.08, Y + s * 0.12, s * 0.84, s * 0.74, s * 0.05);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.fillRect(X + s * 0.08, Y + s * 0.12, s * 0.84, Math.max(1.5, s * 0.08));
  ctx.strokeStyle = 'rgba(70,78,90,0.35)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(X + s * 0.08, Y + s * 0.37);
  ctx.lineTo(X + s * 0.92, Y + s * 0.37);
  ctx.moveTo(X + s * 0.08, Y + s * 0.62);
  ctx.lineTo(X + s * 0.92, Y + s * 0.62);
  ctx.moveTo(X + s * 0.5, Y + s * 0.12);
  ctx.lineTo(X + s * 0.5, Y + s * 0.37);
  ctx.moveTo(X + s * 0.3, Y + s * 0.37);
  ctx.lineTo(X + s * 0.3, Y + s * 0.62);
  ctx.moveTo(X + s * 0.7, Y + s * 0.37);
  ctx.lineTo(X + s * 0.7, Y + s * 0.62);
  ctx.moveTo(X + s * 0.5, Y + s * 0.62);
  ctx.lineTo(X + s * 0.5, Y + s * 0.86);
  ctx.stroke();
}

/** 微波炉：白机身 + 深色窗口 + 橙色控制钮（1×1）。 */
function drawMicrowave(ctx: CanvasRenderingContext2D, f: Furniture, s: number, ox: number, oy: number): void {
  const X = ox + f.x * s;
  const Y = oy + f.y * s;
  softShadow(ctx, X + s * 0.5, Y + s * 0.92, s * 0.36, s * 0.07);
  ctx.fillStyle = '#f4f5f7';
  rr(ctx, X + s * 0.08, Y + s * 0.2, s * 0.84, s * 0.62, s * 0.06);
  ctx.fill();
  ctx.fillStyle = 'rgba(70,78,90,0.28)';
  ctx.fillRect(X + s * 0.08, Y + s * 0.74, s * 0.84, Math.max(1, s * 0.06));
  ctx.fillStyle = '#3a4150';
  rr(ctx, X + s * 0.16, Y + s * 0.3, s * 0.42, s * 0.4, s * 0.04);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.fillRect(X + s * 0.2, Y + s * 0.34, s * 0.08, s * 0.32);
  ctx.fillStyle = '#d6dae2';
  ctx.fillRect(X + s * 0.64, Y + s * 0.3, s * 0.22, s * 0.4);
  ctx.fillStyle = '#ff8a5c';
  ctx.fillRect(X + s * 0.68, Y + s * 0.36, s * 0.14, s * 0.08);
  ctx.fillStyle = '#9aa1ad';
  ctx.fillRect(X + s * 0.68, Y + s * 0.52, s * 0.14, s * 0.05);
}

/** 冰箱：浅银双门 + 门缝 + 双把手（1×1）。 */
function drawFridge(ctx: CanvasRenderingContext2D, f: Furniture, s: number, ox: number, oy: number): void {
  const X = ox + f.x * s;
  const Y = oy + f.y * s;
  softShadow(ctx, X + s * 0.5, Y + s * 0.95, s * 0.34, s * 0.07);
  ctx.fillStyle = '#c9d0d9';
  rr(ctx, X + s * 0.16, Y + s * 0.06, s * 0.68, s * 0.86, s * 0.06);
  ctx.fill();
  ctx.fillStyle = 'rgba(70,78,90,0.4)';
  ctx.fillRect(X + s * 0.16, Y + s * 0.4, s * 0.68, Math.max(1, s * 0.03));
  ctx.fillStyle = 'rgba(255,255,255,0.3)';
  ctx.fillRect(X + s * 0.2, Y + s * 0.1, Math.max(1.5, s * 0.05), s * 0.78);
  ctx.fillStyle = '#7c8593';
  ctx.fillRect(X + s * 0.7, Y + s * 0.14, s * 0.06, s * 0.2);
  ctx.fillRect(X + s * 0.7, Y + s * 0.46, s * 0.06, s * 0.34);
}

/* ───────────── 气泡 ───────────── */

/** 气泡文本按 maxW 折行：最多两行，仍超出在第二行截断加省略号。 */
function wrapBubbleText(ctx: CanvasRenderingContext2D, text: string, maxW: number): [string, string] {
  if (ctx.measureText(text).width <= maxW) return [text, ''];
  let l1 = '';
  let l2 = '';
  let second = false;
  for (const ch of text) {
    if (!second) {
      if (l1.length > 0 && ctx.measureText(l1 + ch).width > maxW) {
        second = true;
      } else {
        l1 += ch;
        continue;
      }
    }
    if (l2.length > 0 && ctx.measureText(l2 + ch).width > maxW) {
      return [l1, `${l2}…`];
    }
    l2 += ch;
  }
  return [l1, l2];
}

/** 头顶气泡：白底圆角矩形 + 小尾巴 + 深色字；挂在头部侧边（不遮姓名牌），右侧放不下翻左侧；remaining<0.4s 线性渐隐（秒）。 */
function drawBubble(
  ctx: CanvasRenderingContext2D,
  c: Character,
  text: string,
  s: number,
  ox: number,
  oy: number,
  remaining: number,
  cw: number,
): void {
  const alpha = Math.max(0, Math.min(1, remaining / 0.4));
  if (alpha <= 0) return;
  const px = ox + c.rx * s;
  const py = oy + c.ry * s;
  const fs = Math.min(11, Math.max(9, s * 0.26));
  const maxW = Math.max(56, s * 5);
  ctx.font = `${fs}px -apple-system, "PingFang SC", sans-serif`;
  const [l1, l2] = wrapBubbleText(ctx, text, maxW);
  const w1 = ctx.measureText(l1).width;
  const w2 = l2 ? ctx.measureText(l2).width : 0;
  const lineH = fs * 1.3;
  const pad = fs * 0.45;
  const bw = Math.max(w1, w2) + pad * 2;
  const bh = pad * 2 + lineH * (l2 ? 2 : 1);
  // 侧挂：默认头左侧（尾巴指向头顶左侧），贴左缘翻右侧，两侧都放不下再回到头顶高位
  const gap = s * 0.62;
  const tx = px + s * 0.34;
  const ty = py - s * 0.5;
  let bx = px - gap - bw;
  let by = py - s * 0.9;
  let side: 'right' | 'left' | 'top' = 'left';
  if (bx < 4) {
    bx = px + gap;
    side = bx + bw <= cw - 4 ? 'right' : 'top';
    if (side === 'top') bx = px - bw / 2;
  }
  if (side === 'top') by = py - s * 1.55;
  ctx.save();
  ctx.globalAlpha = alpha;
  // 尾巴（指向头部；先画再压矩形保证衔接）
  ctx.fillStyle = '#ffffff';
  if (side === 'top') {
    ctx.beginPath();
    ctx.moveTo(px - fs * 0.3, by + bh - 1);
    ctx.lineTo(px + fs * 0.3, by + bh - 1);
    ctx.lineTo(px, by + bh + fs * 0.45);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.16)';
    ctx.stroke();
  } else {
    const ex = side === 'right' ? bx : bx + bw;
    const tipX = side === 'right' ? tx : px - s * 0.34;
    const ey1 = Math.min(Math.max(ty - fs * 0.3, by + 4), by + bh - 4 - fs * 0.6);
    ctx.beginPath();
    ctx.moveTo(ex, ey1);
    ctx.lineTo(ex, ey1 + fs * 0.6);
    ctx.lineTo(tipX, ty);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.16)';
    ctx.stroke();
  }
  // 白底圆角矩形 + 底部 1px 阴影
  ctx.fillStyle = 'rgba(40,35,25,0.10)';
  rr(ctx, bx, by + 1.5, bw, bh, fs * 0.55);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  rr(ctx, bx, by, bw, bh, fs * 0.55);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.16)';
  ctx.stroke();
  // 深色文字（居中于气泡）
  const btx = bx + bw / 2;
  ctx.fillStyle = '#333';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(l1, btx, by + pad + lineH * 0.5);
  if (l2) ctx.fillText(l2, btx, by + pad + lineH * 1.5);
  ctx.restore();
}

/* ───────────── 人物 ───────────── */

function drawChar(
  ctx: CanvasRenderingContext2D,
  c: Character,
  s: number,
  ox: number,
  oy: number,
  time: number,
  showNames: boolean,
  hasBubble: boolean,
): void {
  const px = ox + c.rx * s;
  const py = oy + c.ry * s;
  const sitting = c.state === 'working' || c.state === 'coffee';
  const walking = c.state === 'walking';
  // 走路上下轻微 bob（sin(time*10 + 相位)）；phase 为生成期固定随机相位，等价 charId 哈希
  const bob = walking
    ? Math.abs(Math.sin(time * 10 + c.phase)) * s * 0.07
    : Math.sin(time * 2 + c.phase) * s * 0.015;
  const bobN = walking ? Math.abs(Math.sin(time * 10 + c.phase)) : 0;
  const bodyW = s * 0.52;
  const bodyH = s * 0.34;
  const headR = s * 0.19;
  const legH = sitting ? 0 : s * 0.16;
  const baseY = py + s * 0.28;

  // 自己：脚底高亮圈
  if (c.isSelf) {
    ctx.strokeStyle = 'rgba(0, 210, 106, 0.85)';
    ctx.lineWidth = Math.max(1.5, s * 0.06);
    ctx.beginPath();
    ctx.ellipse(px, baseY + 1, s * 0.32, s * 0.11, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 1;
  }
  // 脚下椭圆影子（bob 抬升时影子微缩，落地时略大）
  const shadowK = 1 - bobN * 0.15;
  ctx.fillStyle = 'rgba(0,0,0,0.12)';
  ctx.beginPath();
  ctx.ellipse(px, baseY + 1, s * 0.24 * shadowK, s * 0.08 * shadowK, 0, 0, Math.PI * 2);
  ctx.fill();

  // 腿（走路交替摆动，与 bob 同频）
  if (!sitting) {
    const swing = walking ? Math.sin(time * 10 + c.phase) * s * 0.1 : 0;
    ctx.fillStyle = '#3a3f4a';
    ctx.fillRect(px - bodyW * 0.38 + swing, baseY - legH, bodyW * 0.26, legH);
    ctx.fillRect(px + bodyW * 0.12 - swing, baseY - legH, bodyW * 0.26, legH);
  }

  // 身体
  const bodyTop = baseY - legH - bodyH + bob;
  ctx.fillStyle = c.color;
  rr(ctx, px - bodyW / 2, bodyTop, bodyW, bodyH, s * 0.09);
  ctx.fill();
  // 身体顶部高光边（体积感）
  ctx.fillStyle = 'rgba(255,255,255,0.28)';
  ctx.fillRect(px - bodyW / 2 + s * 0.04, bodyTop + 1, bodyW - s * 0.08, Math.max(1, s * 0.045));

  // 头
  const headCy = bodyTop - headR * 0.85 + bob;
  ctx.fillStyle = '#f5c99b';
  ctx.beginPath();
  ctx.arc(px, headCy, headR, 0, Math.PI * 2);
  ctx.fill();
  // 头发（头顶盖片）
  ctx.fillStyle = c.hair;
  ctx.fillRect(px - headR, headCy - headR, headR * 2, headR * 0.72);
  // 朝向细节：眼睛组向 face 侧偏移 + face 侧腮红（镜像感的最低成本实现）
  const eyeShift = c.face * headR * 0.18;
  ctx.fillStyle = '#2b2b2b';
  const eye = Math.max(1, s * 0.045);
  ctx.fillRect(px - headR * 0.32 + eyeShift, headCy + headR * 0.05, eye, eye * 1.4);
  ctx.fillRect(px + headR * 0.32 - eye + eyeShift, headCy + headR * 0.05, eye, eye * 1.4);
  ctx.fillStyle = 'rgba(232,140,120,0.4)';
  ctx.fillRect(px + c.face * headR * 0.62 - eye * 0.5, headCy + headR * 0.28, eye, eye * 0.8);

  // 会议中：头顶蓝色光环（呼吸浮动；白板群体高亮由主渲染增强）
  let haloTop = 0;
  if (c.state === 'meeting') {
    const haloY = headCy - headR - s * 0.14 + Math.sin(time * 2.5 + c.phase) * s * 0.03;
    ctx.strokeStyle = 'rgba(77,144,254,0.25)';
    ctx.lineWidth = Math.max(2.5, s * 0.1);
    ctx.beginPath();
    ctx.ellipse(px, haloY, s * 0.3, s * 0.1, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(77,144,254,0.85)';
    ctx.lineWidth = Math.max(1.2, s * 0.045);
    ctx.beginPath();
    ctx.ellipse(px, haloY, s * 0.3, s * 0.1, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 1;
    haloTop = haloY - s * 0.1;
  }

  // 咖啡态：手侧小咖啡杯 + 蒸汽
  if (c.state === 'coffee') {
    const cupW = Math.max(3, s * 0.14);
    const cupX = px + c.face * bodyW * 0.62 - cupW / 2;
    const cupY = bodyTop + bodyH * 0.3;
    ctx.fillStyle = '#ffffff';
    rr(ctx, cupX, cupY, cupW, cupW * 0.85, cupW * 0.2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.18)';
    ctx.lineWidth = 1;
    ctx.stroke();
    const steam = Math.sin(time * 3 + c.phase);
    ctx.fillStyle = 'rgba(120,120,130,0.35)';
    ctx.fillRect(cupX + cupW * 0.3 + steam * 1.2, cupY - cupW * 0.55, Math.max(1, cupW * 0.14), cupW * 0.4);
  }

  // 会议中且无气泡：头顶 💬 兜底标记（有光环时上移避开）
  if (c.state === 'meeting' && !hasBubble) {
    const efs = Math.min(12, Math.max(9, s * 0.3));
    ctx.font = `${efs}px sans-serif`;
    ctx.textAlign = 'center';
    const lift = haloTop > 0 ? headCy - haloTop + efs * 0.6 : 0;
    ctx.fillText('💬', px, headCy - headR - efs * (showNames ? 2.4 : 0.4) - lift);
    ctx.textAlign = 'left';
  }

  // 名牌：白底圆角 + 细描边 + 1px 底部阴影
  if (showNames) {
    const label = `${c.name}${c.isSelf ? '（我）' : ''}`;
    const fs = Math.min(12, Math.max(9, s * 0.3));
    ctx.font = `${fs}px -apple-system, "PingFang SC", sans-serif`;
    const tw = ctx.measureText(label).width;
    const bx = px - tw / 2 - 4;
    const by = headCy - headR - fs - 7;
    ctx.fillStyle = 'rgba(40,35,25,0.10)';
    rr(ctx, bx, by + 1.5, tw + 8, fs + 5, 4);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.94)';
    rr(ctx, bx, by, tw + 8, fs + 5, 4);
    ctx.fill();
    ctx.strokeStyle = 'rgba(60,55,45,0.22)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = '#333';
    ctx.fillText(label, px - tw / 2, by + fs + 1);
  }
}

/* ───────────── 主渲染 ───────────── */

export function renderOffice(
  canvas: HTMLCanvasElement,
  furniture: Furniture[],
  chars: Character[],
  time: number,
  opts?: {
    showNames?: boolean;
    /** 引擎气泡表（未到期的会被绘制在最上层）。 */
    bubbles?: ReadonlyMap<string, { text: string; until: number }>;
    /** 会议进行中：白板高亮描边。 */
    meeting?: boolean;
    /** 视口：缩放/平移（缺省 1 倍适配居中）。 */
    view?: OfficeView;
    /** 俯视 2D 模式（布置办公室编辑器用）：跳过等距投影，保持平面网格语义。 */
    topDown?: boolean;
  },
): void {
  if (opts?.topDown === true) {
    renderTopDown(canvas, furniture, chars, time, opts);
    return;
  }
  renderIso(canvas, furniture, chars, time, opts);
}

/** 俯视 2D 渲染（编辑器专用路径；数学：scale = min(cssW/MAP_W, cssH/MAP_H) 居中）。 */
function renderTopDown(
  canvas: HTMLCanvasElement,
  furniture: Furniture[],
  chars: Character[],
  time: number,
  opts?: {
    showNames?: boolean;
    bubbles?: ReadonlyMap<string, { text: string; until: number }>;
    meeting?: boolean;
    view?: OfficeView;
  },
): void {
  const ctx = canvas.getContext('2d');
  if (ctx === null) return;
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || 320;
  const cssH = canvas.clientHeight || 200;
  const pxW = Math.max(1, Math.round(cssW * dpr));
  const pxH = Math.max(1, Math.round(cssH * dpr));
  if (canvas.width !== pxW || canvas.height !== pxH) {
    canvas.width = pxW;
    canvas.height = pxH;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.imageSmoothingEnabled = false;

  const v = resolveView(opts?.view);
  const scale = Math.min(cssW / MAP_W, cssH / MAP_H) * v.zoom;
  const ox = (cssW - scale * MAP_W) / 2 + v.panX;
  const oy = (cssH - scale * MAP_H) / 2 + v.panY;
  const showNames = opts?.showNames ?? scale >= 15;

  // 静态层：地板棋盘 + 斑块 + 圆角外框阴影，按主画布尺寸+视口缓存（双实例各持一份）
  const staticKey = `td:${pxW}x${pxH}@${dpr}@${v.zoom.toFixed(3)}@${Math.round(v.panX)}@${Math.round(v.panY)}`;
  let cached = staticLayers.get(canvas);
  if (cached === undefined || cached.key !== staticKey) {
    cached = { key: staticKey, layer: buildStaticLayer(pxW, pxH, dpr, cssW, cssH, opts?.view) };
    staticLayers.set(canvas, cached);
  }
  ctx.drawImage(cached.layer, 0, 0, cssW, cssH);

  // 家具
  for (const f of furniture) {
    switch (f.kind) {
      case 'desk':
        drawDesk(ctx, f, scale, ox, oy, time);
        break;
      case 'whiteboard':
        drawWhiteboard(ctx, f, scale, ox, oy);
        break;
      case 'plant':
        drawPlant(ctx, f, scale, ox, oy);
        break;
      case 'coffee':
        drawCoffee(ctx, f, scale, ox, oy, time);
        break;
      case 'wall':
        drawWall(ctx, f, scale, ox, oy);
        break;
      case 'microwave':
        drawMicrowave(ctx, f, scale, ox, oy);
        break;
      case 'fridge':
        drawFridge(ctx, f, scale, ox, oy);
        break;
    }
  }

  // 会议进行中：白板呼吸高亮（外圈光晕 + 主描边；家具之上、人物之下）
  if (opts?.meeting === true) {
    const breath = 0.75 + 0.2 * Math.sin(time * 3);
    ctx.save();
    ctx.strokeStyle = 'rgba(242, 153, 74, 0.95)';
    ctx.globalAlpha = breath;
    ctx.lineWidth = Math.max(2, scale * 0.12);
    for (const f of furniture) {
      if (f.kind !== 'whiteboard') continue;
      rr(ctx, ox + f.x * scale + 1, oy + f.y * scale + 1, f.w * scale - 2, f.h * scale - 2, scale * 0.14);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(242, 153, 74, 1)';
    ctx.globalAlpha = breath * 0.3;
    ctx.lineWidth = Math.max(5, scale * 0.24);
    for (const f of furniture) {
      if (f.kind !== 'whiteboard') continue;
      rr(ctx, ox + f.x * scale + 1, oy + f.y * scale + 1, f.w * scale - 2, f.h * scale - 2, scale * 0.14);
      ctx.stroke();
    }
    ctx.restore();
  }

  // 人物按 y 排序（画家算法）
  const sorted = [...chars].sort((a, b) => a.ry - b.ry);
  const bubbles = opts?.bubbles;
  const hasBubble = (c: Character): boolean => {
    const b = bubbles?.get(c.id);
    return b !== undefined && b.until > time;
  };
  for (const c of sorted) drawChar(ctx, c, scale, ox, oy, time, showNames, hasBubble(c));

  // 气泡最后绘制（最上层，避免遮挡角色）；剩余寿命 <0.4s 线性渐隐
  if (bubbles !== undefined && bubbles.size > 0) {
    for (const c of sorted) {
      if (!hasBubble(c)) continue;
      const b = bubbles.get(c.id);
      if (b === undefined) continue;
      drawBubble(ctx, c, b.text, scale, ox, oy, b.until - time, cssW);
    }
  }
}

/* ═════════ 等距 3D 渲染（软 3D 玩具风，对齐参考稿：白/灰房间 + 暖木托盘地板 + 纯白家具 + 玻璃隔断 + Q 版人物） ═════════ */

const ISO_BG = '#f6f7f8';
const ISO_OUT_FLOOR = '#efe6d7';
const ISO_FLOOR_A = '#dcbb8b';
const ISO_FLOOR_B = '#d2af7d';
const ISO_FLOOR_LINE = 'rgba(146,110,64,0.14)';
const ISO_TRAY = '#ffffff';
const ISO_TRAY_SIDE = '#e4e6e9';
const ISO_WALL_R = '#e3e6ea';
const ISO_WALL_L = '#f4f5f7';
const ISO_WALL_TOP = '#fbfcfd';
const ISO_WALL_SKIRT = '#dbdfe4';
const ISO_WHITE_TOP = '#ffffff';
const ISO_WHITE_LEFT = '#edf0f2';
const ISO_WHITE_RIGHT = '#d9dde2';
const ISO_METAL = '#474e56';
const ISO_SCREEN = '#2b3137';
const ISO_SHADOW = 'rgba(88,78,62,0.15)';
const ISO_LEAF_A = '#6cab5f';
const ISO_LEAF_B = '#54904a';
const ISO_LEAF_C = '#83c172';
const ISO_POT = '#f6f7f8';
const ISO_POT_SHADE = '#e0e3e6';
const ISO_SKIN = '#f8d6b3';
const ISO_PANTS = '#5c6570';
const ISO_SHOE = '#f1f2f3';

/** 每格半宽像素 k：格投影宽 2k、高 k（经典 2:1 等距）。 */
function isoFit(cssW: number, cssH: number, zoom: number, rot = 0): number {
  const { w, h } = rotDims(rot);
  return Math.min(cssW / (w + h), (cssH * 2) / (w + h)) * zoom;
}

function isoOrigin(cssW: number, cssH: number, k: number, panX: number, panY: number, rot = 0): { ox: number; oy: number } {
  const { w, h } = rotDims(rot);
  return {
    ox: (cssW - (w + h) * k) / 2 + h * k + panX,
    oy: (cssH - ((w + h) * k) / 2) / 2 + panY,
  };
}

/** 格角 (gx,gy) → 屏幕点。旋转视角经 currentRot（renderIso 入口设置，iso 绘制全程生效）。 */
let currentRot = 0;
function isoCorner(ox: number, oy: number, k: number, gx: number, gy: number): { x: number; y: number } {
  const p = rotCell(gx, gy, currentRot);
  return { x: ox + (p.x - p.y) * k, y: oy + ((p.x + p.y) * k) / 2 };
}

function isoPoly(ctx: CanvasRenderingContext2D, pts: Array<{ x: number; y: number }>): void {
  ctx.beginPath();
  pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.closePath();
}

/** 柔和落地影：两层压扁椭圆，接近参考稿的低对比软影。 */
function isoSoftShadow(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, alpha = 0.15): void {
  ctx.fillStyle = `rgba(88,78,62,${alpha.toFixed(3)})`;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, rx * 0.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = `rgba(88,78,62,${(alpha * 0.55).toFixed(3)})`;
  ctx.beginPath();
  ctx.ellipse(x, y, rx * 0.68, rx * 0.34, 0, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * 等距圆角顶面：把画布变换到「u 沿 gx、v 沿 gy」的等距平面画真正圆角的矩形。
 * 圆角在等距投影下自然椭圆化——玩具风软边的关键观感（对齐参考稿）。
 */
function isoTopRounded(
  ctx: CanvasRenderingContext2D,
  ox: number,
  oy: number,
  k: number,
  fx: number,
  fy: number,
  w: number,
  d: number,
  r: number,
  vy: number,
  fill: string,
): void {
  ctx.save();
  ctx.transform(k, k / 2, -k, k / 2, ox + (fx - fy) * k, oy + ((fx + fy) * k) / 2 - vy);
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') ctx.roundRect(0, 0, w, d, r);
  else ctx.rect(0, 0, w, d);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.restore();
}

/**
 * 等距长方体：底面 = 格矩形 (fx,fy,w,d)，高 hPx；画左前面 → 右前面 → 圆角顶面。
 * 返回顶面中心投影点（供在其上摆物件）。
 */
function isoBoxAt(
  ctx: CanvasRenderingContext2D,
  ox: number,
  oy: number,
  k: number,
  fx: number,
  fy: number,
  w: number,
  d: number,
  h: number,
  top: string,
  left: string,
  right: string,
): { x: number; y: number } {
  const c00 = isoCorner(ox, oy, k, fx, fy);
  const c10 = isoCorner(ox, oy, k, fx + w, fy);
  const c11 = isoCorner(ox, oy, k, fx + w, fy + d);
  const c01 = isoCorner(ox, oy, k, fx, fy + d);
  ctx.fillStyle = left;
  isoPoly(ctx, [c01, c11, { x: c11.x, y: c11.y - h }, { x: c01.x, y: c01.y - h }]);
  ctx.fill();
  ctx.fillStyle = right;
  isoPoly(ctx, [c11, c10, { x: c10.x, y: c10.y - h }, { x: c11.x, y: c11.y - h }]);
  ctx.fill();
  // 圆角顶面（软边；等距下圆角自动椭圆化）
  isoTopRounded(ctx, ox, oy, k, fx, fy, w, d, Math.min(w, d) * 0.2, h, top);
  return { x: (c00.x + c11.x) / 2, y: (c00.y + c11.y) / 2 - h };
}

/** 竖立平行四边形板（沿 gx 方向，底边在 gyBase，向上 hPx）。 */
function isoSlabAlongX(
  ctx: CanvasRenderingContext2D,
  ox: number,
  oy: number,
  k: number,
  fx: number,
  gyBase: number,
  len: number,
  h: number,
): void {
  const p1 = isoCorner(ox, oy, k, fx, gyBase);
  const p2 = isoCorner(ox, oy, k, fx + len, gyBase);
  isoPoly(ctx, [p1, p2, { x: p2.x, y: p2.y - h }, { x: p1.x, y: p1.y - h }]);
}

/** 竖立四边形（任意底边两点 + 高度），玻璃隔断/靠背通用。 */
function isoSlabAt(
  ctx: CanvasRenderingContext2D,
  a: { x: number; y: number },
  b: { x: number; y: number },
  h: number,
): void {
  isoPoly(ctx, [a, b, { x: b.x, y: b.y - h }, { x: a.x, y: a.y - h }]);
}

/** iso 静态层：背景 + 延伸地板 + 房间托盘（白边+厚度）+ 木地板 + 两面墙。 */
function buildIsoStaticLayer(pxW: number, pxH: number, dpr: number, cssW: number, cssH: number, view?: OfficeView): HTMLCanvasElement {
  const layer = document.createElement('canvas');
  layer.width = pxW;
  layer.height = pxH;
  const c = layer.getContext('2d');
  if (c === null) return layer;
  c.setTransform(dpr, 0, 0, dpr, 0, 0);

  const v = resolveView(view);
  const k = isoFit(cssW, cssH, v.zoom);
  const { ox, oy } = isoOrigin(cssW, cssH, k, v.panX, v.panY);

  // 背景（场景像摆在浅色台面上）
  c.fillStyle = ISO_BG;
  c.fillRect(0, 0, cssW, cssH);

  // 延伸区淡木地板：铺满画布（地图外的通行区），比房间主体更淡
  const inv = (sx: number, sy: number): { gx: number; gy: number } => {
    const wx = sx - ox;
    const wy = sy - oy;
    const a = (wy * 2) / k;
    const b = wx / k;
    // 屏幕点 → 旋转系格 → 地图系格（与 cellAtPoint 同一套逆变换）
    const rx = Math.floor(((a + b) / 2) * 1e9) / 1e9;
    const ry = Math.floor(((a - b) / 2) * 1e9) / 1e9;
    const r = v.rot;
    if (r === 0) return { gx: rx, gy: ry };
    if (r === 1) return { gx: ry, gy: MAP_H - 1 - rx };
    if (r === 2) return { gx: MAP_W - 1 - rx, gy: MAP_H - 1 - ry };
    return { gx: MAP_W - 1 - ry, gy: rx };
  };
  const corners = [inv(0, 0), inv(cssW, 0), inv(0, cssH), inv(cssW, cssH)];
  const gxs = corners.map((pt) => pt.gx);
  const gys = corners.map((pt) => pt.gy);
  const gx0 = Math.floor(Math.min(...gxs)) - 1;
  const gx1 = Math.ceil(Math.max(...gxs)) + 1;
  const gy0 = Math.floor(Math.min(...gys)) - 1;
  const gy1 = Math.ceil(Math.max(...gys)) + 1;
  for (let gy = gy0; gy <= gy1; gy++) {
    for (let gx = gx0; gx <= gx1; gx++) {
      const p00 = isoCorner(ox, oy, k, gx, gy);
      const p10 = isoCorner(ox, oy, k, gx + 1, gy);
      const p11 = isoCorner(ox, oy, k, gx + 1, gy + 1);
      const p01 = isoCorner(ox, oy, k, gx, gy + 1);
      c.fillStyle = (gx + gy) % 2 === 0 ? ISO_OUT_FLOOR : '#eae0d0';
      isoPoly(c, [p00, p10, p11, p01]);
      c.fill();
    }
  }

  // 房间外软影（把房间从背景里「托起」）
  const roomMid = isoCorner(ox, oy, k, MAP_W / 2, MAP_H / 2);
  c.fillStyle = 'rgba(88,78,62,0.10)';
  c.beginPath();
  c.ellipse(roomMid.x, roomMid.y + k * 0.5, k * (MAP_W + MAP_H) * 0.34, k * (MAP_W + MAP_H) * 0.13, 0, 0, Math.PI * 2);
  c.fill();

  // 房间托盘：白色外围（0.34 格宽）+ 台基厚度
  const TRAY = 0.34;
  const trayPts = [
    isoCorner(ox, oy, k, -TRAY, -TRAY),
    isoCorner(ox, oy, k, MAP_W + TRAY, -TRAY),
    isoCorner(ox, oy, k, MAP_W + TRAY, MAP_H + TRAY),
    isoCorner(ox, oy, k, -TRAY, MAP_H + TRAY),
  ];
  const trayThick = k * 0.5; // 参考稿厚白底座
  // 台基侧面（下缘两条边向下延伸）
  c.fillStyle = ISO_TRAY_SIDE;
  isoPoly(c, [trayPts[3] as { x: number; y: number }, trayPts[2] as { x: number; y: number }, { x: (trayPts[2] as { x: number; y: number }).x, y: (trayPts[2] as { x: number; y: number }).y + trayThick }, { x: (trayPts[3] as { x: number; y: number }).x, y: (trayPts[3] as { x: number; y: number }).y + trayThick }]);
  c.fill();
  c.fillStyle = '#d3d7db';
  isoPoly(c, [{ x: (trayPts[2] as { x: number; y: number }).x, y: (trayPts[2] as { x: number; y: number }).y }, { x: (trayPts[1] as { x: number; y: number }).x, y: (trayPts[1] as { x: number; y: number }).y }, { x: (trayPts[1] as { x: number; y: number }).x, y: (trayPts[1] as { x: number; y: number }).y + trayThick }, { x: (trayPts[2] as { x: number; y: number }).x, y: (trayPts[2] as { x: number; y: number }).y + trayThick }]);
  c.fill();
  // 托盘面
  c.fillStyle = ISO_TRAY;
  isoPoly(c, trayPts);
  c.fill();

  // 房间木地板：沿 gy 行铺木条（参考稿是长条木地板）
  for (let gy = 0; gy < MAP_H; gy++) {
    const p0 = isoCorner(ox, oy, k, 0, gy);
    const p1 = isoCorner(ox, oy, k, MAP_W, gy);
    const p2 = isoCorner(ox, oy, k, MAP_W, gy + 1);
    const p3 = isoCorner(ox, oy, k, 0, gy + 1);
    // 宽木条（每 2 格一条，对齐参考稿的宽板地板）
    c.fillStyle = (gy >> 1) % 2 === 0 ? ISO_FLOOR_A : ISO_FLOOR_B;
    isoPoly(c, [p0, p1, p2, p3]);
    c.fill();
    // 板缝
    c.strokeStyle = ISO_FLOOR_LINE;
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(p0.x, p0.y);
    c.lineTo(p1.x, p1.y);
    c.stroke();
    // 木板短缝（按格错位）
    const segs = 8;
    for (let i = 0; i < segs; i++) {
      const t = (i + (((gy >> 1) * 3) % segs) / segs) / segs;
      if (t <= 0 || t >= 1) continue;
      const a = isoCorner(ox, oy, k, MAP_W * t, gy);
      const b = isoCorner(ox, oy, k, MAP_W * t, gy + 1);
      c.strokeStyle = 'rgba(146,110,64,0.10)';
      c.beginPath();
      c.moveTo(a.x, a.y);
      c.lineTo(b.x, b.y);
      c.stroke();
    }
  }

  // 两面墙：右后墙（gy=0，参考稿内面灰调）+ 左后墙（gx=0，白调），墙高 3.1k，厚墙顶
  const WALL_H = k * 3.1;
  const thick = { x: k * 0.4, y: -k * 0.2 }; // 参考稿厚墙体积感
  const w00 = isoCorner(ox, oy, k, 0, 0);
  const wW0 = isoCorner(ox, oy, k, MAP_W, 0);
  const w0H = isoCorner(ox, oy, k, 0, MAP_H);
  // 右后墙面
  c.fillStyle = ISO_WALL_R;
  isoPoly(c, [w00, wW0, { x: wW0.x, y: wW0.y - WALL_H }, { x: w00.x, y: w00.y - WALL_H }]);
  c.fill();
  // 左后墙面
  c.fillStyle = ISO_WALL_L;
  isoPoly(c, [w00, w0H, { x: w0H.x, y: w0H.y - WALL_H }, { x: w00.x, y: w00.y - WALL_H }]);
  c.fill();
  // 墙顶厚度（右后墙顶 + 左后墙顶）
  c.fillStyle = ISO_WALL_TOP;
  const t00 = { x: w00.x, y: w00.y - WALL_H };
  const tW0 = { x: wW0.x, y: wW0.y - WALL_H };
  const t0H = { x: w0H.x, y: w0H.y - WALL_H };
  isoPoly(c, [t00, tW0, { x: tW0.x + thick.x, y: tW0.y + thick.y }, { x: t00.x + thick.x, y: t00.y + thick.y }]);
  c.fill();
  isoPoly(c, [t00, t0H, { x: t0H.x + thick.x, y: t0H.y + thick.y }, { x: t00.x + thick.x, y: t00.y + thick.y }]);
  c.fill();
  // 左后墙窗格（参考稿左墙一排窗）：沿 gx=0 边分三段，浅蓝玻璃 + 白框
  const winBottom = k * 0.9;
  const winH = k * 1.5;
  const segsWin = 3;
  for (let i = 0; i < segsWin; i++) {
    const g0 = 0.9 + ((MAP_H - 1.8) / segsWin) * i;
    const g1 = g0 + (MAP_H - 1.8) / segsWin - 0.5;
    const a = isoCorner(ox, oy, k, 0.02, g0);
    const b = isoCorner(ox, oy, k, 0.02, g1);
    // 玻璃
    c.fillStyle = '#dceaf4';
    isoPoly(c, [a, b, { x: b.x, y: b.y - winBottom - winH }, { x: a.x, y: a.y - winBottom - winH }]);
    c.fill();
    c.fillStyle = 'rgba(255,255,255,0.45)';
    isoPoly(c, [
      { x: a.x + (b.x - a.x) * 0.15, y: a.y + (b.y - a.y) * 0.15 - winBottom - winH },
      { x: a.x + (b.x - a.x) * 0.3, y: a.y + (b.y - a.y) * 0.3 - winBottom - winH },
      { x: a.x + (b.x - a.x) * 0.18, y: a.y + (b.y - a.y) * 0.18 - winBottom },
      { x: a.x + (b.x - a.x) * 0.03, y: a.y + (b.y - a.y) * 0.03 - winBottom },
    ]);
    c.fill();
    // 白框
    c.strokeStyle = '#ffffff';
    c.lineWidth = Math.max(2, k * 0.09);
    c.beginPath();
    c.moveTo(a.x, a.y - winBottom);
    c.lineTo(b.x, b.y - winBottom);
    c.lineTo(b.x, b.y - winBottom - winH);
    c.lineTo(a.x, a.y - winBottom - winH);
    c.closePath();
    c.stroke();
    // 中梃
    c.lineWidth = Math.max(1.5, k * 0.05);
    c.beginPath();
    c.moveTo((a.x + b.x) / 2, (a.y + b.y) / 2 - winBottom);
    c.lineTo((a.x + b.x) / 2, (a.y + b.y) / 2 - winBottom - winH);
    c.stroke();
    // 窗台
    c.strokeStyle = 'rgba(255,255,255,0.95)';
    c.lineWidth = Math.max(2, k * 0.08);
    c.beginPath();
    c.moveTo(a.x, a.y - winBottom + k * 0.04);
    c.lineTo(b.x, b.y - winBottom + k * 0.04);
    c.stroke();
  }

  // 墙顶高光 + 墙面下缘踢脚
  c.strokeStyle = 'rgba(255,255,255,0.9)';
  c.lineWidth = Math.max(1.5, k * 0.06);
  c.beginPath();
  c.moveTo(t0H.x, t0H.y);
  c.lineTo(t00.x, t00.y);
  c.lineTo(tW0.x, tW0.y);
  c.stroke();
  c.strokeStyle = ISO_WALL_SKIRT;
  c.lineWidth = Math.max(2, k * 0.1);
  c.beginPath();
  c.moveTo(w0H.x, w0H.y - k * 0.05);
  c.lineTo(w00.x, w00.y - k * 0.05);
  c.lineTo(wW0.x, wW0.y - k * 0.05);
  c.stroke();
  return layer;
}

/* ───────────── iso 家具（纯白软 3D 风） ───────────── */

/** 白色办公椅：五星脚 + 座垫 + 靠背（参考稿同款）。 */
function isoDrawChair(ctx: CanvasRenderingContext2D, ox: number, oy: number, k: number, cx: number, cy: number): void {
  const foot = isoCorner(ox, oy, k, cx + 0.5, cy + 0.5);
  // 五星脚 + 轮
  ctx.strokeStyle = '#b9bdc2';
  ctx.lineWidth = Math.max(1.2, k * 0.05);
  for (let i = 0; i < 5; i++) {
    const ang = (Math.PI * 2 * i) / 5 - Math.PI / 2;
    const ex = foot.x + Math.cos(ang) * k * 0.3;
    const ey = foot.y + Math.sin(ang) * k * 0.16;
    ctx.beginPath();
    ctx.moveTo(foot.x, foot.y);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    ctx.fillStyle = '#9aa0a7';
    ctx.beginPath();
    ctx.arc(ex, ey, Math.max(1, k * 0.04), 0, Math.PI * 2);
    ctx.fill();
  }
  // 气压杆
  ctx.fillStyle = '#c8ccd1';
  ctx.fillRect(foot.x - k * 0.035, foot.y - k * 0.3, Math.max(1.5, k * 0.07), k * 0.3);
  // 座垫
  isoBoxAt(ctx, ox, oy, k, cx + 0.16, cy + 0.2, 0.68, 0.58, k * 0.44, ISO_WHITE_TOP, ISO_WHITE_LEFT, '#dde0e4');
  // 靠背（竖板，带轻微斜角）
  const b0 = isoCorner(ox, oy, k, cx + 0.2, cy + 0.76);
  const b1 = isoCorner(ox, oy, k, cx + 0.8, cy + 0.76);
  ctx.fillStyle = '#eef0f2';
  isoSlabAt(ctx, { x: b0.x, y: b0.y - k * 0.42 }, { x: b1.x, y: b1.y - k * 0.42 }, k * 0.5);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  isoSlabAt(ctx, { x: b0.x, y: b0.y - k * 0.42 }, { x: b1.x, y: b1.y - k * 0.42 }, k * 0.1);
  ctx.fill();
}

/** 白色办公桌 2×2：桌板 + 挡板 + 桌腿 + 显示器 + 键盘鼠标 + 笔筒 + 杯 + 椅。 */
function isoDrawDesk(ctx: CanvasRenderingContext2D, f: Furniture, ox: number, oy: number, k: number, time: number): void {
  const X = f.x;
  const Y = f.y;
  const front = isoCorner(ox, oy, k, X + 1, Y + 2);
  isoSoftShadow(ctx, front.x, front.y - k * 0.12, k * 1.2, 0.14);
  // 桌腿（左右前角细柱）
  ctx.strokeStyle = '#d7dade';
  ctx.lineWidth = Math.max(1.5, k * 0.07);
  const legL = isoCorner(ox, oy, k, X + 0.1, Y + 0.88);
  const legR = isoCorner(ox, oy, k, X + 1.9, Y + 0.88);
  ctx.beginPath();
  ctx.moveTo(legL.x, legL.y);
  ctx.lineTo(legL.x, legL.y - k * 0.52);
  ctx.moveTo(legR.x, legR.y);
  ctx.lineTo(legR.x, legR.y - k * 0.52);
  ctx.stroke();
  // 桌板（上排，白；前缘挡板由盒体侧面体现）
  isoBoxAt(ctx, ox, oy, k, X, Y, 2, 1, k * 0.54, ISO_WHITE_TOP, ISO_WHITE_LEFT, ISO_WHITE_RIGHT);
  // 桌板顶部高光
  const tl = isoCorner(ox, oy, k, X + 0.05, Y + 0.05);
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.fillRect(tl.x, tl.y - k * 0.56, Math.max(1, k * 0.04), k * 0.2);
  // 显示器：iMac 式一体机——白壳面板 + 深屏内嵌 + 银色下巴 + 细支架（屏面朝左下）
  const mon = isoBoxAt(ctx, ox, oy, k, X + 0.26, Y + 0.28, 0.72, 0.14, k * 0.5, '#fbfcfd', '#eef0f2', '#dfe2e6');
  const s1 = isoCorner(ox, oy, k, X + 0.30, Y + 0.44);
  const s2 = isoCorner(ox, oy, k, X + 0.94, Y + 0.44);
  // 白色面板（外框）
  ctx.fillStyle = '#fdfdfe';
  isoPoly(ctx, [s1, s2, { x: s2.x, y: s2.y - k * 0.44 }, { x: s1.x, y: s1.y - k * 0.44 }]);
  ctx.fill();
  // 深屏内嵌（边距：侧 0.06 / 上 0.08 / 下巴 0.08）
  const g1 = isoCorner(ox, oy, k, X + 0.36, Y + 0.44);
  const g2 = isoCorner(ox, oy, k, X + 0.88, Y + 0.44);
  const gb1 = { x: g1.x, y: g1.y - k * 0.08 };
  const gb2 = { x: g2.x, y: g2.y - k * 0.08 };
  ctx.fillStyle = ISO_SCREEN;
  isoPoly(ctx, [gb1, gb2, { x: gb2.x, y: gb2.y - k * 0.28 }, { x: gb1.x, y: gb1.y - k * 0.28 }]);
  ctx.fill();
  // 屏幕反光（呼吸感）
  const glow = 0.10 + 0.05 * Math.sin(time * 1.6 + f.x * 1.3 + f.y);
  ctx.fillStyle = `rgba(150,190,225,${glow.toFixed(3)})`;
  isoPoly(ctx, [gb1, gb2, { x: gb2.x, y: gb2.y - k * 0.1 }, { x: gb1.x, y: gb1.y - k * 0.1 }]);
  ctx.fill();
  // 银色下巴（屏下窄条）
  ctx.fillStyle = '#dfe3e7';
  isoPoly(ctx, [g1, g2, gb2, gb1]);
  ctx.fill();
  // 支架 + 底座
  ctx.fillStyle = '#c9cdd3';
  ctx.fillRect(mon.x - k * 0.05, mon.y + k * 0.02, Math.max(2, k * 0.1), k * 0.2);
  ctx.fillStyle = '#e8eaed';
  ctx.fillRect(mon.x - k * 0.16, mon.y + k * 0.2, Math.max(3, k * 0.32), Math.max(1.5, k * 0.05));
  // 键盘 + 鼠标
  const kb = isoCorner(ox, oy, k, X + 0.42, Y + 0.66);
  ctx.fillStyle = '#f2f3f5';
  isoPoly(ctx, [kb, { x: kb.x + k * 0.5, y: kb.y + k * 0.25 }, { x: kb.x + k * 0.62, y: kb.y + k * 0.19 }, { x: kb.x + k * 0.12, y: kb.y - k * 0.06 }]);
  ctx.fill();
  ctx.fillStyle = '#e2e4e7';
  isoPoly(ctx, [kb, { x: kb.x + k * 0.5, y: kb.y + k * 0.25 }, { x: kb.x + k * 0.5, y: kb.y + k * 0.29 }, { x: kb.x, y: kb.y + k * 0.04 }]);
  ctx.fill();
  ctx.fillStyle = '#f2f3f5';
  ctx.beginPath();
  ctx.ellipse(kb.x + k * 0.78, kb.y + k * 0.24, k * 0.08, k * 0.05, 0, 0, Math.PI * 2);
  ctx.fill();
  // 笔筒
  const pen = isoCorner(ox, oy, k, X + 1.62, Y + 0.3);
  ctx.fillStyle = '#eef0f2';
  ctx.fillRect(pen.x - k * 0.07, pen.y - k * 0.18, k * 0.14, k * 0.18);
  ctx.fillStyle = '#cfd3d8';
  ctx.beginPath();
  ctx.ellipse(pen.x, pen.y - k * 0.18, k * 0.07, k * 0.035, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#8d939b';
  ctx.lineWidth = Math.max(1, k * 0.03);
  ctx.beginPath();
  ctx.moveTo(pen.x - k * 0.03, pen.y - k * 0.18);
  ctx.lineTo(pen.x - k * 0.05, pen.y - k * 0.34);
  ctx.moveTo(pen.x + k * 0.02, pen.y - k * 0.18);
  ctx.lineTo(pen.x + k * 0.04, pen.y - k * 0.33);
  ctx.stroke();
  // 马克杯
  const cup = isoCorner(ox, oy, k, X + 1.2, Y + 0.62);
  ctx.fillStyle = '#f4f5f6';
  ctx.beginPath();
  ctx.ellipse(cup.x, cup.y - k * 0.14, k * 0.085, k * 0.045, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(cup.x - k * 0.085, cup.y - k * 0.14, k * 0.17, k * 0.12);
  ctx.beginPath();
  ctx.ellipse(cup.x, cup.y - k * 0.02, k * 0.085, k * 0.045, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#d9b9a4';
  ctx.beginPath();
  ctx.ellipse(cup.x, cup.y - k * 0.14, k * 0.055, k * 0.03, 0, 0, Math.PI * 2);
  ctx.fill();
  // 桌下抽屉柜（参考稿：桌板右半下的灰白三屉柜，贴桌板底）
  const dw = isoCorner(ox, oy, k, X + 1.08, Y + 1.04);
  const dh = k * 0.4;
  const dTop = { x: dw.x, y: dw.y - k * 0.54 };
  // 柜体正面（朝左下）+ 侧面
  ctx.fillStyle = '#e9ecef';
  isoPoly(ctx, [dTop, { x: dTop.x + k * 0.78, y: dTop.y + k * 0.39 }, { x: dTop.x + k * 0.78, y: dTop.y + k * 0.39 + dh }, { x: dTop.x, y: dTop.y + dh }]);
  ctx.fill();
  ctx.fillStyle = '#d6dade';
  isoPoly(ctx, [{ x: dTop.x + k * 0.78, y: dTop.y + k * 0.39 }, { x: dTop.x + k * 0.98, y: dTop.y + k * 0.29 }, { x: dTop.x + k * 0.98, y: dTop.y + k * 0.29 + dh }, { x: dTop.x + k * 0.78, y: dTop.y + k * 0.39 + dh }]);
  ctx.fill();
  // 顶面
  ctx.fillStyle = '#f6f7f8';
  isoPoly(ctx, [dTop, { x: dTop.x + k * 0.78, y: dTop.y + k * 0.39 }, { x: dTop.x + k * 0.98, y: dTop.y + k * 0.29 }]);
  ctx.fill();
  // 三条抽屉缝 + 拉手
  ctx.strokeStyle = 'rgba(120,128,138,0.4)';
  ctx.lineWidth = Math.max(1, k * 0.02);
  ctx.beginPath();
  for (let di = 1; di <= 2; di++) {
    const y = dTop.y + (dh * di) / 3;
    ctx.moveTo(dTop.x + k * 0.06, y + k * 0.03);
    ctx.lineTo(dTop.x + k * 0.74, y + k * 0.36);
  }
  ctx.stroke();
  ctx.fillStyle = '#b9bec5';
  ctx.fillRect(dTop.x + k * 0.56, dTop.y + dh * 0.36, Math.max(1.5, k * 0.1), Math.max(1.5, k * 0.028));
  ctx.fillRect(dTop.x + k * 0.62, dTop.y + dh * 0.7, Math.max(1.5, k * 0.1), Math.max(1.5, k * 0.028));
  // 椅子（下排左格）
  isoDrawChair(ctx, ox, oy, k, X, Y + 1);
}

function isoDrawWhiteboard(ctx: CanvasRenderingContext2D, f: Furniture, ox: number, oy: number, k: number): void {
  const base = isoCorner(ox, oy, k, f.x + 1, f.y + 1.05);
  isoSoftShadow(ctx, base.x, base.y, k * 0.95, 0.12);
  // 支架腿
  ctx.strokeStyle = '#c3c7cc';
  ctx.lineWidth = Math.max(1.5, k * 0.06);
  const l1 = isoCorner(ox, oy, k, f.x + 0.2, f.y + 0.92);
  const l2 = isoCorner(ox, oy, k, f.x + 1.8, f.y + 0.92);
  ctx.beginPath();
  ctx.moveTo(l1.x, l1.y);
  ctx.lineTo(l1.x, l1.y - k * 0.9);
  ctx.moveTo(l2.x, l2.y);
  ctx.lineTo(l2.x, l2.y - k * 0.9);
  ctx.stroke();
  // 板面：白底 + 浅灰边框
  isoSlabAlongX(ctx, ox, oy, k, f.x - 0.02, f.y + 0.92, 2.04, k * 1.0);
  ctx.fillStyle = '#dfe3e8';
  ctx.fill();
  isoSlabAlongX(ctx, ox, oy, k, f.x + 0.04, f.y + 0.92, 1.92, k * 0.9);
  ctx.fillStyle = '#fdfdfc';
  ctx.fill();
  // 板书（柔和色块，不用硬线）
  const note = (t0: number, t1: number, yUp: number, color: string, th: number): void => {
    const a = isoCorner(ox, oy, k, f.x + t0, f.y + 0.9);
    const b = isoCorner(ox, oy, k, f.x + t1, f.y + 0.9);
    ctx.fillStyle = color;
    isoPoly(ctx, [a, b, { x: b.x, y: b.y - yUp }, { x: a.x, y: a.y - yUp }]);
    ctx.fill();
  };
  note(0.25, 0.72, k * 0.66, 'rgba(90,150,210,0.85)', k * 0.07);
  note(0.25, 0.58, k * 0.5, 'rgba(90,150,210,0.55)', k * 0.07);
  note(0.95, 1.35, k * 0.66, 'rgba(214,110,110,0.8)', k * 0.07);
  note(0.95, 1.18, k * 0.5, 'rgba(214,110,110,0.5)', k * 0.07);
}

function isoDrawPlant(ctx: CanvasRenderingContext2D, f: Furniture, ox: number, oy: number, k: number): void {
  const base = isoCorner(ox, oy, k, f.x + 0.5, f.y + 0.78);
  isoSoftShadow(ctx, base.x, base.y, k * 0.34, 0.14);
  // 白盆（梯形 + 口沿）
  ctx.fillStyle = ISO_POT;
  ctx.beginPath();
  ctx.moveTo(base.x - k * 0.21, base.y - k * 0.44);
  ctx.lineTo(base.x + k * 0.21, base.y - k * 0.44);
  ctx.lineTo(base.x + k * 0.15, base.y);
  ctx.quadraticCurveTo(base.x, base.y + k * 0.06, base.x - k * 0.15, base.y);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = ISO_POT_SHADE;
  ctx.beginPath();
  ctx.ellipse(base.x, base.y - k * 0.44, k * 0.21, k * 0.085, 0, 0, Math.PI);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.ellipse(base.x, base.y - k * 0.44, k * 0.21, k * 0.085, 0, Math.PI, Math.PI * 2);
  ctx.fill();
  // 叶片：三片大阔叶放射（参考稿的龟背竹感）
  const leaf = (dx: number, dy: number, rw: number, rh: number, rot: number, color: string): void => {
    ctx.save();
    ctx.translate(base.x + dx, base.y - k * 0.55 + dy);
    ctx.rotate(rot);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.ellipse(0, 0, rw, rh, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = Math.max(1, k * 0.02);
    ctx.beginPath();
    ctx.moveTo(0, -rh * 0.8);
    ctx.lineTo(0, rh * 0.8);
    ctx.stroke();
    ctx.restore();
  };
  leaf(-k * 0.26, -k * 0.06, k * 0.17, k * 0.36, -0.62, ISO_LEAF_B);
  leaf(k * 0.24, -k * 0.02, k * 0.17, k * 0.38, 0.55, ISO_LEAF_A);
  leaf(0, -k * 0.24, k * 0.16, k * 0.42, 0.02, ISO_LEAF_C);
  // 参考稿的繁茂感：再加两片侧后叶
  leaf(-k * 0.12, -k * 0.18, k * 0.13, k * 0.3, -0.25, ISO_LEAF_A);
  leaf(k * 0.13, -k * 0.16, k * 0.12, k * 0.3, 0.28, ISO_LEAF_B);
  // 叶柄
  ctx.strokeStyle = ISO_LEAF_B;
  ctx.lineWidth = Math.max(1.2, k * 0.035);
  ctx.beginPath();
  ctx.moveTo(base.x, base.y - k * 0.44);
  ctx.lineTo(base.x, base.y - k * 0.6);
  ctx.stroke();
}

function isoDrawCoffee(ctx: CanvasRenderingContext2D, f: Furniture, ox: number, oy: number, k: number, time: number): void {
  const base = isoCorner(ox, oy, k, f.x + 0.5, f.y + 0.82);
  isoSoftShadow(ctx, base.x, base.y, k * 0.36, 0.14);
  isoBoxAt(ctx, ox, oy, k, f.x + 0.18, f.y + 0.22, 0.64, 0.58, k * 0.62, '#f7f8f9', '#e3e6e9', '#cfd3d8');
  // 面板 + 出水口（右前面）
  const fp = isoCorner(ox, oy, k, f.x + 0.82, f.y + 0.64);
  ctx.fillStyle = '#3f464e';
  ctx.fillRect(fp.x - k * 0.16, fp.y - k * 0.5, Math.max(2, k * 0.16), k * 0.1);
  ctx.fillRect(fp.x - k * 0.12, fp.y - k * 0.3, Math.max(1.5, k * 0.08), k * 0.14);
  // 顶面杯 + 指示灯
  ctx.fillStyle = '#f1f2f4';
  ctx.beginPath();
  ctx.ellipse(fp.x - k * 0.1, fp.y - k * 0.14, k * 0.07, k * 0.035, 0, 0, Math.PI * 2);
  ctx.fill();
  const pulse = 0.35 + 0.25 * Math.sin(time * 2.4 + f.x);
  ctx.fillStyle = `rgba(240,120,110,${pulse.toFixed(3)})`;
  ctx.beginPath();
  ctx.arc(fp.x - k * 0.05, fp.y - k * 0.62, Math.max(1.2, k * 0.045), 0, Math.PI * 2);
  ctx.fill();
}

/** 玻璃隔断（wall 家具）：深灰框 + 半透明玻璃 + 竖梃。 */
function isoDrawWallSeg(ctx: CanvasRenderingContext2D, f: Furniture, ox: number, oy: number, k: number): void {
  const base = isoCorner(ox, oy, k, f.x + 0.5, f.y + 0.5);
  isoSoftShadow(ctx, base.x, base.y, k * 0.4, 0.13);
  const GLASS_H = k * 2.1; // 参考稿：齐人半高的黑框玻璃墙
  const a = isoCorner(ox, oy, k, f.x + 0.02, f.y + 0.5);
  const b = isoCorner(ox, oy, k, f.x + 0.98, f.y + 0.5);
  const aT = { x: a.x, y: a.y - GLASS_H };
  const bT = { x: b.x, y: b.y - GLASS_H };
  // 玻璃（淡绿灰透感）
  ctx.fillStyle = 'rgba(198,216,222,0.42)';
  isoPoly(ctx, [a, b, bT, aT]);
  ctx.fill();
  // 玻璃斜向反光条（两条）
  ctx.fillStyle = 'rgba(255,255,255,0.32)';
  isoPoly(ctx, [
    { x: a.x + k * 0.14, y: a.y - k * 0.06 },
    { x: a.x + k * 0.3, y: a.y - k * 0.02 },
    { x: a.x + k * 0.1, y: a.y - GLASS_H + k * 0.16 },
    { x: a.x - k * 0.06, y: a.y - GLASS_H + k * 0.12 },
  ]);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.2)';
  isoPoly(ctx, [
    { x: a.x + k * 0.46, y: a.y + k * 0.08 },
    { x: a.x + k * 0.56, y: a.y + k * 0.11 },
    { x: a.x + k * 0.4, y: a.y - GLASS_H + k * 0.14 },
    { x: a.x + k * 0.3, y: a.y - GLASS_H + k * 0.11 },
  ]);
  ctx.fill();
  // 黑框：四周描边（加粗、圆头）
  ctx.strokeStyle = '#3a4046';
  ctx.lineWidth = Math.max(2.5, k * 0.1);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.moveTo(aT.x, aT.y);
  ctx.lineTo(bT.x, bT.y);
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(aT.x, aT.y);
  ctx.moveTo(b.x, b.y);
  ctx.lineTo(bT.x, bT.y);
  ctx.stroke();
  // 竖梃（把玻璃面分成三扇）
  ctx.lineWidth = Math.max(2, k * 0.07);
  const m1 = isoCorner(ox, oy, k, f.x + 0.34, f.y + 0.5);
  const m2 = isoCorner(ox, oy, k, f.x + 0.66, f.y + 0.5);
  ctx.beginPath();
  ctx.moveTo(m1.x, m1.y);
  ctx.lineTo(m1.x, m1.y - GLASS_H);
  ctx.moveTo(m2.x, m2.y);
  ctx.lineTo(m2.x, m2.y - GLASS_H);
  ctx.stroke();
}

function isoDrawMicrowave(ctx: CanvasRenderingContext2D, f: Furniture, ox: number, oy: number, k: number): void {
  const base = isoCorner(ox, oy, k, f.x + 0.5, f.y + 0.82);
  isoSoftShadow(ctx, base.x, base.y, k * 0.36, 0.13);
  isoBoxAt(ctx, ox, oy, k, f.x + 0.12, f.y + 0.24, 0.76, 0.56, k * 0.5, '#f8f9fa', '#e4e7ea', '#d0d4d9');
  const w = isoCorner(ox, oy, k, f.x + 0.88, f.y + 0.56);
  ctx.fillStyle = '#3d444c';
  ctx.fillRect(w.x - k * 0.22, w.y - k * 0.4, Math.max(2, k * 0.2), k * 0.24);
  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  ctx.fillRect(w.x - k * 0.19, w.y - k * 0.37, Math.max(1, k * 0.03), k * 0.18);
  ctx.fillStyle = '#e6e9ec';
  ctx.fillRect(w.x - k * 0.05, w.y - k * 0.4, Math.max(2, k * 0.05), k * 0.24);
}

function isoDrawFridge(ctx: CanvasRenderingContext2D, f: Furniture, ox: number, oy: number, k: number): void {
  const base = isoCorner(ox, oy, k, f.x + 0.5, f.y + 0.82);
  isoSoftShadow(ctx, base.x, base.y, k * 0.38, 0.14);
  isoBoxAt(ctx, ox, oy, k, f.x + 0.16, f.y + 0.22, 0.68, 0.56, k * 1.15, '#f7f8f9', '#e2e5e9', '#ccd1d7');
  const d = isoCorner(ox, oy, k, f.x + 0.84, f.y + 0.78);
  ctx.strokeStyle = 'rgba(90,98,108,0.45)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(d.x - k * 0.24, d.y - k * 0.52);
  ctx.lineTo(d.x, d.y - k * 0.46);
  ctx.stroke();
  ctx.fillStyle = '#9aa1a9';
  ctx.fillRect(d.x - k * 0.07, d.y - k * 0.98, Math.max(1.5, k * 0.045), k * 0.2);
  ctx.fillRect(d.x - k * 0.07, d.y - k * 0.66, Math.max(1.5, k * 0.045), k * 0.32);
}

/** 地毯（可通行）：等距圆角米色绒毯，三层同心柔边。 */
function isoDrawCarpet(ctx: CanvasRenderingContext2D, f: Furniture, ox: number, oy: number, k: number): void {
  const r = Math.min(f.w, f.h) * 0.22;
  isoTopRounded(ctx, ox, oy, k, f.x - 0.03, f.y - 0.03, f.w + 0.06, f.h + 0.06, r, 0, 'rgba(120,104,80,0.14)');
  isoTopRounded(ctx, ox, oy, k, f.x, f.y, f.w, f.h, r, 0, '#efe7da');
  isoTopRounded(ctx, ox, oy, k, f.x + 0.14, f.y + 0.14, f.w - 0.28, f.h - 0.28, r * 0.8, 0, '#eae1d2');
  // 绒面细纹
  ctx.save();
  ctx.transform(k, k / 2, -k, k / 2, ox + (f.x - f.y) * k, oy + ((f.x + f.y) * k) / 2);
  ctx.strokeStyle = 'rgba(160,140,110,0.16)';
  ctx.lineWidth = 0.02;
  for (let i = 1; i < 5; i++) {
    const t = (f.w * i) / 5;
    ctx.beginPath();
    ctx.moveTo(t, 0.12);
    ctx.lineTo(t, f.h - 0.12);
    ctx.stroke();
  }
  ctx.restore();
}

/** 圆桌（会议桌）：白色椭圆台面 + 中柱底座 + 桌上小物 + 四把椅子（对应参考稿会议角）。 */
function isoDrawRoundTable(ctx: CanvasRenderingContext2D, f: Furniture, ox: number, oy: number, k: number): void {
  const cx = f.x + f.w / 2;
  const cy = f.y + f.h / 2;
  const c = isoCorner(ox, oy, k, cx, cy);
  // 后方两把椅子
  isoDrawChair(ctx, ox, oy, k, f.x - 0.62, f.y - 0.5);
  isoDrawChair(ctx, ox, oy, k, f.x + f.w - 0.38, f.y - 0.5);
  // 桌影
  isoSoftShadow(ctx, c.x, c.y + k * 0.06, k * 1.0, 0.13);
  // 中柱 + 圆底座
  ctx.fillStyle = '#e4e7ea';
  ctx.fillRect(c.x - k * 0.08, c.y - k * 0.55, k * 0.16, k * 0.55);
  ctx.beginPath();
  ctx.ellipse(c.x, c.y, k * 0.4, k * 0.19, 0, 0, Math.PI * 2);
  ctx.fill();
  // 台面侧厚 + 台面
  ctx.fillStyle = '#dde1e5';
  ctx.beginPath();
  ctx.ellipse(c.x, c.y - k * 0.5, k * 1.0, k * 0.54, 0, 0, Math.PI);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.ellipse(c.x, c.y - k * 0.56, k * 1.0, k * 0.54, 0, 0, Math.PI * 2);
  ctx.fill();
  // 桌面小物：笔记本 + 杯子
  ctx.fillStyle = '#f2f3f5';
  ctx.beginPath();
  ctx.ellipse(c.x - k * 0.34, c.y - k * 0.62, k * 0.22, k * 0.12, 0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#e9ebee';
  ctx.beginPath();
  ctx.ellipse(c.x + k * 0.3, c.y - k * 0.62, k * 0.1, k * 0.06, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#dfe3e7';
  ctx.fillRect(c.x + k * 0.26, c.y - k * 0.64, k * 0.08, k * 0.08);
  // 前方两把椅子
  isoDrawChair(ctx, ox, oy, k, f.x - 0.62, f.y + f.h - 0.5);
  isoDrawChair(ctx, ox, oy, k, f.x + f.w - 0.38, f.y + f.h - 0.5);
}

/** 抽屉柜（工位旁三层白柜）：柜体 + 三层抽屉缝 + 把手 + 柜顶小物。 */
function isoDrawCabinet(ctx: CanvasRenderingContext2D, f: Furniture, ox: number, oy: number, k: number): void {
  const base = isoCorner(ox, oy, k, f.x + 0.5, f.y + 0.88);
  isoSoftShadow(ctx, base.x, base.y, k * 0.32, 0.13);
  isoBoxAt(ctx, ox, oy, k, f.x + 0.2, f.y + 0.24, 0.6, 0.56, k * 0.72, '#fbfcfd', '#e6e9ec', '#d2d6db');
  // 三层抽屉缝 + 把手（右前面）
  const fp = isoCorner(ox, oy, k, f.x + 0.8, f.y + 0.78);
  ctx.strokeStyle = 'rgba(120,128,138,0.35)';
  ctx.lineWidth = 1;
  for (let i = 1; i <= 2; i++) {
    const dy = k * (0.72 / 3) * i;
    ctx.beginPath();
    ctx.moveTo(fp.x - k * 0.2, fp.y - dy);
    ctx.lineTo(fp.x, fp.y - dy + k * 0.08);
    ctx.stroke();
  }
  ctx.fillStyle = '#b6bcc4';
  ctx.fillRect(fp.x - k * 0.12, fp.y - k * 0.3, Math.max(1.5, k * 0.05), k * 0.12);
  ctx.fillRect(fp.x - k * 0.12, fp.y - k * 0.52, Math.max(1.5, k * 0.05), k * 0.12);
  // 柜顶小物（书）
  ctx.fillStyle = '#e9ebee';
  ctx.beginPath();
  ctx.ellipse(base.x, base.y - k * 0.76, k * 0.18, k * 0.09, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#dde1e5';
  ctx.fillRect(base.x - k * 0.18, base.y - k * 0.76, k * 0.36, k * 0.1);
}

/* ───────────── iso 人物（Q 版大头，软 3D 玩具风） ───────────── */

/** 头发：从 c.hair 提亮成软 3D 观感（保留员工发色识别）。 */
function isoHairColor(hair: string): string {
  return hair === '' ? '#6b4a34' : hair;
}

function isoDrawChar(
  ctx: CanvasRenderingContext2D,
  c: Character,
  ox: number,
  oy: number,
  k: number,
  time: number,
  showNames: boolean,
  hasBubble: boolean,
): { headX: number; headY: number } {
  const foot = isoCorner(ox, oy, k, c.rx + 0.5, c.ry + 0.5);
  const px = foot.x;
  const sitting = c.state === 'working' || c.state === 'coffee';
  const walking = c.state === 'walking';
  const bob = walking ? Math.abs(Math.sin(time * 10 + c.phase)) * k * 0.05 : Math.sin(time * 2 + c.phase) * k * 0.012;
  const bobN = walking ? Math.abs(Math.sin(time * 10 + c.phase)) : 0;

  // 落地软影
  const shadowK = 1 - bobN * 0.15;
  ctx.fillStyle = 'rgba(88,78,62,0.20)';
  ctx.beginPath();
  ctx.ellipse(px, foot.y + k * 0.02, k * 0.3 * shadowK, k * 0.13 * shadowK, 0, 0, Math.PI * 2);
  ctx.fill();
  // 自己：脚底绿圈
  if (c.isSelf) {
    ctx.strokeStyle = 'rgba(0, 200, 106, 0.9)';
    ctx.lineWidth = Math.max(1.5, k * 0.055);
    ctx.beginPath();
    ctx.ellipse(px, foot.y + k * 0.02, k * 0.38, k * 0.17, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 1;
  }

  // 腿：站/走路（摆动双腿 + 白鞋）或真坐姿（大腿前伸 + 小腿垂下 + 鞋）
  const seatH = k * 0.42; // 与 isoDrawChair 的座垫高度一致
  const legH = sitting ? 0 : k * 0.16;
  const bodyW = k * 0.52;
  const bodyH = k * 0.34; // Q 版：身体短圆
  const headR = k * 0.38; // Q 版大头（参考稿头身比约 1:1）
  const baseY = foot.y;
  if (!sitting) {
    const swing = walking ? Math.sin(time * 10 + c.phase) * k * 0.08 : 0;
    ctx.fillStyle = ISO_PANTS;
    ctx.fillRect(px - bodyW * 0.36 + swing, baseY - legH, bodyW * 0.26, legH * 0.78);
    ctx.fillRect(px + bodyW * 0.1 - swing, baseY - legH, bodyW * 0.26, legH * 0.78);
    ctx.fillStyle = ISO_SHOE;
    ctx.fillRect(px - bodyW * 0.4 + swing, baseY - legH * 0.24, bodyW * 0.34, legH * 0.24);
    ctx.fillRect(px + bodyW * 0.06 - swing, baseY - legH * 0.24, bodyW * 0.34, legH * 0.24);
  } else {
    const dir = c.face;
    const seatY = baseY - seatH;
    // 大腿（水平前伸）
    const thighX = dir > 0 ? px - k * 0.05 : px - k * 0.4;
    ctx.fillStyle = ISO_PANTS;
    rr(ctx, thighX, seatY - k * 0.02, k * 0.45, k * 0.15, k * 0.07);
    ctx.fill();
    // 小腿（垂下）+ 鞋
    const kneeX = dir > 0 ? px + k * 0.32 : px - k * 0.32;
    ctx.fillRect(kneeX - k * 0.065, seatY + k * 0.06, k * 0.13, baseY - seatY - k * 0.02);
    ctx.fillStyle = ISO_SHOE;
    rr(ctx, kneeX - k * 0.1, baseY - k * 0.09, k * 0.2, k * 0.1, k * 0.045);
    ctx.fill();
  }

  // 身体（圆润短胖）+ 两侧手臂；坐姿时身体落在椅面高度上
  const bodyBottom = sitting ? baseY - seatH + k * 0.05 : baseY - legH;
  const bodyTop = bodyBottom - bodyH + bob;
  ctx.fillStyle = c.color;
  rr(ctx, px - bodyW / 2, bodyTop, bodyW, bodyH, k * 0.17);
  ctx.fill();
  // 球状立体感：顶部高光 + 底部收影
  const bodyGrad = ctx.createLinearGradient(0, bodyTop, 0, bodyTop + bodyH);
  bodyGrad.addColorStop(0, 'rgba(255,255,255,0.32)');
  bodyGrad.addColorStop(0.45, 'rgba(255,255,255,0)');
  bodyGrad.addColorStop(1, 'rgba(40,40,60,0.16)');
  ctx.fillStyle = bodyGrad;
  rr(ctx, px - bodyW / 2, bodyTop, bodyW, bodyH, k * 0.17);
  ctx.fill();
  // 手臂（略深）
  ctx.fillStyle = c.color;
  ctx.globalAlpha = 0.85;
  rr(ctx, px - bodyW * 0.62, bodyTop + bodyH * 0.16, bodyW * 0.2, bodyH * 0.68, k * 0.09);
  ctx.fill();
  rr(ctx, px + bodyW * 0.42, bodyTop + bodyH * 0.16, bodyW * 0.2, bodyH * 0.68, k * 0.09);
  ctx.fill();
  ctx.globalAlpha = 1;
  // 手
  ctx.fillStyle = ISO_SKIN;
  ctx.beginPath();
  ctx.arc(px - bodyW * 0.52, bodyTop + bodyH * 0.84, k * 0.075, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(px + bodyW * 0.52, bodyTop + bodyH * 0.84, k * 0.075, 0, Math.PI * 2);
  ctx.fill();

  // 头（Q 版大头）：底色 + 球面渐变（上亮下影）+ 头发盖 + 刘海
  const headCy = bodyTop - headR * 0.62 + bob;
  ctx.fillStyle = ISO_SKIN;
  ctx.beginPath();
  ctx.arc(px, headCy, headR, 0, Math.PI * 2);
  ctx.fill();
  const headGrad = ctx.createRadialGradient(px - headR * 0.3, headCy - headR * 0.35, headR * 0.2, px, headCy, headR);
  headGrad.addColorStop(0, 'rgba(255,255,255,0.4)');
  headGrad.addColorStop(0.5, 'rgba(255,255,255,0)');
  headGrad.addColorStop(1, 'rgba(150,100,70,0.18)');
  ctx.fillStyle = headGrad;
  ctx.beginPath();
  ctx.arc(px, headCy, headR, 0, Math.PI * 2);
  ctx.fill();
  // 耳朵
  ctx.beginPath();
  ctx.arc(px - headR * 0.95, headCy + headR * 0.1, headR * 0.16, 0, Math.PI * 2);
  ctx.arc(px + headR * 0.95, headCy + headR * 0.1, headR * 0.16, 0, Math.PI * 2);
  ctx.fill();
  // 头发：上半球盖 + 刘海
  const hair = isoHairColor(c.hair);
  ctx.fillStyle = hair;
  ctx.beginPath();
  ctx.arc(px, headCy, headR + k * 0.01, Math.PI, Math.PI * 2);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(px, headCy - headR * 0.55, headR, headR * 0.5, 0, 0, Math.PI * 2);
  ctx.fill();
  // 眼睛（朝向 face 偏移）+ 腮红 + 嘴
  const eyeShift = c.face * headR * 0.1;
  ctx.fillStyle = '#2c2a28';
  const eyeR = Math.max(1.2, headR * 0.13);
  ctx.beginPath();
  ctx.arc(px - headR * 0.34 + eyeShift, headCy + headR * 0.12, eyeR, 0, Math.PI * 2);
  ctx.arc(px + headR * 0.34 + eyeShift, headCy + headR * 0.12, eyeR, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(232,150,130,0.35)';
  ctx.beginPath();
  ctx.arc(px - headR * 0.62 + eyeShift, headCy + headR * 0.42, headR * 0.15, 0, Math.PI * 2);
  ctx.arc(px + headR * 0.62 + eyeShift, headCy + headR * 0.42, headR * 0.15, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(120,90,80,0.5)';
  ctx.lineWidth = Math.max(1, headR * 0.07);
  ctx.beginPath();
  ctx.arc(px + eyeShift, headCy + headR * 0.42, headR * 0.14, 0.2, Math.PI - 0.2);
  ctx.stroke();

  // 会议光环
  let haloTop = 0;
  if (c.state === 'meeting') {
    const haloY = headCy - headR - k * 0.12 + Math.sin(time * 2.5 + c.phase) * k * 0.03;
    ctx.strokeStyle = 'rgba(77,144,254,0.3)';
    ctx.lineWidth = Math.max(2.5, k * 0.1);
    ctx.beginPath();
    ctx.ellipse(px, haloY, k * 0.32, k * 0.13, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(77,144,254,0.9)';
    ctx.lineWidth = Math.max(1.2, k * 0.045);
    ctx.beginPath();
    ctx.ellipse(px, haloY, k * 0.32, k * 0.13, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 1;
    haloTop = haloY - k * 0.1;
  }

  // 咖啡杯
  if (c.state === 'coffee') {
    const cupW = Math.max(3, k * 0.15);
    const cupX = px + c.face * bodyW * 0.62 - cupW / 2;
    const cupY = bodyTop + bodyH * 0.34;
    ctx.fillStyle = '#fbfbfc';
    rr(ctx, cupX, cupY, cupW, cupW * 0.9, cupW * 0.25);
    ctx.fill();
    ctx.fillStyle = '#e7e9ec';
    ctx.fillRect(cupX, cupY, cupW, cupW * 0.18);
    const steam = Math.sin(time * 3 + c.phase);
    ctx.fillStyle = 'rgba(140,140,150,0.3)';
    ctx.fillRect(cupX + cupW * 0.3 + steam * 1.2, cupY - cupW * 0.6, Math.max(1, cupW * 0.14), cupW * 0.45);
  }

  if (c.state === 'meeting' && !hasBubble) {
    const efs = Math.min(12, Math.max(9, k * 0.32));
    ctx.font = `${efs}px sans-serif`;
    ctx.textAlign = 'center';
    const lift = haloTop > 0 ? headCy - haloTop + efs * 0.6 : 0;
    ctx.fillText('💬', px, headCy - headR - efs * (showNames ? 2.3 : 0.4) - lift);
    ctx.textAlign = 'left';
  }

  // 名牌：无描边、柔影（软 3D 风）
  if (showNames) {
    const label = `${c.name}${c.isSelf ? '（我）' : ''}`;
    const fs = Math.min(12, Math.max(9, k * 0.3));
    ctx.font = `${fs}px -apple-system, "PingFang SC", sans-serif`;
    const tw = ctx.measureText(label).width;
    const bx = px - tw / 2 - 5;
    const by = headCy - headR - fs - k * 0.24;
    ctx.fillStyle = 'rgba(88,78,62,0.14)';
    rr(ctx, bx, by + 1.5, tw + 10, fs + 6, (fs + 6) * 0.42);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.96)';
    rr(ctx, bx, by, tw + 10, fs + 6, (fs + 6) * 0.42);
    ctx.fill();
    ctx.fillStyle = '#3a3a3c';
    ctx.fillText(label, px - tw / 2, by + fs + 1.5);
  }
  return { headX: px, headY: headCy - headR };
}

/** iso 气泡：锚头顶点，默认挂左侧（不遮名牌），贴左缘翻右侧，两侧都放不下回头顶高位。 */
function isoDrawBubble(ctx: CanvasRenderingContext2D, text: string, k: number, hx: number, hy: number, remaining: number, cw: number): void {
  const alpha = Math.max(0, Math.min(1, remaining / 0.4));
  if (alpha <= 0) return;
  const fs = Math.min(11, Math.max(9, k * 0.26));
  const maxW = Math.max(56, k * 5);
  ctx.font = `${fs}px -apple-system, "PingFang SC", sans-serif`;
  const [l1, l2] = wrapBubbleText(ctx, text, maxW);
  const w1 = ctx.measureText(l1).width;
  const w2 = l2 ? ctx.measureText(l2).width : 0;
  const lineH = fs * 1.3;
  const pad = fs * 0.5;
  const bw = Math.max(w1, w2) + pad * 2;
  const bh = pad * 2 + lineH * (l2 ? 2 : 1);
  const gap = k * 0.6;
  let bx = hx - gap - bw;
  let by = hy - bh + k * 0.08;
  let side: 'right' | 'left' | 'top' = 'left';
  if (bx < 4) {
    bx = hx + gap;
    side = bx + bw <= cw - 4 ? 'right' : 'top';
    if (side === 'top') bx = hx - bw / 2;
  }
  if (side === 'top') by = hy - bh - k * 0.5;
  const radius = Math.min(bh, bw) * 0.42;
  ctx.save();
  ctx.globalAlpha = alpha;
  // 尾巴
  ctx.fillStyle = '#ffffff';
  if (side === 'top') {
    ctx.beginPath();
    ctx.moveTo(hx - fs * 0.3, by + bh - 1);
    ctx.lineTo(hx + fs * 0.3, by + bh - 1);
    ctx.lineTo(hx, by + bh + fs * 0.5);
    ctx.closePath();
    ctx.fill();
  } else {
    const ex = side === 'left' ? bx + bw : bx;
    const tipX = side === 'left' ? hx - k * 0.16 : hx + k * 0.16;
    const ey1 = Math.min(Math.max(hy - fs * 0.3, by + 4), by + bh - 4 - fs * 0.6);
    ctx.beginPath();
    ctx.moveTo(ex, ey1);
    ctx.lineTo(ex, ey1 + fs * 0.6);
    ctx.lineTo(tipX, hy - k * 0.04);
    ctx.closePath();
    ctx.fill();
  }
  // 气泡体：柔影 + 纯白（无描边）
  ctx.fillStyle = 'rgba(88,78,62,0.16)';
  rr(ctx, bx, by + 2, bw, bh, radius);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  rr(ctx, bx, by, bw, bh, radius);
  ctx.fill();
  ctx.fillStyle = '#3a3a3c';
  ctx.textAlign = 'center';
  const btx = bx + bw / 2;
  ctx.fillText(l1, btx, by + pad + lineH * 0.5);
  if (l2) ctx.fillText(l2, btx, by + pad + lineH * 1.5);
  ctx.textAlign = 'left';
  ctx.restore();
}

/* ───────────── iso 主渲染 ───────────── */

function renderIso(
  canvas: HTMLCanvasElement,
  furniture: Furniture[],
  chars: Character[],
  time: number,
  opts?: {
    showNames?: boolean;
    bubbles?: ReadonlyMap<string, { text: string; until: number }>;
    meeting?: boolean;
    view?: OfficeView;
  },
): void {
  const ctx = canvas.getContext('2d');
  if (ctx === null) return;
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || 320;
  const cssH = canvas.clientHeight || 200;
  const pxW = Math.max(1, Math.round(cssW * dpr));
  const pxH = Math.max(1, Math.round(cssH * dpr));
  if (canvas.width !== pxW || canvas.height !== pxH) {
    canvas.width = pxW;
    canvas.height = pxH;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const v = resolveView(opts?.view);
  const k = isoFit(cssW, cssH, v.zoom);
  const { ox, oy } = isoOrigin(cssW, cssH, k, v.panX, v.panY);
  const showNames = opts?.showNames ?? k >= 13;

  const staticKey = `iso3:${pxW}x${pxH}@${dpr}@${v.zoom.toFixed(3)}@${v.rot}@${Math.round(v.panX)}@${Math.round(v.panY)}`;
  let cached = staticLayers.get(canvas);
  if (cached === undefined || cached.key !== staticKey) {
    cached = { key: staticKey, layer: buildIsoStaticLayer(pxW, pxH, dpr, cssW, cssH, opts?.view) };
    staticLayers.set(canvas, cached);
  }
  ctx.drawImage(cached.layer, 0, 0, cssW, cssH);

  // 会议白板高亮（板面外扩描边，呼吸）
  if (opts?.meeting === true) {
    const breath = 0.75 + 0.2 * Math.sin(time * 3);
    ctx.save();
    for (const f of furniture) {
      if (f.kind !== 'whiteboard') continue;
      const a = isoCorner(ox, oy, k, f.x - 0.06, f.y + 0.9);
      const b = isoCorner(ox, oy, k, f.x + 2.06, f.y + 0.9);
      ctx.strokeStyle = 'rgba(242, 153, 74, 0.95)';
      ctx.globalAlpha = breath;
      ctx.lineWidth = Math.max(2, k * 0.09);
      isoSlabAt(ctx, a, b, k * 1.04);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(242, 153, 74, 1)';
      ctx.globalAlpha = breath * 0.28;
      ctx.lineWidth = Math.max(5, k * 0.2);
      isoSlabAt(ctx, a, b, k * 1.04);
      ctx.stroke();
    }
    ctx.restore();
  }

  // 画家算法：家具与人物按 (gx+gy) 深度混排（人物 +0.01 后画，坐在椅前）
  type Renderable = { depth: number; kind: 'furn' | 'char'; f?: Furniture; c?: Character };
  const items: Renderable[] = [];
  // 地毯贴地装饰：永远最先画（深度压到最低），其余家具按 gx+gy
  for (const f of furniture) items.push({ depth: f.kind === 'carpet' ? -1000 + f.x * 0.001 : f.x + f.y, kind: 'furn', f });
  for (const c of chars) items.push({ depth: c.rx + c.ry + 0.01, kind: 'char', c });
  items.sort((a, b) => a.depth - b.depth);

  const bubbles = opts?.bubbles;
  const hasBubble = (c: Character): boolean => {
    const b = bubbles?.get(c.id);
    return b !== undefined && b.until > time;
  };
  const anchors = new Map<string, { headX: number; headY: number }>();
  for (const it of items) {
    if (it.kind === 'furn' && it.f !== undefined) {
      const f = it.f;
      switch (f.kind) {
        case 'desk':
          isoDrawDesk(ctx, f, ox, oy, k, time);
          break;
        case 'whiteboard':
          isoDrawWhiteboard(ctx, f, ox, oy, k);
          break;
        case 'plant':
          isoDrawPlant(ctx, f, ox, oy, k);
          break;
        case 'coffee':
          isoDrawCoffee(ctx, f, ox, oy, k, time);
          break;
        case 'wall':
          isoDrawWallSeg(ctx, f, ox, oy, k);
          break;
        case 'microwave':
          isoDrawMicrowave(ctx, f, ox, oy, k);
          break;
        case 'fridge':
          isoDrawFridge(ctx, f, ox, oy, k);
          break;
        case 'carpet':
          isoDrawCarpet(ctx, f, ox, oy, k);
          break;
        case 'roundtable':
          isoDrawRoundTable(ctx, f, ox, oy, k);
          break;
        case 'cabinet':
          isoDrawCabinet(ctx, f, ox, oy, k);
          break;
      }
    } else if (it.kind === 'char' && it.c !== undefined) {
      const anchor = isoDrawChar(ctx, it.c, ox, oy, k, time, showNames, hasBubble(it.c));
      if (hasBubble(it.c)) anchors.set(it.c.id, anchor);
    }
  }

  if (bubbles !== undefined && bubbles.size > 0) {
    for (const [id, b] of bubbles) {
      if (b.until <= time) continue;
      const anchor = anchors.get(id);
      if (anchor === undefined) continue;
      isoDrawBubble(ctx, b.text, k, anchor.headX, anchor.headY, b.until - time, cssW);
    }
  }
}
