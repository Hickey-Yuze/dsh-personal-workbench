/**
 * 办公室「自觉工作」autopilot：每 30 分钟一轮，为开启 autopilot 且空闲的员工
 * 用直连 llm 生成一条此刻最该做的小任务（≤60 字，截 ≤120 保存），再走 office/agent/start
 * 同代码路径 spawn 真实会话派活。llm 不可用 / 异常 / 空返回 → 该员工本轮跳过。
 * 全程 try/catch 静默失败，绝不影响 office 主流程。
 */
import { listAutopilotChars, loadMemoryNotes } from './office-roster.js';

/** cordis Context 的最小结构面（只做服务软探测）。 */
interface AutopilotCtx {
  get(name: string): unknown;
}

export interface OfficeAutopilotDeps {
  ctx: AutopilotCtx;
  log: { info(m: string): void; warn(m: string): void };
  /** 该员工当前是否在忙（真会话 working 中）；从没 spawn 过 = 空闲可派。 */
  isBusy(id: string): boolean;
  /** 与 office/agent/start 同代码路径的派活；失败应抛 Error（本模块捕获跳过）。 */
  dispatch(id: string, name: string, role: string, task: string): Promise<void>;
}

const ROUND_MS = 30 * 60 * 1000;
const TASK_MAX = 120;

type OfficeStreamChunk = { type?: string; text?: unknown };

/** 直连 llm 生成微任务文本；服务缺失/异常/空返回 null（本轮跳过该员工）。 */
async function generateMicroTask(deps: OfficeAutopilotDeps, p: { id: string; name: string; role: string; persona?: string }): Promise<string | null> {
  const llm = deps.ctx.get('llm') as { stream?: (options: object) => AsyncIterable<OfficeStreamChunk> } | undefined;
  if (!llm || typeof llm.stream !== 'function') return null;
  const selection = (deps.ctx.get('agentDefaultModel') as
    | { currentSelection?: () => { provider?: unknown; model?: unknown; reasoningEffort?: unknown } }
    | undefined)?.currentSelection?.();
  const provider = typeof selection?.provider === 'string' && selection.provider !== '' ? selection.provider : '';
  const model = typeof selection?.model === 'string' && selection.model !== '' ? selection.model : '';
  if (provider === '' || model === '') return null;
  const mems = loadMemoryNotes(p.id)
    .slice(-5)
    .map((n) => n.text);
  const sys = [
    `你是办公室员工「${p.name}」（${p.role}）。`,
    ...(p.persona !== undefined ? [`你的性格：${p.persona}`] : []),
    ...(mems.length > 0 ? [`你最近的工作记录：\n${mems.map((m) => `- ${m}`).join('\n')}`] : []),
    '请生成一条此刻最该做的小任务，≤60字，只输出任务本身，不要解释、不要标点包裹。',
  ].join('\n');
  let out = '';
  try {
    for await (const chunk of llm.stream({
      provider,
      model,
      messages: [
        { role: 'system', content: [{ type: 'text', text: sys }] },
        { role: 'user', content: [{ type: 'text', text: '现在生成。' }] },
      ],
      signal: AbortSignal.timeout(60_000),
      ...(typeof selection?.reasoningEffort === 'string' && selection.reasoningEffort !== ''
        ? { reasoningEffort: selection.reasoningEffort }
        : {}),
    })) {
      if (chunk?.type === 'text-delta' && typeof chunk.text === 'string') out += chunk.text;
    }
  } catch {
    return null;
  }
  const task = out
    .trim()
    .replace(/^["'「『]/, '')
    .replace(/["'」』]$/, '')
    .slice(0, TASK_MAX);
  return task === '' ? null : task;
}

/** 跑一轮：枚举自觉工作员工 → 逐个（串行防抖）判忙 → 生成微任务 → 派真会话。单员工失败不影响其他。 */
async function runRound(deps: OfficeAutopilotDeps): Promise<void> {
  let chars: ReturnType<typeof listAutopilotChars> = [];
  try {
    chars = listAutopilotChars();
  } catch {
    return;
  }
  for (const c of chars) {
    try {
      if (deps.isBusy(c.id)) continue;
      const task = await generateMicroTask(deps, c);
      if (task === null) continue;
      await deps.dispatch(c.id, c.name, c.role, task);
      deps.log.info(`[personal-workbench] office autopilot 已派活 ${c.name}（${c.role}）：${task}`);
    } catch (err) {
      deps.log.warn(`[personal-workbench] office autopilot 派活失败 ${c.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

/** 安装 autopilot 定时器（30 分钟一轮，unref 不阻退出）；返回停表函数（重复安装返回既有停表）。 */
export function installOfficeAutopilot(deps: OfficeAutopilotDeps): () => void {
  const timer = setInterval(() => {
    void runRound(deps).catch(() => {});
  }, ROUND_MS);
  if (typeof timer.unref === 'function') timer.unref();
  return () => clearInterval(timer);
}
