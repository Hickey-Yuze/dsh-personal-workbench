/**
 * 模块：像素办公室 —— P1 场景 + P2 互动 + P3 编辑器 + P4 对话 + P5 员工档案/动作网关
 * + P4.5 同事 agent 联动：点谁跟谁聊（私聊）、全员群聊互聊、会议讨论；NPC 回复冒泡到头上。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, ReactElement } from 'react';
import { ImagePlus } from 'lucide-react';
import { OfficeEngine } from '../office/engine.js';
import { OfficeCanvas } from '../office/OfficeCanvas.js';
import { loadOfficeMap } from '../office/store.js';
import { deskChairCell } from '../office/map.js';
import type { OfficeMap } from '../office/types.js';
import type { MemberStat } from '../office/types.js';
import type { OfficeView } from '../office/renderer.js';
import { addRosterEntry, isEndpointMissing, loadRoster, officeListModels } from '../office/agentClient.js';
import type { BuiltinOverride, OfficeModelOption, RosterEntry } from '../office/agentClient.js';
import { OfficeEditor } from './OfficeEditor.js';
import { OfficeProfileView } from './OfficeProfileView.js';
import { OfficeAgentPanel } from './OfficeAgentPanel.js';

const STATE_TEXT: Record<MemberStat['state'], string> = {
  idle: '摸鱼中',
  walking: '走动中',
  working: '工作中',
  coffee: '咖啡时间',
  visit: '拜访同事',
  meeting: '会议中',
};

type Tab = 'scene' | 'data' | 'edit';

type ChatImage = { mediaType: string; data: string; name?: string };
type ChatMsg = { role: 'user' | 'assistant'; content: string; speaker?: string; streaming?: boolean; images?: ChatImage[] };
type ChatTarget = { kind: 'ai' } | { kind: 'npc'; id: string; name: string; role: string } | { kind: 'group' };
/** 群聊/私聊共享记忆：speaker='me' 是老板说的话，否则是同事名。 */
type MemEntry = { speaker: string; content: string; images?: ChatImage[] };

/** 服务端 wire 分段（content 既可 string 也可分段数组；此处统一为分段）。 */
type WirePart = { type: 'text'; text: string } | { type: 'image'; mediaType: string; data: string; name?: string };
type WireMsg = { role: 'user' | 'assistant'; content: WirePart[] };

/** 把界面消息（文本 + 附图）转成 wire 分段；全空时保留空文本段占位。 */
function partsOf(m: { content: string; images?: ChatImage[] }): WirePart[] {
  const parts: WirePart[] = [];
  if (m.content !== '') parts.push({ type: 'text', text: m.content });
  for (const img of m.images ?? []) {
    parts.push({ type: 'image', mediaType: img.mediaType, data: img.data, ...(img.name !== undefined ? { name: img.name } : {}) });
  }
  if (parts.length === 0) parts.push({ type: 'text', text: '' });
  return parts;
}

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const IMAGE_SIZE_MAX = 8 * 1024 * 1024;

/** File → ChatImage（base64，不含 data: 前缀）；格式/大小不符直接 reject。 */
function fileToChatImage(file: File): Promise<ChatImage> {
  return new Promise((resolve, reject) => {
    if (!IMAGE_TYPES.includes(file.type)) {
      reject(new Error('仅支持 PNG/JPEG/WebP/GIF 图片'));
      return;
    }
    if (file.size > IMAGE_SIZE_MAX) {
      reject(new Error(`图片超过 8MB（${(file.size / 1024 / 1024).toFixed(1)}MB）`));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result ?? '');
      const idx = url.indexOf(',');
      if (idx < 0) {
        reject(new Error('图片读取失败'));
        return;
      }
      resolve({ mediaType: file.type, data: url.slice(idx + 1), name: file.name !== '' ? file.name : undefined });
    };
    reader.onerror = () => reject(new Error('图片读取失败'));
    reader.readAsDataURL(file);
  });
}

type OfficeAction = { id: number; type: 'desk_visit' | 'desk_visit_tour' | 'set_state'; payload?: Record<string, unknown> };

const CHAT_URL = '/api/personal-workbench/office/chat';
const NPC_CHAT_URL = '/api/personal-workbench/office/npc/chat';
const ACTIONS_URL = '/api/personal-workbench/office/actions';
const AGENTS_URL = '/api/personal-workbench/office/agents';

/** 真工位会话快照（office/agents 轮询返回的NPC 条目）。 */
type AgentRow = { npcId: string; name?: string; status: string; lastText: string; task?: string; report?: string; reportAt?: number };

/* ── 左右分栏：左列宽度比例（0.3~0.8），存 localStorage 进视图恢复，拖拽分隔条实时调整 ── */
const SPLIT_KEY = 'dsh-pwb:office_split_v1';
const SPLIT_MIN = 0.3;
const SPLIT_MAX = 0.8;
const SPLIT_DEFAULT = 0.6;
function clampSplit(v: number): number {
  return Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, v));
}
function loadSplit(): number {
  try {
    const raw = window.localStorage.getItem(SPLIT_KEY);
    if (raw === null) return SPLIT_DEFAULT;
    const v = Number(raw);
    return Number.isFinite(v) ? clampSplit(v) : SPLIT_DEFAULT;
  } catch {
    return SPLIT_DEFAULT;
  }
}

/* ── 聊天记录持久化：按会话对象分键存 localStorage，重进视图不丢记录 ── */
const CHAT_CAP = 100;
function chatKeyOf(t: ChatTarget): string {
  return t.kind === 'ai' ? 'dsh-pwb:office_chat_v1:ai' : t.kind === 'group' ? 'dsh-pwb:office_chat_v1:group' : `dsh-pwb:office_chat_v1:npc:${t.id}`;
}
function loadChatMsgs(t: ChatTarget): ChatMsg[] {
  try {
    const raw = window.localStorage.getItem(chatKeyOf(t));
    if (raw === null) return [];
    const arr = JSON.parse(raw) as ChatMsg[];
    if (!Array.isArray(arr)) return [];
    return arr.slice(-CHAT_CAP).map((m) => ({ ...m, streaming: false }));
  } catch {
    return [];
  }
}
function saveChatMsgs(t: ChatTarget, msgs: ChatMsg[]): void {
  const key = chatKeyOf(t);
  const list = msgs.filter((m) => m.streaming !== true).slice(-CHAT_CAP);
  try {
    window.localStorage.setItem(key, JSON.stringify(list));
    return;
  } catch { /* 可能是附图撑爆配额：降级重存 */ }
  // 配额不足 → 从最旧开始丢图片数据（先只留最近 5 条的图，再全丢）
  for (const keepImages of [5, 0]) {
    try {
      const trimmed = list.map((m, i) => (i < list.length - keepImages && m.images !== undefined ? { ...m, images: undefined } : m));
      window.localStorage.setItem(key, JSON.stringify(trimmed));
      return;
    } catch { /* 继续降级 */ }
  }
}

/** 读取 SSE 流，逐 delta 回调，返回完整文本；非流式/空流都在气泡里给出原因。 */
async function readSse(res: Response, onDelta: (d: string) => void, onErr: (e: string) => void): Promise<string> {
  let full = '';
  if (!res.ok || res.body === null) {
    const detail = await res.text().catch(() => '');
    let msg = detail;
    try {
      const j = JSON.parse(detail) as { error?: { message?: string } } | null;
      if (typeof j?.error?.message === 'string' && j.error.message !== '') msg = j.error.message;
    } catch { /* 非 JSON 错误体按原文展示 */ }
    onErr(`对话服务不可用（${res.status}）${msg !== '' ? `：${msg.slice(0, 140)}` : ''}`);
    return full;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const parts = buf.split('\n\n');
    buf = parts.pop() ?? '';
    for (const part of parts) {
      const line = part.trim();
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (payload === '[DONE]') continue;
      try {
        const obj = JSON.parse(payload) as { delta?: string; error?: string };
        if (obj.error !== undefined) onErr(obj.error);
        else if (obj.delta !== undefined && obj.delta !== '') {
          full += obj.delta;
          onDelta(obj.delta);
        }
      } catch {
        /* 非 JSON 行忽略 */
      }
    }
  }
  const leftover = buf.trim();
  if (full === '' && leftover !== '') onErr(`服务返回非流式响应：${leftover.slice(0, 140)}`);
  return full;
}

export function OfficeModuleView(): ReactElement {
  const [engine, setEngine] = useState<OfficeEngine>(() => new OfficeEngine(loadOfficeMap() ?? undefined));
  const [members, setMembers] = useState<MemberStat[]>(() => engine.members());
  const [officeView, setOfficeView] = useState<OfficeView>({}); // 场景缩放/平移（滚轮+按钮）
  const [char3d, setChar3d] = useState(false); // 人物 3D OBJ 模型开关（默认 2D 手绘小人）
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [builtinOverrides, setBuiltinOverrides] = useState<Record<string, BuiltinOverride>>({});
  const [hireName, setHireName] = useState('');
  const [hireRole, setHireRole] = useState('');
  /** 入职可选模型（`${provider}::${id}`；空 = 跟随宿主全局默认）。 */
  const [hireModel, setHireModel] = useState('');
  const [modelOptions, setModelOptions] = useState<OfficeModelOption[]>([]);
  const [hireBusy, setHireBusy] = useState(false);
  const [hireErr, setHireErr] = useState('');
  const [tab, setTab] = useState<Tab>('scene');
  const [chatOpen, setChatOpen] = useState(true);
  const [chatTarget, setChatTarget] = useState<ChatTarget>({ kind: 'ai' });
  const [chatMsgs, setChatMsgs] = useState<ChatMsg[]>([]);
  const [chatInput, setChatInput] = useState('');
  /** 待发送附图（贴图/选图后暂存，发送即清空）。 */
  const [chatImages, setChatImages] = useState<ChatImage[]>([]);
  const [imgErr, setImgErr] = useState('');
  const imgInputRef = useRef<HTMLInputElement | null>(null);
  const [chatBusy, setChatBusy] = useState(false);
  const chatAbortRef = useRef<AbortController | null>(null);
  const chatBodyRef = useRef<HTMLDivElement | null>(null);
  /** NPC 对话记忆：私聊按 charId 存，群聊统一 'group'。 */
  const npcMemRef = useRef(new Map<string, MemEntry[]>());
  const actionsDeadRef = useRef(false);
  /** 真工位：npcId → 会话快照；bubbledRef 记录已冒泡过的 lastText 尾部，避免每轮重复弹。 */
  const [agentRows, setAgentRows] = useState<Record<string, AgentRow>>({});
  const [workErr, setWorkErr] = useState('');
  const agentsDeadRef = useRef(false);
  const bubbledRef = useRef(new Map<string, string>());
  /** 派活工作区：随 office/agent/start 传给宿主写进会话 header（宿主会话列表按项目归组，重启后会话仍归该项目）；
   *  空 = 用户主目录。持久化 dsh-pwb:office_cwd_v1。 */
  const [workCwd, setWorkCwd] = useState<string>(() => {
    try {
      return window.localStorage.getItem('dsh-pwb:office_cwd_v1') ?? '';
    } catch {
      return '';
    }
  });
  useEffect(() => {
    try {
      window.localStorage.setItem('dsh-pwb:office_cwd_v1', workCwd);
    } catch {
      /* 持久化失败不影响功能 */
    }
  }, [workCwd]);
  /** 工作区选择：弹 macOS 原生「选择文件夹」对话框（与文件归档同款 osascript choose folder）。
   *  取消静默；失败写 workErr；成功回填并持久化（已有 effect 落 dsh-pwb:office_cwd_v1）。 */
  const pickWorkspace = useCallback((): void => {
    fetch('/api/personal-workbench/office/workdir/pick', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
      .then(async (res) => {
        const j = (await res.json().catch(() => null)) as { ok?: boolean; path?: string; code?: string; error?: { message?: string } } | null;
        if (j !== null && j.ok === true && typeof j.path === 'string' && j.path !== '') {
          setWorkCwd(j.path);
          setWorkErr('');
          return;
        }
        if (j !== null && j.code === 'cancelled') return;
        setWorkErr(j?.error?.message ?? '系统目录选择器不可用（宿主需要 ⌘Q 重启）');
      })
      .catch(() => setWorkErr('网络错误，无法连接宿主'));
  }, []);

  /* office/agents 轮询：2.5s；干活中的 NPC 把最新输出尾部冒泡到头顶 */
  useEffect(() => {
    let stopped = false;
    const poll = (): void => {
      if (stopped || agentsDeadRef.current) return;
      fetch(AGENTS_URL)
        .then((res) => {
          if (res.status === 404) {
            agentsDeadRef.current = true;
            return null;
          }
          return res.ok ? (res.json() as Promise<{ agents?: AgentRow[] }>) : null;
        })
        .then((data) => {
          if (data === null || data === undefined) return;
          const next: Record<string, AgentRow> = {};
          for (const row of data.agents ?? []) next[row.npcId] = row;
          setAgentRows(next);
          for (const row of data.agents ?? []) {
            if (row.status !== 'working' || row.lastText.trim() === '') continue;
            const tail = row.lastText.trim().slice(-60);
            if (bubbledRef.current.get(row.npcId) === tail) continue;
            bubbledRef.current.set(row.npcId, tail);
            engine.setBubble(row.npcId, tail, 7000);
          }
        })
        .catch(() => undefined);
    };
    poll();
    const id = window.setInterval(poll, 2500);
    return () => {
      stopped = true;
      window.clearInterval(id);
    };
  }, [engine]);

  /* 干完活的完整汇报回聊天区：reportAt 前进且正在看该同事私聊 → 冒泡 + 写入聊天（写入了才记账，切走再切回也能补看） */
  const deliveredReportRef = useRef(new Map<string, number>());
  useEffect(() => {
    if (chatTarget.kind !== 'npc') return;
    const row = agentRows[chatTarget.id];
    if (row === undefined || row.report === undefined || row.reportAt === undefined || row.report.trim() === '') return;
    if ((deliveredReportRef.current.get(row.npcId) ?? 0) >= row.reportAt) return;
    deliveredReportRef.current.set(row.npcId, row.reportAt);
    engine.setBubble(row.npcId, row.report.trim().slice(-60), 8000);
    const speaker = members.find((m) => m.id === row.npcId)?.name ?? row.npcId;
    const content = row.report;
    setChatMsgs((prev) => [...prev, { role: 'assistant', speaker, content }]);
  }, [agentRows, chatTarget, engine, members]);

  /* 切换聊天对象时载入历史记录 */
  useEffect(() => {
    setChatMsgs(loadChatMsgs(chatTarget));
  }, [chatTarget]);

  /* 聊天记录落盘：目标或消息变化即保存（刚切对象的那一帧闭包里还是旧记录，跳过防串键） */
  const savedKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const key = chatKeyOf(chatTarget);
    if (savedKeyRef.current !== key) {
      savedKeyRef.current = key;
      return;
    }
    saveChatMsgs(chatTarget, chatMsgs);
  }, [chatTarget, chatMsgs]);

  const postAgent = useCallback(
    (path: 'office/agent/start' | 'office/agent/say' | 'office/agent/stop', body: Record<string, string>): void => {
      void fetch(`/api/personal-workbench/${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
        .then(async (res) => {
          if (res.ok) {
            setWorkErr('');
            return;
          }
          let msg = `请求失败（${res.status}）`;
          try {
            const j = (await res.json()) as { error?: { message?: string } };
            if (typeof j.error?.message === 'string' && j.error.message !== '') msg = j.error.message;
          } catch {
            /* 非 JSON 响应用默认文案 */
          }
          if (res.status === 404) msg = `${msg}（宿主需要 ⌘Q 重启后才有此功能）`;
          setWorkErr(msg);
        })
        .catch(() => setWorkErr('网络错误，无法连接宿主'));
    },
    [],
  );

  /** 派活/递话统一入口：无会话→start；有会话→say；输入为空忽略。 */
  const workSend = useCallback(
    (text: string): void => {
      if (chatTarget.kind !== 'npc') return;
      const t = text.trim();
      if (t === '') return;
      const row = agentRows[chatTarget.id];
      if (row !== undefined && row.status !== 'stopped') {
        postAgent('office/agent/say', { npcId: chatTarget.id, text: t });
      } else {
        bubbledRef.current.delete(chatTarget.id);
        // 派活带工作区：宿主 stat 校验目录，不存在回退主目录并继续
        const cwd = workCwd.trim();
        postAgent('office/agent/start', {
          npcId: chatTarget.id,
          name: chatTarget.name,
          role: chatTarget.role,
          task: t,
          ...(cwd !== '' ? { cwd } : {}),
        });
      }
      setChatInput('');
    },
    [agentRows, chatTarget, postAgent, workCwd],
  );

  useEffect(() => {
    const id = window.setInterval(() => setMembers(engine.members()), 900);
    return () => window.clearInterval(id);
  }, [engine]);

  /* 员工：拉花名册（含属性覆盖）→ 引擎生成自定义角色 + 应用覆盖改名（换引擎/换图后同样补齐） */
  useEffect(() => {
    let dead = false;
    loadRoster()
      .then((res) => {
        if (dead) return;
        setRoster(res.roster);
        setBuiltinOverrides(res.builtin ?? {});
        res.roster.forEach((r) => engine.addRosterChar(r.id, r.name, r.role, res.builtin?.[r.id]?.deskId));
        for (const [id, ov] of Object.entries(res.builtin ?? {})) {
          engine.renameChar(id, ov.name, ov.role);
          if (ov.deskId !== undefined) engine.assignDesk(id, ov.deskId);
        }
      })
      .catch(() => {
        /* 宿主旧版无 roster 端点：自定义员工暂缺，不阻塞场景 */
      });
    return () => {
      dead = true;
    };
  }, [engine]);

  /* 模型清单懒加载一次（失败静默：入职下拉只剩「跟随默认」） */
  useEffect(() => {
    let dead = false;
    void officeListModels().then((list) => {
      if (!dead) setModelOptions(list);
    });
    return () => {
      dead = true;
    };
  }, []);

  /** 入职：写花名册（宿主持久化）→ 引擎生成角色 → 刷新列表。 */
  const hireSubmit = useCallback(async (): Promise<void> => {
    const name = hireName.trim();
    const role = hireRole.trim();
    if (name === '' || role === '' || hireBusy) return;
    setHireBusy(true);
    setHireErr('');
    try {
      const entry = await addRosterEntry(name, role, hireModel.trim());
      engine.addRosterChar(entry.id, entry.name, entry.role);
      setRoster((prev) => [...prev.filter((r) => r.id !== entry.id), entry]);
      setHireName('');
      setHireRole('');
      setHireModel('');
    } catch (err) {
      setHireErr(isEndpointMissing(err) ? '宿主半是旧代码：⌘Q 重启宿主后再试' : err instanceof Error ? err.message : '添加失败');
    } finally {
      setHireBusy(false);
    }
  }, [engine, hireBusy, hireModel, hireName, hireRole]);

  /** 缩放按钮：围绕中心缩放（平移归零，保持地图居中），范围与滚轮一致 0.5~2.5。 */
  const zoomStep = useCallback((delta: number): void => {
    setOfficeView((v) => {
      const zoom = Math.min(2.5, Math.max(0.5, Math.round(((v.zoom ?? 1) + delta) * 10) / 10));
      return { zoom, panX: 0, panY: 0 };
    });
  }, []);

  /* 对话跟随滚动到底 */
  useEffect(() => {
    const el = chatBodyRef.current;
    if (el !== null) el.scrollTop = el.scrollHeight;
  }, [chatMsgs, chatOpen]);

  const sceneState = useCallback(
    () => JSON.stringify(members.map((m) => ({ name: m.name, role: m.role, state: STATE_TEXT[m.state] }))),
    [members],
  );

  /* ── 附图：选文件/贴图 → base64 暂存；单批失败给出提示 ── */
  const addImageFiles = useCallback(async (files: File[]): Promise<void> => {
    if (files.length === 0) return;
    const next: ChatImage[] = [];
    let err = '';
    for (const f of files) {
      try {
        next.push(await fileToChatImage(f));
      } catch (e) {
        err = e instanceof Error ? e.message : String(e);
      }
    }
    if (next.length > 0) {
      setImgErr('');
      setChatImages((prev) => [...prev, ...next].slice(0, 8));
    }
    if (err !== '') setImgErr(err);
  }, []);

  /* ── AI 助手（全局） ── */
  const sendAi = useCallback(
    async (text: string, imgs: ChatImage[], ctrl: AbortController): Promise<void> => {
      const uiHistory = chatMsgs.filter((m) => !m.streaming);
      const history: WireMsg[] = uiHistory.map((m) => ({ role: m.role, content: partsOf(m) }));
      const userMsg: ChatMsg = { role: 'user', content: text, ...(imgs.length > 0 ? { images: imgs } : {}) };
      setChatMsgs([...uiHistory, userMsg, { role: 'assistant', content: '', streaming: true }]);
      try {
        const res = await fetch(CHAT_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: [...history, { role: 'user', content: partsOf(userMsg) }], sceneState: sceneState() }),
          signal: ctrl.signal,
        });
        await readSse(
          res,
          (d) =>
            setChatMsgs((prev) => {
              const copy = [...prev];
              const last = copy[copy.length - 1];
              if (last === undefined || last.role !== 'assistant') return copy;
              copy[copy.length - 1] = { ...last, content: last.content + d };
              return copy;
            }),
          (e) =>
            setChatMsgs((prev) => {
              const copy = [...prev];
              const last = copy[copy.length - 1];
              if (last !== undefined && last.role === 'assistant') copy[copy.length - 1] = { ...last, content: `⚠️ ${e}` };
              return copy;
            }),
        );
      } catch (err) {
        const aborted = err instanceof DOMException && err.name === 'AbortError';
        if (!aborted)
          setChatMsgs((prev) => {
            const copy = [...prev];
            const last = copy[copy.length - 1];
            if (last !== undefined && last.role === 'assistant' && last.content === '') copy[copy.length - 1] = { ...last, content: '连接中断，请重试' };
            return copy;
          });
      }
    },
    [chatMsgs, sceneState],
  );

  /* ── 同事 agent 说一句（低层）：写进流式消息槽，返回完整话 ── */
  const npcUtterance = useCallback(
    async (char: { id: string; name: string; role: string }, history: WireMsg[], ctrl: AbortController): Promise<string> => {
      setChatMsgs((prev) => [...prev, { role: 'assistant', content: '', speaker: char.name, streaming: true }]);
      let said = '';
      try {
        const res = await fetch(NPC_CHAT_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: char.name, role: char.role, messages: history, sceneState: sceneState() }),
          signal: ctrl.signal,
        });
        said = await readSse(
          res,
          (d) =>
            setChatMsgs((prev) => {
              const copy = [...prev];
              const last = copy[copy.length - 1];
              if (last === undefined || last.role !== 'assistant') return copy;
              copy[copy.length - 1] = { ...last, content: last.content + d };
              return copy;
            }),
          (e) =>
            setChatMsgs((prev) => {
              const copy = [...prev];
              const last = copy[copy.length - 1];
              if (last !== undefined && last.role === 'assistant') copy[copy.length - 1] = { ...last, content: `⚠️ ${e}` };
              return copy;
            }),
        );
      } catch (err) {
        const aborted = err instanceof DOMException && err.name === 'AbortError';
        if (!aborted)
          setChatMsgs((prev) => {
            const copy = [...prev];
            const last = copy[copy.length - 1];
            if (last !== undefined && last.role === 'assistant' && last.content === '') copy[copy.length - 1] = { ...last, content: '连接中断' };
            return copy;
          });
      }
      if (said.trim() !== '') engine.setBubble(char.id, said.trim(), 6000); // 同事开口 → 场景冒泡
      return said.trim();
    },
    [engine, sceneState],
  );

  /* ── 私聊：点谁跟谁聊 ── */
  const sendNpc = useCallback(
    async (text: string, imgs: ChatImage[], ctrl: AbortController): Promise<void> => {
      if (chatTarget.kind !== 'npc') return;
      const key = `npc:${chatTarget.id}`;
      const mem = npcMemRef.current.get(key) ?? [];
      mem.push({ speaker: 'me', content: text, ...(imgs.length > 0 ? { images: imgs } : {}) });
      const history: WireMsg[] = mem.map((e) => ({ role: e.speaker === 'me' ? ('user' as const) : ('assistant' as const), content: partsOf(e) }));
      setChatMsgs((prev) => [...prev.filter((m) => !m.streaming), { role: 'user', content: text, ...(imgs.length > 0 ? { images: imgs } : {}) }]);
      const said = await npcUtterance({ id: chatTarget.id, name: chatTarget.name, role: chatTarget.role }, history, ctrl);
      mem.push({ speaker: chatTarget.name, content: said });
      npcMemRef.current.set(key, mem.slice(-40));
    },
    [chatTarget, npcUtterance],
  );

  /* ── 群聊：轮流让每个同事 agent 说一句（互聊核心） ── */
  const runGroupRound = useCallback(
    async (text: string, imgs: ChatImage[], ctrl: AbortController): Promise<void> => {
      const npcList = engine.chars.filter((c) => !c.isSelf);
      if (npcList.length === 0) return;
      const mem = npcMemRef.current.get('group') ?? [];
      if (text.trim() !== '' || imgs.length > 0) {
        mem.push({ speaker: 'me', content: text, ...(imgs.length > 0 ? { images: imgs } : {}) });
        setChatMsgs((prev) => [...prev.filter((m) => !m.streaming), { role: 'user', content: text, ...(imgs.length > 0 ? { images: imgs } : {}) }]);
      }
      for (const c of npcList) {
        if (ctrl.signal.aborted) break;
        const history: WireMsg[] = mem.map((e) =>
          e.speaker === 'me'
            ? { role: 'user' as const, content: partsOf(e) }
            : e.speaker === c.name
              ? { role: 'assistant' as const, content: [{ type: 'text', text: e.content }] }
              : { role: 'user' as const, content: [{ type: 'text', text: `[${e.speaker}] ${e.content}` }] },
        );
        if (history.length === 0) history.push({ role: 'user', content: [{ type: 'text', text: '（会议开始，围绕刚才的话题说一句你的看法）' }] });
        const said = await npcUtterance({ id: c.id, name: c.name, role: c.role }, history, ctrl);
        if (said !== '') mem.push({ speaker: c.name, content: said });
      }
      npcMemRef.current.set('group', mem.slice(-60));
    },
    [engine, npcUtterance],
  );

  const sendChat = useCallback(
    async (text: string): Promise<void> => {
      const q = text.trim();
      const imgs = chatImages;
      if ((q === '' && imgs.length === 0) || chatBusy) return;
      setChatInput('');
      setChatImages([]);
      setImgErr('');
      setChatBusy(true);
      const ctrl = new AbortController();
      chatAbortRef.current = ctrl;
      if (chatTarget.kind === 'ai') await sendAi(q, imgs, ctrl);
      else if (chatTarget.kind === 'npc') {
        const row = agentRows[chatTarget.id];
        if (row !== undefined && row.status !== 'stopped') {
          // 干活中的同事：发送即递话进其真实会话（回复经 office/agents 轮询以气泡+进度条呈现）
          if (q === '') {
            setImgErr('同事正在干活时只能发文字（附图未发送）');
            setChatBusy(false);
            chatAbortRef.current = null;
            return;
          }
          if (imgs.length > 0) setWorkErr('真实会话暂不支持附图，已只发送文字');
          setChatMsgs((prev) => [...prev, { role: 'user', content: q }]);
          setChatBusy(false);
          chatAbortRef.current = null;
          workSend(q);
          return;
        }
        await sendNpc(q, imgs, ctrl);
      } else await runGroupRound(q, imgs, ctrl);
      setChatMsgs((prev) =>
        prev.map((m) => (m.streaming === true ? (m.content === '' ? { ...m, content: '（无回复内容）', streaming: false } : { ...m, streaming: false }) : m)),
      );
      setChatBusy(false);
      chatAbortRef.current = null;
    },
    [agentRows, chatBusy, chatImages, chatTarget, runGroupRound, sendAi, sendNpc, workSend],
  );

  /* 「让他们聊」：不输入话题，空转一轮互聊 */
  const runAutoChat = useCallback((): void => {
    if (chatBusy || chatTarget.kind !== 'group') return;
    setChatBusy(true);
    const ctrl = new AbortController();
    chatAbortRef.current = ctrl;
    void runGroupRound('', [], ctrl).finally(() => {
      setChatMsgs((prev) => prev.map((m) => (m.streaming === true ? (m.content === '' ? { ...m, content: '（无回复内容）', streaming: false } : { ...m, streaming: false }) : m)));
      setChatBusy(false);
      chatAbortRef.current = null;
    });
  }, [chatBusy, chatTarget, runGroupRound]);

  /* P5 动作网关轮询：取走即执行（宿主半未部署时 404 静默停轮询） */
  useEffect(() => {
    let stopped = false;
    const runOne = (a: OfficeAction): void => {
      if (a.type === 'desk_visit') {
        const name = typeof a.payload?.name === 'string' ? a.payload.name : '';
        const target = engine.chars.find((c) => c.name === name && !c.isSelf);
        const desk = target === undefined ? undefined : engine.map.furniture.find((f) => f.id === target.deskId);
        if (desk !== undefined) {
          const ch = deskChairCell(desk);
          engine.clickCell(ch.x, ch.y);
        }
      } else if (a.type === 'desk_visit_tour') {
        const others = engine.chars.filter((c) => !c.isSelf);
        others.forEach((c, i) => {
          window.setTimeout(() => {
            const desk = engine.map.furniture.find((f) => f.id === c.deskId);
            if (desk !== undefined) {
              const ch = deskChairCell(desk);
              engine.clickCell(ch.x, ch.y);
            }
          }, i * 5000);
        });
      } else if (a.type === 'set_state') {
        const msg = typeof a.payload?.message === 'string' ? a.payload.message : '';
        const self = members.find((m) => m.isSelf);
        if (self !== undefined && msg !== '') engine.setBubble(self.id, msg, 6000);
      }
    };
    const poll = (): void => {
      if (stopped || actionsDeadRef.current) return;
      fetch(ACTIONS_URL)
        .then((res) => {
          if (res.status === 404) {
            actionsDeadRef.current = true;
            return null;
          }
          return res.ok ? (res.json() as Promise<{ actions?: OfficeAction[] }>) : null;
        })
        .then((data) => {
          if (data === null || data === undefined) return;
          for (const a of data.actions ?? []) runOne(a);
        })
        .catch(() => undefined);
    };
    const id = window.setInterval(poll, 1500);
    return () => {
      stopped = true;
      window.clearInterval(id);
    };
  }, [engine, members]);

  const handleSaveMap = useCallback((m: OfficeMap): void => {
    setEngine(new OfficeEngine(m)); // 换图即换引擎：OfficeCanvas 的 rAF effect 依赖 engine 会自动重挂
    setTab('scene');
  }, []);

  /* ── 左右分栏拖拽：pointer capture 让指针移出分隔条也持续收到 move/up；比例 clamp 后实时刷新左列 flex-basis ── */
  const [split, setSplit] = useState<number>(loadSplit);
  const viewBodyRef = useRef<HTMLDivElement | null>(null);
  const splitDraggingRef = useRef(false);
  useEffect(() => {
    try {
      window.localStorage.setItem(SPLIT_KEY, String(split));
    } catch { /* 存储失败仅影响持久化 */ }
  }, [split]);
  const onSplitPointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>): void => {
    e.preventDefault();
    splitDraggingRef.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
  }, []);
  const onSplitPointerMove = useCallback((e: ReactPointerEvent<HTMLDivElement>): void => {
    if (!splitDraggingRef.current) return;
    const el = viewBodyRef.current;
    if (el === null) return;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) return;
    setSplit(clampSplit((e.clientX - rect.left) / rect.width));
  }, []);
  const onSplitPointerUp = useCallback((e: ReactPointerEvent<HTMLDivElement>): void => {
    if (!splitDraggingRef.current) return;
    splitDraggingRef.current = false;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch { /* 指针捕获已释放时忽略 */ }
  }, []);

  /* 点格子：互动照旧；点到同事（本人格或其椅位）→ 切私聊 */
  const handleCellClick = useCallback(
    (cell: { x: number; y: number }): void => {
      engine.clickCell(cell.x, cell.y);
      const hit = engine.chars.find((c) => {
        if (c.isSelf) return false;
        if (c.cx === cell.x && c.cy === cell.y) return true;
        const desk = engine.map.furniture.find((f) => f.id === c.deskId);
        if (desk === undefined) return false;
        const ch = deskChairCell(desk);
        return ch.x === cell.x && ch.y === cell.y;
      });
      if (hit !== undefined) {
        setChatTarget({ kind: 'npc', id: hit.id, name: hit.name, role: hit.role });
        setChatOpen(true);
      }
    },
    [engine],
  );

  /* 聊天标题优先用宿主覆盖的名字/职务（面板改名后即使 chatTarget 快照是旧的也显示新值） */
  const chatNpc = chatTarget.kind === 'npc' ? { name: builtinOverrides[chatTarget.id]?.name ?? chatTarget.name, role: builtinOverrides[chatTarget.id]?.role ?? chatTarget.role } : null;
  const targetLabel =
    chatTarget.kind === 'ai' ? 'AI 助手' : chatNpc !== null ? `和 ${chatNpc.name} 聊天 · ${chatNpc.role}` : '全员群聊';
  const emptyText =
    chatTarget.kind === 'ai'
      ? '问问办公室里的情况，或让我安排同事做事'
      : chatNpc !== null
        ? `和 ${chatNpc.name} 说点什么吧，回复会冒泡到 TA 头上`
        : '先说一句抛话题，或点「让他们聊」看同事们互聊';
  const npcWorkRow = chatTarget.kind === 'npc' ? agentRows[chatTarget.id] : undefined;
  const npcWorkActive = npcWorkRow !== undefined && npcWorkRow.status !== 'stopped';

  return (
    <div className="dsh-pwb-view">
      <div className="dsh-pwb-view-body dsh-pwb-office-viewbody" ref={viewBodyRef}>
        <div className="dsh-pwb-office-left" style={chatOpen ? { flex: `0 0 ${(split * 100).toFixed(2)}%` } : { flex: '1 1 auto' }}>
          <div className="dsh-pwb-office-tabs">
            <button className={`dsh-pwb-office-tab${tab === 'scene' ? ' dsh-pwb-office-tab-active' : ''}`} onClick={() => setTab('scene')}>
              场景
            </button>
            <button className={`dsh-pwb-office-tab${tab === 'data' ? ' dsh-pwb-office-tab-active' : ''}`} onClick={() => setTab('data')}>
              员工档案
            </button>
            <button className={`dsh-pwb-office-tab${tab === 'edit' ? ' dsh-pwb-office-tab-active' : ''}`} onClick={() => setTab('edit')}>
              布置办公室
            </button>
            <span className="dsh-pwb-office-tab-spacer" />
            <button className="dsh-pwb-office-tab" onClick={() => setChatOpen((v) => !v)}>
              {chatOpen ? '收起 AI' : 'AI 助手'}
            </button>
          </div>

          {tab === 'scene' && (
            <div className="dsh-pwb-office-scenewrap">
              <div className="dsh-pwb-office-stage">
                <OfficeCanvas
                  engine={engine}
                  className="dsh-pwb-office-canvas"
                  onClickCell={handleCellClick}
                  view={officeView}
                  onViewChange={setOfficeView}
                  char3d={char3d}
                />
                <div className="dsh-pwb-office-zoom">
                  <button
                    title={char3d ? '切回 2D 小人' : '切换 3D 人物模型'}
                    onClick={() => setChar3d((s) => !s)}
                    style={char3d ? { background: 'var(--pwb-accent)', color: '#fff' } : undefined}
                  >
                    3D
                  </button>
                  <button title="放大" onClick={() => zoomStep(0.2)}>
                    ＋
                  </button>
                  <button title="缩小" onClick={() => zoomStep(-0.2)}>
                    －
                  </button>
                  <button
                    title="向左转 90°"
                    onClick={() =>
                      setOfficeView((v) => ({ ...v, rot: ((((v.rot ?? 0) - 1) % 4) + 4) % 4 }))
                    }
                  >
                    ⟲
                  </button>
                  <button
                    title="向右转 90°"
                    onClick={() =>
                      setOfficeView((v) => ({ ...v, rot: (((v.rot ?? 0) + 1) % 4 + 4) % 4 }))
                    }
                  >
                    ⟳
                  </button>
                  <button title="复位" onClick={() => setOfficeView({})}>
                    ⭯
                  </button>
                </div>
              </div>
            </div>
          )}

          {tab === 'data' && <OfficeProfileView members={members} roster={roster} builtin={builtinOverrides} onBuiltinSaved={setBuiltinOverrides} />}

          {tab === 'edit' && (
            <>
              <OfficeEditor onSave={handleSaveMap} onCancel={() => setTab('scene')} />
              <div className="dsh-pwb-office-hire">
                <b>员工入职</b>
                <input
                  value={hireName}
                  placeholder="名字，如 小黄"
                  onChange={(e) => setHireName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void hireSubmit();
                  }}
                />
                <input
                  value={hireRole}
                  placeholder="职务，如 商运"
                  onChange={(e) => setHireRole(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void hireSubmit();
                  }}
                />
                <select
                  value={hireModel}
                  onChange={(e) => setHireModel(e.target.value)}
                  title="员工专属模型（聊天/派活/自觉工作都用它；空 = 跟随全局默认）"
                >
                  <option value="">模型：跟随默认</option>
                  {modelOptions.map((m) => (
                    <option key={`${m.provider}::${m.id}`} value={`${m.provider}::${m.id}`}>
                      {m.provider} / {m.name}
                    </option>
                  ))}
                </select>
                <button disabled={hireBusy || hireName.trim() === '' || hireRole.trim() === ''} onClick={() => void hireSubmit()}>
                  {hireBusy ? '添加中…' : '添加员工'}
                </button>
                {hireErr !== '' && <span className="dsh-pwb-office-hire-err">⚠️ {hireErr}</span>}
                <span className="dsh-pwb-office-hire-roster">
                  {roster.length === 0 ? '还没有自定义员工' : `已入职：${roster.map((r) => `${r.name}·${r.role}`).join('、')}`}
                </span>
              </div>
            </>
          )}

          <div className="dsh-pwb-office-status">
            {members.map((m) => (
              <span key={m.id} className={`dsh-pwb-office-chip${m.isSelf ? ' dsh-pwb-office-chip-self' : ''}`}>
                <b>{m.name}</b>
                <i>{m.role}</i>
                <em>
                  {STATE_TEXT[m.state]}
                  {agentRows[m.id]?.status === 'working' ? ' ⚒' : ''}
                </em>
              </span>
            ))}
          </div>
          <div className="dsh-pwb-office-hint">点同事打招呼并私聊 · 点空地走位 · 点白板开会 · 群聊里看同事们互聊</div>
        </div>

        {chatOpen && (
          <>
            <div
              className="dsh-pwb-office-splitter"
              role="separator"
              aria-orientation="vertical"
              title="拖动调整左右宽度"
              onPointerDown={onSplitPointerDown}
              onPointerMove={onSplitPointerMove}
              onPointerUp={onSplitPointerUp}
              onPointerCancel={onSplitPointerUp}
            />
            <div className="dsh-pwb-office-right">
              <OfficeAgentPanel
                onOpenChat={(id, name, role) => {
                  setChatTarget({ kind: 'npc', id, name, role });
                  setChatOpen(true);
                }}
                onBuiltinSaved={(id, name, role, deskId) => {
                  setBuiltinOverrides((prev) => ({
                    ...prev,
                    [id]: {
                      ...prev[id],
                      ...(name !== undefined ? { name } : {}),
                      ...(role !== undefined ? { role } : {}),
                      ...(deskId !== undefined ? { deskId: deskId !== '' ? deskId : undefined } : {}),
                    },
                  }));
                  engine.renameChar(id, name, role);
                  if (deskId !== undefined) engine.assignDesk(id, deskId);
                }}
                desks={engine.listDesks().map((d, i) => ({ id: d.id, label: `工位${i + 1} · (${d.x},${d.y})` }))}
              />
              <div className="dsh-pwb-office-chat">
                <div className="dsh-pwb-office-chat-head">
                  {targetLabel}
                  <span className="dsh-pwb-office-chat-act">
                    {chatTarget.kind === 'npc' && (
                      <button onClick={() => setChatTarget({ kind: 'group' })}>全员群聊</button>
                    )}
                    {chatTarget.kind === 'group' && (
                      <button disabled={chatBusy} onClick={runAutoChat}>
                        让他们聊
                      </button>
                    )}
                    {chatTarget.kind !== 'ai' && <button onClick={() => setChatTarget({ kind: 'ai' })}>返回 AI</button>}
                    {chatTarget.kind === 'npc' && npcWorkActive && (
                      <button onClick={() => postAgent('office/agent/stop', { npcId: chatTarget.id })}>停工</button>
                    )}
                    <button
                      onClick={() => {
                        chatAbortRef.current?.abort();
                        setChatMsgs([]);
                      }}
                    >
                      新建
                    </button>
                    <button onClick={() => setChatOpen(false)}>收起</button>
                  </span>
                </div>
                {/* OFFICE-AGENT-PANEL-SLOT */}
                {npcWorkRow !== undefined && (
                  <div className="dsh-pwb-office-work-status">
                    ⚒{' '}
                    {npcWorkRow.status === 'working' ? '真实工作中' : npcWorkRow.status === 'idle' ? '真实会话空闲' : '已停工'}
                    {(npcWorkRow.lastText.trim() ?? '') !== '' && <span> · {npcWorkRow.lastText.trim().slice(-120)}</span>}
                  </div>
                )}
                {workErr !== '' && <div className="dsh-pwb-office-work-status dsh-pwb-office-work-err">⚠️ {workErr}</div>}
                <div className="dsh-pwb-office-chat-body" ref={chatBodyRef}>
                  {chatMsgs.length === 0 && <div className="dsh-pwb-office-chat-empty">{emptyText}</div>}
                  {chatMsgs.map((m, i) => (
                    <div
                      key={i}
                      className={`dsh-pwb-office-chat-msg ${m.role === 'user' ? 'dsh-pwb-office-chat-msg-user' : 'dsh-pwb-office-chat-msg-ai'}${
                        m.streaming === true ? ' dsh-pwb-office-chat-msg-streaming' : ''
                      }`}
                    >
                      {m.speaker !== undefined && <b>{m.speaker}：</b>}
                      {m.images !== undefined && m.images.length > 0 && (
                        <span className="dsh-pwb-office-chat-imgs">
                          {m.images.map((img, j) => (
                            <img key={j} src={`data:${img.mediaType};base64,${img.data}`} alt={img.name ?? '附图'} title={img.name ?? '附图'} />
                          ))}
                        </span>
                      )}
                      {m.content}
                    </div>
                  ))}
                </div>
                {chatTarget.kind === 'npc' && (
                  <>
                    <div className="dsh-pwb-office-chat-cwd">
                      <span>工作区</span>
                      <input
                        value={workCwd}
                        placeholder="点「浏览」选择项目目录（子任务也落这里；留空 = 主目录）"
                        onChange={(e) => setWorkCwd(e.target.value)}
                      />
                      <button className="dsh-pwb-office-cwd-browse" onClick={pickWorkspace}>
                        浏览
                      </button>
                    </div>
                  </>
                )}
                {imgErr !== '' && <div className="dsh-pwb-office-work-status dsh-pwb-office-work-err">⚠️ {imgErr}</div>}
                {chatImages.length > 0 && (
                  <div className="dsh-pwb-office-chat-pending">
                    {chatImages.map((img, i) => (
                      <span key={i} className="dsh-pwb-office-chat-pending-item" title={img.name ?? '图片'}>
                        <img src={`data:${img.mediaType};base64,${img.data}`} alt="" />
                        <button
                          type="button"
                          aria-label="移除图片"
                          onClick={() => setChatImages((prev) => prev.filter((_, j) => j !== i))}
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <div className="dsh-pwb-office-chat-input">
                  <input
                    ref={imgInputRef}
                    type="file"
                    accept={IMAGE_TYPES.join(',')}
                    multiple
                    style={{ display: 'none' }}
                    onChange={(e) => {
                      const files = Array.from(e.target.files ?? []);
                      e.target.value = '';
                      if (files.length > 0) void addImageFiles(files);
                    }}
                  />
                  <button type="button" className="dsh-pwb-office-chat-attach" title="发送图片（也可直接粘贴）" onClick={() => imgInputRef.current?.click()}>
                    <ImagePlus size={15} />
                  </button>
                  <input
                    value={chatInput}
                    placeholder={
                      chatTarget.kind === 'npc'
                        ? npcWorkActive
                          ? 'TA 正在干活，消息会递进 TA 的真实会话…'
                          : '找 TA 聊天，或输入任务点「派活」让 TA 真干活…'
                        : chatImages.length > 0
                          ? '补充说明（可选），点「发送」带上图片…'
                          : '输入消息…'
                    }
                    onChange={(e) => setChatInput(e.target.value)}
                    onPaste={(e) => {
                      const files = Array.from(e.clipboardData.files);
                      if (files.length === 0) return;
                      e.preventDefault();
                      void addImageFiles(files);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void sendChat(chatInput);
                    }}
                  />
                  {chatTarget.kind === 'npc' && !chatBusy && !npcWorkActive && (
                    <button
                      className="dsh-pwb-office-chat-work"
                      disabled={chatInput.trim() === ''}
                      title="附图不随「派活」发送"
                      onClick={() => workSend(chatInput.trim())}
                    >
                      派活
                    </button>
                  )}
                  {chatBusy ? (
                    <button className="dsh-pwb-office-chat-stop" onClick={() => chatAbortRef.current?.abort()}>
                      停止
                    </button>
                  ) : (
                    <button
                      className="dsh-pwb-office-chat-send"
                      disabled={chatInput.trim() === '' && chatImages.length === 0}
                      onClick={() => void sendChat(chatInput)}
                    >
                      发送
                    </button>
                  )}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
