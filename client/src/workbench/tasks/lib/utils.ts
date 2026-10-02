import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Electron/浏览器通用的剪贴板写入：Clipboard API 优先，权限被拒时回退 execCommand，再回退系统剪贴板 IPC
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      if (ok) return true;
    } catch {
      /* fall through */
    }
    try {
      const w = window as any;
      if (typeof w.desktop?.copyText === 'function') {
        const r = await w.desktop.copyText(text);
        return Boolean(r?.ok);
      }
    } catch {
      /* fall through */
    }
    return false;
  }
}
