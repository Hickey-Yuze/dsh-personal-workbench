/**
 * 「跳到宿主侧栏会话」桥。
 *
 * 宿主 shell 没有 URL 路由（无 history.pushState / location 赋值），会话切换必须走客户端服务：
 * 官方 `uiWorkspace.openSession(sessionId)` = 在主区打开该会话、并在侧栏展开它所属的工作区分组、
 * 滚动定位并高亮（dsh-experimental-client-ui-agent-team 同款用法）。
 *
 * entry.tsx 的 apply(ctx) 里注册实现：用 ctxGet 软取服务（不写进 inject，缺服务时静默降级），
 * 且每次调用时再取——workspace UI 插件可能晚于本插件挂载。
 */

type SessionOpener = (sessionId: string) => boolean;

let opener: SessionOpener | null = null;

/** 注册实现（entry.tsx apply 时调用一次）。 */
export function setSessionOpener(fn: SessionOpener): void {
  opener = fn;
}

/** 在宿主侧栏打开指定会话；无实现或失败返回 false（调用方自行降级提示）。 */
export function openSessionInShell(sessionId: string): boolean {
  if (sessionId === '' || opener === null) return false;
  return opener(sessionId);
}
