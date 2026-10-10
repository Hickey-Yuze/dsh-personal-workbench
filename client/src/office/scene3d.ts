/**
 * 全 3D 场景渲染器：地板/墙/家具/人物全部 Three.js（char3d 开关 = 整场景 3D）。
 *
 * 机位对齐 2D iso 数学（关键不变式，点击/平移/延伸区逻辑因此零改动）：
 *   正交相机、方位角 45°、仰角 30°（sin e = 0.5）、世界 1 格 = 1 单位、
 *   视锥半宽 = cssW/(2P)、P = √2·k（px/世界单位）——与 2D 的
 *   sx=(gx-gy)k、sy=(gx+gy)k/2 逐点一致（已推导验证）。
 * 视角旋转 rot：场景组绕地图中心 rotation.y = -r·90°，与 rotCell 等价。
 * 气泡：单独 2D canvas 覆盖层，头顶世界坐标 project 到屏幕像素绘制。
 */
import * as THREE from 'three';
import { MAP_H, MAP_W } from './map.js';
import { loadCharModel, modelForChar } from './objModels.js';
import type { Character, Furniture } from './types.js';

/* ───────────── 调色板（对齐参考稿：白底座/木地板/白家具/黑框玻璃） ───────────── */
const C_BG = '#f6f7f8';
const C_BASE = '#f4f4f5';
const C_FLOOR = '#dcbd8b';
const C_FLOOR_LINE = '#d0af7c';
const C_WALL = '#f0f2f4';
const C_WHITE = '#fdfdfd';
const C_WHITE2 = '#f2f3f5';
const C_METAL = '#3a4046';
const C_GLASS = '#dce8ee';
const C_SCREEN = 0x2f3438;
const C_POT = '#cf7a52';
const C_CARPET = '#e9e2d2';

/** 家具静态场景缓存：按每个 Scene3D 实例各持一份（模块级共享会让第二个画布白屏）。 */

type Scene3D = {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  pivot: THREE.Group; // 场景组（含旋转）
  sun: THREE.DirectionalLight;
  charGroup: THREE.Group;
  boardMats: THREE.MeshStandardMaterial[]; // 白板板面（会议呼吸高亮）
  sceneKey: string; // 家具内容指纹（本实例当前场景组对应的）
  sceneGroup: THREE.Group | null;
  instances: Map<string, { obj: THREE.Group; state: string }>;
  loaded: Map<string, boolean>;
  requested: Set<string>;
  meeting: boolean;
};

const scenes = new WeakMap<HTMLCanvasElement, Scene3D>();

const R2 = Math.SQRT1_2; // 0.7071
/** 屏幕右 / 屏幕下 对应的世界地面方向（rot=0 机位固定，旋转在场景组）。 */
const RIGHT = new THREE.Vector3(R2, 0, -R2);
const DOWN = new THREE.Vector3(R2, 0, R2);

function ensureScene(canvas: HTMLCanvasElement): Scene3D | null {
  let s = scenes.get(canvas);
  if (s !== undefined) return s;
  try {
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setClearColor(new THREE.Color(C_BG), 1);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 300);
    scene.add(new THREE.AmbientLight(0xfff6ea, 1.25));
    const sun = new THREE.DirectionalLight(0xfff2dd, 1.6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -45;
    sun.shadow.camera.right = 45;
    sun.shadow.camera.top = 45;
    sun.shadow.camera.bottom = -45;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 160;
    sun.shadow.bias = -0.0004;
    scene.add(sun);
    scene.add(sun.target);
    const pivot = new THREE.Group();
    scene.add(pivot);
    const charGroup = new THREE.Group();
    pivot.add(charGroup);
    s = {
      renderer, scene, camera, pivot, sun, charGroup,
      boardMats: [], sceneKey: '', sceneGroup: null, instances: new Map(), loaded: new Map(), requested: new Set(),
      meeting: false,
    };
    scenes.set(canvas, s);
    return s;
  } catch {
    return null;
  }
}

/* ───────────── 材质/几何小工具 ───────────── */
const matCache = new Map<string, THREE.MeshStandardMaterial>();function mat(color: string, opts?: { rough?: number; transparent?: boolean; opacity?: number }): THREE.MeshStandardMaterial {
  const key = `${color}|${opts?.rough ?? 0.85}|${opts?.opacity ?? 1}`;
  const hit = matCache.get(key);
  if (hit !== undefined) return hit;
  const m = new THREE.MeshStandardMaterial({
    color, roughness: opts?.rough ?? 0.85, metalness: 0.02,
    transparent: opts?.transparent ?? false, opacity: opts?.opacity ?? 1,
  });
  matCache.set(key, m);
  return m;
}
function box(w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number, cast = true): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  mesh.position.set(x, y, z);
  mesh.castShadow = cast;
  mesh.receiveShadow = true;
  return mesh;
}

/** 木地板贴图：条板缝 + 细微色差（CanvasTexture，repeat 平铺）。 */
function floorTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 256;
  const ctx = c.getContext('2d');
  if (ctx !== null) {
    ctx.fillStyle = C_FLOOR;
    ctx.fillRect(0, 0, 256, 256);
    ctx.fillStyle = C_FLOOR_LINE;
    for (let i = 0; i <= 256; i += 64) ctx.fillRect(0, i, 256, 2);
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    for (let i = 0; i < 40; i++) {
      const x = (i * 97) % 256;
      const y = (i * 53) % 256;
      ctx.fillRect(x, y, 14, 3);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(80, 80);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
let floorTex: THREE.CanvasTexture | null = null;

/* ───────────── 家具构建 ───────────── */

function buildDesk(f: Furniture, g: THREE.Group): void {
  const cx = f.x + 1, cz = f.y + 1; // 2×2 中心
  const white = mat(C_WHITE, { rough: 0.6 });
  g.add(box(2, 0.1, 1.3, white, cx, 0.75, cz - 0.15));
  g.add(box(0.08, 0.72, 1.3, white, cx - 0.96, 0.36, cz - 0.15));
  g.add(box(0.08, 0.72, 1.3, white, cx + 0.96, 0.36, cz - 0.15));
  g.add(box(0.55, 0.55, 1.1, mat(C_WHITE2), cx + 0.55, 0.28, cz - 0.15));
  // 显示器（屏面朝 +z，坐姿在桌前 z+ 侧）
  g.add(box(0.3, 0.05, 0.2, mat(C_WHITE2), cx - 0.3, 0.83, cz - 0.35));
  g.add(box(0.06, 0.22, 0.06, mat(C_WHITE2), cx - 0.3, 0.95, cz - 0.35));
  const bezel = box(0.74, 0.48, 0.05, mat('#e8eaed'), cx - 0.3, 1.28, cz - 0.42);
  g.add(bezel);
  g.add(box(0.64, 0.38, 0.03, mat('#2f3438', { rough: 0.35 }), cx - 0.3, 1.28, cz - 0.39));
  g.add(box(0.44, 0.03, 0.15, mat('#eceff2'), cx - 0.3, 0.82, cz + 0.15));
}

function buildGlassCell(f: Furniture, g: THREE.Group, wallSet: Set<string>): void {
  const cx = f.x + 0.5, cz = f.y + 0.5;
  const hasX = wallSet.has(`${f.x - 1},${f.y}`) || wallSet.has(`${f.x + 1},${f.y}`);
  const frame = mat(C_METAL, { rough: 0.5 });
  const glass = new THREE.MeshStandardMaterial({
    color: C_GLASS, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.3, depthWrite: false,
  });
  const mk = (geo: THREE.BufferGeometry, x: number, y: number, z: number): THREE.Mesh => {
    const mesh = new THREE.Mesh(geo, frame);
    mesh.position.set(x, y, z);
    mesh.receiveShadow = true;
    return mesh;
  };
  if (hasX) {
    // 沿 x 排布：X 向玻璃 + 端柱 + 上下横梁
    const gm = new THREE.Mesh(new THREE.BoxGeometry(1, 2.1, 0.035), glass);
    gm.position.set(cx, 1.05, cz);
    g.add(gm);
    g.add(mk(new THREE.BoxGeometry(0.05, 2.14, 0.05), f.x, 1.07, cz));
    g.add(mk(new THREE.BoxGeometry(0.05, 2.14, 0.05), f.x + 1, 1.07, cz));
    g.add(mk(new THREE.BoxGeometry(1, 0.05, 0.05), cx, 2.12, cz));
    g.add(mk(new THREE.BoxGeometry(1, 0.05, 0.05), cx, 0.02, cz));
  } else {
    // 沿 z 排布
    const gm = new THREE.Mesh(new THREE.BoxGeometry(0.035, 2.1, 1), glass);
    gm.position.set(cx, 1.05, cz);
    g.add(gm);
    g.add(mk(new THREE.BoxGeometry(0.05, 2.14, 0.05), cx, 1.07, f.y));
    g.add(mk(new THREE.BoxGeometry(0.05, 2.14, 0.05), cx, 1.07, f.y + 1));
    g.add(mk(new THREE.BoxGeometry(0.05, 0.05, 1), cx, 2.12, cz));
    g.add(mk(new THREE.BoxGeometry(0.05, 0.05, 1), cx, 0.02, cz));
  }
}

function buildWall(f: Furniture, g: THREE.Group, wallSet: Set<string>): void {
  buildGlassCell(f, g, wallSet);
}

function buildWhiteboard(f: Furniture, g: THREE.Group, boardMats: THREE.MeshStandardMaterial[]): void {
  const cx = f.x + 1, cz = f.y + 0.5;
  const frameM = mat('#d7dade');
  const board = box(1.9, 1.15, 0.05, mat('#fbfbfc', { rough: 0.9 }), cx, 1.25, cz);
  const bm = board.material as THREE.MeshStandardMaterial;
  boardMats.push(bm);
  g.add(board);
  g.add(box(1.98, 0.06, 0.07, frameM, cx, 1.86, cz));
  g.add(box(1.98, 0.06, 0.07, frameM, cx, 0.64, cz));
  g.add(box(0.06, 1.3, 0.07, frameM, cx - 0.96, 1.25, cz));
  g.add(box(0.06, 1.3, 0.07, frameM, cx + 0.96, 1.25, cz));
  g.add(box(0.05, 0.62, 0.05, frameM, cx - 0.8, 0.31, cz));
  g.add(box(0.05, 0.62, 0.05, frameM, cx + 0.8, 0.31, cz));
  g.add(box(0.05, 0.62, 0.05, frameM, cx - 0.8, 0.31, cz + 0.0));
  g.add(box(0.05, 0.62, 0.05, frameM, cx + 0.8, 0.31, cz + 0.0));
}

function buildPlant(f: Furniture, g: THREE.Group): void {
  const cx = f.x + 0.5, cz = f.y + 0.5;
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.15, 0.34, 12), mat(C_POT, { rough: 0.7 }));
  pot.position.set(cx, 0.17, cz);
  pot.castShadow = true; pot.receiveShadow = true;
  g.add(pot);
  const leafM1 = mat('#4e8a4a', { rough: 0.9 });
  const leafM2 = mat('#6fb86a', { rough: 0.9 });
  const s1 = new THREE.Mesh(new THREE.SphereGeometry(0.26, 10, 8), leafM1);
  s1.position.set(cx, 0.62, cz); s1.castShadow = true;
  const s2 = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), leafM2);
  s2.position.set(cx + 0.12, 0.82, cz - 0.08); s2.castShadow = true;
  const s3 = new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 8), leafM2);
  s3.position.set(cx - 0.13, 0.86, cz + 0.1); s3.castShadow = true;
  g.add(s1, s2, s3);
}

function buildCoffee(f: Furniture, g: THREE.Group): void {
  const cx = f.x + 0.5, cz = f.y + 0.5;
  g.add(box(0.46, 0.85, 0.46, mat(C_WHITE2), cx, 0.425, cz));
  g.add(box(0.34, 0.4, 0.32, mat('#3c4148', { rough: 0.4 }), cx, 1.05, cz));
}

function buildMicrowave(f: Furniture, g: THREE.Group): void {
  const cx = f.x + 0.5, cz = f.y + 0.5;
  g.add(box(0.44, 0.5, 0.42, mat(C_WHITE2), cx, 0.25, cz));
  g.add(box(0.5, 0.34, 0.4, mat('#c9cdd3', { rough: 0.4 }), cx, 0.67, cz));
  g.add(box(0.36, 0.24, 0.03, mat('#3c4148'), cx, 0.67, cz + 0.2));
}

function buildFridge(f: Furniture, g: THREE.Group): void {
  const cx = f.x + 0.5, cz = f.y + 0.5;
  g.add(box(0.66, 1.7, 0.66, mat('#f4f5f7', { rough: 0.35 }), cx, 0.85, cz));
  g.add(box(0.04, 0.5, 0.05, mat('#b9bec5'), cx + 0.3, 1.05, cz + 0.28));
}

function buildCabinet(f: Furniture, g: THREE.Group): void {
  const cx = f.x + 0.5, cz = f.y + 0.5;
  g.add(box(0.82, 0.85, 0.82, mat(C_WHITE, { rough: 0.55 }), cx, 0.425, cz));
  g.add(box(0.7, 0.02, 0.02, mat('#d8dbdf'), cx, 0.58, cz + 0.41));
  g.add(box(0.7, 0.02, 0.02, mat('#d8dbdf'), cx, 0.3, cz + 0.41));
}

function buildCarpet(f: Furniture, g: THREE.Group): void {
  const cx = f.x + f.w / 2, cz = f.y + f.h / 2;
  g.add(box(f.w, 0.025, f.h, mat(C_CARPET, { rough: 1 }), cx, 0.013, cz, false));
}

function buildRoundTable(f: Furniture, g: THREE.Group): void {
  const cx = f.x + 1, cz = f.y + 1;
  const top = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 0.95, 0.07, 24), mat(C_WHITE, { rough: 0.5 }));
  top.position.set(cx, 0.74, cz);
  top.castShadow = true; top.receiveShadow = true;
  const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.14, 0.72, 10), mat('#e8eaed'));
  ped.position.set(cx, 0.36, cz);
  ped.castShadow = true;
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.42, 0.05, 16), mat('#e8eaed'));
  base.position.set(cx, 0.025, cz);
  base.receiveShadow = true;
  g.add(top, ped, base);
  // 两把圆凳
  for (const dz of [-0.85, 0.85]) {
    const stool = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.16, 0.42, 10), mat(C_WHITE2));
    stool.position.set(cx + 0.6 * Math.sign(dz) * 0.2, 0.21, cz + dz);
    stool.castShadow = true;
    g.add(stool);
  }
}

/** 由家具列表构建静态场景组（地板/底座/周墙/家具/工位椅）。 */
function buildScene(furniture: Furniture[], boardMats: THREE.MeshStandardMaterial[]): THREE.Group {
  const g = new THREE.Group();
  // 白底座（地图外扩 0.8 的裙边）
  g.add(box(MAP_W + 1.6, 0.68, MAP_H + 1.6, mat(C_BASE, { rough: 0.8 }), MAP_W / 2, -0.36, MAP_H / 2, false));
  // 大木地板（延伸走位区连续）
  if (floorTex === null) floorTex = floorTexture();
  const floor = new THREE.Mesh(
    new THREE.BoxGeometry(160, 0.04, 160),
    new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.9, metalness: 0 }),
  );
  floor.position.set(MAP_W / 2, -0.02, MAP_H / 2);
  floor.receiveShadow = true;
  g.add(floor);
  // 两面周墙（rot=0 的背景面）：z=0 带窗 + x=0 素墙
  const wallM = mat(C_WALL, { rough: 0.9 });
  g.add(box(MAP_W, 2.6, 0.16, wallM, MAP_W / 2, 1.3, -0.08));
  g.add(box(0.16, 2.6, MAP_H, wallM, -0.08, 1.3, MAP_H / 2));
  // z=0 墙上的 3 扇窗（浅蓝玻璃）
  const winM = new THREE.MeshStandardMaterial({ color: 0xcfe4f2, roughness: 0.1, metalness: 0.05, emissive: 0x9cc8e4, emissiveIntensity: 0.25 });
  for (const wx of [3, 8, 13]) {
    if (wx + 2.4 > MAP_W) break;
    g.add(box(2.4, 1.5, 0.05, winM, wx + 1.2, 1.35, 0.0));
    g.add(box(2.5, 0.06, 0.07, mat('#dfe3e7'), wx + 1.2, 2.14, 0.0));
    g.add(box(2.5, 0.06, 0.07, mat('#dfe3e7'), wx + 1.2, 0.56, 0.0));
  }
  const wallSet = new Set(furniture.filter((f) => f.kind === 'wall').map((f) => `${f.x},${f.y}`));
  for (const f of furniture) {
    if (f.kind === 'desk') {
      buildDesk(f, g);
      // 工位椅（椅背在 +z，人坐椅上）
      const chx = f.x + 0.5, chz = f.y + 1.5;
      g.add(box(0.46, 0.07, 0.46, mat('#dfe4ea', { rough: 0.7 }), chx, 0.42, chz + 0.12));
      g.add(box(0.46, 0.52, 0.06, mat('#dfe4ea', { rough: 0.7 }), chx, 0.72, chz + 0.36));
      g.add(box(0.06, 0.4, 0.06, mat('#c3c9d0'), chx, 0.2, chz + 0.12));
      continue;
    }
    if (f.kind === 'whiteboard') { buildWhiteboard(f, g, boardMats); continue; }
    if (f.kind === 'plant') { buildPlant(f, g); continue; }
    if (f.kind === 'coffee') { buildCoffee(f, g); continue; }
    if (f.kind === 'microwave') { buildMicrowave(f, g); continue; }
    if (f.kind === 'fridge') { buildFridge(f, g); continue; }
    if (f.kind === 'cabinet') { buildCabinet(f, g); continue; }
    if (f.kind === 'carpet') { buildCarpet(f, g); continue; }
    if (f.kind === 'roundtable') { buildRoundTable(f, g); continue; }
    // wall 已在 wallSet 循环里建过
  }
  return g;
}

/* ───────────── 人物 ───────────── */
const CHAR_SCALE = 0.78;

function syncChars(s: Scene3D, chars: Character[], time: number): void {
  for (const c of chars) {
    const m = modelForChar(c.name);
    if (s.loaded.get(m) !== true) {
      if (!s.requested.has(m)) {
        s.requested.add(m);
        void loadCharModel(m, c.name).then((model) => {
          s.requested.delete(m);
          s.loaded.set(m, model !== null);
        });
      }
      continue;
    }
    const instKey = `${m}|${c.name}`;
    let inst = s.instances.get(c.id);
    if (inst === undefined || inst.state !== instKey) {
      if (inst !== undefined) s.charGroup.remove(inst.obj);
      void loadCharModel(m, c.name).then((model) => {
        if (model === null) return;
        const clone = model.group.clone(true);
        clone.scale.setScalar(CHAR_SCALE);
        clone.traverse((node) => {
          if (node instanceof THREE.Mesh) {
            node.castShadow = true;
            node.receiveShadow = true;
          }
        });
        s.charGroup.add(clone);
        s.instances.set(c.id, { obj: clone, state: instKey });
      });
      continue;
    }
    let gx = c.rx + 0.5;
    let gy = c.ry + 0.5;
    const sitting = c.state === 'working' || c.state === 'coffee';
    if (sitting && c.deskId !== null && c.deskId !== '') {
      const desk = (s.charGroup.userData.desks as Map<string, Furniture> | undefined)?.get(c.deskId);
      if (desk !== undefined) {
        gx = desk.x + 0.5;
        gy = desk.y + 1.5;
      }
    }
    inst.obj.position.set(gx, 0, gy);
    const faceRot = c.face === 1 ? -0.6 : Math.PI + 0.6;
    inst.obj.rotation.y += (faceRot - inst.obj.rotation.y) * 0.25;
    const walking = c.state === 'walking';
    if (walking) inst.obj.position.y = Math.abs(Math.sin(time * 9 + c.phase)) * 0.05;
    else inst.obj.position.y = 0;
  }
  const alive = new Set(chars.map((c) => c.id));
  for (const [id, inst] of s.instances) {
    if (!alive.has(id)) {
      s.charGroup.remove(inst.obj);
      s.instances.delete(id);
    }
  }
}

/* ───────────── 气泡（2D 覆盖 canvas） ───────────── */
function wrap2(ctx: TextRenderingContext, text: string, maxW: number): [string, string | null] {
  if (ctx.measureText(text).width <= maxW) return [text, null];
  let a = text;
  while (a.length > 1 && ctx.measureText(a + '…').width > maxW) a = a.slice(0, -1);
  return [a + '…', null];
}
type TextRenderingContext = { measureText: (t: string) => { width: number } };

function drawBubbles(
  canvas: HTMLCanvasElement,
  s: Scene3D,
  chars: Character[],
  bubbles: Map<string, { text: string; until: number }>,
  time: number,
  cssW: number,
  cssH: number,
): void {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const pxW = Math.max(1, Math.round(cssW * dpr));
  const pxH = Math.max(1, Math.round(cssH * dpr));
  if (canvas.width !== pxW || canvas.height !== pxH) {
    canvas.width = pxW;
    canvas.height = pxH;
  }
  const ctx = canvas.getContext('2d');
  if (ctx === null) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);
  const v = new THREE.Vector3();
  for (const c of chars) {
    const b = bubbles.get(c.id);
    if (b === undefined) continue;
    const remaining = b.until - time;
    const alpha = Math.max(0, Math.min(1, remaining / 0.4));
    if (alpha <= 0) continue;
    v.set(c.rx + 0.5, 1.55 * CHAR_SCALE, c.ry + 0.5).project(s.camera);
    const px = ((v.x + 1) / 2) * cssW;
    const py = ((1 - v.y) / 2) * cssH;
    const fs = 11;
    const maxW = 96;
    ctx.font = `${fs}px -apple-system, "PingFang SC", sans-serif`;
    const [l1] = wrap2(ctx, b.text, maxW);
    const w1 = ctx.measureText(l1).width;
    const pad = fs * 0.5;
    const bw = w1 + pad * 2;
    const bh = pad * 2 + fs * 1.3;
    let bx = px - bw / 2;
    let by = py - bh - 12;
    bx = Math.max(4, Math.min(cssW - bw - 4, bx));
    if (by < 4) by = py + 14;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = 'rgba(20,20,30,0.1)';
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') ctx.roundRect(bx, by, bw, bh, 9);
    else ctx.rect(bx, by, bw, bh);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#3a3f47';
    ctx.textBaseline = 'top';
    ctx.fillText(l1, bx + pad, by + pad);
    ctx.globalAlpha = 1;
  }
}

/* ───────────── 主入口 ───────────── */
export type Scene3DOpts = {
  zoom: number;
  panX: number;
  panY: number;
  rot: number;
  meeting: boolean;
  bubbles: Map<string, { text: string; until: number }>;
};

/**
 * 渲染一帧全 3D 场景。canvas = WebGL 主画布；bubbleCanvas = 2D 气泡覆盖层。
 * 视口由 zoom/panX/panY/rot 决定（与 2D OfficeView 同源，换算见文件头注释）。
 */
export function renderScene3d(
  canvas: HTMLCanvasElement,
  bubbleCanvas: HTMLCanvasElement,
  furniture: Furniture[],
  chars: Character[],
  time: number,
  opts: Scene3DOpts,
): void {
  const s = ensureScene(canvas);
  if (s === null) return;
  const cssW = canvas.clientWidth || 800;
  const cssH = canvas.clientHeight || 600;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const pxW = Math.max(1, Math.round(cssW * dpr));
  const pxH = Math.max(1, Math.round(cssH * dpr));
  if (canvas.width !== pxW || canvas.height !== pxH) s.renderer.setSize(cssW, cssH, false);
  s.renderer.setPixelRatio(dpr);

  // 静态场景：家具内容指纹变了才重建
  const key = JSON.stringify(furniture);
  if (key !== s.sceneKey || s.sceneGroup === null) {
    s.sceneKey = key;
    if (s.sceneGroup !== null) s.pivot.remove(s.sceneGroup);
    s.boardMats.length = 0;
    s.sceneGroup = buildScene(furniture, s.boardMats);
    s.pivot.add(s.sceneGroup);
    // 工位索引（坐姿吸附用）
    const desks = new Map<string, Furniture>();
    for (const f of furniture) if (f.kind === 'desk') desks.set(f.id, f);
    s.charGroup.userData.desks = desks;
    // 太阳光位随地图中心
    s.sun.position.set(MAP_W / 2 - 18, 30, MAP_H / 2 + 14);
    s.sun.target.position.set(MAP_W / 2, 0, MAP_H / 2);
  }
  s.pivot.rotation.y = -(((Math.round(opts.rot) % 4) + 4) % 4) * (Math.PI / 2);

  // 相机：方位 45°/仰角 30° 正交；k 由 zoom 推出（与 2D isoFit 同式）
  const rot = ((Math.round(opts.rot) % 4) + 4) % 4;
  const dims = rot % 2 === 1 ? { w: MAP_H, h: MAP_W } : { w: MAP_W, h: MAP_H };
  const k = Math.min(cssW / (dims.w + dims.h), (cssH * 2) / (dims.w + dims.h)) * opts.zoom;
  const P = Math.SQRT2 * k;
  s.camera.left = -cssW / (2 * P);
  s.camera.right = cssW / (2 * P);
  s.camera.top = cssH / (2 * P);
  s.camera.bottom = -cssH / (2 * P);
  const panX = Number.isFinite(opts.panX) ? opts.panX : 0;
  const panY = Number.isFinite(opts.panY) ? opts.panY : 0;
  const tx = MAP_W / 2 - (panX * RIGHT.x + panY * DOWN.x) / P;
  const tz = MAP_H / 2 - (panX * RIGHT.z + panY * DOWN.z) / P;
  const D = 120;
  s.camera.position.set(tx + D * 0.866 * R2, D * 0.5, tz + D * 0.866 * R2);
  s.camera.lookAt(tx, 0, tz);
  s.camera.updateProjectionMatrix();

  // 会议：白板呼吸高亮
  const pulse = opts.meeting ? 0.35 + 0.3 * Math.sin(time * 3) : 0;
  for (const m of s.boardMats) {
    m.emissive.setHex(0x7fd0a0);
    m.emissiveIntensity = pulse;
  }

  syncChars(s, chars, time);
  s.renderer.render(s.scene, s.camera);
  drawBubbles(bubbleCanvas, s, chars, opts.bubbles, time, cssW, cssH);
}
