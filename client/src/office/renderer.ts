/**
 * canvas 2D 渲染器 —— 像素风自绘（零依赖、避开 PixOffice 版权素材）。
 * 只读引擎的浮点坐标做插值绘制；逻辑仍在整数格（renderer 不参与决策）。
 * P2：气泡绘制（最上层）、会议中白板高亮、头顶 💬 兜底、cellAtPoint 点击换算。
 */
import { MAP_H, MAP_W } from './map.js';
import type { Character, Furniture, Vec } from './types.js';

const FLOOR_A = '#efeae0';
const FLOOR_B = '#e7e1d3';

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(x, y, w, h, r);
  } else {
    ctx.rect(x, y, w, h);
  }
}

/* ───────────── 点击换算 ───────────── */

/**
 * 点击坐标（CSS 像素）→ 地图格：scale = min(cssW/MAP_W, cssH/MAP_H) 居中，
 * 与 renderOffice 完全同一套数学。墙环与界外返回 null（点击层不响应）。
 */
export function cellAtPoint(cssX: number, cssY: number, cssW: number, cssH: number): Vec | null {
  const scale = Math.min(cssW / MAP_W, cssH / MAP_H);
  if (!(scale > 0)) return null;
  const ox = (cssW - scale * MAP_W) / 2;
  const oy = (cssH - scale * MAP_H) / 2;
  const x = Math.floor((cssX - ox) / scale);
  const y = Math.floor((cssY - oy) / scale);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  if (x <= 0 || y <= 0 || x >= MAP_W - 1 || y >= MAP_H - 1) return null;
  return { x, y };
}

/* ───────────── 家具 ───────────── */

function drawDesk(ctx: CanvasRenderingContext2D, f: Furniture, s: number, ox: number, oy: number): void {
  const X = ox + f.x * s;
  const Y = oy + f.y * s;
  // 桌面（上排两格）
  ctx.fillStyle = '#b98a5a';
  ctx.fillRect(X + 1, Y + 1, s * 2 - 2, s - 2);
  ctx.fillStyle = '#c89b6d';
  ctx.fillRect(X + 1, Y + 1, s * 2 - 2, Math.max(2, s * 0.18));
  // 显示器（上排左格，正对椅位）
  const mw = s * 0.6;
  const mh = s * 0.42;
  const mx = X + s * 0.2;
  const my = Y + s * 0.14;
  ctx.fillStyle = '#2f3640';
  ctx.fillRect(mx, my, mw, mh);
  ctx.fillStyle = '#8fd3b6';
  ctx.fillRect(mx + 2, my + 2, mw - 4, mh - 4);
  ctx.fillStyle = '#2f3640';
  ctx.fillRect(mx + mw / 2 - s * 0.05, my + mh, s * 0.1, s * 0.16);
  // 马克杯（上排右格）
  ctx.fillStyle = '#e8615a';
  ctx.fillRect(X + s * 1.55, Y + s * 0.55, s * 0.24, s * 0.2);
  // 椅位垫（下排，浅色过道）
  ctx.fillStyle = 'rgba(0,0,0,0.05)';
  ctx.fillRect(X + 1, Y + s + 1, s * 2 - 2, s - 2);
  // 椅子（下排左格）
  ctx.fillStyle = '#7d8aa0';
  rr(ctx, X + s * 0.2, Y + s + s * 0.3, s * 0.6, s * 0.45, s * 0.08);
  ctx.fill();
  ctx.fillStyle = '#68748a';
  ctx.fillRect(X + s * 0.2, Y + s + s * 0.3, s * 0.6, s * 0.12);
}

function drawWhiteboard(ctx: CanvasRenderingContext2D, f: Furniture, s: number, ox: number, oy: number): void {
  const X = ox + f.x * s;
  const Y = oy + f.y * s;
  ctx.fillStyle = '#8b93a1';
  ctx.fillRect(X + 1, Y + 1, s * 2 - 2, s - 2);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(X + s * 0.12, Y + s * 0.14, s * 1.76, s * 0.72);
  // 板书
  ctx.fillStyle = '#4a90d9';
  ctx.fillRect(X + s * 0.28, Y + s * 0.3, s * 0.6, s * 0.07);
  ctx.fillRect(X + s * 0.28, Y + s * 0.46, s * 0.42, s * 0.07);
  ctx.fillStyle = '#e14d4d';
  ctx.fillRect(X + s * 1.1, Y + s * 0.3, s * 0.5, s * 0.07);
  ctx.fillRect(X + s * 1.1, Y + s * 0.46, s * 0.3, s * 0.07);
}

function drawPlant(ctx: CanvasRenderingContext2D, f: Furniture, s: number, ox: number, oy: number): void {
  const X = ox + f.x * s;
  const Y = oy + f.y * s;
  ctx.fillStyle = '#c96f4a';
  ctx.fillRect(X + s * 0.28, Y + s * 0.6, s * 0.44, s * 0.3);
  ctx.fillStyle = '#4c8a48';
  ctx.fillRect(X + s * 0.2, Y + s * 0.34, s * 0.28, s * 0.28);
  ctx.fillStyle = '#5fa05a';
  ctx.fillRect(X + s * 0.52, Y + s * 0.26, s * 0.3, s * 0.32);
  ctx.fillStyle = '#437a40';
  ctx.fillRect(X + s * 0.38, Y + s * 0.14, s * 0.26, s * 0.26);
}

function drawCoffee(ctx: CanvasRenderingContext2D, f: Furniture, s: number, ox: number, oy: number, time: number): void {
  const X = ox + f.x * s;
  const Y = oy + f.y * s;
  ctx.fillStyle = '#6b7280';
  ctx.fillRect(X + s * 0.18, Y + s * 0.15, s * 0.64, s * 0.7);
  ctx.fillStyle = '#4b5563';
  ctx.fillRect(X + s * 0.18, Y + s * 0.15, s * 0.64, s * 0.2);
  ctx.fillStyle = '#374151';
  ctx.fillRect(X + s * 0.3, Y + s * 0.55, s * 0.4, s * 0.18);
  // 工作指示灯：呼吸闪烁
  if (Math.sin(time * 2.4) > 0) {
    ctx.fillStyle = '#ff6b6b';
    ctx.fillRect(X + s * 0.68, Y + s * 0.22, s * 0.08, s * 0.08);
  }
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

/** 头顶气泡：白底圆角矩形 + 小尾巴 + 深色字（调用方保证最后绘制，避免遮挡）。 */
function drawBubble(ctx: CanvasRenderingContext2D, c: Character, text: string, s: number, ox: number, oy: number): void {
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
  const bx = px - bw / 2;
  const by = py - s * 0.6 - bh;
  ctx.save();
  // 尾巴（向下小三角，指向头顶；先画再压矩形保证衔接）
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(px - fs * 0.3, by + bh - 1);
  ctx.lineTo(px + fs * 0.3, by + bh - 1);
  ctx.lineTo(px, by + bh + fs * 0.45);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.16)';
  ctx.stroke();
  // 白底圆角矩形
  rr(ctx, bx, by, bw, bh, fs * 0.55);
  ctx.fill();
  ctx.stroke();
  // 深色文字（居中）
  ctx.fillStyle = '#333';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(l1, px, by + pad + lineH * 0.5);
  if (l2) ctx.fillText(l2, px, by + pad + lineH * 1.5);
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
  const bob = walking
    ? Math.abs(Math.sin(time * 9 + c.phase)) * s * 0.06
    : Math.sin(time * 2 + c.phase) * s * 0.015;
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
  // 阴影
  ctx.fillStyle = 'rgba(0,0,0,0.12)';
  ctx.beginPath();
  ctx.ellipse(px, baseY + 1, s * 0.24, s * 0.08, 0, 0, Math.PI * 2);
  ctx.fill();

  // 腿（走路交替摆动）
  if (!sitting) {
    const swing = walking ? Math.sin(time * 9 + c.phase) * s * 0.1 : 0;
    ctx.fillStyle = '#3a3f4a';
    ctx.fillRect(px - bodyW * 0.38 + swing, baseY - legH, bodyW * 0.26, legH);
    ctx.fillRect(px + bodyW * 0.12 - swing, baseY - legH, bodyW * 0.26, legH);
  }

  // 身体
  const bodyTop = baseY - legH - bodyH + bob;
  ctx.fillStyle = c.color;
  rr(ctx, px - bodyW / 2, bodyTop, bodyW, bodyH, s * 0.09);
  ctx.fill();

  // 头
  const headCy = bodyTop - headR * 0.85 + bob;
  ctx.fillStyle = '#f5c99b';
  ctx.beginPath();
  ctx.arc(px, headCy, headR, 0, Math.PI * 2);
  ctx.fill();
  // 头发（头顶盖片）
  ctx.fillStyle = c.hair;
  ctx.fillRect(px - headR, headCy - headR, headR * 2, headR * 0.72);
  // 眼睛（正面两颗）
  ctx.fillStyle = '#2b2b2b';
  const eye = Math.max(1, s * 0.045);
  ctx.fillRect(px - headR * 0.32, headCy + headR * 0.05, eye, eye * 1.4);
  ctx.fillRect(px + headR * 0.32 - eye, headCy + headR * 0.05, eye, eye * 1.4);

  // 会议中且无气泡：头顶 💬 兜底标记
  if (c.state === 'meeting' && !hasBubble) {
    const efs = Math.min(12, Math.max(9, s * 0.3));
    ctx.font = `${efs}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText('💬', px, headCy - headR - efs * (showNames ? 2.4 : 0.4));
    ctx.textAlign = 'left';
  }

  // 名牌
  if (showNames) {
    const label = `${c.name}${c.isSelf ? '（我）' : ''}`;
    const fs = Math.min(12, Math.max(9, s * 0.3));
    ctx.font = `${fs}px -apple-system, "PingFang SC", sans-serif`;
    const tw = ctx.measureText(label).width;
    const bx = px - tw / 2 - 4;
    const by = headCy - headR - fs - 7;
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    rr(ctx, bx, by, tw + 8, fs + 5, 4);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.14)';
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

  const scale = Math.min(cssW / MAP_W, cssH / MAP_H);
  const ox = (cssW - scale * MAP_W) / 2;
  const oy = (cssH - scale * MAP_H) / 2;
  const showNames = opts?.showNames ?? scale >= 15;

  // 地板满铺整幅（无墙体带），外墙只留一圈细描边
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      ctx.fillStyle = (x + y) % 2 === 0 ? FLOOR_A : FLOOR_B;
      ctx.fillRect(ox + x * scale, oy + y * scale, scale + 0.5, scale + 0.5);
    }
  }
  const rim = Math.max(1.5, scale * 0.1);
  ctx.strokeStyle = 'rgba(91,100,114,0.5)';
  ctx.lineWidth = rim;
  ctx.strokeRect(rim / 2, rim / 2, cssW - rim, cssH - rim);

  // 家具
  for (const f of furniture) {
    switch (f.kind) {
      case 'desk':
        drawDesk(ctx, f, scale, ox, oy);
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
    }
  }

  // 会议进行中：白板高亮描边（家具之上、人物之下）
  if (opts?.meeting === true) {
    ctx.strokeStyle = 'rgba(242, 153, 74, 0.95)';
    ctx.lineWidth = Math.max(2, scale * 0.12);
    for (const f of furniture) {
      if (f.kind !== 'whiteboard') continue;
      rr(ctx, ox + f.x * scale + 1, oy + f.y * scale + 1, f.w * scale - 2, f.h * scale - 2, scale * 0.14);
      ctx.stroke();
    }
    ctx.lineWidth = 1;
  }

  // 人物按 y 排序（画家算法）
  const sorted = [...chars].sort((a, b) => a.ry - b.ry);
  const bubbles = opts?.bubbles;
  const hasBubble = (c: Character): boolean => {
    const b = bubbles?.get(c.id);
    return b !== undefined && b.until > time;
  };
  for (const c of sorted) drawChar(ctx, c, scale, ox, oy, time, showNames, hasBubble(c));

  // 气泡最后绘制（最上层，避免遮挡角色）
  if (bubbles !== undefined && bubbles.size > 0) {
    for (const c of sorted) {
      if (!hasBubble(c)) continue;
      const b = bubbles.get(c.id);
      if (b === undefined) continue;
      drawBubble(ctx, c, b.text, scale, ox, oy);
    }
  }
}
