/**
 * 办公室真工位 agent 客户端：花名册（roster 持久化）+ 真实会话（start/say/stop/agents）+ 移交（handoff）。
 * 统一封装 fetch，URL 前缀 /api/personal-workbench/office/...；错误一律抛 Error(message)（message 来自宿主 {ok:false,error:{message}}）。
 */

const BASE = '/api/personal-workbench/office';

/** 自定义员工花名册条目（默认六名 NPC 由客户端内置，不在此列）。 */
export type RosterEntry = { id: string; name: string; role: string };

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

async function postJson<T>(path: string, body: Record<string, string>): Promise<T> {
  const res = await fetch(`${BASE}/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await errMessage(res, `请求失败（${res.status}）`));
  return (await res.json()) as T;
}

/** 读取自定义员工花名册；网络/宿主不可达时抛错（由调用方展示），宿主返回缺 roster 字段按空数组。 */
export async function loadRoster(): Promise<RosterEntry[]> {
  const data = await getJson<{ roster?: RosterEntry[] }>('roster');
  return Array.isArray(data.roster) ? data.roster : [];
}

/** 新增自定义员工；成功返回宿主生成的新条目（id 为 custom-<序号>）。 */
export async function addRosterEntry(name: string, role: string): Promise<RosterEntry> {
  const data = await postJson<{ entry?: RosterEntry }>('roster', { name, role });
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

/** 判断错误是否为「端点不存在」（旧宿主未重启，尚无真工位功能；404 或宿主未知端点文案）。 */
export function isEndpointMissing(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return err.message.includes('404') || err.message.includes('未知端点');
}
