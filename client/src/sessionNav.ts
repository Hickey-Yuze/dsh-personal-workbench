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

/** 跳转结果：service=走宿主 uiWorkspace 服务；sidebar=退化成点侧栏那一行；后两者=都没成功。 */
export type JumpOutcome = 'service' | 'sidebar' | 'service-missing' | 'failed';

type SessionOpener = (sessionId: string) => Promise<JumpOutcome> | JumpOutcome;
/**
 * 按员工 npcId 在宿主会话列表里找 TA 最近的会话 id。
 * 宿主重启后 office/agents 的内存派活记录会清空，只剩磁盘上的会话——会话 id 形如
 * `office-<npcId 的 ASCII 化>-<创建毫秒>`，所以按前缀找 + 取时间戳最大者即可。
 */
type SessionFinder = (npcId: string) => string | null;

let opener: SessionOpener | null = null;
let finder: SessionFinder | null = null;

/** 注册实现（entry.tsx apply 时调用一次）。 */
export function setSessionOpener(fn: SessionOpener): void {
  opener = fn;
}

/** 注册「按员工名找会话」实现（entry.tsx apply 时调用一次）。 */
export function setSessionFinder(fn: SessionFinder): void {
  finder = fn;
}

/** 跳到指定会话（宿主主区 + 侧栏定位）；返回实际走通的方式，失败原因由调用方提示。 */
export async function openSessionInShell(sessionId: string): Promise<JumpOutcome> {
  if (sessionId === '' || opener === null) return 'failed';
  try {
    return await opener(sessionId);
  } catch (err) {
    console.warn('[personal-workbench] 跳转会话异常', err);
    return 'failed';
  }
}

/** 找回员工最近的会话 id（宿主内存里有派活记录时不需要它）；找不到返回 null。 */
export function findSessionOfNpc(npcId: string): string | null {
  if (npcId === '' || finder === null) return null;
  try {
    return finder(npcId);
  } catch {
    return null;
  }
}
