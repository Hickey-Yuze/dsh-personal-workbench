/**
 * OBJ 模型库加载器（assets/models 的人物 OBJ/MTL → Three.js Group）。
 *
 * 模型来源：用户提供的 Blender 导出人物库（53 个，顶点级 MTL 颜色，无贴图）。
 * 传输：宿主 office/asset/list + office/asset/get（纯文本 JSON），客户端 LRU 内存缓存。
 * 解析：最小 OBJ 解析（v/f + usemtl 分组）+ MTL Kd 漫反射色 → 每材质一个 BufferGeometry，
 *       归一化到 1.75 单位高（≈ 场景人物身高），材质用 MeshStandardMaterial（rough 0.8）。
 */
import * as THREE from 'three';

const BASE = '/api/personal-workbench/office/asset';

/** OBJ 解析结果：每组（材质名）一个几何体。 */
export type ObjModel = { group: THREE.Group; height: number };

const textCache = new Map<string, string>();
const modelCache = new Map<string, ObjModel | null>(); // null = 加载失败（不反复重试）
const inflight = new Map<string, Promise<ObjModel | null>>();

async function fetchText(name: string): Promise<string> {
  const hit = textCache.get(name);
  if (hit !== undefined) return hit;
  const res = await fetch(`${BASE}/get?name=${encodeURIComponent(name)}`);
  const json = (await res.json()) as { ok: boolean; data?: string; error?: { message?: string } };
  if (!json.ok || typeof json.data !== 'string') throw new Error(json.error?.message ?? `加载失败: ${name}`);
  textCache.set(name, json.data);
  return json.data;
}

/** 最小 OBJ 解析：只认 v / f / usemtl / o；面三角化用扇形切分（Blender 导出多为凸面，够用）。 */
function parseObj(objText: string, mtlText: string | null): ObjModel {
  const positions: number[][] = [];
  const groups = new Map<string, number[]>(); // material → flat 顶点索引三元组
  let current = '_default';
  for (const raw of objText.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('v ')) {
      const p = line.slice(2).trim().split(/\s+/).map(Number);
      if (p.length >= 3 && p.every(Number.isFinite)) positions.push([p[0] ?? 0, p[1] ?? 0, p[2] ?? 0]);
    } else if (line.startsWith('usemtl ')) {
      current = line.slice(7).trim() || '_default';
      if (!groups.has(current)) groups.set(current, []);
    } else if (line.startsWith('f ')) {
      const idx = line.slice(2).trim().split(/\s+/).map((tok) => {
        const n = Number.parseInt(tok.split('/')[0] ?? '', 10);
        return Number.isFinite(n) ? (n > 0 ? n - 1 : positions.length + n) : -1;
      });
      const g = groups.get(current) ?? [];
      const i0 = idx[0] ?? -1;
      for (let i = 1; i + 1 < idx.length; i++) {
        for (const vi of [i0, idx[i] ?? -1, idx[i + 1] ?? -1]) {
          if (vi >= 0 && vi < positions.length) g.push(vi);
        }
      }
      groups.set(current, g);
    }
  }
  // MTL：材质名 → Kd 漫反射色。
  // 已知坑：这套 Blender 导出的 Kd 是线性空间暗值（Skin=0.0107 近黑），真彩色不在文件里——
  // 顶点无色、无贴图。策略：亮度足够（>0.25）才采用 Kd；否则按材质语义名给明快色。
  const kd = new Map<string, string>();
  const SEMANTIC: Record<string, string> = {
    Skin: '#f2c79f',
    Face: '#f6d7b8',
    Hair: '#4a3826',
    Shirt: '#7f95b5',
    Pants: '#4d565f',
    Belt: '#5a4634',
    Black: '#3a3d42',
    Details: '#8a8f96',
    Eye: '#2c2a28',
    Shoe: '#e8e4dc',
    Body: '#7f95b5',
  };
  if (mtlText !== null) {
    let mtlName = '';
    for (const raw of mtlText.split('\n')) {
      const line = raw.trim();
      if (line.startsWith('newmtl ')) mtlName = line.slice(7).trim();
      else if (line.startsWith('Kd ') && mtlName !== '') {
        const rgb = line.slice(3).trim().split(/\s+/).map(Number);
        if (rgb.length >= 3 && rgb.every(Number.isFinite)) {
          const lum = (rgb[0] ?? 0) * 0.3 + (rgb[1] ?? 0) * 0.6 + (rgb[2] ?? 0) * 0.1;
          if (lum > 0.25) {
            const c = new THREE.Color(Math.min(1, Math.max(0, rgb[0] ?? 0)), Math.min(1, Math.max(0, rgb[1] ?? 0)), Math.min(1, Math.max(0, rgb[2] ?? 0)));
            kd.set(mtlName, `#${c.getHexString()}`);
          }
          // 暗 Kd：不入表，走语义色兜底
        }
      }
    }
  }
  const colorOf = (matName: string): string => kd.get(matName) ?? SEMANTIC[matName] ?? '#b8bcc4';

  const group = new THREE.Group();
  // 包围盒（归一化用）
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const p of positions) {
    const x = p[0] ?? 0;
    const y = p[1] ?? 0;
    const z = p[2] ?? 0;
    if (x < minX) minX = x; if (y < minY) minY = y; if (z < minZ) minZ = z;
    if (x > maxX) maxX = x; if (y > maxY) maxY = y; if (z > maxZ) maxZ = z;
  }
  const height = Math.max(0.01, maxY - minY);
  const center = { x: (minX + maxX) / 2, z: (minZ + maxZ) / 2 };

  for (const [matName, idxFlat] of groups) {
    if (idxFlat.length < 3) continue;
    const arr = new Float32Array(idxFlat.length * 3);
    for (let i = 0; i < idxFlat.length; i++) {
      const vi = idxFlat[i] ?? -1;
      const p = positions[vi] ?? [0, 0, 0];
      arr[i * 3] = p[0] ?? 0; arr[i * 3 + 1] = p[1] ?? 0; arr[i * 3 + 2] = p[2] ?? 0;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({
      color: colorOf(matName),
      roughness: 0.82,
      metalness: 0.04,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  // 归一化：脚底落地、水平居中、身高 1.75
  const s = 1.75 / height;
  group.scale.setScalar(s);
  group.position.set(-center.x * s, -minY * s, -center.z * s);
  return { group, height };
}

/** 拉取并解析一个人物模型（缓存；失败返回 null）。 */
export async function loadObjModel(name: string): Promise<ObjModel | null> {
  const hit = modelCache.get(name);
  if (hit !== undefined) return hit;
  const busy = inflight.get(name);
  if (busy !== undefined) return busy;
  const p = (async (): Promise<ObjModel | null> => {
    try {
      const objText = await fetchText(name.endsWith('.obj') ? name : `${name}.obj`);
      const mtlName = name.replace(/\.obj$/, '.mtl');
      let mtlText: string | null = null;
      try {
        mtlText = await fetchText(mtlName);
      } catch { /* mtl 缺失容忍：走默认灰 */ }
      const m = parseObj(objText, mtlText);
      modelCache.set(name, m);
      return m;
    } catch {
      modelCache.set(name, null);
      return null;
    } finally {
      inflight.delete(name);
    }
  })();
  inflight.set(name, p);
  return p;
}

/** 角色名 → 稳定衬衫色（ hue 环：名字哈希取色，饱和度/亮度固定在柔和区间）。 */
function shirtTintFor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  const c = new THREE.Color().setHSL(hue / 360, 0.38, 0.58);
  return `#${c.getHexString()}`;
}

/** 给解析好的模型按角色名重染 Shirt/Body 材质（染色只对该角色克隆生效）。 */
export async function loadCharModel(modelName: string, charName?: string): Promise<ObjModel | null> {
  const base = await loadObjModel(modelName);
  if (base === null) return null;
  if (charName === undefined || charName === '') return base;
  const tint = shirtTintFor(charName);
  const group = base.group.clone(true);
  for (const child of group.children) {
    if (child instanceof THREE.Mesh) {
      const mat = child.material as THREE.MeshStandardMaterial;
      // Shirt/Body 系才染色；Skin/Hair/Pants 等保持原样（材质在克隆间共享，换色要重建）
      if (typeof mat.color?.getHexString === 'function') {
        const hex = `#${mat.color.getHexString()}`;
        if (hex === SEMANTIC_SHIRT || hex === SEMANTIC_BODY) {
          child.material = new THREE.MeshStandardMaterial({ color: tint, roughness: 0.82, metalness: 0.04 });
        }
      }
    }
  }
  return { group, height: base.height };
}

const SEMANTIC_SHIRT = '7f95b5';
const SEMANTIC_BODY = SEMANTIC_SHIRT;

/** 名字 → 模型名稳定映射（同一名字永远同一模型；内置职员硬编码覆盖）。 */
const FIXED: Record<string, string> = {
  'Yuze': 'Suit_Male',
  '小周': 'Casual_Male',
  '阿琳': 'Casual_Female',
  '老王': 'OldClassy_Male',
  '大鹏': 'Casual2_Male',
  '小陈': 'Casual3_Female',
  '阿福': 'Casual3_Male',
  '小黄': 'Casual2_Female',
  '小郑': 'Worker_Female',
};

const POOL = [
  'Casual_Male', 'Casual_Female', 'Casual2_Male', 'Casual2_Female', 'Casual3_Male', 'Casual3_Female',
  'Suit_Male', 'Suit_Female', 'Worker_Male', 'Worker_Female', 'Doctor_Male_Young', 'Doctor_Female_Young',
  'OldClassy_Male', 'OldClassy_Female',
];

export function modelForChar(name: string): string {
  const fixed = FIXED[name];
  if (fixed !== undefined) return fixed;
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return POOL[h % POOL.length] ?? 'Casual_Male';
}
