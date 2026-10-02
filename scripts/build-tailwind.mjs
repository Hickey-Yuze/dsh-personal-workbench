/**
 * 生成待办看板的 Tailwind CSS。
 *
 * 流程：tailwind CLI 编译 client/tailwind/app.css → postcss 把**每一条规则**限定到
 * `.dsh-pwb-dark` 容器内 → 落成 client/src/workbench/tailwind.generated.css。
 *
 * 为什么要做作用域化：Tailwind 的工具类是扁平的（`.flex`、`.p-5`），直接注入会和宿主
 * 自己的样式互相覆盖；包一层容器选择器后，这一千多条规则只在看板容器内生效。
 * 例外：@keyframes / @property / @font-face 这类 at-rule 内部的规则不能加前缀。
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const input = path.join(root, 'client/tailwind/app.css');
const output = path.join(root, 'client/src/workbench/tailwind.generated.css');
const cli = path.join(root, 'node_modules/@tailwindcss/cli/dist/index.mjs');

const SCOPE = '.dsh-pwb-dark';
/** 已经在作用域内、或本来就该保持全局的 at-rule。 */
const GLOBAL_AT = /^(keyframes|-webkit-keyframes|property|font-face|counter-style|page)$/i;
const ALREADY_GLOBAL = /^(@|,|from$|to$|[\d.]+%)/;

execFileSync(process.execPath, [cli, '-i', input, '-o', output, '--minify'], {
  cwd: root,
  stdio: ['ignore', 'pipe', 'pipe'],
});

const raw = readFileSync(output, 'utf8');
const scoped = postcss.parse(raw);

let touched = 0;
scoped.walkRules((rule) => {
  // keyframes 的步进选择器（0%、from、to）和 @property 内部不能碰
  for (let p = rule.parent; p !== undefined && p !== null; p = p.parent) {
    if (p.type === 'atrule' && GLOBAL_AT.test(p.name)) return;
  }
  const next = rule.selector
    .split(',')
    .map((part) => {
      const sel = part.trim();
      // 文档根选择器不能拼前缀（`.dsh-pwb-dark :root` 永远匹配不到），
      // 必须替换成容器本身 —— 否则 Tailwind 自带主题的全部变量（色板、
      // --container-*、--text-*…）整体失效，max-w-*、原生颜色类全跟着瞎。
      if (sel === ':root' || sel === ':host' || sel === 'html' || sel === 'body') return SCOPE;
      if (sel === '' || ALREADY_GLOBAL.test(sel)) return sel;
      if (sel.startsWith(SCOPE)) return sel;
      return `${SCOPE} ${sel}`;
    })
    .join(', ');
  if (next !== rule.selector) {
    rule.selector = next;
    touched += 1;
  }
});

const finalCss = scoped.toString();
writeFileSync(output, finalCss, 'utf8');
const kb = (Buffer.byteLength(finalCss) / 1024).toFixed(1);
console.log(`build-tailwind: ${output.split('/').pop()} ${kb} KB（作用域化 ${touched} 条规则）`);
