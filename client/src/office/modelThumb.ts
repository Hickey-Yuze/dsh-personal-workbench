/**
 * 3D 人物模型缩略图：离屏 WebGL 渲染，把 assets/models 下的模型渲成小图（data URL）。
 * 用途：① 员工档案里选「3D 人物模型」时预览；② 员工头像直接用「模型的头像」。
 *
 * 注意：浏览器可用的 WebGL 上下文数量有限（约 16 个），所以全局只建一个离屏渲染器反复复用，
 * 不能每个模型建一个。渲染失败（模型加载不了 / WebGL 不可用）一律返回 null，由调用方回退文字头像。
 */
import * as THREE from 'three';
import { loadCharModel } from './objModels.js';

/** bust = 头肩（头像用）；full = 全身（选型预览用）。 */
export type ThumbMode = 'bust' | 'full';

const cache = new Map<string, string | null>();
let ctx: { r: THREE.WebGLRenderer; s: THREE.Scene; c: THREE.PerspectiveCamera } | null = null;
let broken = false;

function ensure(size: number): typeof ctx {
  if (ctx !== null) {
    if (ctx.r.domElement.width !== size) ctx.r.setSize(size, size, false);
    return ctx;
  }
  if (broken) return null;
  try {
    const canvas = document.createElement('canvas');
    const r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
    r.setPixelRatio(1);
    r.setSize(size, size, false);
    r.setClearColor(0x000000, 0);
    const s = new THREE.Scene();
    s.add(new THREE.AmbientLight(0xffffff, 1.7));
    const key = new THREE.DirectionalLight(0xffffff, 1.5);
    key.position.set(1.6, 2.6, 3);
    s.add(key);
    const rim = new THREE.DirectionalLight(0xffffff, 0.55);
    rim.position.set(-2.2, 1.4, -2.4);
    s.add(rim);
    const c = new THREE.PerspectiveCamera(30, 1, 0.01, 60);
    ctx = { r, s, c };
    return ctx;
  } catch {
    broken = true;
    return null;
  }
}

/** 渲染模型缩略图；失败返回 null。同一 file+mode+size 只渲一次（进程内缓存）。 */
export async function modelThumb(file: string, mode: ThumbMode = 'bust', size = 128): Promise<string | null> {
  const key = `${mode}:${size}:${file}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const c = ensure(size);
  if (c === null) {
    cache.set(key, null);
    return null;
  }
  const model = await loadCharModel(file);
  if (model === null) {
    cache.set(key, null);
    return null;
  }
  const g = model.group;
  c.s.add(g);
  try {
    const box = new THREE.Box3().setFromObject(g);
    if (box.isEmpty()) {
      cache.set(key, null);
      return null;
    }
    const dim = new THREE.Vector3();
    const mid = new THREE.Vector3();
    box.getSize(dim);
    box.getCenter(mid);
    const h = Math.max(0.001, dim.y);
    // 半身：以「头顶往下 16%」为中心，视野高度取整体 44% ≈ 头 + 肩
    const focusY = mode === 'bust' ? box.max.y - h * 0.16 : mid.y;
    const fitH = mode === 'bust' ? h * 0.44 : h * 1.18;
    const dist = fitH / 2 / Math.tan((c.c.fov * Math.PI) / 360);
    // 模型原生面朝 +z（见 objModels.ts 说明），相机放 +z 侧才看得到脸
    c.c.position.set(mid.x, focusY, mid.z + dist);
    c.c.lookAt(mid.x, focusY, mid.z);
    c.c.updateProjectionMatrix();
    c.r.render(c.s, c.c);
    const url = c.r.domElement.toDataURL('image/png');
    cache.set(key, url);
    return url;
  } catch {
    cache.set(key, null);
    return null;
  } finally {
    // 模型是加载器里的共享对象，只借场景一帧，不要 dispose
    c.s.remove(g);
  }
}
