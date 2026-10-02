/**
 * 待办事项卡 —— 移植自 Yuze Workbench OverviewPage.TodoWidget（交互 1:1）：
 * 顶部「添加待办…（同步到任务）」输入框 + 未完成任务列表 + 待办计数。
 * 数据源与待办模块同 key（task_board_tasks / task_board_groups），写入后
 * 待办模块切回时自动重读 —— 与原版跨页面共享 localStorage 的机制一致。
 */
// @ts-nocheck —— 移植自 Yuze Workbench（原项目自带类型检查），此处不重复校验

import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, ListTodo, Plus } from 'lucide-react';
import type { RpcFn } from '../../rpc.js';

interface TaskItem { id: string; title: string; status: string; priority?: string; group?: string; createdAt?: string }
const PRIORITY_ORDER: Record<string, number> = { 高: 0, 中: 1, 低: 2 };

export function TodoWidget({ rpc, onOpen }: { rpc: RpcFn; onOpen: (id: string) => void }) {
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [groups, setGroups] = useState<string[]>([]);
  const [text, setText] = useState('');

  // 读（与待办模块同 key）：挂载读一次 + 5s 轮询，跟随待办模块的增删改
  useEffect(() => {
    const read = () => {
      try {
        const t = localStorage.getItem('dsh-pwb:task_board_tasks');
        const g = localStorage.getItem('dsh-pwb:task_board_groups');
        if (t) setTasks(JSON.parse(t) as TaskItem[]);
        if (g) setGroups(JSON.parse(g) as string[]);
      } catch { /* ignore */ }
    };
    read();
    const id = window.setInterval(read, 5000);
    return () => window.clearInterval(id);
  }, []);

  const open = useMemo(
    () => tasks.filter((t) => t.status !== 'completed').sort((a, b) => (PRIORITY_ORDER[a.priority ?? '中'] ?? 1) - (PRIORITY_ORDER[b.priority ?? '中'] ?? 1)),
    [tasks],
  );

  const add = () => {
    const title = text.trim();
    if (!title) return;
    const item: TaskItem = {
      id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      title,
      status: 'todo',
      priority: '中',
      group: groups[0] ?? '待办',
      createdAt: new Date().toISOString(),
    };
    const next = [item, ...tasks];
    setTasks(next);
    try { localStorage.setItem('dsh-pwb:task_board_tasks', JSON.stringify(next)); } catch { /* ignore */ }
    void rpc('personal-workbench/store/write', { key: 'task_board_tasks', value: next }).catch(() => undefined);
    setText('');
  };

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
            <button
              key={t.id}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-white/[0.05]"
              onClick={() => onOpen('todo')}
              title="打开待办模块处理"
            >
              <CheckCircle2 className="size-4 shrink-0 text-primary/70" />
              <span className="min-w-0 flex-1 truncate text-xs text-white/75">{t.title}</span>
              {t.priority && <span className="shrink-0 text-[10px] text-white/35">{t.priority}</span>}
            </button>
          ))
        )}
      </div>
    </div>
  );
}
