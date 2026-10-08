/**
 * 办公室真工位 agent 客户端：花名册（roster 持久化）+ 真实会话（start/say/stop/agents）+ 移交（handoff）。
 * 统一封装 fetch，URL 前缀 /api/personal-workbench/office/...；错误一律抛 Error(message)（message 来自宿主 {ok:false,error:{message}}）。
 */

const BASE = '/api/personal-workbench/office';

/** 自定义员工花名册条目（默认六名 NPC 由客户端内置，不在此列）。 */
export type RosterEntry = { id: string; name: string; role: string };

/** 员工的可编辑属性覆盖（宿主按 charId 合并进人设/提示词；对内置与自定义员工都有效）。 */
export type BuiltinOverride = {
  name?: string;
  role?: string;
  /** 性格描述：会作为人设喂给该员工的 agent。 */
  persona?: string;
  /** 同事链：协作关系描述，每行一条。 */
  links?: string[];
  /** 自觉工作开关：开了不派活也会自己找活干。 */
  autopilot?: boolean;
  /** 指定工位：地图里的桌子 id；空串/缺省 = 自动分配。 */
  deskId?: string;
  /** 员工专属模型 provider：空串/缺省 = 跟随宿主全局默认。 */
  provider?: string;
  /** 员工专属模型 id：空串/缺省 = 跟随全局默认（聊天/派活/自觉工作都生效）。 */
  model?: string;
};

export type RosterResult = { roster: RosterEntry[]; builtin?: Record<string, BuiltinOverride> };

/** 员工记忆条目（宿主真实会话产生的工作记录）。 */
export type MemoryNote = { t: number; text: string };

/** office/agents 返回的真工位会话快照（status: working | idle | stopped）。 */
export type AgentRow = {
  npcId: string;
  name?: string;
  role?: string;
  task?: string;
  status: string;
  lastText: string;
  report?: string;
  reportAt?: number;
  startedAt?: number;
  updatedAt?: number;
};

/** 从宿主错误响应掏出人类可读消息；掏不到用 fallback。 */
async function errMessage(res: Response, fallback: string): Promise<string> {
  try {
    const j = (await res.json()) as { error?: { message?: unknown } };
    if (typeof j.error?.message === 'string' && j.error.message !== '') return j.error.message;
  } catch {
    /* 非 JSON 响应用默认文案 */
  }
  return fallback;
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}/${path}`);
  if (!res.ok) throw new Error(await errMessage(res, `请求失败（${res.status}）`));
  return (await res.json()) as T;
}

async function postJson<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${BASE}/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await errMessage(res, `请求失败（${res.status}）`));
  return (await res.json()) as T;
}

/** 读取花名册（自定义员工 + 各员工属性覆盖 builtin；旧宿主无 builtin 字段 → undefined，调用方降级）。 */
export async function loadRoster(): Promise<RosterResult> {
  const data = await getJson<{ roster?: RosterEntry[]; builtin?: Record<string, BuiltinOverride> }>('roster');
  return {
    roster: Array.isArray(data.roster) ? data.roster : [],
    ...(data.builtin !== undefined && typeof data.builtin === 'object' ? { builtin: data.builtin } : {}),
  };
}

/** 保存员工属性覆盖（名称/职务/性格/同事链）。 */
export async function saveBuiltin(id: string, patch: BuiltinOverride): Promise<void> {
  await postJson('roster/builtin', { id, ...patch });
}

/** 自觉工作开关。 */
export async function setAutopilot(id: string, on: boolean): Promise<void> {
  await postJson('roster/autopilot', { id, on });
}

/** 员工记忆（真实会话产生的【工作记录】）。 */
export async function fetchMemory(char: string): Promise<MemoryNote[]> {
  const data = await getJson<{ notes?: MemoryNote[] }>(`memory?char=${encodeURIComponent(char)}`);
  return Array.isArray(data.notes) ? data.notes : [];
}

/** 追加一条员工记忆（实验用；面板 v1 只读展示，不调用）。 */
export async function addMemoryNote(char: string, text: string): Promise<void> {
  await postJson('memory', { char, text });
}

/** 新增自定义员工；成功返回宿主生成的新条目（id 为 custom-<序号>）。model 可选员工专属模型（`${provider}::${id}`；空 = 跟随默认）。 */
export async function addRosterEntry(name: string, role: string, model?: string): Promise<RosterEntry> {
  const raw = typeof model === 'string' ? model : '';
  const sep = raw.indexOf('::');
  const provider = sep > 0 ? raw.slice(0, sep) : '';
  const modelId = sep > 0 ? raw.slice(sep + 2) : raw;
  const data = await postJson<{ entry?: RosterEntry }>('roster', {
    name,
    role,
    ...(provider !== '' ? { provider } : {}),
    ...(modelId !== '' ? { model: modelId } : {}),
  });
  if (data.entry === undefined) throw new Error('宿主未返回新员工条目');
  return data.entry;
}

/** 拉取所有真工位会话快照（office/agents）。 */
export async function fetchAgentRows(): Promise<AgentRow[]> {
  const data = await getJson<{ agents?: AgentRow[] }>('agents');
  return Array.isArray(data.agents) ? data.agents : [];
}

/** 给 NPC 拉起真实 agent 会话并派活（cwd 缺省用用户主目录）。 */
export async function startAgent(opts: { npcId: string; name: string; role: string; task: string; cwd?: string }): Promise<void> {
  await postJson('agent/start', {
    npcId: opts.npcId,
    name: opts.name,
    role: opts.role,
    task: opts.task,
    ...(opts.cwd !== undefined ? { cwd: opts.cwd } : {}),
  });
}

/** 给干活中的 NPC 递话（排队下一轮）。 */
export async function sayToAgent(npcId: string, text: string): Promise<void> {
  await postJson('agent/say', { npcId, text });
}

/** 拆掉 NPC 的真实会话。 */
export async function stopAgent(npcId: string): Promise<void> {
  await postJson('agent/stop', { npcId });
}

/** 移交：from 把当前工作连同一句交接说明交给 to 接手；双方须都已派活开会话（否则宿主 400）。 */
export async function handoff(fromId: string, toId: string, note: string): Promise<void> {
  await postJson('agent/handoff', { fromId, toId, note });
}

/** 宿主可选模型（provider×model），供员工模型选择下拉。 */
export type OfficeModelOption = { provider: string; id: string; name: string };

let officeModelsCache: OfficeModelOption[] | undefined;

/** 枚举宿主 llm 模型清单（GET office/models；进程内缓存，失败返回 []，下拉只剩「跟随默认」）。 */
export async function officeListModels(): Promise<OfficeModelOption[]> {
  if (officeModelsCache !== undefined) return officeModelsCache;
  try {
    const data = await getJson<{ models?: OfficeModelOption[] }>('models');
    officeModelsCache = Array.isArray(data.models)
      ? data.models.filter((m) => typeof m?.provider === 'string' && m.provider !== '' && typeof m?.id === 'string' && m.id !== '')
      : [];
  } catch {
    officeModelsCache = [];
  }
  return officeModelsCache;
}

/** 判断错误是否为「端点不存在」（旧宿主未重启，尚无真工位功能；404 或宿主未知端点文案）。 */
export function isEndpointMissing(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return err.message.includes('404') || err.message.includes('未知端点');
}
