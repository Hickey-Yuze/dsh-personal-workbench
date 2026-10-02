/**
 * 冒烟：不需要宿主即可验证的三件事
 *   1. Node half 产物导出齐备（name / Config / apply）；
 *   2. 插件自有存储真实可写可读（写入 dataDir 下的临时键后立即删除）；
 *   3. 知识库连通性（可选，未运行 Obsidian 时只提示不失败）。
 * 用法：node scripts/smoke.mjs
 */
import { pathToFileURL } from 'node:url';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = (f) => pathToFileURL(path.join(root, 'dist', f)).href;

let failed = 0;
const check = (ok, label, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failed += 1;
};
const info = (label, detail = '') => console.log(`  · ${label}${detail ? ` — ${detail}` : ''}`);

console.log('[smoke] dsh-personal-workbench');

// ── 1. Node half 导出 ──
const mod = await import(dist('index.js'));
check(mod.name === 'dsh-personal-workbench', 'name 导出正确', String(mod.name));
check(typeof mod.apply === 'function', 'apply 可调用');
check(mod.Config !== undefined, 'Config schema 已导出');
check(Array.isArray(mod.inject), 'inject 已导出', JSON.stringify(mod.inject));

// ── 2. 自有存储：真实读写 ──
const { JsonStore, resolveDataDir } = await import(dist('store.js'));
const dataDir = resolveDataDir();
const store = new JsonStore(dataDir);
await store.init();
const probeKey = 'smoke-check';
await store.write(probeKey, { ok: true, at: new Date().toISOString() });
const back = await store.read(probeKey, { ok: false });
check(back?.ok === true, '存储写入后可读回', dataDir);
await fs.rm(path.join(dataDir, `${probeKey}.json`), { force: true });
// 路径穿越必须被拒绝
let rejected = false;
try {
  await store.write('../escape', {});
} catch {
  rejected = true;
}
check(rejected, '非法键（../）被拒绝');

// ── 3. 知识库连通性（可选） ──
const { KnowledgeClient } = await import(dist('knowledge.js'));
const { resolveObsidianKeyPath } = await import(dist('config.js'));
const kb = new KnowledgeClient('http://127.0.0.1:27123', resolveObsidianKeyPath(), 2500);
try {
  const list = await kb.list('');
  check(true, '知识库可达', `${list.total} 个根条目`);
} catch (err) {
  info('知识库未就绪（不影响插件加载）', err instanceof Error ? err.message : String(err));
}

console.log(failed === 0 ? '[smoke] PASS' : `[smoke] FAILED（${failed} 项）`);
process.exit(failed === 0 ? 0 : 1);
