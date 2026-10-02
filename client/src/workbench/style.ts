/**
 * 待办看板的样式注入。
 * tailwind.generated.css 由 scripts/build-tailwind.mjs 生成，所有规则都已限定在
 * `.dsh-pwb-dark` 容器内（构建期做的选择器作用域化），所以可以安全地插进宿主文档。
 */
import css from './tailwind.generated.css';

const STYLE_ID = 'dsh-pwb-tailwind';

export function ensureWorkbenchStyle(): void {
  if (typeof document === 'undefined') return;
  const existing = document.getElementById(STYLE_ID);
  if (existing !== null) {
    existing.textContent = css;
    return;
  }
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = css;
  document.head.appendChild(style);
}
