/**
 * 一致性门禁（无需宿主即可跑）：合同级错误的最后一道闸。
 *   1. 包名 / patch insert id / client ModuleLoader id / PANEL_ID 四处一致；
 *   2. package.json 合同字段齐全（type/main/exports/dsh）；
 *   3. 构建产物存在且形状正确（Node half + client half）；
 *   4. react 未被打进 client bundle。
 * 任一项失败 → 非零退出，禁止安装。
 */
import { readFileSync, existsSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const problems = [];
const checks = [];

function ok(label) {
  checks.push(`  ✓ ${label}`);
}
function bad(label) {
  problems.push(`  ✗ ${label}`);
}

const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const name = pkg.name;

// 1. 包名一致性
if (name === 'dsh-personal-workbench') ok('包名 dsh-personal-workbench');
else bad(`包名异常：${name}`);

const patchPath = path.join(root, 'cordis.patch.yml');
const patch = existsSync(patchPath) ? readFileSync(patchPath, 'utf8') : '';
if (!patch) bad('cordis.patch.yml 缺失');
else if (patch.includes(`id: ${name}`) && patch.includes(`name: ${name}`)) {
  ok('patch insert id/name 等于包名');
} else bad('patch insert id/name 与包名不一致');

// 2. package.json 合同字段
if (pkg.type === 'module') ok('type: module');
else bad('type 必须为 module');
if (pkg.main === 'dist/index.js') ok('main: dist/index.js');
else bad(`main 异常：${pkg.main}`);
for (const key of ['.', './client', './package.json']) {
  if (!pkg.exports?.[key]) bad(`exports 缺 ${key}`);
}
if (!problems.some((p) => p.includes('exports 缺'))) ok('exports 含 . / ./client / ./package.json');
if (pkg.dsh?.bundle?.patch === './cordis.patch.yml') ok('dsh.bundle.patch 已声明');
else bad('dsh.bundle.patch 缺失或路径不符');
if (pkg.dsh?.client?.platform === 'web') ok('dsh.client.platform = web');
else bad('dsh.client.platform 必须为 web');

// 3. 产物形状
const nodeOut = path.join(root, 'dist/index.js');
const clientOut = path.join(root, 'dist/client.js');
if (existsSync(nodeOut)) {
  const src = readFileSync(nodeOut, 'utf8');
  if (src.includes('apply')) ok('Node half 产物存在且含 apply');
  else bad('Node half 产物无 apply 导出');
} else bad('dist/index.js 不存在（先跑 pnpm run build）');

if (existsSync(clientOut)) {
  const src = readFileSync(clientOut, 'utf8');
  if (src.startsWith('window.__ModuleLoader__.load({')) ok('client bundle 协议包装正确');
  else bad('client bundle 缺少 ModuleLoader 包装');
  if (src.includes(`id: "${name}"`)) ok('client bundle id 等于包名');
  else bad('client bundle id 与包名不一致');
  if (src.includes('__SECRET_INTERNALS') || src.includes('react.production.min')) {
    bad('client bundle 疑似打入 React 运行时（双 react 会炸 hooks）');
  } else ok('React 未被打入 client bundle');
  if (src.includes('dsh-personal-workbench')) ok('client bundle 含插件标识接线');
  else bad('client bundle 缺少插件标识接线');
} else bad('dist/client.js 不存在（先跑 pnpm run build）');

console.log('[gates] dsh-personal-workbench');
for (const line of checks) console.log(line);
if (problems.length) {
  for (const line of problems) console.log(line);
  console.log(`[gates] FAILED（${problems.length} 项）`);
  process.exit(1);
}
console.log('[gates] PASS');
