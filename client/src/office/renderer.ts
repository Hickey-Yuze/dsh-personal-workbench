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
}

/** 把视图状态解析成确定的 (zoom, panX, panY)。 */
function resolveView(view?: OfficeView): { zoom: number; panX: number; panY: number } {
  const zoom = view?.zoom !== undefined && Number.isFinite(view.zoom) && view.zoom > 0 ? view.zoom : 1;
  const panX = view?.panX !== undefined && Number.isFinite(view.panX) ? view.panX : 0;
  const panY = view?.panY !== undefined && Number.isFinite(view.panY) ? view.panY : 0;
  return { zoom, panX, panY };
}

/**
 * 平移钳制（等距投影）：地图包围盒 = (MAP_W+MAP_H)k 宽 × 一半高；
 * pan 围绕 0 对称 ±(box-css)/2——放大后边缘恰好贴到画布边缘；小于画布锁定 0。
 */
export function clampViewPan(panX: number, panY: number, zoom: number, cssW: number, cssH: number): { panX: number; panY: number } {
  const k = Math.min(cssW / (MAP_W + MAP_H), (cssH * 2) / (MAP_W + MAP_H)) * zoom;
  const mapW = k * (MAP_W + MAP_H);
  const mapH = (k * (MAP_W + MAP_H)) / 2;
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
  const k = Math.min(cssW / (MAP_W + MAP_H), (cssH * 2) / (MAP_W + MAP_H)) * v.zoom;
  if (!(k > 0)) return null;
  const ox = (cssW - (MAP_W + MAP_H) * k) / 2 + MAP_H * k + v.panX;
  const oy = (cssH - ((MAP_W + MAP_H) * k) / 2) / 2 + v.panY;
  const wx = cssX - ox;
  const wy = cssY - oy;
  const a = (wy * 2) / k; // gx+gy
  const b = wx / k; // gx-gy
  const x = Math.floor((a + b) / 2);
  const y = Math.floor((a - b) / 2);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
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

/* ═════════════ 等距 3D 渲染（场景 tab / mini widget；参考稿：iso 房间盒子 + 白家具 + 木地板） ═════════════ */

const ISO_FLOOR_A = '#e2c497';
const ISO_FLOOR_B = '#d6b788';
const ISO_FLOOR_LINE = 'rgba(122,92,54,0.13)';
const ISO_WALL_R = '#eef0f3';
const ISO_WALL_L = '#e2e5ea';
const ISO_WALL_TOP = '#fbfcfd';
const ISO_WALL_TRIM = '#d2d6dc';
const ISO_BOX_TOP = '#f8f6f1';
const ISO_BOX_LEFT = '#e3ded4';
const ISO_BOX_RIGHT = '#cdc8bd';
const ISO_CHAIR_TOP = '#f1f1ee';
const ISO_CHAIR_SIDE = '#d3d3cf';

/** 每格半宽像素 k：格投影宽 2k、高 k（经典 2:1 等距）。 */
function isoFit(cssW: number, cssH: number, zoom: number): number {
  return Math.min(cssW / (MAP_W + MAP_H), (cssH * 2) / (MAP_W + MAP_H)) * zoom;
}

function isoOrigin(cssW: number, cssH: number, k: number, panX: number, panY: number): { ox: number; oy: number } {
  return {
    ox: (cssW - (MAP_W + MAP_H) * k) / 2 + MAP_H * k + panX,
    oy: (cssH - ((MAP_W + MAP_H) * k) / 2) / 2 + panY,
  };
}

/** 格角 (gx,gy) → 屏幕点。 */
function isoCorner(ox: number, oy: number, k: number, gx: number, gy: number): { x: number; y: number } {
  return { x: ox + (gx - gy) * k, y: oy + ((gx + gy) * k) / 2 };
}

function isoPoly(ctx: CanvasRenderingContext2D, pts: Array<{ x: number; y: number }>): void {
  ctx.beginPath();
  pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.closePath();
}

/**
 * 等距长方体：底面 = 格矩形 (fx,fy,w,d)，高 hPx。
 * 画右前面、左前面、顶面（画家顺序），返回顶面中心投影点（供摆放物件）。
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
  // 左前面（c01→c11）
  ctx.fillStyle = left;
  isoPoly(ctx, [c01, c11, { x: c11.x, y: c11.y - h }, { x: c01.x, y: c01.y - h }]);
  ctx.fill();
  // 右前面（c11→c10）
  ctx.fillStyle = right;
  isoPoly(ctx, [c11, c10, { x: c10.x, y: c10.y - h }, { x: c11.x, y: c11.y - h }]);
  ctx.fill();
  // 顶面
  ctx.fillStyle = top;
  isoPoly(ctx, [
    { x: c00.x, y: c00.y - h },
    { x: c10.x, y: c10.y - h },
    { x: c11.x, y: c11.y - h },
    { x: c01.x, y: c01.y - h },
  ]);
  ctx.fill();
  return { x: (c00.x + c11.x) / 2, y: (c00.y + c11.y) / 2 - h };
}

/** 竖立平行四边形板（沿 gx 方向，底边在 gyBase，向上 hPx）：白板/玻璃隔断/椅背通用。 */
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

/** iso 底影（贴地椭圆，压扁 1/2）。 */
function isoShadow(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number): void {
  ctx.fillStyle = 'rgba(70,62,48,0.14)';
  ctx.beginPath();
  ctx.ellipse(x, y, rx, rx * 0.5, 0, 0, Math.PI * 2);
  ctx.fill();
}

/** iso 静态层：木地板菱形网格 + 斑块 + 两面背墙 + 画布外框。 */
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

  // 可见格范围：画布四角逆投影，外扩 2 格
  const inv = (sx: number, sy: number): { gx: number; gy: number } => {
    const wx = sx - ox;
    const wy = sy - oy;
    const a = (wy * 2) / k;
    const b = wx / k;
    return { gx: (a + b) / 2, gy: (a - b) / 2 };
  };
  const corners = [inv(0, 0), inv(cssW, 0), inv(0, cssH), inv(cssW, cssH)];
  const gxs = corners.map((p) => p.gx);
  const gys = corners.map((p) => p.gy);
  const x0 = Math.floor(Math.min(...gxs)) - 2;
  const x1 = Math.ceil(Math.max(...gxs)) + 2;
  const y0 = Math.floor(Math.min(...gys)) - 2;
  const y1 = Math.ceil(Math.max(...gys)) + 2;

  // 木地板：菱形双色 + 沿 gx 方向木纹线（参考稿暖木条）
  for (let gy = y0; gy <= y1; gy++) {
    for (let gx = x0; gx <= x1; gx++) {
      const p00 = isoCorner(ox, oy, k, gx, gy);
      const p10 = isoCorner(ox, oy, k, gx + 1, gy);
      const p11 = isoCorner(ox, oy, k, gx + 1, gy + 1);
      const p01 = isoCorner(ox, oy, k, gx, gy + 1);
      c.fillStyle = (gx + gy) % 2 === 0 ? ISO_FLOOR_A : ISO_FLOOR_B;
      isoPoly(c, [p00, p10, p11, p01]);
      c.fill();
      c.strokeStyle = ISO_FLOOR_LINE;
      c.lineWidth = 1;
      c.beginPath();
      c.moveTo(p00.x, p00.y);
      c.lineTo(p10.x, p10.y);
      c.stroke();
      // 确定性斑块（同 2D 规则）：亮斑 / 暗斑
      const t = patchTypeAt(gx, gy);
      if (t === 1) {
        c.fillStyle = 'rgba(255,255,255,0.30)';
        const q = isoCorner(ox, oy, k, gx + 0.25, gy + 0.2);
        isoPoly(c, [q, { x: q.x + k * 0.5, y: q.y + k * 0.25 }, { x: q.x, y: q.y + k * 0.5 }, { x: q.x - k * 0.5, y: q.y + k * 0.25 }]);
        c.fill();
      } else if (t === 2) {
        c.fillStyle = 'rgba(140,105,60,0.14)';
        const q = isoCorner(ox, oy, k, gx + 0.2, gy + 0.45);
        isoPoly(c, [q, { x: q.x + k * 0.45, y: q.y + k * 0.22 }, { x: q.x, y: q.y + k * 0.44 }, { x: q.x - k * 0.45, y: q.y + k * 0.22 }]);
        c.fill();
      }
    }
  }

  // 两面背墙：右后墙沿 gy=0（corner(0,0)→corner(W,0)），左后墙沿 gx=0（稍暗）；高 3k
  const WALL_H = k * 3;
  const wBase0 = isoCorner(ox, oy, k, 0, 0);
  const wBaseW = isoCorner(ox, oy, k, MAP_W, 0);
  const wBaseH = isoCorner(ox, oy, k, 0, MAP_H);
  // 右后墙（面向左下）
  c.fillStyle = ISO_WALL_R;
  isoPoly(c, [wBase0, wBaseW, { x: wBaseW.x, y: wBaseW.y - WALL_H }, { x: wBase0.x, y: wBase0.y - WALL_H }]);
  c.fill();
  // 左后墙（面向右下）
  c.fillStyle = ISO_WALL_L;
  isoPoly(c, [wBase0, wBaseH, { x: wBaseH.x, y: wBaseH.y - WALL_H }, { x: wBase0.x, y: wBase0.y - WALL_H }]);
  c.fill();
  // 墙顶高光条 + 底部踢脚线
  c.strokeStyle = ISO_WALL_TOP;
  c.lineWidth = Math.max(2, k * 0.14);
  c.beginPath();
  c.moveTo(wBaseH.x, wBaseH.y - WALL_H);
  c.lineTo(wBase0.x, wBase0.y - WALL_H);
  c.lineTo(wBaseW.x, wBaseW.y - WALL_H);
  c.stroke();
  c.strokeStyle = ISO_WALL_TRIM;
  c.lineWidth = Math.max(1.5, k * 0.08);
  c.beginPath();
  c.moveTo(wBaseH.x, wBaseH.y - 1);
  c.lineTo(wBase0.x, wBase0.y - 1);
  c.lineTo(wBaseW.x, wBaseW.y - 1);
  c.stroke();

  // 画布圆角外框（同 2D，柔和收边）
  const fr = Math.max(6, k * 0.5);
  c.fillStyle = 'rgba(70,62,48,0.08)';
  rr(c, 1.5, 3, cssW - 3, cssH - 3, fr);
  c.fill();
  const lw = Math.max(1.5, k * 0.06);
  c.strokeStyle = 'rgba(122,112,92,0.30)';
  c.lineWidth = lw;
  rr(c, lw / 2, lw / 2, cssW - lw, cssH - lw, fr);
  c.stroke();
  return layer;
}

/* ───────────── iso 家具 ───────────── */

function isoDrawDesk(ctx: CanvasRenderingContext2D, f: Furniture, ox: number, oy: number, k: number, time: number): void {
  const cFront = isoCorner(ox, oy, k, f.x + 1, f.y + 2);
  isoShadow(ctx, cFront.x, cFront.y, k * 1.05);
  // 桌腿（两个前角细柱）
  const legH = k * 0.5;
  ctx.strokeStyle = '#b8b2a6';
  ctx.lineWidth = Math.max(1.5, k * 0.07);
  const legL = isoCorner(ox, oy, k, f.x + 0.12, f.y + 0.95);
  const legR = isoCorner(ox, oy, k, f.x + 1.88, f.y + 0.95);
  ctx.beginPath();
  ctx.moveTo(legL.x, legL.y);
  ctx.lineTo(legL.x, legL.y - legH);
  ctx.moveTo(legR.x, legR.y);
  ctx.lineTo(legR.x, legR.y - legH);
  ctx.stroke();
  // 桌板（2×1 顶行，厚 0.5k，白色顶面）
  isoBoxAt(ctx, ox, oy, k, f.x, f.y, 2, 1, legH, ISO_BOX_TOP, ISO_BOX_LEFT, ISO_BOX_RIGHT);
  // 显示器：立于桌板左半格，屏面（右前面）发光
  const glow = 0.24 + 0.1 * Math.sin(time * 1.8 + f.x * 1.7 + f.y);
  const monC = isoBoxAt(ctx, ox, oy, k, f.x + 0.25, f.y + 0.32, 0.62, 0.16, k * 0.4, '#3a414b', '#2e343c', '#2e343c');
  // 屏幕发光面：显示器盒右前面内缩
  const s1 = isoCorner(ox, oy, k, f.x + 0.31, f.y + 0.48);
  const s2 = isoCorner(ox, oy, k, f.x + 0.81, f.y + 0.48);
  ctx.fillStyle = `rgba(190,225,250,${(glow + 0.35).toFixed(3)})`;
  isoPoly(ctx, [s1, s2, { x: s2.x, y: s2.y - k * 0.3 }, { x: s1.x, y: s1.y - k * 0.3 }]);
  ctx.fill();
  ctx.fillStyle = 'rgba(160,210,245,0.5)';
  isoPoly(ctx, [s1, s2, { x: s2.x, y: s2.y - k * 0.12 }, { x: s1.x, y: s1.y - k * 0.12 }]);
  ctx.fill();
  // 马克杯（桌板右侧）：小圆柱
  const cup = isoCorner(ox, oy, k, f.x + 1.55, f.y + 0.45);
  ctx.fillStyle = '#e8654f';
  ctx.beginPath();
  ctx.ellipse(cup.x, cup.y - k * 0.16, k * 0.09, k * 0.045, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(cup.x - k * 0.09, cup.y - k * 0.16, k * 0.18, k * 0.14);
  ctx.beginPath();
  ctx.ellipse(cup.x, cup.y - k * 0.02, k * 0.09, k * 0.045, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.fillRect(cup.x - k * 0.06, cup.y - k * 0.15, Math.max(1, k * 0.03), k * 0.12);
  // 椅子（下排左格中心）：座垫小盒 + 椅背竖板（白椅）
  const seat = isoBoxAt(ctx, ox, oy, k, f.x + 0.18, f.y + 1.25, 0.64, 0.5, k * 0.22, ISO_CHAIR_TOP, ISO_CHAIR_SIDE, ISO_CHAIR_SIDE);
  ctx.strokeStyle = '#c4c4c0';
  ctx.lineWidth = Math.max(1.5, k * 0.06);
  ctx.beginPath();
  ctx.moveTo(seat.x, seat.y + k * 0.1);
  ctx.lineTo(seat.x, seat.y + k * 0.34);
  ctx.stroke();
  isoSlabAlongX(ctx, ox, oy, k, f.x + 0.18, f.y + 1.72, 0.64, k * 0.5);
  ctx.fillStyle = ISO_CHAIR_TOP;
  ctx.fill();
  ctx.strokeStyle = '#c9c9c5';
  ctx.lineWidth = 1;
  ctx.stroke();
}

function isoDrawWhiteboard(ctx: CanvasRenderingContext2D, f: Furniture, ox: number, oy: number, k: number): void {
  const base = isoCorner(ox, oy, k, f.x + 1, f.y + 1.1);
  isoShadow(ctx, base.x, base.y, k * 0.95);
  // 支脚
  ctx.strokeStyle = '#8b93a1';
  ctx.lineWidth = Math.max(1.5, k * 0.06);
  const f1 = isoCorner(ox, oy, k, f.x + 0.15, f.y + 0.9);
  const f2 = isoCorner(ox, oy, k, f.x + 1.85, f.y + 0.9);
  ctx.beginPath();
  ctx.moveTo(f1.x, f1.y);
  ctx.lineTo(f1.x, f1.y - k * 0.85);
  ctx.moveTo(f2.x, f2.y);
  ctx.lineTo(f2.x, f2.y - k * 0.85);
  ctx.stroke();
  // 板面（2 格宽竖板）
  isoSlabAlongX(ctx, ox, oy, k, f.x, f.y + 0.9, 2, k * 0.95);
  ctx.fillStyle = '#5b6470';
  ctx.fill();
  isoSlabAlongX(ctx, ox, oy, k, f.x + 0.06, f.y + 0.9, 1.88, k * 0.83);
  ctx.fillStyle = '#fdfdfc';
  ctx.fill();
  // 板书（沿板面方向的横线：蓝 + 红）
  const line = (t0: number, t1: number, yUp: number, color: string): void => {
    const a = isoCorner(ox, oy, k, f.x + t0, f.y + 0.88);
    const b = isoCorner(ox, oy, k, f.x + t1, f.y + 0.88);
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1.5, k * 0.06);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y - yUp);
    ctx.lineTo(b.x, b.y - yUp);
    ctx.stroke();
  };
  line(0.25, 0.75, k * 0.62, '#4a90d9');
  line(0.25, 0.6, k * 0.45, '#4a90d9');
  line(0.95, 1.35, k * 0.62, '#e14d4d');
  line(0.95, 1.2, k * 0.45, '#e14d4d');
}

function isoDrawPlant(ctx: CanvasRenderingContext2D, f: Furniture, ox: number, oy: number, k: number): void {
  const base = isoCorner(ox, oy, k, f.x + 0.5, f.y + 0.75);
  isoShadow(ctx, base.x, base.y, k * 0.32);
  // 花盆（梯形身 + 口沿）
  ctx.fillStyle = POT_BODY;
  ctx.beginPath();
  ctx.moveTo(base.x - k * 0.2, base.y - k * 0.42);
  ctx.lineTo(base.x + k * 0.2, base.y - k * 0.42);
  ctx.lineTo(base.x + k * 0.14, base.y);
  ctx.lineTo(base.x - k * 0.14, base.y);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = POT_RIM;
  ctx.beginPath();
  ctx.ellipse(base.x, base.y - k * 0.42, k * 0.2, k * 0.09, 0, 0, Math.PI * 2);
  ctx.fill();
  // 叶片（三片大椭圆，不同角度）
  const leaf = (dx: number, dy: number, rw: number, rh: number, rot: number, color: string): void => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.ellipse(base.x + dx, base.y - k * 0.62 + dy, rw, rh, rot, 0, Math.PI * 2);
    ctx.fill();
  };
  leaf(-k * 0.22, -k * 0.1, k * 0.16, k * 0.34, -0.5, LEAF_BACK);
  leaf(k * 0.2, -k * 0.06, k * 0.16, k * 0.36, 0.45, LEAF_MID);
  leaf(0, -k * 0.22, k * 0.15, k * 0.4, 0, LEAF_FRONT);
  leaf(-k * 0.05, -k * 0.14, k * 0.07, k * 0.18, -0.2, LEAF_LIT);
}

function isoDrawCoffee(ctx: CanvasRenderingContext2D, f: Furniture, ox: number, oy: number, k: number, time: number): void {
  const base = isoCorner(ox, oy, k, f.x + 0.5, f.y + 0.8);
  isoShadow(ctx, base.x, base.y, k * 0.36);
  isoBoxAt(ctx, ox, oy, k, f.x + 0.16, f.y + 0.2, 0.68, 0.6, k * 0.55, '#77808f', '#5b6470', '#4b5563');
  // 正面（右前面）出咖啡口 + 接杯台
  const fr1 = isoCorner(ox, oy, k, f.x + 0.84, f.y + 0.66);
  ctx.fillStyle = '#374151';
  ctx.beginPath();
  ctx.moveTo(fr1.x - k * 0.16, fr1.y - k * 0.4);
  ctx.lineTo(fr1.x, fr1.y - k * 0.34);
  ctx.lineTo(fr1.x, fr1.y - k * 0.16);
  ctx.lineTo(fr1.x - k * 0.16, fr1.y - k * 0.22);
  ctx.closePath();
  ctx.fill();
  // 指示灯（顶面）
  const pulse = 0.3 + 0.25 * Math.sin(time * 2.4 + f.x);
  const lamp = isoCorner(ox, oy, k, f.x + 0.3, f.y + 0.35);
  ctx.fillStyle = `rgba(255,107,107,${pulse.toFixed(3)})`;
  ctx.beginPath();
  ctx.arc(lamp.x, lamp.y - k * 0.55, k * 0.06, 0, Math.PI * 2);
  ctx.fill();
}

function isoDrawWallSeg(ctx: CanvasRenderingContext2D, f: Furniture, ox: number, oy: number, k: number): void {
  const base = isoCorner(ox, oy, k, f.x + 0.5, f.y + 0.5);
  isoShadow(ctx, base.x, base.y, k * 0.36);
  // 玻璃板（沿 gx 方向，黑框 + 半透明玻璃）
  isoSlabAlongX(ctx, ox, oy, k, f.x + 0.02, f.y + 0.5, 0.96, k * 1.1);
  ctx.fillStyle = 'rgba(52,58,66,0.9)';
  ctx.fill();
  isoSlabAlongX(ctx, ox, oy, k, f.x + 0.08, f.y + 0.5, 0.84, k * 1.0);
  ctx.fillStyle = 'rgba(188,208,222,0.5)';
  ctx.fill();
  // 竖梃
  const m1 = isoCorner(ox, oy, k, f.x + 0.36, f.y + 0.5);
  const m2 = isoCorner(ox, oy, k, f.x + 0.64, f.y + 0.5);
  ctx.strokeStyle = 'rgba(52,58,66,0.9)';
  ctx.lineWidth = Math.max(1.5, k * 0.05);
  ctx.beginPath();
  ctx.moveTo(m1.x, m1.y);
  ctx.lineTo(m1.x, m1.y - k * 1.0);
  ctx.moveTo(m2.x, m2.y);
  ctx.lineTo(m2.x, m2.y - k * 1.0);
  ctx.stroke();
}

function isoDrawMicrowave(ctx: CanvasRenderingContext2D, f: Furniture, ox: number, oy: number, k: number): void {
  const base = isoCorner(ox, oy, k, f.x + 0.5, f.y + 0.8);
  isoShadow(ctx, base.x, base.y, k * 0.36);
  isoBoxAt(ctx, ox, oy, k, f.x + 0.12, f.y + 0.22, 0.76, 0.58, k * 0.42, '#f4f5f7', '#d9dce1', '#c2c6cd');
  // 右前面：深色窗口 + 橙钮
  const w1 = isoCorner(ox, oy, k, f.x + 0.88, f.y + 0.52);
  ctx.fillStyle = '#3a4150';
  ctx.beginPath();
  ctx.moveTo(w1.x - k * 0.2, w1.y - k * 0.34);
  ctx.lineTo(w1.x, w1.y - k * 0.28);
  ctx.lineTo(w1.x, w1.y - k * 0.08);
  ctx.lineTo(w1.x - k * 0.2, w1.y - k * 0.14);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#ff8a5c';
  ctx.fillRect(w1.x - k * 0.05, w1.y - k * 0.26, Math.max(1.5, k * 0.05), k * 0.07);
}

function isoDrawFridge(ctx: CanvasRenderingContext2D, f: Furniture, ox: number, oy: number, k: number): void {
  const base = isoCorner(ox, oy, k, f.x + 0.5, f.y + 0.8);
  isoShadow(ctx, base.x, base.y, k * 0.36);
  isoBoxAt(ctx, ox, oy, k, f.x + 0.18, f.y + 0.22, 0.64, 0.56, k * 1.0, '#e8ebef', '#c9d0d9', '#b4bcc6');
  // 右前面门缝 + 双把手
  const d1 = isoCorner(ox, oy, k, f.x + 0.82, f.y + 0.78);
  ctx.strokeStyle = 'rgba(70,78,90,0.4)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(d1.x - k * 0.22, d1.y - k * 0.5);
  ctx.lineTo(d1.x, d1.y - k * 0.44);
  ctx.stroke();
  ctx.fillStyle = '#7c8593';
  ctx.fillRect(d1.x - k * 0.07, d1.y - k * 0.88, Math.max(1.5, k * 0.045), k * 0.18);
  ctx.fillRect(d1.x - k * 0.07, d1.y - k * 0.6, Math.max(1.5, k * 0.045), k * 0.3);
}

/* ───────────── iso 人物 / 气泡 ───────────── */

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
  const bob = walking ? Math.abs(Math.sin(time * 10 + c.phase)) * k * 0.07 : Math.sin(time * 2 + c.phase) * k * 0.015;
  const bobN = walking ? Math.abs(Math.sin(time * 10 + c.phase)) : 0;
  const bodyW = k * 0.5;
  const bodyH = k * 0.36;
  const headR = k * 0.21;
  const legH = sitting ? 0 : k * 0.17;
  const baseY = foot.y;

  if (c.isSelf) {
    ctx.strokeStyle = 'rgba(0, 210, 106, 0.85)';
    ctx.lineWidth = Math.max(1.5, k * 0.06);
    ctx.beginPath();
    ctx.ellipse(px, baseY + 1, k * 0.36, k * 0.16, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 1;
  }
  const shadowK = 1 - bobN * 0.15;
  ctx.fillStyle = 'rgba(0,0,0,0.12)';
  ctx.beginPath();
  ctx.ellipse(px, baseY + 1, k * 0.26 * shadowK, k * 0.11 * shadowK, 0, 0, Math.PI * 2);
  ctx.fill();

  if (!sitting) {
    const swing = walking ? Math.sin(time * 10 + c.phase) * k * 0.08 : 0;
    ctx.fillStyle = '#3a3f4a';
    ctx.fillRect(px - bodyW * 0.38 + swing, baseY - legH, bodyW * 0.26, legH);
    ctx.fillRect(px + bodyW * 0.12 - swing, baseY - legH, bodyW * 0.26, legH);
  }

  const bodyTop = baseY - legH - bodyH + bob;
  ctx.fillStyle = c.color;
  rr(ctx, px - bodyW / 2, bodyTop, bodyW, bodyH, k * 0.09);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.28)';
  ctx.fillRect(px - bodyW / 2 + k * 0.04, bodyTop + 1, bodyW - k * 0.08, Math.max(1, k * 0.045));

  const headCy = bodyTop - headR * 0.85 + bob;
  ctx.fillStyle = '#f5c99b';
  ctx.beginPath();
  ctx.arc(px, headCy, headR, 0, Math.PI * 2);
  ctx.fill();
  // 头发：上半圆盖片
  ctx.fillStyle = c.hair;
  ctx.beginPath();
  ctx.arc(px, headCy, headR + 0.5, Math.PI, Math.PI * 2);
  ctx.closePath();
  ctx.fill();
  const eyeShift = c.face * headR * 0.18;
  ctx.fillStyle = '#2b2b2b';
  const eye = Math.max(1, k * 0.045);
  ctx.fillRect(px - headR * 0.32 + eyeShift, headCy + headR * 0.05, eye, eye * 1.4);
  ctx.fillRect(px + headR * 0.32 - eye + eyeShift, headCy + headR * 0.05, eye, eye * 1.4);
  ctx.fillStyle = 'rgba(232,140,120,0.4)';
  ctx.fillRect(px + c.face * headR * 0.62 - eye * 0.5, headCy + headR * 0.28, eye, eye * 0.8);

  let haloTop = 0;
  if (c.state === 'meeting') {
    const haloY = headCy - headR - k * 0.14 + Math.sin(time * 2.5 + c.phase) * k * 0.03;
    ctx.strokeStyle = 'rgba(77,144,254,0.25)';
    ctx.lineWidth = Math.max(2.5, k * 0.1);
    ctx.beginPath();
    ctx.ellipse(px, haloY, k * 0.3, k * 0.12, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(77,144,254,0.85)';
    ctx.lineWidth = Math.max(1.2, k * 0.045);
    ctx.beginPath();
    ctx.ellipse(px, haloY, k * 0.3, k * 0.12, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 1;
    haloTop = haloY - k * 0.1;
  }

  if (c.state === 'coffee') {
    const cupW = Math.max(3, k * 0.14);
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

  if (c.state === 'meeting' && !hasBubble) {
    const efs = Math.min(12, Math.max(9, k * 0.3));
    ctx.font = `${efs}px sans-serif`;
    ctx.textAlign = 'center';
    const lift = haloTop > 0 ? headCy - haloTop + efs * 0.6 : 0;
    ctx.fillText('💬', px, headCy - headR - efs * (showNames ? 2.4 : 0.4) - lift);
    ctx.textAlign = 'left';
  }

  if (showNames) {
    const label = `${c.name}${c.isSelf ? '（我）' : ''}`;
    const fs = Math.min(12, Math.max(9, k * 0.3));
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
  return { headX: px, headY: headCy - headR };
}

/** iso 气泡：锚头顶点，默认头左侧，贴左缘翻右侧，两侧都放不下回头顶高位。 */
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
  const pad = fs * 0.45;
  const bw = Math.max(w1, w2) + pad * 2;
  const bh = pad * 2 + lineH * (l2 ? 2 : 1);
  const gap = k * 0.62;
  let bx = hx - gap - bw;
  let by = hy - bh + k * 0.1;
  let side: 'right' | 'left' | 'top' = 'left';
  if (bx < 4) {
    bx = hx + gap;
    side = bx + bw <= cw - 4 ? 'right' : 'top';
    if (side === 'top') bx = hx - bw / 2;
  }
  if (side === 'top') by = hy - bh - k * 0.55;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = '#ffffff';
  if (side === 'top') {
    ctx.beginPath();
    ctx.moveTo(hx - fs * 0.3, by + bh - 1);
    ctx.lineTo(hx + fs * 0.3, by + bh - 1);
    ctx.lineTo(hx, by + bh + fs * 0.45);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.16)';
    ctx.stroke();
  } else {
    const ex = side === 'left' ? bx + bw : bx;
    const tipX = side === 'left' ? hx - k * 0.2 : hx + k * 0.2;
    const ey1 = Math.min(Math.max(hy - fs * 0.3, by + 4), by + bh - 4 - fs * 0.6);
    ctx.beginPath();
    ctx.moveTo(ex, ey1);
    ctx.lineTo(ex, ey1 + fs * 0.6);
    ctx.lineTo(tipX, hy - k * 0.05);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.16)';
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(40,35,25,0.10)';
  rr(ctx, bx, by + 1.5, bw, bh, fs * 0.55);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  rr(ctx, bx, by, bw, bh, fs * 0.55);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.16)';
  ctx.stroke();
  ctx.fillStyle = '#333';
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

  const staticKey = `iso:${pxW}x${pxH}@${dpr}@${v.zoom.toFixed(3)}@${Math.round(v.panX)}@${Math.round(v.panY)}`;
  let cached = staticLayers.get(canvas);
  if (cached === undefined || cached.key !== staticKey) {
    cached = { key: staticKey, layer: buildIsoStaticLayer(pxW, pxH, dpr, cssW, cssH, opts?.view) };
    staticLayers.set(canvas, cached);
  }
  ctx.drawImage(cached.layer, 0, 0, cssW, cssH);

  // 会议白板高亮（iso：白板板面外扩描边，呼吸）
  if (opts?.meeting === true) {
    const breath = 0.75 + 0.2 * Math.sin(time * 3);
    ctx.save();
    for (const f of furniture) {
      if (f.kind !== 'whiteboard') continue;
      ctx.strokeStyle = 'rgba(242, 153, 74, 0.95)';
      ctx.globalAlpha = breath;
      ctx.lineWidth = Math.max(2, k * 0.1);
      isoSlabAlongX(ctx, ox, oy, k, f.x - 0.06, f.y + 0.96, 2.12, k * 1.07);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(242, 153, 74, 1)';
      ctx.globalAlpha = breath * 0.3;
      ctx.lineWidth = Math.max(5, k * 0.22);
      isoSlabAlongX(ctx, ox, oy, k, f.x - 0.06, f.y + 0.96, 2.12, k * 1.07);
      ctx.stroke();
    }
    ctx.restore();
  }

  // 画家算法：家具与人物按 (gx+gy) 深度混排；同深度人物在后（坐在椅前层次）
  type Renderable = { depth: number; kind: 'furn' | 'char'; f?: Furniture; c?: Character };
  const items: Renderable[] = [];
  for (const f of furniture) items.push({ depth: f.x + f.y, kind: 'furn', f });
  for (const c of chars) items.push({ depth: c.rx + c.ry + 0.01, kind: 'char', c });
  items.sort((a, b) => a.depth - b.depth);

  const bubbles = opts?.bubbles;
  const hasBubble = (c: Character): boolean => {
    const b = bubbles?.get(c.id);
    return b !== undefined && b.until > time;
  };
  const bubbleAnchors = new Map<string, { headX: number; headY: number }>();
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
      }
    } else if (it.kind === 'char' && it.c !== undefined) {
      const anchor = isoDrawChar(ctx, it.c, ox, oy, k, time, showNames, hasBubble(it.c));
      if (hasBubble(it.c)) bubbleAnchors.set(it.c.id, anchor);
    }
  }

  if (bubbles !== undefined && bubbles.size > 0) {
    for (const [id, b] of bubbles) {
      if (b.until <= time) continue;
      const anchor = bubbleAnchors.get(id);
      if (anchor === undefined) continue;
      isoDrawBubble(ctx, b.text, k, anchor.headX, anchor.headY, b.until - time, cssW);
    }
  }
}
