/**
 * 人物 3D 覆盖层：在 2D 等距场景 canvas 之上叠一块透明 WebGL canvas，
 * 用 Three.js 渲染 OBJ 人物模型（assets/models 人物库），家具/地板/墙仍是 2D 手绘。
 *
 * 对齐：Three.js 正交等距机位的屏幕投影必须与 2D renderer 的 iso 数学一致——
 * 用 renderer.isoFit/isoOrigin 反推每个格中心的屏幕坐标，再映射到相机可视平面，
 * 人物脚底钉在 2D 地板格中心，深度遮挡交给渲染顺序（人物永远画在家具之后，
 * 与 2D 画家算法的近似一致：坐姿人物在桌前，遮桌沿可接受）。
 */
import * as THREE from 'three';
import { MAP_H, MAP_W } from './map.js';
import { isoFit, isoOrigin } from './renderer.js';
import { loadCharModel, modelForChar } from './objModels.js';
import type { Character, Furniture } from './types.js';

/** 每个覆盖 canvas 一套 Three.js 资源。 */
type Overlay = {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  charGroup: THREE.Group;
  instances: Map<string, { obj: THREE.Group; state: string }>;
  loaded: Map<string, boolean>; // 模型名 → 已加载
  requested: Set<string>;
};

const overlays = new WeakMap<HTMLCanvasElement, Overlay>();

function ensureOverlay(canvas: HTMLCanvasElement): Overlay | null {
  let o = overlays.get(canvas);
  if (o !== undefined) return o;
  try {
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    renderer.setClearColor(0x000000, 0);
    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
    camera.position.set(0, 0, 50);
    scene.add(new THREE.AmbientLight(0xfff6ea, 1.15));
    const sun = new THREE.DirectionalLight(0xfff2dd, 1.1);
    sun.position.set(-6, 10, 6);
    scene.add(sun);
    const charGroup = new THREE.Group();
    scene.add(charGroup);
    o = { renderer, scene, camera, charGroup, instances: new Map(), loaded: new Map(), requested: new Set() };
    overlays.set(canvas, o);
    return o;
  } catch {
    return null; // WebGL 不可用 → 纯 2D 兜底
  }
}

/** 世界 → 屏幕：与 2D renderer 相同的 iso 数学（1 格 = k 像素）。 */
function screenOf(ox: number, oy: number, k: number, gx: number, gy: number): { x: number; y: number } {
  return { x: ox + (gx - gy) * k, y: oy + ((gx + gy) * k) / 2 };
}

/**
 * 同步渲染 3D 人物。参数：2D 画布的 iso 几何（k/ox/oy）、引擎人物与家具、时间。
 * 覆盖 canvas 尺寸与主画布一致（父组件布局对齐）。
 */
export function renderCharOverlay(
  canvas: HTMLCanvasElement,
  chars: Character[],
  furniture: Furniture[],
  time: number,
  iso: { k: number; ox: number; oy: number; cssW: number; cssH: number; zoom: number },
): void {
  const o = ensureOverlay(canvas);
  if (o === null) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const pxW = Math.max(1, Math.round(iso.cssW * dpr));
  const pxH = Math.max(1, Math.round(iso.cssH * dpr));
  if (canvas.width !== pxW || canvas.height !== pxH) {
    o.renderer.setSize(iso.cssW, iso.cssH, false);
    o.renderer.setPixelRatio(dpr);
  }
  // 相机：可视平面 = 画布 CSS 尺寸（单位 = CSS 像素），屏幕坐标直接当世界坐标用
  o.camera.left = -iso.cssW / 2;
  o.camera.right = iso.cssW / 2;
  o.camera.top = iso.cssH / 2;
  o.camera.bottom = -iso.cssH / 2;
  o.camera.position.set(iso.cssW / 2, iso.cssH / 2, 50);
  o.camera.zoom = 1;
  o.camera.updateProjectionMatrix();

  // 需要的模型集合（名字 → 是否请求中/已加载）
  const want = new Map<string, number>(); // modelName → 该模型第一个角色索引
  for (const c of chars) {
    const m = modelForChar(c.name);
    if (!want.has(m)) want.set(m, 0);
  }
  for (const m of want.keys()) {
    if (o.loaded.has(m) || o.requested.has(m)) continue;
    o.requested.add(m);
    void loadCharModel(m).then((model) => {
      o.requested.delete(m);
      o.loaded.set(m, model !== null);
    });
  }

  // 同步实例：id → obj 克隆（简单做法：每个角色独立加载同名模型组克隆）
  const alive = new Set(chars.map((c) => c.id));
  for (const [id, inst] of o.instances) {
    if (!alive.has(id)) {
      o.charGroup.remove(inst.obj);
      o.instances.delete(id);
    }
  }
  for (const c of chars) {
    const m = modelForChar(c.name);
    if (o.loaded.get(m) !== true) continue; // 未加载完：跳过（下帧补上）
    let inst = o.instances.get(c.id);
    // inst.state 存「模型名|角色名」：同模型不同角色（衬衫染色不同）不误用缓存
    const instKey = `${m}|${c.name}`;
    if (inst === undefined || inst.state !== instKey) {
      if (inst !== undefined) o.charGroup.remove(inst.obj);
      void loadCharModel(m, c.name).then((model) => {
        if (model === null) return;
        const clone = model.group.clone(true);
        clone.traverse((node) => {
          if (node instanceof THREE.Mesh) {
            node.castShadow = false;
            node.receiveShadow = false;
          }
        });
        o.charGroup.add(clone);
        o.instances.set(c.id, { obj: clone, state: instKey });
      });
      continue;
    }
    // 位置：脚底钉在人物插值格中心屏幕坐标；坐姿（working/coffee）吸附工位
    let gx = c.rx + 0.5;
    let gy = c.ry + 0.5;
    const sitting = c.state === 'working' || c.state === 'coffee';
    if (sitting && c.deskId !== undefined && c.deskId !== null) {
      const desk = furniture.find((f) => f.kind === 'desk' && f.id === c.deskId);
      if (desk !== undefined) {
        gx = desk.x + 0.5;
        gy = desk.y + 1.5;
      }
    }
    const p = screenOf(iso.ox, iso.oy, iso.k, gx, gy);
    // 身高缩放：模型归一化 1.75 世界单位 → 屏幕 = 1.75 * k * 0.62（与 2D 人物视觉高度一致）
    const hPx = 1.75 * iso.k * 0.62;
    const s = hPx / 1.75;
    inst.obj.scale.setScalar(s);
    inst.obj.position.set(p.x, p.y, 0);
    // 朝向：走路按 face 翻转；等距下默认面向相机偏左（rotation.y ≈ -0.6）
    const faceRot = c.face === 1 ? -0.6 : Math.PI + 0.6;
    inst.obj.rotation.y += (faceRot - inst.obj.rotation.y) * 0.25;
    // 走路轻微上下浮动
    const walking = c.state === 'walking';
    const bob = walking ? Math.abs(Math.sin(time * 9)) * iso.k * 0.045 : 0;
    inst.obj.position.y -= bob;
    inst.obj.renderOrder = 10 + Math.round(gx + gy);
  }

  o.renderer.render(o.scene, o.camera);
  void time;
  void MAP_W;
  void MAP_H;
}

/** 清空某画布的覆盖层（卸载时）。 */
export function disposeCharOverlay(canvas: HTMLCanvasElement): void {
  const o = overlays.get(canvas);
  if (o === undefined) return;
  o.renderer.dispose();
  overlays.delete(canvas);
}
