/**
 * 办公室员工扩展数据：花名册持久化（roster + builtin 属性覆盖同文件）+ 自生长记忆。
 *
 * office_agents.json 结构：
 *   { roster: [{id,name,role}...], builtin?: { [charId]: {name?,role?,persona?,links?,autopilot?} } }
 *   - v1 兼容：老文件无 builtin 字段 → 读作 {}；
 *   - 自定义员工 POST（旧逻辑）仍写 roster 数组，本模块统一负责整文件落盘，builtin 不丢。
 * office_memory/<charId>.json 结构：{ notes: [{t, text}...] }（≤50 条，丢最旧）。
 *
 * 约定：全部读写静默 try/catch（持久化失败不影响 office 主流程）；charId 白名单 [a-z0-9-]+ 防路径穿越。
 */
import * as fs from 'node:fs';

const PW_DIR = `${process.env.HOME ?? ''}/.dsh/personal-workbench`;
const ROSTER_FILE = `${PW_DIR}/office_agents.json`;
const MEMORY_DIR = `${PW_DIR}/office_memory`;

export type OfficeRosterEntry = { id: string; name: string; role: string };

/** 员工可编辑属性覆盖（对内置六 NPC 与自定义员工都有效）。 */
export type OfficeBuiltinOverride = {
  name?: string;
  role?: string;
  /** 性格描述：注入 agent system 提示词。 */
  persona?: string;
  /** 同事链：协作关系短句，逐条注入。 */
  links?: string[];
  /** 自觉工作开关：开了不派活也自己找活干（autopilot）。 */
  autopilot?: boolean;
  /** 指定工位：客户端地图里的桌子 id；空/缺省 = 自动分配。 */
  deskId?: string;
  /** 员工专属模型 provider：空串/缺省 = 跟随宿主全局默认。 */
  provider?: string;
  /** 员工专属模型 id：空串/缺省 = 跟随全局默认（聊天/派活/自觉工作共用；配快的非思考模型可避免流式静默超时）。 */
  model?: string;
  /** 能力评估：固定维度（OFFICE_SKILL_DIMS）→ 0-100 分。员工档案编辑，注入派活/私聊提示词做角色定位。 */
  skills?: Record<string, number>;
};

/** 能力评估固定维度（员工档案编辑与 personaPromptSuffix 注入共用同一顺序）。 */
export const OFFICE_SKILL_DIMS: readonly string[] = ['代码', '架构', '测试', '设计', '沟通', '业务', '数据'];

/** 内置六名 NPC 的稳定身份（与客户端 client/src/office/engine.ts BUILTIN_STAFF 一致：npc-1..npc-6）。 */
export const OFFICE_BUILTIN_SIX: Array<{ id: string; name: string; role: string }> = [
  { id: 'npc-1', name: '小周', role: '前端工程师' },
  { id: 'npc-2', name: '阿琳', role: '产品经理' },
  { id: 'npc-3', name: '老王', role: '架构师' },
  { id: 'npc-4', name: '大鹏', role: '测试工程师' },
  { id: 'npc-5', name: '小陈', role: '设计师' },
  { id: 'npc-6', name: '阿福', role: '运营' },
];

const CHAR_ID_RE = /^[a-z0-9-]{1,32}$/;

/** charId 白名单校验（memory 文件名安全 + builtin 键安全）。 */
export function isValidCharId(id: string): boolean {
  return CHAR_ID_RE.test(id);
}

/** 合法员工 id 全集 = 内置六 NPC ∪ 自定义花名册条目。 */
function knownCharIds(roster: OfficeRosterEntry[]): Set<string> {
  return new Set([...OFFICE_BUILTIN_SIX.map((c) => c.id), ...roster.map((r) => r.id)]);
}

export type OfficeRosterExt = { roster: OfficeRosterEntry[]; builtin: Record<string, OfficeBuiltinOverride> };

/** 读 office_agents.json，返回花名册 + 属性覆盖（v1 无 builtin → {}；坏文件 → 全空）。 */
export function loadOfficeRosterExt(): OfficeRosterExt {
  try {
    const data = JSON.parse(fs.readFileSync(ROSTER_FILE, 'utf8')) as { roster?: unknown; builtin?: unknown };
    const roster: OfficeRosterEntry[] = [];
    if (Array.isArray(data.roster)) {
      for (const r of data.roster) {
        if (r === null || typeof r !== 'object') continue;
        const e = r as { id?: unknown; name?: unknown; role?: unknown };
        if (typeof e.id === 'string' && typeof e.name === 'string' && typeof e.role === 'string' && e.name.trim() !== '') {
          roster.push({ id: e.id, name: e.name, role: e.role });
        }
      }
    }
    const builtin: Record<string, OfficeBuiltinOverride> = {};
    if (data.builtin !== null && typeof data.builtin === 'object' && !Array.isArray(data.builtin)) {
      for (const [k, v] of Object.entries(data.builtin as Record<string, unknown>)) {
        if (!CHAR_ID_RE.test(k) || v === null || typeof v !== 'object' || Array.isArray(v)) continue;
        const o = v as OfficeBuiltinOverride;
        const clean: OfficeBuiltinOverride = {};
        if (typeof o.name === 'string' && o.name.trim() !== '') clean.name = o.name.trim().slice(0, 20);
        if (typeof o.role === 'string' && o.role.trim() !== '') clean.role = o.role.trim().slice(0, 20);
        if (typeof o.persona === 'string' && o.persona.trim() !== '') clean.persona = o.persona.trim().slice(0, 300);
        if (Array.isArray(o.links)) {
          const links = o.links
            .filter((l): l is string => typeof l === 'string' && l.trim() !== '')
            .map((l) => l.trim().slice(0, 40))
            .slice(0, 10);
          if (links.length > 0) clean.links = links;
        }
        if (o.autopilot === true) clean.autopilot = true;
        if (typeof o.deskId === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(o.deskId.trim())) clean.deskId = o.deskId.trim();
        if (typeof o.provider === 'string' && o.provider.trim() !== '') clean.provider = o.provider.trim().slice(0, 64);
        if (typeof o.model === 'string' && o.model.trim() !== '') clean.model = o.model.trim().slice(0, 64);
        if (o.skills !== null && typeof o.skills === 'object' && !Array.isArray(o.skills)) {
          const skills: Record<string, number> = {};
          for (const dim of OFFICE_SKILL_DIMS) {
            const v = (o.skills as Record<string, unknown>)[dim];
            if (typeof v === 'number' && Number.isFinite(v)) skills[dim] = Math.max(0, Math.min(100, Math.round(v)));
          }
          if (Object.keys(skills).length > 0) clean.skills = skills;
        }
        if (Object.keys(clean).length > 0) builtin[k] = clean;
      }
    }
    return { roster, builtin };
  } catch {
    return { roster: [], builtin: {} };
  }
}

/** 整文件落盘（roster + builtin 一起写；builtin 为空对象时不写该键，保持 v1 文件形状）。 */
export function saveOfficeRosterList(roster: OfficeRosterEntry[], builtin: Record<string, OfficeBuiltinOverride>): void {
  try {
    fs.mkdirSync(PW_DIR, { recursive: true });
    fs.writeFileSync(ROSTER_FILE, JSON.stringify({ roster, ...(Object.keys(builtin).length > 0 ? { builtin } : {}) }, null, 2), 'utf8');
  } catch {
    /* 写失败仅影响持久化，下次改动重写 */
  }
}

function clampField(v: unknown, max: number): string | undefined {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t === '' ? '' : t.slice(0, max);
}

/**
 * upsert 员工属性覆盖。patch 语义：字段缺省=不动；字符串（含空串）=设置（空串=清除该字段）；
 * links 数组（含空数组）=整体替换（空数组=清除）；skills 对象（含空对象）=整体替换（空对象=清除，
 * 仅接受 OFFICE_SKILL_DIMS 内维度、数值钳 0-100）。id 不在白名单或字段非法时抛 Error。
 * 返回更新后的完整 builtin 表（已落盘）。
 */
export function upsertBuiltinOverride(
  id: string,
  patch: { name?: unknown; role?: unknown; persona?: unknown; links?: unknown; deskId?: unknown; provider?: unknown; model?: unknown; skills?: unknown },
): Record<string, OfficeBuiltinOverride> {
  if (!isValidCharId(id)) throw new Error('id 必须为合法员工 id');
  const ext = loadOfficeRosterExt();
  if (!knownCharIds(ext.roster).has(id)) throw new Error('未知员工 id');
  const cur: OfficeBuiltinOverride = { ...(ext.builtin[id] ?? {}) };
  const name = clampField(patch.name, 20);
  if (name !== undefined) {
    if (name === '') delete cur.name;
    else cur.name = name;
  }
  const role = clampField(patch.role, 20);
  if (role !== undefined) {
    if (role === '') delete cur.role;
    else cur.role = role;
  }
  const persona = clampField(patch.persona, 300);
  if (persona !== undefined) {
    if (persona === '') delete cur.persona;
    else cur.persona = persona;
  }
  if (patch.links !== undefined) {
    if (!Array.isArray(patch.links)) throw new Error('links 必须为字符串数组（每条 ≤40 字，最多 10 条）');
    const links = patch.links
      .filter((l): l is string => typeof l === 'string' && l.trim() !== '')
      .map((l) => l.trim().slice(0, 40))
      .slice(0, 10);
    if (links.length === 0) delete cur.links;
    else cur.links = links;
  }
  if (patch.deskId !== undefined) {
    if (typeof patch.deskId !== 'string') throw new Error('deskId 必须为字符串');
    const deskId = patch.deskId.trim();
    if (deskId === '') delete cur.deskId;
    else if (!/^[A-Za-z0-9_-]{1,40}$/.test(deskId)) throw new Error('deskId 格式非法');
    else cur.deskId = deskId;
  }
  const provider = clampField(patch.provider, 64);
  if (provider !== undefined) {
    if (provider === '') delete cur.provider;
    else cur.provider = provider;
  }
  const model = clampField(patch.model, 64);
  if (model !== undefined) {
    if (model === '') delete cur.model;
    else cur.model = model;
  }
  if (patch.skills !== undefined) {
    if (patch.skills === null || typeof patch.skills !== 'object' || Array.isArray(patch.skills)) {
      throw new Error('skills 必须为「维度 → 0-100 分」的对象');
    }
    const rawSkills = patch.skills as Record<string, unknown>;
    const skills: Record<string, number> = {};
    for (const dim of OFFICE_SKILL_DIMS) {
      const v = rawSkills[dim];
      if (typeof v === 'number' && Number.isFinite(v)) skills[dim] = Math.max(0, Math.min(100, Math.round(v)));
    }
    if (Object.keys(skills).length === 0) delete cur.skills;
    else cur.skills = skills;
  }
  if (Object.keys(cur).length > 0) ext.builtin[id] = cur;
  else delete ext.builtin[id];
  saveOfficeRosterList(ext.roster, ext.builtin);
  return ext.builtin;
}

/** 自觉工作开关。on=false 时删除该字段（缺省即关）。返回更新后的完整 builtin 表（已落盘）。 */
export function setAutopilotFlag(id: string, on: boolean): Record<string, OfficeBuiltinOverride> {
  if (!isValidCharId(id)) throw new Error('id 必须为合法员工 id');
  const ext = loadOfficeRosterExt();
  if (!knownCharIds(ext.roster).has(id)) throw new Error('未知员工 id');
  const cur: OfficeBuiltinOverride = { ...(ext.builtin[id] ?? {}) };
  if (on) cur.autopilot = true;
  else delete cur.autopilot;
  if (Object.keys(cur).length > 0) ext.builtin[id] = cur;
  else delete ext.builtin[id];
  saveOfficeRosterList(ext.roster, ext.builtin);
  return ext.builtin;
}

/** 按员工 id 取属性覆盖（无覆盖返回 undefined）。 */
export function builtinOverrideOf(id: string): OfficeBuiltinOverride | undefined {
  return loadOfficeRosterExt().builtin[id];
}

/** 按 id 解析员工的展示名/职务：覆盖值 → 内置六 NPC 默认 → 自定义花名册（找不到返回 undefined）。 */
export function resolveCharById(id: string): { id: string; name: string; role: string } | undefined {
  const ext = loadOfficeRosterExt();
  const ov = ext.builtin[id];
  const base = OFFICE_BUILTIN_SIX.find((c) => c.id === id) ?? ext.roster.find((r) => r.id === id);
  if (base === undefined && (ov?.name === undefined || ov.name === '')) return undefined;
  return {
    id,
    name: ov?.name !== undefined && ov.name !== '' ? ov.name : (base?.name ?? ''),
    role: ov?.role !== undefined && ov.role !== '' ? ov.role : (base?.role ?? '同事'),
  };
}

/**
 * 全员花名册一行文本（供员工真会话的协作协议用，让模型知道能派活给谁）：
 * 「小周(前端工程师)、阿琳(产品经理)、…」；excludeId 自己除外。
 */
export function rosterSummary(excludeId: string): string {
  const ext = loadOfficeRosterExt();
  const all = [
    ...OFFICE_BUILTIN_SIX.map((c) => ({ id: c.id, name: ext.builtin[c.id]?.name || c.name, role: ext.builtin[c.id]?.role || c.role })),
    ...ext.roster.map((r) => ({ id: r.id, name: ext.builtin[r.id]?.name || r.name, role: ext.builtin[r.id]?.role || r.role })),
  ];
  return all
    .filter((c) => c.id !== excludeId && c.name !== '')
    .map((c) => `${c.name}(${c.role})`)
    .join('、');
}

/**
 * 按名字定位员工 id（office/npc/chat 请求体只带 name/role，无 id）：
 * ① 覆盖后的名字（改过名的员工用新名字命中）→ ② 内置六 NPC 默认名 → ③ 自定义花名册名。
 */
export function findCharIdByName(name: string): string | undefined {
  const t = name.trim();
  if (t === '') return undefined;
  const ext = loadOfficeRosterExt();
  for (const [id, ov] of Object.entries(ext.builtin)) {
    if (ov.name === t) return id;
  }
  const hit = OFFICE_BUILTIN_SIX.find((c) => c.name === t);
  if (hit !== undefined) return hit.id;
  return ext.roster.find((r) => r.name === t)?.id;
}

/** 人设注入后缀：有覆盖时返回「你的性格：…」+「能力评估：…」+「团队协作：- …」文本段（含前导换行），无覆盖返回空串。 */
export function personaPromptSuffix(ov: OfficeBuiltinOverride | undefined): string {
  if (!ov) return '';
  const lines: string[] = [];
  if (ov.persona !== undefined && ov.persona !== '') lines.push(`你的性格：${ov.persona}`);
  if (ov.skills !== undefined) {
    const parts = OFFICE_SKILL_DIMS.filter((d) => ov.skills?.[d] !== undefined).map((d) => `${d} ${ov.skills?.[d]}`);
    if (parts.length > 0) lines.push(`能力评估（0-100，按此定位分工与产出标准）：${parts.join('、')}`);
  }
  if (ov.links !== undefined && ov.links.length > 0) {
    lines.push(`团队协作：\n${ov.links.map((l) => `- ${l}`).join('\n')}`);
  }
  return lines.length > 0 ? `\n${lines.join('\n')}` : '';
}

/* ── 自生长记忆：office_memory/<charId>.json ── */

export type OfficeMemoryNote = { t: number; text: string };

const MEMORY_MAX = 50;
const MEMORY_TEXT_MAX = 400;

function readMemoryFile(charId: string): OfficeMemoryNote[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(`${MEMORY_DIR}/${charId}.json`, 'utf8')) as { notes?: unknown };
    if (!Array.isArray(parsed.notes)) return [];
    const notes: OfficeMemoryNote[] = [];
    for (const n of parsed.notes) {
      if (n === null || typeof n !== 'object') continue;
      const e = n as { t?: unknown; text?: unknown };
      if (typeof e.t === 'number' && Number.isFinite(e.t) && typeof e.text === 'string' && e.text.trim() !== '') {
        notes.push({ t: e.t, text: e.text.slice(0, MEMORY_TEXT_MAX) });
      }
    }
    return notes;
  } catch {
    return [];
  }
}

/** 读员工记忆（按时间升序；无记忆/非法 id 返回空数组）。 */
export function loadMemoryNotes(charId: string): OfficeMemoryNote[] {
  if (!isValidCharId(charId)) return [];
  return readMemoryFile(charId);
}

/** 追加一条员工记忆（≤400 字，最多 50 条丢最旧；非法 id 静默忽略，全程不抛）。 */
export function appendMemoryNote(charId: string, text: string): void {
  try {
    if (!isValidCharId(charId)) return;
    const t = text.trim().slice(0, MEMORY_TEXT_MAX);
    if (t === '') return;
    fs.mkdirSync(MEMORY_DIR, { recursive: true });
    const notes = readMemoryFile(charId);
    notes.push({ t: Date.now(), text: t });
    const trimmed = notes.length > MEMORY_MAX ? notes.slice(notes.length - MEMORY_MAX) : notes;
    fs.writeFileSync(`${MEMORY_DIR}/${charId}.json`, JSON.stringify({ notes: trimmed }, null, 2), 'utf8');
  } catch {
    /* 记忆失败不影响主流程 */
  }
}

/** 删除员工记忆第 index 条（0 基；越界/非法 id 返回 false，不抛）。 */
export function removeMemoryNote(charId: string, index: number): boolean {
  if (!isValidCharId(charId) || !Number.isInteger(index)) return false;
  try {
    const notes = readMemoryFile(charId);
    if (index < 0 || index >= notes.length) return false;
    notes.splice(index, 1);
    if (notes.length === 0) {
      try {
        fs.rmSync(`${MEMORY_DIR}/${charId}.json`, { force: true });
      } catch {
        /* 留下空文件不影响后续写入 */
      }
      return true;
    }
    fs.mkdirSync(MEMORY_DIR, { recursive: true });
    fs.writeFileSync(`${MEMORY_DIR}/${charId}.json`, JSON.stringify({ notes }, null, 2), 'utf8');
    return true;
  } catch {
    return false;
  }
}

/** 清空员工记忆（删除记忆文件；非法 id 返回 false，不抛）。 */
export function clearMemoryNotes(charId: string): boolean {
  if (!isValidCharId(charId)) return false;
  try {
    fs.rmSync(`${MEMORY_DIR}/${charId}.json`, { force: true });
    return true;
  } catch {
    return false;
  }
}

/** 枚举开了自觉工作的员工（内置六 ∪ 自定义，名字/职务/性格用覆盖值）。供 autopilot 轮询。 */
export function listAutopilotChars(): Array<{ id: string; name: string; role: string; persona?: string }> {
  const ext = loadOfficeRosterExt();
  const all: Array<{ id: string; name: string; role: string }> = [...OFFICE_BUILTIN_SIX, ...ext.roster];
  const out: Array<{ id: string; name: string; role: string; persona?: string }> = [];
  for (const c of all) {
    const ov = ext.builtin[c.id];
    if (ov?.autopilot !== true) continue;
    out.push({
      id: c.id,
      name: ov.name ?? c.name,
      role: ov.role ?? c.role,
      ...(ov.persona !== undefined && ov.persona !== '' ? { persona: ov.persona } : {}),
    });
  }
  return out;
}
