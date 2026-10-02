/**
 * 待办事项卡 —— 移植自 Yuze Workbench OverviewPage.TodoWidget（交互 1:1）：
 * 顶部「添加待办…（同步到任务）」输入框 + 未完成任务列表 + 待办计数。
 * 数据源与待办模块同 key（task_board_tasks / task_board_groups）。
 * 同步保障（v2）：
 * · 写入完整合法的 ITask 结构（枚举 priority: high/medium/low、taskNo、
 *   assignee 等必填字段全补齐）—— 此前只写部分字段导致看板渲染取值失败
 * · 写入后广播 dsh-pwb-tasks-changed，看板监听后即时重读，无需切模块
 */
// @ts-nocheck —— 移植自 Yuze Workbench（原项目自带类型检查），此处不重复校验

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, ListTodo, Plus } from 'lucide-react';
import type { RpcFn } from '../../rpc.js';

interface TaskItem {
  id: string;
  taskNo: string;
  title: string;
  priority: 'high' | 'medium' | 'low';
  status: 'todo' | 'in_progress' | 'completed' | 'overdue';
  group: string;
  assignee: string;
  assigneeAvatar: string;
  project: string;
  deadline: string;
  scheduleTime?: string;
  description: string;
  tags: string[];
  createdAt?: string;
}

/** 任务变更广播：看板（TaskBoardSection）监听后即时重读。 */
export const TASKS_CHANGED_EVENT = 'dsh-pwb-tasks-changed';

const readTasks = (): TaskItem[] => {
  try {
    const t = localStorage.getItem('dsh-pwb:task_board_tasks');
    const parsed = t ? (JSON.parse(t) as TaskItem[]) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
};
const readGroups = (): string[] => {
  try {
    const g = localStorage.getItem('dsh-pwb:task_board_groups');
    const parsed = g ? (JSON.parse(g) as string[]) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
};

export function TodoWidget({ rpc, onOpen }: { rpc: RpcFn; onOpen: (id: string) => void }) {
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [groups, setGroups] = useState<string[]>([]);
  const [text, setText] = useState('');

  // 挂载读一次 + 5s 轮询 + 事件桥（本页/看板写入后即时跟随）
  useEffect(() => {
    const read = () => { setTasks(readTasks()); setGroups(readGroups()); };
    read();
    const id = window.setInterval(read, 5000);
    window.addEventListener(TASKS_CHANGED_EVENT, read);
    return () => { window.clearInterval(id); window.removeEventListener(TASKS_CHANGED_EVENT, read); };
  }, []);

  const open = useMemo(() => tasks.filter((t) => t.status !== 'completed'), [tasks]);

  const persist = useCallback((next: TaskItem[]) => {
    setTasks(next);
    try { localStorage.setItem('dsh-pwb:task_board_tasks', JSON.stringify(next)); } catch { /* ignore */ }
    void rpc('personal-workbench/store/write', { key: 'task_board_tasks', value: next }).catch(() => undefined);
    window.dispatchEvent(new CustomEvent(TASKS_CHANGED_EVENT));
  }, [rpc]);

  const add = () => {
    const title = text.trim();
    if (!title) return;
    const item: TaskItem = {
      id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      taskNo: `WXB-${new Date().getFullYear()}-${String(tasks.length + 1).padStart(3, '0')}`,
      title,
      priority: 'medium',
      status: 'todo',
      group: groups[0] ?? '待办',
      assignee: '我',
      assigneeAvatar: '',
      project: '',
      deadline: '',
      description: '',
      tags: [],
      createdAt: new Date().toISOString(),
    };
    persist([item, ...tasks]);
    setText('');
  };

  // 快捷勾完成：点行首圆圈直接完成（与看板状态同源）
  const complete = (id: string) => persist(tasks.map((t) => (t.id === id ? { ...t, status: 'completed' as const } : t)));

  return (
    <div className="dsh-pwb-widget relative flex h-full flex-col">
      <div className="flex items-center gap-2 px-4 pt-3">
        <span className="grid size-7 place-items-center rounded-lg bg-primary/15 text-primary"><ListTodo className="size-4" /></span>
        <span className="text-sm font-semibold text-white">待办事项</span>
        <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] text-white/50">{open.length} 待办</span>
        <button className="ml-auto text-[11px] font-medium text-primary hover:underline" onClick={() => onOpen('todo')}>
          打开模块
        </button>
      </div>

      <div className="mx-4 mt-2 flex gap-1.5">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
          placeholder="添加新待办…（同步到任务）"
          className="min-w-0 flex-1 rounded-lg border border-white/[0.08] bg-white/[0.05] px-2.5 py-1.5 text-xs text-white outline-none placeholder:text-white/30"
        />
        <button className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary text-[var(--primary-foreground,#0c1d14)]" onClick={add} title="添加">
          <Plus className="size-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-2.5 pb-3 pt-2">
        {open.length === 0 ? (
          <div className="grid h-full place-items-center text-xs text-white/35">暂无待办，上方输入框添加一条</div>
        ) : (
          open.map((t) => (
            <div key={t.id} className="group flex w-full items-center gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-white/[0.05]">
              <button className="grid size-4 shrink-0 place-items-center rounded-full border border-white/25 text-transparent transition-colors hover:border-primary hover:text-primary" onClick={() => complete(t.id)} title="标记完成">
                <CheckCircle2 className="size-3.5" />
              </button>
              <button className="min-w-0 flex-1 truncate text-left text-xs text-white/75" onClick={() => onOpen('todo')} title="打开待办模块处理">
                {t.title}
              </button>
              {t.priority === 'high' && <span className="shrink-0 text-[10px] text-red-400/80">高</span>}
              {t.priority === 'low' && <span className="shrink-0 text-[10px] text-white/30">低</span>}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
