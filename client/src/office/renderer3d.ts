/**
 * Three.js 真 3D 渲染（路线 B）：对齐参考图软 3D 盒景——厚白底座、木地板、厚墙、
 * 玻璃里间、iMac 工位、圆桌会议区、Q 版大头小人（真光照 + 阴影）。
 * 约定：逻辑层零改动——引擎/寻路/会话照旧；本文件只消费 engine.map.furniture + engine.chars。
 * 交互契约与 2D 兼容：cellAtPoint3D（Raycaster 拾取地板）+ clampViewPan3D（正交相机 zoom/pan）。
 */
import * as THREE from 'three';
import type { Character, Furniture, OfficeMap } from './types.js';
import { MAP_H, MAP_W } from './map.js';

/* ── 调色（对齐参考图） ── */
const C_BG = 0xf7f7f8;
const C_BASE = 0xffffff; // 厚白底座
const C_BASE_SIDE = 0xe2e4e8;
const C_FLOOR = 0xe3c191; // 木地板
const C_FLOOR_ALT = 0xdab684;
const C_WALL_L = 0xf5f6f8; // 左后墙（白）
const C_WALL_R = 0xe9ebee; // 右后墙（浅灰白，参考稿仅微差）
const C_DESK_TOP = 0xfdfdfd;
const C_DESK_SIDE = 0xe8eaee;
const C_METAL = 0xb9bec6;
const C_SCREEN = 0x2b3137;
const C_GLASS = 0xcfe0e6;
const C_FRAME = 0x5a6168;
const C_CARPET = 0xe9e2d4;
const C_POT = 0xf6f7f8;
const C_LEAF = 0x6cab5f;
const C_SKIN = 0xf8d6b3;
const C_PANTS = 0x5c6570;
const C_CHAIR = 0xf4f5f6;

/** 每个画布一份场景（家具重建仅在地图变化时）。 */
type Scene3D = {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  baseGroup: THREE.Group; // 底座+地板+墙（地图不变则不重建）
  furnGroup: THREE.Group; // 家具（地图变化重建）
  charGroup: THREE.Group; // 人物（每帧同步位置）
  charMap: Map<string, CharParts & { phase: number; lastState: string }>;
  mapSig: string; // 家具签名（数量+id 拼接），变了才重建 furnGroup
  charsSig: string; // 人物 id+颜色签名，变了才重建 charMap
  cellMeshes: THREE.Mesh; // 地板拾取面
  disposables: Array<{ dispose: () => void }>;
};

const sceneByCanvas = new WeakMap<HTMLCanvasElement, Scene3D>();

/* ── 几何工具 ── */

function roundedRectShape(w: number, h: number, r: number): THREE.Shape {
  const s = new THREE.Shape();
  const x = -w / 2;
  const y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

/** 格坐标 → 世界坐标（地图中心为原点；1 格 = 1 单位）。 */
function cellToWorld(gx: number, gy: number): { x: number; z: number } {
  return { x: gx - MAP_W / 2, z: gy - MAP_H / 2 };
}

const CELL_H = 0.5; // 家具普遍高度基数

function stdMaterial(color: number, opts?: { rough?: number; metal?: number }): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: opts?.rough ?? 0.85, metalness: opts?.metal ?? 0.05 });
}

/* ── 静态层：底座 + 木地板 + 墙 ── */

function buildBase(map: OfficeMap, disposables: Array<{ dispose: () => void }>): THREE.Group {
  const g = new THREE.Group();
  // 厚白底座（圆角挤出）
  const shape = roundedRectShape(MAP_W + 1.6, MAP_H + 1.6, 0.9);
  const extrude = new THREE.ExtrudeGeometry(shape, { depth: 0.9, bevelEnabled: true, bevelSize: 0.12, bevelThickness: 0.12, bevelSegments: 3, curveSegments: 8 });
  const baseMat = stdMaterial(C_BASE, { rough: 0.6 });
  const base = new THREE.Mesh(extrude, baseMat);
  base.rotation.x = -Math.PI / 2;
  base.position.set(0, -1.24, 0); // 顶面 ≈ -0.1：必须低于地板面，否则白座埋掉木地板
  g.add(base);
  disposables.push(extrude, baseMat);

  // 木地板：条状交替色
  const floorGroup = new THREE.Group();
  for (let gy = 0; gy < MAP_H; gy++) {
    const color = (gy >> 1) % 2 === 0 ? C_FLOOR : C_FLOOR_ALT;
    const geo = new THREE.BoxGeometry(MAP_W, 0.08, 1);
    const mat = stdMaterial(color, { rough: 0.9 });
    const m = new THREE.Mesh(geo, mat);
    const { x, z } = cellToWorld(MAP_W / 2, gy + 0.5);
    m.position.set(x, 0.04, z);
    floorGroup.add(m);
    disposables.push(geo, mat);
  }
  g.add(floorGroup);

  // 两面厚墙（gx=0 左白 / gy=0 右灰），厚 0.45 高 3.4
  const wallThick = 0.45;
  const wallH = 2.9;
  const mkWall = (w: number, d: number, color: number): void => {
    const geo = new THREE.BoxGeometry(w, wallH, d);
    const mat = stdMaterial(color, { rough: 0.95 });
    const m = new THREE.Mesh(geo, mat);
    m.position.y = wallH / 2;
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
    disposables.push(geo, mat);
  };
  const wL = cellToWorld(0 + wallThick / 2, MAP_H / 2); // gx=0 面
  mkWall(wallThick, MAP_H, C_WALL_L);
  (g.children[g.children.length - 1] as THREE.Mesh).position.set(wL.x, wallH / 2, wL.z);
  const wR = cellToWorld(MAP_W / 2, wallThick / 2); // gy=0 面
  mkWall(MAP_W, wallThick, C_WALL_R);
  (g.children[g.children.length - 1] as THREE.Mesh).position.set(wR.x, wallH / 2, wR.z);
  return g;
}

/* ── 家具构建 ── */

function box(w: number, h: number, d: number, color: number, opts?: { rough?: number; metal?: number; transparent?: number }): THREE.Mesh {
  const geo = new THREE.BoxGeometry(w, h, d);
  const mat = opts?.transparent !== undefined
    ? new THREE.MeshStandardMaterial({ color, roughness: 0.15, metalness: 0.1, transparent: true, opacity: opts.transparent })
    : stdMaterial(color, opts);
  return new THREE.Mesh(geo, mat);
}

function addShadowed(g: THREE.Group, mesh: THREE.Mesh, x: number, z: number, y: number): void {
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  g.add(mesh);
}

function buildDesk(g: THREE.Group, f: Furniture, disposables: Array<{ dispose: () => void }>): void {
  const { x, z } = cellToWorld(f.x + 1, f.y + 0.5); // 桌面行中心
  // 桌板
  const top = box(2, 0.12, 1, C_DESK_TOP);
  addShadowed(g, top, x, z, 0.62);
  // 四腿
  for (const [dx, dz] of [[-0.85, -0.38], [0.85, -0.38], [-0.85, 0.38], [0.85, 0.38]] as const) {
    const leg = box(0.08, 0.6, 0.08, C_METAL, { metal: 0.4, rough: 0.4 });
    addShadowed(g, leg, x + dx, z + dz, 0.3);
  }
  // iMac：白壳 + 深屏 + 银下巴 + 底座
  const imac = new THREE.Group();
  const shell = box(0.78, 0.52, 0.05, 0xfbfcfd);
  shell.position.y = 0.95;
  const screen = box(0.66, 0.38, 0.02, C_SCREEN);
  screen.position.set(0, 0.99, 0.028);
  const chin = box(0.66, 0.07, 0.03, 0xdfe3e7);
  chin.position.set(0, 0.745, 0.03);
  const stand = box(0.08, 0.22, 0.05, C_METAL);
  stand.position.set(0, 0.68 - 0.11, 0);
  const foot = box(0.3, 0.03, 0.16, 0xe8eaed);
  foot.position.set(0, 0.685, 0);
  imac.add(shell, screen, chin, stand, foot);
  imac.position.set(x - 0.25, 0, z - 0.1); // 屏面默认朝 +z（房内/相机）
  g.add(imac);
  for (const m of [shell, screen, chin, stand, foot]) disposables.push(m.geometry, m.material as THREE.Material);
  // 键盘 + 杯
  const kb = box(0.42, 0.03, 0.14, 0xf2f3f5);
  addShadowed(g, kb, x + 0.1, z + 0.22, 0.7);
  const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.06, 0.12, 12), stdMaterial(0xffffff));
  addShadowed(g, cup, x + 0.6, z + 0.15, 0.74);
  disposables.push(cup.geometry, cup.material as THREE.Material, kb.geometry, kb.material as THREE.Material);
  // 桌下三屉柜（右半）
  const cab = box(0.75, 0.5, 0.85, 0xf4f5f6);
  addShadowed(g, cab, x + 0.55, z + 0.55, 0.25);
  disposables.push(cab.geometry, cab.material as THREE.Material);
  // 办公椅（椅位在桌面行下一格中心，面朝桌）
  const chair = buildOfficeChair(disposables);
  const cp = cellToWorld(f.x + 0.5, f.y + 1.5);
  chair.position.set(cp.x, 0, cp.z);
  chair.rotation.y = Math.PI; // 背朝南、面朝桌（桌在北）
  g.add(chair);
}

function buildOfficeChair(disposables: Array<{ dispose: () => void }>): THREE.Group {
  const g = new THREE.Group();
  const seat = box(0.5, 0.07, 0.5, C_CHAIR);
  seat.position.y = 0.42;
  const back = box(0.48, 0.55, 0.07, C_CHAIR);
  back.position.set(0, 0.72, -0.22);
  const post = box(0.07, 0.28, 0.07, C_METAL, { metal: 0.5, rough: 0.35 });
  post.position.y = 0.26;
  const footGeo = new THREE.CylinderGeometry(0.28, 0.32, 0.05, 5);
  const footMat = stdMaterial(C_METAL, { metal: 0.5, rough: 0.35 });
  const star = new THREE.Mesh(footGeo, footMat);
  star.position.y = 0.04;
  g.add(seat, back, post, star);
  disposables.push(seat.geometry, seat.material as THREE.Material, back.geometry, back.material as THREE.Material, post.geometry, post.material as THREE.Material, footGeo, footMat);
  return g;
}

function buildWallSeg(g: THREE.Group, f: Furniture, disposables: Array<{ dispose: () => void }>): void {
  const { x, z } = cellToWorld(f.x + 0.5, f.y + 0.5);
  const H = 2.2;
  // 玻璃面（沿 x 向，1 格宽；参考稿通透大整面）
  const glass = box(0.99, H - 0.06, 0.03, 0xe6eef1, { transparent: 0.32 });
  addShadowed(g, glass, x, z, H / 2);
  // 黑框：上下横梁 + 竖梃
  const frame = (w: number, h: number, d: number, px: number, pz: number, py: number): void => {
    const m = box(w, h, d, C_FRAME, { rough: 0.5, metal: 0.3 });
    addShadowed(g, m, px, pz, py);
    disposables.push(m.geometry, m.material as THREE.Material);
  };
  frame(1.04, 0.055, 0.06, x, z, H);
  frame(1.04, 0.055, 0.06, x, z, 0.028);
  frame(0.04, H, 0.06, x - 0.5, z, H / 2);
  frame(0.04, H, 0.06, x + 0.5, z, H / 2);
  disposables.push(glass.geometry, glass.material as THREE.Material);
}

function buildRoundTable(g: THREE.Group, f: Furniture, disposables: Array<{ dispose: () => void }>): void {
  const { x, z } = cellToWorld(f.x + f.w / 2, f.y + f.h / 2);
  const topGeo = new THREE.CylinderGeometry(1.05, 1.05, 0.09, 32);
  const topMat = stdMaterial(0xffffff, { rough: 0.5 });
  const top = new THREE.Mesh(topGeo, topMat);
  addShadowed(g, top, x, z, 0.78);
  const postGeo = new THREE.CylinderGeometry(0.1, 0.12, 0.75, 12);
  const postMat = stdMaterial(C_METAL, { metal: 0.4 });
  const post = new THREE.Mesh(postGeo, postMat);
  addShadowed(g, post, x, z, 0.375);
  const baseGeo = new THREE.CylinderGeometry(0.42, 0.46, 0.06, 24);
  const baseMat = stdMaterial(C_DESK_SIDE);
  const base = new THREE.Mesh(baseGeo, baseMat);
  addShadowed(g, base, x, z, 0.03);
  disposables.push(topGeo, topMat, postGeo, postMat, baseGeo, baseMat);
  // 四把餐椅
  for (const [dx, dz, rot] of [[-1.3, 0, Math.PI / 2], [1.3, 0, -Math.PI / 2], [0, -1.3, 0], [0, 1.3, Math.PI]] as const) {
    const ch = new THREE.Group();
    const seat = box(0.45, 0.06, 0.45, C_CHAIR);
    seat.position.y = 0.45;
    const back = box(0.43, 0.5, 0.06, C_CHAIR);
    back.position.set(0, 0.72, -0.2);
    for (const [lx, lz] of [[-0.18, -0.18], [0.18, -0.18], [-0.18, 0.18], [0.18, 0.18]] as const) {
      const leg = box(0.05, 0.45, 0.05, 0xd8cbb4);
      leg.position.set(lx, 0.225, lz);
      ch.add(leg);
      disposables.push(leg.geometry, leg.material as THREE.Material);
    }
    ch.add(seat, back);
    ch.position.set(x + dx, 0, z + dz);
    ch.rotation.y = rot;
    ch.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    g.add(ch);
    disposables.push(seat.geometry, seat.material as THREE.Material, back.geometry, back.material as THREE.Material);
  }
}

function buildCarpet(g: THREE.Group, f: Furniture, disposables: Array<{ dispose: () => void }>): void {
  const geo = new THREE.BoxGeometry(f.w - 0.15, 0.05, f.h - 0.15);
  const mat = stdMaterial(C_CARPET, { rough: 1 });
  const m = new THREE.Mesh(geo, mat);
  const { x, z } = cellToWorld(f.x + f.w / 2, f.y + f.h / 2);
  m.position.set(x, 0.045, z);
  m.receiveShadow = true;
  g.add(m);
  disposables.push(geo, mat);
}

function buildPlant(g: THREE.Group, f: Furniture, disposables: Array<{ dispose: () => void }>): void {
  const { x, z } = cellToWorld(f.x + 0.5, f.y + 0.5);
  const potGeo = new THREE.CylinderGeometry(0.22, 0.16, 0.4, 16);
  const potMat = stdMaterial(C_POT);
  const pot = new THREE.Mesh(potGeo, potMat);
  addShadowed(g, pot, x, z, 0.2);
  // 叶丛：3-5 个绿球
  const leafMat = stdMaterial(C_LEAF, { rough: 0.7 });
  const blobs: ReadonlyArray<readonly [number, number, number, number]> = [
    [0, 0.78, 0, 0.34],
    [0.16, 0.62, 0.1, 0.24],
    [-0.15, 0.66, -0.08, 0.26],
    [0.02, 1.02, -0.05, 0.22],
    [-0.06, 0.9, 0.12, 0.2],
  ];
  for (const [dx, dy, dz, r] of blobs) {
    const geo = new THREE.SphereGeometry(r, 12, 10);
    const m = new THREE.Mesh(geo, leafMat);
    m.position.set(x + dx, dy, z + dz);
    m.castShadow = true;
    g.add(m);
    disposables.push(geo);
  }
  disposables.push(potGeo, potMat, leafMat);
}

function buildWhiteboard(g: THREE.Group, f: Furniture, disposables: Array<{ dispose: () => void }>): void {
  const { x, z } = cellToWorld(f.x + 1, f.y + 0.5);
  const board = box(1.9, 1.1, 0.06, 0xfdfdfc);
  addShadowed(g, board, x, z, 1.35);
  const frame = box(1.96, 1.16, 0.04, 0xdfe3e8);
  addShadowed(g, frame, x, z, 1.35);
  frame.position.z = z - 0.005;
  for (const lx of [-0.8, 0.8]) {
    const leg = box(0.06, 0.85, 0.06, C_METAL);
    addShadowed(g, leg, x + lx, z, 0.425);
    disposables.push(leg.geometry, leg.material as THREE.Material);
  }
  disposables.push(board.geometry, board.material as THREE.Material, frame.geometry, frame.material as THREE.Material);
}

function buildCoffee(g: THREE.Group, f: Furniture, disposables: Array<{ dispose: () => void }>): void {
  const { x, z } = cellToWorld(f.x + 0.5, f.y + 0.5);
  const body = box(0.6, 0.62, 0.5, 0xf7f8f9);
  addShadowed(g, body, x, z, 0.31);
  const panel = box(0.18, 0.2, 0.04, 0x3f464e);
  addShadowed(g, panel, x + 0.12, z + 0.26, 0.4);
  disposables.push(body.geometry, body.material as THREE.Material, panel.geometry, panel.material as THREE.Material);
}

function buildFridge(g: THREE.Group, f: Furniture, disposables: Array<{ dispose: () => void }>): void {
  const { x, z } = cellToWorld(f.x + 0.5, f.y + 0.5);
  const body = box(0.65, 1.5, 0.6, 0xf7f8f9);
  addShadowed(g, body, x, z, 0.75);
  const handle = box(0.05, 0.5, 0.04, C_METAL);
  addShadowed(g, handle, x + 0.28, z + 0.3, 0.85);
  disposables.push(body.geometry, body.material as THREE.Material, handle.geometry, handle.material as THREE.Material);
}

function buildMicrowave(g: THREE.Group, f: Furniture, disposables: Array<{ dispose: () => void }>): void {
  const { x, z } = cellToWorld(f.x + 0.5, f.y + 0.5);
  const body = box(0.6, 0.4, 0.45, 0xf8f9fa);
  addShadowed(g, body, x, z, 0.2);
  const door = box(0.3, 0.24, 0.03, 0x3d444c);
  addShadowed(g, door, x - 0.08, z + 0.23, 0.2);
  disposables.push(body.geometry, body.material as THREE.Material, door.geometry, door.material as THREE.Material);
}

function buildCabinet(g: THREE.Group, f: Furniture, disposables: Array<{ dispose: () => void }>): void {
  const { x, z } = cellToWorld(f.x + 0.5, f.y + 0.5);
  const body = box(0.55, 0.72, 0.5, 0xfbfcfd);
  addShadowed(g, body, x, z, 0.36);
  for (let i = 1; i <= 2; i++) {
    const seam = box(0.4, 0.02, 0.02, 0xc6cbd1);
    addShadowed(g, seam, x, z + 0.26, 0.24 * i + 0.1);
    disposables.push(seam.geometry, seam.material as THREE.Material);
  }
  disposables.push(body.geometry, body.material as THREE.Material);
}

/* ── 人物（Q 版小人：大头 + 圆身 + 双臂双鞋，参考稿大头娃娃） ── */

type CharParts = {
  root: THREE.Group;
  head: THREE.Group; // 头组（含发/眼），坐姿整体前倾
  body: THREE.Mesh;
  armL: THREE.Mesh;
  armR: THREE.Mesh;
  legL: THREE.Group; // 站姿垂下 / 坐姿前伸（旋转 90°）
  legR: THREE.Group;
  headBobY: number;
  torsoY: number;
};

function buildChar(c: Character, disposables: Array<{ dispose: () => void }>): CharParts {
  const root = new THREE.Group();
  const shirt = new THREE.Color(c.color).getHex();
  const hairCol = new THREE.Color(c.hair === '' ? '#5a4634' : c.hair).getHex();
  const shirtMat = stdMaterial(shirt, { rough: 0.75 });
  const skinMat = stdMaterial(C_SKIN, { rough: 0.6 });
  const hairMat = stdMaterial(hairCol, { rough: 0.85 });
  const pantsMat = stdMaterial(C_PANTS, { rough: 0.85 });
  const shoeMat = stdMaterial(0xf1f2f3, { rough: 0.6 });
  disposables.push(shirtMat, skinMat, hairMat, pantsMat, shoeMat);

  // 头组：脸球 + 发帽 + 眼（root 上的 pivot 在脖子处，便于前倾）
  const head = new THREE.Group();
  const headGeo = new THREE.SphereGeometry(0.3, 18, 14);
  const face = new THREE.Mesh(headGeo, skinMat);
  face.castShadow = true;
  head.add(face);
  const hairGeo = new THREE.SphereGeometry(0.315, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.52);
  const hair = new THREE.Mesh(hairGeo, hairMat);
  hair.position.y = 0.015;
  head.add(hair);
  const eyeMat = stdMaterial(0x2c2a28, { rough: 0.4 });
  for (const ex of [-0.105, 0.105]) {
    const eyeGeo = new THREE.SphereGeometry(0.034, 8, 8);
    const eye = new THREE.Mesh(eyeGeo, eyeMat);
    eye.position.set(ex, 0.0, 0.27);
    head.add(eye);
    disposables.push(eyeGeo, eyeMat);
  }
  head.position.y = 0.98; // 脖子高度
  disposables.push(headGeo, hairGeo);

  // 身体：圆润胶囊
  const bodyGeo = new THREE.CapsuleGeometry(0.21, 0.16, 6, 14);
  const body = new THREE.Mesh(bodyGeo, shirtMat);
  body.position.y = 0.5;
  body.castShadow = true;
  disposables.push(bodyGeo);

  // 手臂：从肩垂下的细胶囊，稍外张
  const armGeo = new THREE.CapsuleGeometry(0.055, 0.2, 4, 8);
  const armL = new THREE.Mesh(armGeo, shirtMat);
  armL.position.set(-0.24, 0.52, 0);
  armL.rotation.z = 0.25;
  const armR = new THREE.Mesh(armGeo, shirtMat);
  armR.position.set(0.24, 0.52, 0);
  armR.rotation.z = -0.25;
  armL.castShadow = true;
  armR.castShadow = true;
  disposables.push(armGeo);

  // 腿：pivot 在髋部（y=0.34），可从垂下旋转成前伸坐姿
  const mkLeg = (side: 1 | -1): THREE.Group => {
    const g = new THREE.Group();
    g.position.set(side * 0.1, 0.34, 0);
    const legGeo = new THREE.CapsuleGeometry(0.06, 0.2, 4, 8);
    const leg = new THREE.Mesh(legGeo, pantsMat);
    leg.position.y = -0.16;
    leg.castShadow = true;
    g.add(leg);
    const shoeGeo = new THREE.SphereGeometry(0.075, 10, 8);
    shoeGeo.scale(1, 0.7, 1.35);
    const shoe = new THREE.Mesh(shoeGeo, shoeMat);
    shoe.position.set(0, -0.3, 0.03);
    g.add(shoe);
    disposables.push(legGeo, shoeGeo);
    return g;
  };
  const legL = mkLeg(-1);
  const legR = mkLeg(1);

  root.add(body, head, armL, armR, legL, legR);
  return { root, head, body, armL, armR, legL, legR, headBobY: 0.98, torsoY: 0.5 };
}

/* ── 主渲染循环 ── */

export function renderOffice3D(
  canvas: HTMLCanvasElement,
  map: OfficeMap,
  chars: Character[],
  time: number,
  opts?: { bubbles?: ReadonlyMap<string, { text: string; until: number }>; view?: { zoom?: number; panX?: number; panY?: number } },
): void {
  let s = sceneByCanvas.get(canvas);
  if (s === undefined) {
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(C_BG);
    // 光照：环境 + 半球 + 主平行光（软阴影）
    scene.add(new THREE.AmbientLight(0xfff6ea, 0.68));
    const hemi = new THREE.HemisphereLight(0xffffff, 0xcfb99a, 0.6);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff2dd, 1.6);
    sun.position.set(-18, 26, 14);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -26;
    sun.shadow.camera.right = 26;
    sun.shadow.camera.top = 22;
    sun.shadow.camera.bottom = -22;
    sun.shadow.camera.far = 80;
    sun.shadow.bias = -0.0004;
    scene.add(sun);
    const fill = new THREE.DirectionalLight(0xeef2ff, 0.4);
    fill.position.set(12, 10, -6);
    scene.add(fill);
    const aspect = (canvas.clientWidth || 640) / (canvas.clientHeight || 400);
    const camera = new THREE.OrthographicCamera(-16 * aspect, 16 * aspect, 16, -16, 0.1, 300);
    // 参考稿机位：从开放角斜俯视（两面墙在画面后方），正交等距
    camera.position.set(30, 30, 30);
    camera.lookAt(0, -1, 0);
    const disposables: Array<{ dispose: () => void }> = [];
    const baseGroup = buildBase(map, disposables);
    scene.add(baseGroup);
    // 地板拾取面（整块 plane，raycast 命中后换算格）
    const pickGeo = new THREE.PlaneGeometry(MAP_W, MAP_H);
    const pickMat = new THREE.MeshBasicMaterial({ visible: false });
    const pick = new THREE.Mesh(pickGeo, pickMat);
    pick.rotation.x = -Math.PI / 2;
    pick.position.y = 0.09;
    pick.name = 'pick';
    scene.add(pick);
    disposables.push(pickGeo, pickMat);
    const furnGroup = new THREE.Group();
    const charGroup = new THREE.Group();
    scene.add(furnGroup, charGroup);
    s = {
      renderer, scene, camera, baseGroup, furnGroup, charGroup,
      charMap: new Map(), mapSig: '', charsSig: '',
      cellMeshes: pick, disposables,
    };
    sceneByCanvas.set(canvas, s);
  }

  // 尺寸自适应
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const cssW = canvas.clientWidth || 640;
  const cssH = canvas.clientHeight || 400;
  const pxW = Math.round(cssW * dpr);
  const pxH = Math.round(cssH * dpr);
  if (canvas.width !== pxW || canvas.height !== pxH) {
    s.renderer.setSize(cssW, cssH, false);
    s.renderer.setPixelRatio(dpr);
    const aspect = cssW / cssH;
    s.camera.left = -16 * aspect;
    s.camera.right = 16 * aspect;
    s.camera.top = 16;
    s.camera.bottom = -16;
    s.camera.updateProjectionMatrix();
  }

  // 家具签名变化 → 重建
  const mapSig = map.furniture.map((f) => `${f.id}:${f.x},${f.y},${f.w},${f.h}`).join('|');
  if (mapSig !== s.mapSig) {
    s.mapSig = mapSig;
    for (const ch of [...s.furnGroup.children]) s.furnGroup.remove(ch);
    const disposables = s.disposables;
    for (const f of map.furniture) {
      switch (f.kind) {
        case 'desk': buildDesk(s.furnGroup, f, disposables); break;
        case 'wall': buildWallSeg(s.furnGroup, f, disposables); break;
        case 'roundtable': buildRoundTable(s.furnGroup, f, disposables); break;
        case 'carpet': buildCarpet(s.furnGroup, f, disposables); break;
        case 'plant': buildPlant(s.furnGroup, f, disposables); break;
        case 'whiteboard': buildWhiteboard(s.furnGroup, f, disposables); break;
        case 'coffee': buildCoffee(s.furnGroup, f, disposables); break;
        case 'fridge': buildFridge(s.furnGroup, f, disposables); break;
        case 'microwave': buildMicrowave(s.furnGroup, f, disposables); break;
        case 'cabinet': buildCabinet(s.furnGroup, f, disposables); break;
      }
    }
  }

  // 人物签名变化 → 重建（颜色/发型变化也会触发）
  const charsSig = chars.map((c) => `${c.id}:${c.color}:${c.hair}:${c.name}`).join('|');
  if (charsSig !== s.charsSig) {
    s.charsSig = charsSig;
    for (const [, v] of s.charMap) s.charGroup.remove(v.root);
    s.charMap.clear();
    for (const c of chars) {
      const built = buildChar(c, s.disposables);
      s.charGroup.add(built.root);
      s.charMap.set(c.id, { ...built, phase: Math.random() * Math.PI * 2, lastState: '' });
    }
  }

  // 视角：view.zoom → 相机缩放（正交 zoom），panX/panY → 相机屏幕平移
  const zoom = opts?.view?.zoom ?? 1;
  s.camera.zoom = zoom;
  const panX = opts?.view?.panX ?? 0;
  const panY = opts?.view?.panY ?? 0;
  s.camera.clearViewOffset();
  if (panX !== 0 || panY !== 0) {
    s.camera.setViewOffset(
      Math.round((s.camera.right - s.camera.left) / zoom),
      Math.round((s.camera.top - s.camera.bottom) / zoom),
      -panX / zoom,
      panY / zoom,
      Math.round((s.camera.right - s.camera.left) / zoom),
      Math.round((s.camera.top - s.camera.bottom) / zoom),
    );
  }
  s.camera.updateProjectionMatrix();

  // 人物同步：位置插值交给引擎 rx/ry；坐姿/走姿用部位动画（不再是整体硬压低）
  for (const c of chars) {
    const v = s.charMap.get(c.id);
    if (v === undefined) continue;
    const { x, z } = cellToWorld(c.rx + 0.5, c.ry + 0.5);
    const walking = c.state === 'walking';
    const sitting = c.state === 'working' || c.state === 'coffee';
    const swing = walking ? Math.sin(time * 10 + v.phase) * 0.55 : 0;
    const bob = walking ? Math.abs(Math.sin(time * 10 + v.phase)) * 0.05 : Math.sin(time * 2 + v.phase) * 0.012;
    v.root.position.set(x, bob, z);
    const targetRot = c.face === 1 ? Math.PI : 0;
    v.root.rotation.y += (targetRot - v.root.rotation.y) * 0.2;
    if (sitting) {
      // 坐姿：大腿前伸（腿组绕髋转 -90°）、躯干降落到椅面、头微低
      v.legL.rotation.x += (-Math.PI / 2 - v.legL.rotation.x) * 0.25;
      v.legR.rotation.x += (-Math.PI / 2 - v.legR.rotation.x) * 0.25;
      const k = 0.25;
      v.body.position.y += (0.46 - v.body.position.y) * k;
      v.head.position.y += (0.9 - v.head.position.y) * k;
      v.head.rotation.x += (-0.25 - v.head.rotation.x) * k;
      v.armL.rotation.x += (-0.7 - v.armL.rotation.x) * k; // 手搭键盘
      v.armR.rotation.x += (-0.7 - v.armR.rotation.x) * k;
      v.armL.rotation.z += (0.12 - v.armL.rotation.z) * k;
      v.armR.rotation.z += (-0.12 - v.armR.rotation.z) * k;
    } else {
      // 站/走：腿垂下摆动、手臂前后摆、头回正
      v.legL.rotation.x += (swing - v.legL.rotation.x) * 0.3;
      v.legR.rotation.x += (-swing - v.legR.rotation.x) * 0.3;
      const k = 0.3;
      v.body.position.y += (0.5 - v.body.position.y) * k;
      v.head.position.y += (0.98 - v.head.position.y) * k;
      v.head.rotation.x += (0 - v.head.rotation.x) * k;
      v.armL.rotation.x += (-swing * 0.6 - v.armL.rotation.x) * k;
      v.armR.rotation.x += (swing * 0.6 - v.armR.rotation.x) * k;
      v.armL.rotation.z += (0.25 - v.armL.rotation.z) * k;
      v.armR.rotation.z += (-0.25 - v.armR.rotation.z) * k;
    }
  }

  // 气泡：WebGL 上画 CSS 定位的 DOM 气泡由调用方（OfficeCanvas）处理；这里不管
  s.renderer.render(s.scene, s.camera);
}

/** 点击换算：Raycaster 拾取地板面 → 地图格（出界返回 null）。 */
export function cellAtPoint3D(canvas: HTMLCanvasElement, cssX: number, cssY: number): { x: number; y: number } | null {
  const s = sceneByCanvas.get(canvas);
  if (s === undefined) return null;
  const rect = canvas.getBoundingClientRect();
  const ndc = new THREE.Vector2(((cssX - rect.left) / rect.width) * 2 - 1, -((cssY - rect.top) / rect.height) * 2 + 1);
  const ray = new THREE.Raycaster();
  ray.setFromCamera(ndc, s.camera);
  const hit = ray.intersectObject(s.cellMeshes, false)[0];
  if (hit === undefined) return null;
  const gx = Math.floor(hit.point.x + MAP_W / 2);
  const gy = Math.floor(hit.point.z + MAP_H / 2);
  if (gx < 0 || gy < 0 || gx >= MAP_W || gy >= MAP_H) return null;
  return { x: gx, y: gy };
}

/** 平移钳制（3D 正交）：pan 围绕 0 对称（与 2D clampViewPan 同语义，用世界包围盒近似）。 */
export function clampViewPan3D(panX: number, panY: number, zoom: number, cssW: number, cssH: number): { panX: number; panY: number } {
  const viewW = 28 / zoom; // 相机宽 28 世界单位（left -14..right 14）
  const worldW = MAP_W + 2;
  const slackX = Math.max(0, (viewW / 2) * (cssW / cssH) * 0 + (viewW * (cssW / cssH) - worldW) / 2);
  void slackX;
  const viewH = 24 / zoom;
  const worldH = MAP_H + 4;
  const slackXf = Math.max(0, (viewW * (cssW / Math.max(1, cssH)) - worldW) / 2);
  const slackYf = Math.max(0, (viewH - worldH) / 2);
  void slackXf;
  // 简化：以 14px/单位 的近似把世界钳制换算回 CSS 像素（正交 zoom 下相机可视世界宽=28/zoom * aspect）
  const aspect = cssW / Math.max(1, cssH);
  const visW = (28 / zoom) * aspect;
  const visH = 24 / zoom;
  const sx = Math.max(0, (visW - worldW) / 2) * 24;
  const sy = Math.max(0, (visH - worldH) / 2) * 24;
  return {
    panX: Math.min(Math.max(panX, -sx), sx),
    panY: Math.min(Math.max(panY, -sy), sy),
  };
}
