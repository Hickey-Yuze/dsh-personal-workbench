/**
 * 办公室「自觉工作」autopilot：每 30 分钟一轮，为开启 autopilot 且空闲的员工派活，
 * 走 office/agent/start 同代码路径 spawn 真实会话。单员工失败不影响其他，全程 try/catch 静默失败。
 *
 * 任务源优先级（默认**不再让模型凭空编活**）：
 *  ① 该员工档案里的「待办事项」第一条未完成项（src/office-todos.ts，在员工档案页手写；派出去即自动打勾）；
 *  ② 「有汇报但没验收结论」的旧活收尾（deps.pendingClose，只认老板派出的活）；
 *  ③ 模型微任务 —— 仅在 DSH_PWB_INVENT=1 时启用（默认关：避免无止境自己给自己派活）。
 * 三源都空 → 本轮跳过（日志写明原因）。
 *
 * 三道熔断（避免「开关一开就无止境给自己派活」）：
 *  ① 每人每日配额 DAILY_MAX 条（按本地日期自动归零）；
 *  ② 连续 NO_PROGRESS_LIMIT 轮「空闲但无新增记忆」或「任务重复」→ 自动关闭该员工开关；
 *  ③ 任务去重：与最近 20 条记忆/上一轮任务规范化后相同（或长度≥8 互相包含）→ 本轮跳过并记一次无进展；
 *     （只对③模型微任务生效：手写待办与收尾任务是指令，重复也要执行，靠熔断②兜底。）
 * 熔断状态落盘 ~/.dsh/personal-workbench/office_autopilot.json（读写静默失败 → 降级为无状态）。
 */
import * as fs from 'node:fs';
import { builtinOverrideOf, listAutopilotChars, loadMemoryNotes, setAutopilotFlag } from './office-roster.js';
import { markTodoDone, takeTodo } from './office-todos.js';

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
  /**
   * 收尾兜底：该员工有没有「有汇报但没验收结论」的老板派活。有则返回催办任务文本（调用方拼好）。
   * 缺省 = 不提供此来源。
   */
  pendingClose?: (id: string) => string | undefined;
}

const ROUND_MS = 30 * 60 * 1000;
const TASK_MAX = 120;
/** 每人每日自动派活上限（跨天自动归零）。 */
const DAILY_MAX = 3;
/** 连续无进展轮数达到此值 → 自动关闭该员工自觉开关。 */
const NO_PROGRESS_LIMIT = 2;
/** 允许模型凭空编微任务（默认关：任务源 = 老板手写待办 + 未验收收尾）。 */
const ALLOW_INVENTED = process.env.DSH_PWB_INVENT === '1';
/** 熔断状态文件（宿主重启后当日已派数仍生效）。 */
const STATE_FILE = `${process.env.HOME ?? ''}/.dsh/personal-workbench/office_autopilot.json`;

/** 单个员工的当日熔断状态。 */
type AutopilotState = {
  /** 本地日期 YYYY-MM-DD；不等于今天 → 视为新的一天，计数归零。 */
  day: string;
  /** 今日已派活条数。 */
  count: number;
  /** 连续无进展轮数（空闲无产出 / 任务重复）。 */
  fails: number;
  /** 上一轮派出的任务文本（去重用）。 */
  lastTask?: string;
  /** 派活当时的记忆条数：下一轮据此判断「有没有产出」。 */
  notes?: number;
};

function todayKey(d: Date = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function loadState(): Record<string, AutopilotState> {
  try {
    const obj: unknown = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    return typeof obj === 'object' && obj !== null ? (obj as Record<string, AutopilotState>) : {};
  } catch {
    return {};
  }
}

function saveState(state: Record<string, AutopilotState>): void {
  try {
    fs.mkdirSync(`${process.env.HOME ?? ''}/.dsh/personal-workbench`, { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(state));
  } catch {
    /* 落盘失败：降级为无状态，不影响派活 */
  }
}

/** 任务文本规范化（去空白与常见标点，便于判重）。 */
function normalizeTask(text: string): string {
  return text.replace(/[\s，。、；：！？,.;:!?"'「」『』（）()【】[\]]/g, '');
}

/** 是否与最近记忆 / 上一轮任务重复（相同，或长度≥8 的互相包含）。 */
function isDuplicate(task: string, recent: string[], lastTask?: string): boolean {
  const t = normalizeTask(task);
  if (t === '') return true;
  const pool = [...recent.map(normalizeTask), ...(lastTask !== undefined ? [normalizeTask(lastTask)] : [])];
  return pool.some((p) => p !== '' && (p === t || (t.length >= 8 && p.includes(t)) || (p.length >= 8 && t.includes(p))));
}

type OfficeStreamChunk = { type?: string; text?: unknown };

/** 直连 llm 生成微任务文本；服务缺失/异常/空返回 null（本轮跳过该员工）。 */
async function generateMicroTask(deps: OfficeAutopilotDeps, p: { id: string; name: string; role: string; persona?: string }): Promise<string | null> {
  const llm = deps.ctx.get('llm') as { stream?: (options: object) => AsyncIterable<OfficeStreamChunk> } | undefined;
  if (!llm || typeof llm.stream !== 'function') return null;
  const selection = (deps.ctx.get('agentDefaultModel') as
    | { currentSelection?: () => { provider?: unknown; model?: unknown; reasoningEffort?: unknown } }
    | undefined)?.currentSelection?.();
  // 员工专属模型覆盖优先（档案 builtin.provider/model）；空 = 跟随全局默认
  const ov = builtinOverrideOf(p.id);
  const provider =
    typeof ov?.provider === 'string' && ov.provider !== ''
      ? ov.provider
      : typeof selection?.provider === 'string' && selection.provider !== ''
        ? selection.provider
        : '';
  const model =
    typeof ov?.model === 'string' && ov.model !== ''
      ? ov.model
      : typeof selection?.model === 'string' && selection.model !== ''
        ? selection.model
        : '';
  if (model === '') return null;
  const modelOverridden = typeof ov?.model === 'string' && ov.model !== '';
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
      ...(provider !== '' ? { provider } : {}),
      model,
      messages: [
        { role: 'system', content: [{ type: 'text', text: sys }] },
        { role: 'user', content: [{ type: 'text', text: '现在生成。' }] },
      ],
      signal: AbortSignal.timeout(60_000),
      ...(!modelOverridden && typeof selection?.reasoningEffort === 'string' && selection.reasoningEffort !== ''
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

/** 跑一轮：读待办队列 → 逐个员工过熔断（配额/进展）→ 选任务源（待办 → 收尾 → 可选微任务）→ 派真会话。 */
async function runRound(deps: OfficeAutopilotDeps): Promise<void> {
  let chars: ReturnType<typeof listAutopilotChars> = [];
  try {
    chars = listAutopilotChars();
  } catch {
    return;
  }
  const state = loadState();
  const today = todayKey();
  for (const c of chars) {
    try {
      const cur = state[c.id];
      const st: AutopilotState = cur === undefined || cur.day !== today ? { day: today, count: 0, fails: 0 } : cur;
      state[c.id] = st;
      // 熔断① 当日配额
      if (st.count >= DAILY_MAX) {
        deps.log.info(`[personal-workbench] office autopilot 跳过 ${c.name}：今日配额已用满（${DAILY_MAX} 条）`);
        continue;
      }
      // 还在干活：不派活也不计无进展（长任务可能跨轮）
      if (deps.isBusy(c.id)) continue;
      const notes = loadMemoryNotes(c.id);
      // 熔断② 上一轮以来有没有产出：基线 st.notes 是上一轮评估时的记忆条数
      const baseline = st.notes;
      if (baseline !== undefined && notes.length <= baseline) {
        st.fails += 1;
        deps.log.warn(`[personal-workbench] office autopilot ${c.name} 连续无产出 ${st.fails}/${NO_PROGRESS_LIMIT} 轮`);
      } else if (st.fails !== 0) {
        st.fails = 0;
      }
      // 基线前移：下一轮只认「这一轮之后」新增的记忆（否则一次产出会被反复当成新进展）
      st.notes = notes.length;
      if (st.fails >= NO_PROGRESS_LIMIT) {
        setAutopilotFlag(c.id, false);
        delete state[c.id];
        deps.log.warn(`[personal-workbench] office autopilot 连续 ${NO_PROGRESS_LIMIT} 轮无产出，已自动关闭 ${c.name} 的自觉开关`);
        continue;
      }
      // 任务源：① 该员工档案里的待办 → ② 未验收旧活收尾 → ③ 可选模型微任务 → 都空则跳过
      let task: string | null = null;
      let source = '';
      const todo = takeTodo(c.id);
      if (todo !== undefined) {
        task = todo.text;
        source = '员工待办';
      } else {
        const close = deps.pendingClose?.(c.id);
        if (typeof close === 'string' && close.trim() !== '') {
          task = close.trim();
          source = '收尾未验收';
        } else if (ALLOW_INVENTED) {
          const inv = await generateMicroTask(deps, c);
          if (inv !== null) {
            task = inv;
            source = '模型微任务';
          }
        }
      }
      if (task === null) {
        deps.log.info(`[personal-workbench] office autopilot 跳过 ${c.name}：员工待办与未验收旧活都空（不凭空派活）`);
        continue;
      }
      // 熔断③ 去重：只对模型微任务生效（手写待办/收尾是指令，重复也要执行，靠熔断②兜底）
      if (source === '模型微任务' && isDuplicate(task, notes.slice(-20).map((n) => n.text), st.lastTask)) {
        st.fails += 1;
        deps.log.warn(`[personal-workbench] office autopilot ${c.name} 生成的任务与近期重复（${st.fails}/${NO_PROGRESS_LIMIT}），跳过：${task}`);
        if (st.fails >= NO_PROGRESS_LIMIT) {
          setAutopilotFlag(c.id, false);
          delete state[c.id];
          deps.log.warn(`[personal-workbench] office autopilot 连续 ${NO_PROGRESS_LIMIT} 轮无产出/重复，已自动关闭 ${c.name} 的自觉开关`);
        }
        continue;
      }
      await deps.dispatch(c.id, c.name, c.role, task);
      // 员工待办：派出去即自动打勾（在档案里取消勾选 = 允许再派一次）
      if (todo !== undefined) {
        try {
          markTodoDone(c.id, todo.id, c.name);
        } catch (err) {
          deps.log.warn(`[personal-workbench] office 待办打勾失败 ${c.name}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      st.count += 1;
      st.lastTask = task;
      // 注意：这里**不重置 fails**——只有「这一轮看到新产出」才算进展（熔断②靠这一点连坐两轮）。
      deps.log.info(`[personal-workbench] office autopilot 已派活 ${c.name}（${c.role}）今日第 ${st.count}/${DAILY_MAX} 条 · 来源=${source}：${task}`);
    } catch (err) {
      deps.log.warn(`[personal-workbench] office autopilot 派活失败 ${c.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  saveState(state);
}

/** 安装 autopilot 定时器（30 分钟一轮，unref 不阻退出）；返回停表函数（重复安装返回既有停表）。 */
export function installOfficeAutopilot(deps: OfficeAutopilotDeps): () => void {
  const timer = setInterval(() => {
    void runRound(deps).catch(() => {});
  }, ROUND_MS);
  if (typeof timer.unref === 'function') timer.unref();
  return () => clearInterval(timer);
}
