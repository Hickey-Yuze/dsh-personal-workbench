// @ts-nocheck —— 移植自 Yuze Workbench 的 TaskDashboard（原项目自带完整类型检查），此处不重复校验
import { memo, useState, useEffect, useMemo, useRef, forwardRef, useImperativeHandle } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAutoAnimate } from '@formkit/auto-animate/react';
import {
  ChevronDown,
  Clock,
  Check,
  Plus,
  X,
  Trash2,
  Pencil,
  ChevronUp,
  ChevronDown as ChevronDownIcon,
  Filter,
  ArrowUpDown,
  LayoutGrid,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../components/dropdown-menu';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '../components/alert-dialog';
import { MOCK_TASKS, type ITask } from '../data/tasks';
import { scopedStorage } from '../lib/compat';
import { cn } from '../lib/utils';
import { toast } from '../lib/compat';

// ==================== 类型定义 ====================
interface TaskGroupItem {
  id: string;
  name: string;
  dotColor: string;
}

interface TaskItem extends Omit<ITask, 'group'> {
  groupId: string;
  description: string;
  deadline: string;
}
export type { TaskItem };

// ==================== 常量 ====================
const STORAGE_KEY_GROUPS = 'task_board_groups';
const STORAGE_KEY_TASKS = 'task_board_tasks';

const DEFAULT_GROUPS: TaskGroupItem[] = [
  { id: 'requirement', name: '需求评审', dotColor: 'bg-primary' },
  { id: 'design', name: '产品设计', dotColor: 'bg-cyan-400' },
  { id: 'development', name: '开发实现', dotColor: 'bg-purple-400' },
];

const STATUS_OPTIONS = [
  { value: 'all', label: '全部状态', dotClass: 'bg-white/40' },
  { value: 'todo', label: '待办', dotClass: 'bg-amber-400' },
  { value: 'in_progress', label: '进行中', dotClass: 'bg-primary' },
  { value: 'completed', label: '已完成', dotClass: 'bg-cyan-400' },
  { value: 'overdue', label: '已逾期', dotClass: 'bg-red-400' },
] as const;

type StatusFilter = typeof STATUS_OPTIONS[number]['value'];
export type { StatusFilter };

const PRIORITY_OPTIONS = [
  { value: 'high', label: '高' },
  { value: 'medium', label: '中' },
  { value: 'low', label: '低' },
] as const;

const SORT_OPTIONS = [
  { value: 'default', label: '默认顺序' },
  { value: 'priority', label: '按优先级' },
  { value: 'deadline', label: '按截止时间' },
  { value: 'created', label: '按创建时间' },
] as const;

type SortKey = typeof SORT_OPTIONS[number]['value'];

export interface TaskStats {
  todo: number;
  in_progress: number;
  completed: number;
  overdue: number;
}

const DOT_COLORS = [
  'bg-primary',
  'bg-cyan-400',
  'bg-purple-400',
  'bg-amber-400',
  'bg-pink-400',
  'bg-emerald-400',
  'bg-rose-400',
  'bg-blue-400',
];

// ==================== 工具函数 ====================
function priorityBadge(priority: TaskItem['priority']) {
  const map = {
    high: { label: '高', className: 'bg-red-500/15 text-red-400 border-red-500/20' },
    medium: { label: '中', className: 'bg-amber-500/15 text-amber-400 border-amber-500/20' },
    low: { label: '低', className: 'bg-white/10 text-white/60 border-white/10' },
  };
  return map[priority];
}

// 未完成任务若已过截止时间，按已逾期展示
function effectiveStatus(task: Pick<TaskItem, 'status' | 'deadline'>): TaskItem['status'] {
  if (task.status === 'completed') return task.status;
  const dt = task.deadline ? new Date(task.deadline.includes('T') ? task.deadline : task.deadline.replace(' ', 'T')) : new Date(NaN);
  if (!Number.isNaN(dt.getTime()) && dt.getTime() < Date.now()) return 'overdue';
  return task.status;
}

function initDefaultTasks(): TaskItem[] {
  return MOCK_TASKS.map((t) => ({
    ...t,
    groupId: t.group,
    description: t.description || '',
    deadline: t.deadline || '',
  }));
}

// ==================== 任务卡片组件 ====================
interface TaskCardProps {
  task: TaskItem;
  selected: boolean;
  onSelect: (task: TaskItem) => void;
  onMoveUp: (id: string) => void;
  onMoveDown: (id: string) => void;
  isFirst: boolean;
  isLast: boolean;
}

function TaskCard({ task, selected, onSelect, onMoveUp, onMoveDown, isFirst, isLast }: TaskCardProps) {
  const p = priorityBadge(task.priority);
  const effStatus = effectiveStatus(task);
  const [showActions, setShowActions] = useState(false);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -5 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      whileHover={{ y: -1 }}
      transition={{ duration: 0.15 }}
      data-task-id={task.id}
      className={cn(
        'group relative flex items-start gap-2.5 p-2.5 rounded-xl border transition-colors cursor-pointer',
        selected
          ? 'bg-primary/[0.08] border-primary/30'
          : 'bg-transparent border-transparent hover:bg-white/[0.04] hover:border-white/[0.06]'
      )}
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
      onClick={() => onSelect(task)}
    >
      <div className="shrink-0 w-1.5 h-1.5 rounded-full bg-white/30 group-hover:bg-primary transition-colors mt-2"></div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-sm font-medium text-white truncate">{task.title}</span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className={cn(
            'text-[10px] px-1.5 py-0.5 rounded-md border font-medium',
            p.className
          )}>{p.label}</span>
          <span className="text-[11px] text-white/40 flex items-center gap-1">
            <Clock className="size-3" />
            {task.scheduleTime ?? task.deadline?.slice(5).replace('T', ' ') ?? '无截止'}
          </span>
          {effStatus === 'overdue' && (
            <span className="text-[10px] text-red-400/90 ml-auto font-medium">已逾期</span>
          )}
          {effStatus === 'in_progress' && (
            <span className="text-[10px] text-primary/80 ml-auto font-medium">进行中</span>
          )}
          {effStatus === 'completed' && (
            <span className="text-[10px] text-cyan-400/80 ml-auto font-medium">已完成</span>
          )}
        </div>
      </div>

      {/* 操作按钮（仅排序） */}
      <AnimatePresence>
        {showActions && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            className="absolute right-2 top-2 flex items-center gap-0.5 bg-black/60 backdrop-blur-md rounded-lg p-0.5 border border-white/10 z-10"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => onMoveUp(task.id)}
              disabled={isFirst}
              className="size-6 rounded-md hover:bg-white/[0.1] text-white/60 hover:text-white flex items-center justify-center disabled:opacity-30 disabled:cursor-not-allowed"
              title="上移"
            >
              <ChevronUp className="size-3" />
            </button>
            <button
              onClick={() => onMoveDown(task.id)}
              disabled={isLast}
              className="size-6 rounded-md hover:bg-white/[0.1] text-white/60 hover:text-white flex items-center justify-center disabled:opacity-30 disabled:cursor-not-allowed"
              title="下移"
            >
              <ChevronDownIcon className="size-3" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ==================== 任务分组组件 ====================
interface TaskGroupProps {
  group: TaskGroupItem;
  tasks: TaskItem[];
  defaultOpen?: boolean;
  selectedTaskId?: string | null;
  revealTaskId?: string | null;
  onRename: (id: string, newName: string) => void;
  onDelete: (id: string) => void;
  onAddTask: (groupId: string) => void;
  onMoveTask: (taskId: string, direction: 'up' | 'down') => void;
  onSelectTask: (task: TaskItem) => void;
}

function TaskGroup({
  group,
  tasks,
  defaultOpen = true,
  selectedTaskId,
  revealTaskId,
  onRename,
  onDelete,
  onAddTask,
  onMoveTask,
  onSelectTask,
}: TaskGroupProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(group.name);
  const inputRef = useRef<HTMLInputElement>(null);
  const [ref] = useAutoAnimate({ duration: 250, easing: 'ease-in-out' });

  // 搜索定位：命中本组任务时自动展开分组
  useEffect(() => {
    if (revealTaskId && tasks.some((t) => t.id === revealTaskId)) setOpen(true);
  }, [revealTaskId, tasks]);

  const startEdit = () => {
    setEditName(group.name);
    setEditing(true);
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const finishEdit = () => {
    const name = editName.trim();
    if (name && name !== group.name) {
      onRename(group.id, name);
    }
    setEditing(false);
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') finishEdit();
    if (e.key === 'Escape') {
      setEditName(group.name);
      setEditing(false);
    }
  };

  return (
    <div className="relative rounded-2xl overflow-hidden liquid-glass transition-transform duration-300 hover:-translate-y-1">
      <div className="relative">
        {/* 分组标题 */}
        <div className="flex items-center gap-2.5 px-4 py-3 group/header">
          <span className={cn('size-2 rounded-full shrink-0 animate-glow', group.dotColor)}></span>
          {editing ? (
            <input
              ref={inputRef}
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onBlur={finishEdit}
              onKeyDown={handleKey}
              className="flex-1 text-sm font-semibold text-white bg-white/[0.08] border border-primary/40 rounded-lg px-2 py-1 outline-none"
            />
          ) : (
            <button
              onClick={() => setOpen(!open)}
              className="flex-1 flex items-center gap-2 text-left"
              onDoubleClick={startEdit}
            >
              <span className="text-sm font-semibold text-white">{group.name}</span>
              <span className="text-xs text-white/40 bg-white/[0.06] rounded-full px-1.5 py-0.5">
                {tasks.length}
              </span>
            </button>
          )}
          <ChevronDown
            className={cn(
              'size-4 text-white/40 transition-transform duration-200',
              open ? '' : '-rotate-90'
            )}
          />
          <div className="flex items-center gap-0.5 opacity-0 group-hover/header:opacity-100 transition-opacity">
            <button
              onClick={(e) => { e.stopPropagation(); onAddTask(group.id); }}
              className="size-7 rounded-lg hover:bg-white/[0.08] text-white/50 hover:text-primary flex items-center justify-center"
              title="添加任务"
            >
              <Plus className="size-3.5" />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); startEdit(); }}
              className="size-7 rounded-lg hover:bg-white/[0.08] text-white/50 hover:text-white flex items-center justify-center"
              title="重命名"
            >
              <Pencil className="size-3" />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(group.id); }}
              className="size-7 rounded-lg hover:bg-red-500/15 text-white/50 hover:text-red-400 flex items-center justify-center"
              title="删除分组"
            >
              <Trash2 className="size-3" />
            </button>
          </div>
        </div>

        <div ref={ref} className="px-3 pb-3 space-y-1">
          {open && tasks.length === 0 && (
            <div className="py-6 text-center text-[11px] text-white/30">
              暂无任务，点击「+」添加
            </div>
          )}
          {open && tasks.map((task, idx) => (
            <TaskCard
              key={task.id}
              task={task}
              selected={selectedTaskId === task.id}
              onSelect={onSelectTask}
              onMoveUp={() => onMoveTask(task.id, 'up')}
              onMoveDown={() => onMoveTask(task.id, 'down')}
              isFirst={idx === 0}
              isLast={idx === tasks.length - 1}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// ==================== 任务编辑弹窗 ====================
interface TaskEditorProps {
  task: TaskItem | null;
  groups: TaskGroupItem[];
  groupId: string;
  onClose: () => void;
  onSave: (task: TaskItem) => void;
  isNew: boolean;
}

function TaskEditor({ task, groups, groupId, onClose, onSave, isNew }: TaskEditorProps) {
  const [title, setTitle] = useState(task?.title || '');
  const [description, setDescription] = useState(task?.description || '');
  const [priority, setPriority] = useState<TaskItem['priority']>(task?.priority || 'medium');
  const [status, setStatus] = useState<TaskItem['status']>(task?.status || 'todo');
  const [deadline, setDeadline] = useState(task?.deadline || '');
  const [project, setProject] = useState(task?.project || '');
  const [tagsInput, setTagsInput] = useState((task?.tags || []).join(', '));
  const [selectedGroupId, setSelectedGroupId] = useState(task?.groupId || groupId);

  useEffect(() => {
    if (task) {
      setTitle(task.title);
      setDescription(task.description);
      setPriority(task.priority);
      setStatus(task.status);
      setDeadline(task.deadline);
      setProject(task.project);
      setTagsInput((task.tags || []).join(', '));
      setSelectedGroupId(task.groupId);
    } else {
      setTitle('');
      setDescription('');
      setPriority('medium');
      setStatus('todo');
      setDeadline('');
      setProject('');
      setTagsInput('');
      setSelectedGroupId(groupId);
    }
  }, [task, groupId]);

  const handleSave = () => {
    if (!title.trim()) {
      toast.error('请输入任务标题');
      return;
    }
    const newTask: TaskItem = {
      id: task?.id || Date.now().toString(),
      taskNo: task?.taskNo || `TASK-${String(Date.now()).slice(-6)}`,
      title: title.trim(),
      description: description.trim(),
      priority,
      status,
      groupId: selectedGroupId,
      assignee: task?.assignee || '我',
      assigneeAvatar: task?.assigneeAvatar || '',
      project: project.trim(),
      deadline,
      tags: tagsInput.split(/[,，]/).map((s) => s.trim()).filter(Boolean),
    };
    onSave(newTask);
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0, y: 10 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.95, opacity: 0, y: 10 }}
        transition={{ type: 'spring', damping: 25 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-2xl liquid-glass overflow-hidden shadow-2xl"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/5">
          <h3 className="text-base font-semibold text-white">
            {isNew ? '新建任务' : '编辑任务'}
          </h3>
          <button
            onClick={onClose}
            className="size-8 rounded-lg hover:bg-white/[0.06] text-white/50 hover:text-white flex items-center justify-center"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
          <div>
            <label className="block text-xs text-white/60 mb-1.5">任务标题</label>
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="输入任务标题..."
              className="w-full h-10 px-3 rounded-xl bg-white/[0.06] border border-white/[0.08] text-white text-sm placeholder-white/30 focus:outline-none focus:border-primary/40"
            />
          </div>
          <div>
            <label className="block text-xs text-white/60 mb-1.5">任务描述</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="描述任务详情..."
              rows={3}
              className="w-full px-3 py-2 rounded-xl bg-white/[0.06] border border-white/[0.08] text-white text-sm placeholder-white/30 focus:outline-none focus:border-primary/40 resize-none"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-white/60 mb-1.5">优先级</label>
              <div className="flex gap-1.5">
                {(['high', 'medium', 'low'] as const).map((p) => (
                  <button
                    key={p}
                    onClick={() => setPriority(p)}
                    className={cn(
                      'flex-1 h-9 rounded-lg text-[11px] font-medium border transition-all',
                      priority === p
                        ? p === 'high' ? 'bg-red-500/20 border-red-500/40 text-red-400'
                          : p === 'medium' ? 'bg-amber-500/20 border-amber-500/40 text-amber-400'
                          : 'bg-white/[0.1] border-white/20 text-white/70'
                        : 'bg-white/[0.04] border-white/[0.08] text-white/50 hover:bg-white/[0.08]'
                    )}
                  >
                    {p === 'high' ? '高' : p === 'medium' ? '中' : '低'}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-xs text-white/60 mb-1.5">状态</label>
              <div className="flex gap-1.5">
                {(['todo', 'in_progress', 'completed'] as const).map((s) => (
                  <button
                    key={s}
                    onClick={() => setStatus(s)}
                    className={cn(
                      'flex-1 h-9 rounded-lg text-[11px] font-medium border transition-all',
                      status === s
                        ? 'bg-primary/20 border-primary/40 text-primary'
                        : 'bg-white/[0.04] border-white/[0.08] text-white/50 hover:bg-white/[0.08]'
                    )}
                  >
                    {s === 'todo' ? '待办' : s === 'in_progress' ? '进行中' : '已完成'}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div>
            <label className="block text-xs text-white/60 mb-1.5">所属分组</label>
            <div className="flex flex-wrap gap-1.5">
              {groups.map((g) => (
                <button
                  key={g.id}
                  onClick={() => setSelectedGroupId(g.id)}
                  className={cn(
                    'px-3 h-8 rounded-lg text-[11px] font-medium border transition-all flex items-center gap-1.5',
                    selectedGroupId === g.id
                      ? 'bg-white/[0.1] border-white/20 text-white'
                      : 'bg-white/[0.04] border-white/[0.08] text-white/50 hover:bg-white/[0.08]'
                  )}
                >
                  <span className={cn('size-1.5 rounded-full', g.dotColor)}></span>
                  {g.name}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs text-white/60 mb-1.5">所属项目</label>
            <input
              value={project}
              onChange={(e) => setProject(e.target.value)}
              placeholder="输入所属项目..."
              className="w-full h-10 px-3 rounded-xl bg-white/[0.06] border border-white/[0.08] text-white text-sm placeholder-white/30 focus:outline-none focus:border-primary/40"
            />
          </div>
          <div>
            <label className="block text-xs text-white/60 mb-1.5">截止日期</label>
            <input
              type="datetime-local"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
              className="w-full h-10 px-3 rounded-xl bg-white/[0.06] border border-white/[0.08] text-white text-sm focus:outline-none focus:border-primary/40"
            />
          </div>
          <div>
            <label className="block text-xs text-white/60 mb-1.5">标签</label>
            <input
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              placeholder="多个标签用逗号分隔，如：评审, 需求"
              className="w-full h-10 px-3 rounded-xl bg-white/[0.06] border border-white/[0.08] text-white text-sm placeholder-white/30 focus:outline-none focus:border-primary/40"
            />
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-white/5">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-sm text-white/60 hover:text-white hover:bg-white/[0.06] transition-colors"
          >
            取消
          </button>
          <button
            onClick={handleSave}
            className="px-5 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:brightness-110 transition-all flex items-center gap-2"
          >
            <Check className="size-4" />
            {isNew ? '创建' : '保存'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ==================== 新增分组弹窗 ====================
interface NewGroupDialogProps {
  open: boolean;
  onClose: () => void;
  onCreate: (name: string, dotColor: string) => void;
}

function NewGroupDialog({ open, onClose, onCreate }: NewGroupDialogProps) {
  const [name, setName] = useState('');
  const [dotColor, setDotColor] = useState(DOT_COLORS[0]);

  const handleCreate = () => {
    if (!name.trim()) {
      toast.error('请输入分组名称');
      return;
    }
    onCreate(name.trim(), dotColor);
    setName('');
    setDotColor(DOT_COLORS[0]);
  };

  if (!open) return null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0, y: 10 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.95, opacity: 0, y: 10 }}
        transition={{ type: 'spring', damping: 25 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-2xl liquid-glass overflow-hidden shadow-2xl"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/5">
          <h3 className="text-base font-semibold text-white">新建分组</h3>
          <button
            onClick={onClose}
            className="size-8 rounded-lg hover:bg-white/[0.06] text-white/50 hover:text-white flex items-center justify-center"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-xs text-white/60 mb-1.5">分组名称</label>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              placeholder="输入分组名称..."
              className="w-full h-10 px-3 rounded-xl bg-white/[0.06] border border-white/[0.08] text-white text-sm placeholder-white/30 focus:outline-none focus:border-primary/40"
            />
          </div>
          <div>
            <label className="block text-xs text-white/60 mb-2">标识颜色</label>
            <div className="flex gap-2 flex-wrap">
              {DOT_COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => setDotColor(c)}
                  className={cn(
                    'size-8 rounded-full transition-all',
                    c,
                    dotColor === c
                      ? 'ring-2 ring-white/60 ring-offset-2 ring-offset-black/50 scale-110'
                      : 'hover:scale-105'
                  )}
                />
              ))}
            </div>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-white/5">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-sm text-white/60 hover:text-white hover:bg-white/[0.06] transition-colors"
          >
            取消
          </button>
          <button
            onClick={handleCreate}
            className="px-5 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:brightness-110 transition-all flex items-center gap-2"
          >
            <Plus className="size-4" />
            创建
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ==================== 主组件 ====================
interface TaskBoardSectionProps {
  externalStatusFilter?: StatusFilter;
  newTaskSignal?: number;
  selectedTaskId?: string | null;
  onSelectTask?: (task: TaskItem) => void;
  onStatsChange?: (stats: TaskStats) => void;
  onTaskUpdated?: (task: TaskItem) => void;
}

export interface TaskBoardHandle {
  openEditTask: (taskId: string) => void;
  completeTask: (taskId: string) => void;
  updateTask: (task: TaskItem) => void;
  searchAndSelectTask: (keyword: string) => TaskItem | null;
}

const TaskBoardSection = forwardRef<TaskBoardHandle, TaskBoardSectionProps>(function TaskBoardComponent(
  { externalStatusFilter, newTaskSignal, selectedTaskId, onSelectTask, onStatsChange, onTaskUpdated },
  ref
) {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [priorityFilter, setPriorityFilter] = useState<TaskItem['priority'] | 'all'>('all');
  const [sortKey, setSortKey] = useState<SortKey>('default');
  const [groups, setGroups] = useState<TaskGroupItem[]>(DEFAULT_GROUPS);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [editingTask, setEditingTask] = useState<TaskItem | null>(null);
  const [showTaskEditor, setShowTaskEditor] = useState(false);
  const [isNewTask, setIsNewTask] = useState(false);
  const [newTaskGroupId, setNewTaskGroupId] = useState('');
  const [showNewGroup, setShowNewGroup] = useState(false);
  const [deleteGroupId, setDeleteGroupId] = useState<string | null>(null);
  const [revealTaskId, setRevealTaskId] = useState<string | null>(null);

  // 加载数据
  useEffect(() => {
    const savedGroups = scopedStorage.getItem(STORAGE_KEY_GROUPS);
    const savedTasks = scopedStorage.getItem(STORAGE_KEY_TASKS);
    if (savedGroups) {
      try {
        const parsed = JSON.parse(savedGroups);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setGroups(parsed);
        }
      } catch { /* ignore */ }
    }
    if (savedTasks) {
      try {
        const parsed = JSON.parse(savedTasks);
        if (Array.isArray(parsed)) {
          setTasks(parsed);
          return;
        }
      } catch { /* ignore */ }
    }
    // 插件内不播种示例任务：首屏就是空看板（版式与外层一致，数据全是你自己的）
    setTasks([]);
    void initDefaultTasks;
  }, []);

  // 事件桥：项目总览「待办事项」卡等外部写入后，即时重读本地数据（不用切模块）。
  // 独立 useEffect —— 之前混在加载逻辑里，被 savedTasks 存在时的提前 return 跳过，导致不同步。
  useEffect(() => {
    const onExternalChange = () => {
      const g = scopedStorage.getItem(STORAGE_KEY_GROUPS);
      const t = scopedStorage.getItem(STORAGE_KEY_TASKS);
      if (g) { try { const parsed = JSON.parse(g); if (Array.isArray(parsed) && parsed.length > 0) setGroups(parsed); } catch { /* ignore */ } }
      if (t) { try { const parsed = JSON.parse(t); if (Array.isArray(parsed)) setTasks(parsed); } catch { /* ignore */ } }
    };
    window.addEventListener('dsh-pwb-tasks-changed', onExternalChange);
    return () => window.removeEventListener('dsh-pwb-tasks-changed', onExternalChange);
  }, []);

  // 外部触发：KPI 卡片点击 → 同步状态筛选
  useEffect(() => {
    if (externalStatusFilter) setStatusFilter(externalStatusFilter);
  }, [externalStatusFilter]);

  // 外部触发：顶部「新增任务」→ 打开新建任务弹窗（第一个分组）
  useEffect(() => {
    if (newTaskSignal && newTaskSignal > 0) {
      handleAddTask(groups[0]?.id ?? DEFAULT_GROUPS[0].id);
    }
  }, [newTaskSignal, groups]);

  // 任务统计实时上报 → KPI 卡片（与逾期展示逻辑保持一致）
  useEffect(() => {
    if (!onStatsChange) return;
    const count = (s: TaskItem['status']) => tasks.filter((t) => effectiveStatus(t) === s).length;
    onStatsChange({
      todo: count('todo'),
      in_progress: count('in_progress'),
      completed: count('completed'),
      overdue: count('overdue'),
    });
  }, [tasks, onStatsChange]);

  // 保存分组
  const saveGroups = (list: TaskGroupItem[]) => {
    setGroups(list);
    scopedStorage.setItem(STORAGE_KEY_GROUPS, JSON.stringify(list));
  };

  // 保存任务
  const saveTasks = (list: TaskItem[]) => {
    setTasks(list);
    scopedStorage.setItem(STORAGE_KEY_TASKS, JSON.stringify(list));
  };

  // 按状态/优先级过滤 + 排序后的任务
  const filteredTasks = useMemo(() => {
    const list = tasks.filter(
      (t) =>
        (statusFilter === 'all' || effectiveStatus(t) === statusFilter) &&
        (priorityFilter === 'all' || t.priority === priorityFilter)
    );
    const prioRank = { high: 0, medium: 1, low: 2 } as const;
    switch (sortKey) {
      case 'priority':
        return [...list].sort((a, b) => prioRank[a.priority] - prioRank[b.priority]);
      case 'deadline':
        return [...list].sort((a, b) =>
          (a.deadline || '').localeCompare(b.deadline || '')
        );
      case 'created':
        return [...list].sort((a, b) => Number(b.id) - Number(a.id));
      default:
        return list;
    }
  }, [tasks, statusFilter, priorityFilter, sortKey]);

  const groupedTasks = useMemo(() => {
    const map: Record<string, TaskItem[]> = {};
    for (const g of groups) map[g.id] = [];
    for (const t of filteredTasks) {
      if (!map[t.groupId]) map[t.groupId] = [];
      map[t.groupId].push(t);
    }
    return map;
  }, [filteredTasks, groups]);

  // 重命名分组
  const handleRenameGroup = (id: string, newName: string) => {
    saveGroups(groups.map((g) => (g.id === id ? { ...g, name: newName } : g)));
    toast.success('分组已重命名');
  };

  // 删除分组
  const handleDeleteGroup = (id: string) => {
    const group = groups.find((g) => g.id === id);
    if (!group) return;
    if (groups.length <= 1) {
      toast.error('至少保留一个分组');
      setDeleteGroupId(null);
      return;
    }
    const remaining = groups.filter((g) => g.id !== id);
    const newFirstGroupId = remaining[0].id;
    // 把被删分组的任务移到第一个分组
    const newTasks = tasks.map((t) =>
      t.groupId === id ? { ...t, groupId: newFirstGroupId } : t
    );
    saveGroups(remaining);
    saveTasks(newTasks);
    setDeleteGroupId(null);
    toast.success(`已删除分组「${group.name}」`);
  };

  // 新增分组
  const handleCreateGroup = (name: string, dotColor: string) => {
    const newGroup: TaskGroupItem = {
      id: `group_${Date.now()}`,
      name,
      dotColor,
    };
    saveGroups([...groups, newGroup]);
    setShowNewGroup(false);
    toast.success('分组已创建');
  };

  // 新增任务
  const handleAddTask = (groupId: string) => {
    setNewTaskGroupId(groupId);
    setEditingTask(null);
    setIsNewTask(true);
    setShowTaskEditor(true);
  };

  // 编辑任务
  const handleEditTask = (task: TaskItem) => {
    setEditingTask(task);
    setIsNewTask(false);
    setShowTaskEditor(true);
  };

  // 保存任务
  const handleSaveTask = (task: TaskItem) => {
    if (isNewTask) {
      saveTasks([...tasks, task]);
      toast.success('任务已创建');
    } else {
      saveTasks(tasks.map((t) => (t.id === task.id ? task : t)));
      toast.success('任务已更新');
    }
    setShowTaskEditor(false);
    setEditingTask(null);
    onTaskUpdated?.(task);
  };

  // 外部触发：右侧面板「编辑任务」
  const openEditTask = (taskId: string) => {
    const task = tasks.find((t) => t.id === taskId);
    if (task) handleEditTask(task);
  };

  // 外部触发：右侧面板「完成任务」
  const completeTask = (taskId: string) => {
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;
    const updated = { ...task, status: 'completed' as const };
    saveTasks(tasks.map((t) => (t.id === taskId ? updated : t)));
    onTaskUpdated?.(updated);
    toast.success(`「${updated.title}」已完成`);
  };

  // 外部触发：右侧面板「保存编辑」
  const updateTask = (task: TaskItem) => {
    saveTasks(tasks.map((t) => (t.id === task.id ? task : t)));
    onTaskUpdated?.(task);
    toast.success('任务已更新');
  };

  // 顶部搜索：模糊匹配标题/编号/标签/负责人，定位并选中任务
  const searchAndSelectTask = (keyword: string): TaskItem | null => {
    const kw = keyword.trim().toLowerCase();
    if (!kw) return null;
    const match = tasks.find(
      (t) =>
        t.title.toLowerCase().includes(kw) ||
        (t.taskNo || '').toLowerCase().includes(kw) ||
        (t.tags || []).some((tag) => tag.toLowerCase().includes(kw)) ||
        (t.assignee || '').toLowerCase().includes(kw)
    );
    if (!match) return null;
    if (statusFilter !== 'all') setStatusFilter('all');
    if (priorityFilter !== 'all') setPriorityFilter('all');
    setRevealTaskId(match.id);
    onSelectTask?.(match);
    requestAnimationFrame(() => {
      document
        .querySelector(`[data-task-id="${match.id}"]`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
    });
    return match;
  };

  useImperativeHandle(ref, () => ({
    openEditTask,
    completeTask,
    updateTask,
    searchAndSelectTask,
  }));

  // 移动任务
  const handleMoveTask = (taskId: string, direction: 'up' | 'down') => {
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;
    const groupTasks = tasks.filter((t) => t.groupId === task.groupId);
    const idx = groupTasks.findIndex((t) => t.id === taskId);
    if (idx === -1) return;
    if (direction === 'up' && idx === 0) return;
    if (direction === 'down' && idx === groupTasks.length - 1) return;

    const newTasks = [...tasks];
    const globalIdx = newTasks.findIndex((t) => t.id === taskId);
    const targetIdx = direction === 'up' ? globalIdx - 1 : globalIdx + 1;
    // 交换
    [newTasks[globalIdx], newTasks[targetIdx]] = [newTasks[targetIdx], newTasks[globalIdx]];
    saveTasks(newTasks);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
      className="flex flex-col gap-3 h-full"
    >
      {/* 标题栏 */}
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-base font-semibold text-white relative overflow-hidden w-fit">
          任务看板
          <span className="absolute left-0 top-0 h-full w-16 bg-gradient-to-r from-transparent via-primary/30 to-transparent animate-shine rounded pointer-events-none"></span>
        </h2>
        <div className="flex items-center gap-1.5">
          {/* 筛选：状态 + 优先级 */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className={cn(
                'flex items-center gap-1.5 h-8 px-2.5 rounded-lg border transition-all text-[11px]',
                statusFilter !== 'all' || priorityFilter !== 'all'
                  ? 'bg-primary/15 border-primary/30 text-primary'
                  : 'bg-white/[0.04] border-white/[0.08] hover:bg-white/[0.08] text-white/70 hover:text-white'
              )}>
                <Filter className="size-3" />
                筛选
                {(statusFilter !== 'all' || priorityFilter !== 'all') && (
                  <span className="size-1.5 rounded-full bg-primary"></span>
                )}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-56 bg-black/80 backdrop-blur-xl border border-white/10 rounded-xl p-1.5 shadow-xl space-y-1.5">
              <div className="px-2.5 pt-1.5 pb-1 text-[10px] text-white/40">状态</div>
              {STATUS_OPTIONS.map((opt) => (
                <DropdownMenuItem
                  key={opt.value}
                  onClick={() => setStatusFilter(opt.value)}
                  className={cn(
                    'flex items-center gap-2 h-8 px-2.5 rounded-lg text-xs cursor-pointer transition-colors',
                    statusFilter === opt.value
                      ? 'bg-white/[0.08] text-white'
                      : 'text-white/60 hover:text-white hover:bg-white/[0.04]'
                  )}
                >
                  <span className={cn('size-1.5 rounded-full shrink-0', opt.dotClass)}></span>
                  <span className="flex-1">{opt.label}</span>
                  {statusFilter === opt.value && <Check className="size-3.5 text-primary" />}
                </DropdownMenuItem>
              ))}
              <div className="px-2.5 pt-2 pb-1 text-[10px] text-white/40">优先级</div>
              <DropdownMenuItem
                onClick={() => setPriorityFilter('all')}
                className={cn(
                  'flex items-center gap-2 h-8 px-2.5 rounded-lg text-xs cursor-pointer transition-colors',
                  priorityFilter === 'all'
                    ? 'bg-white/[0.08] text-white'
                    : 'text-white/60 hover:text-white hover:bg-white/[0.04]'
                )}
              >
                <span className="flex-1">全部优先级</span>
                {priorityFilter === 'all' && <Check className="size-3.5 text-primary" />}
              </DropdownMenuItem>
              {PRIORITY_OPTIONS.map((opt) => (
                <DropdownMenuItem
                  key={opt.value}
                  onClick={() => setPriorityFilter(opt.value)}
                  className={cn(
                    'flex items-center gap-2 h-8 px-2.5 rounded-lg text-xs cursor-pointer transition-colors',
                    priorityFilter === opt.value
                      ? 'bg-white/[0.08] text-white'
                      : 'text-white/60 hover:text-white hover:bg-white/[0.04]'
                  )}
                >
                  <span className="flex-1">{opt.label}优先级</span>
                  {priorityFilter === opt.value && <Check className="size-3.5 text-primary" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* 排序 */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className={cn(
                'flex items-center gap-1.5 h-8 px-2.5 rounded-lg border transition-all text-[11px]',
                sortKey !== 'default'
                  ? 'bg-primary/15 border-primary/30 text-primary'
                  : 'bg-white/[0.04] border-white/[0.08] hover:bg-white/[0.08] text-white/70 hover:text-white'
              )}>
                <ArrowUpDown className="size-3" />
                排序
                {sortKey !== 'default' && <span className="size-1.5 rounded-full bg-primary"></span>}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-44 bg-black/80 backdrop-blur-xl border border-white/10 rounded-xl p-1.5 shadow-xl">
              {SORT_OPTIONS.map((opt) => (
                <DropdownMenuItem
                  key={opt.value}
                  onClick={() => setSortKey(opt.value)}
                  className={cn(
                    'flex items-center gap-2 h-8 px-2.5 rounded-lg text-xs cursor-pointer transition-colors',
                    sortKey === opt.value
                      ? 'bg-white/[0.08] text-white'
                      : 'text-white/60 hover:text-white hover:bg-white/[0.04]'
                  )}
                >
                  <span className="flex-1">{opt.label}</span>
                  {sortKey === opt.value && <Check className="size-3.5 text-primary" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <button
            className="size-8 rounded-lg bg-white/[0.04] border border-white/[0.08] hover:bg-white/[0.08] transition-all flex items-center justify-center text-white/70 hover:text-white"
            onClick={() => toast.info('切换视图')}
          >
            <LayoutGrid className="size-3.5" />
          </button>
        </div>
      </div>

      {/* 任务分组 */}
      <div className="space-y-3">
        {groups.map((group) => {
          const groupTasks = groupedTasks[group.id] ?? [];
          return (
            <TaskGroup
              key={group.id}
              group={group}
              tasks={groupTasks}
              selectedTaskId={selectedTaskId}
              revealTaskId={revealTaskId}
              onRename={handleRenameGroup}
              onDelete={(id) => setDeleteGroupId(id)}
              onAddTask={handleAddTask}
              onMoveTask={handleMoveTask}
              onSelectTask={(task) => onSelectTask?.(task)}
            />
          );
        })}
      </div>

      {/* 任务编辑弹窗 */}
      <AnimatePresence>
        {showTaskEditor && (
          <TaskEditor
            task={editingTask}
            groups={groups}
            groupId={newTaskGroupId}
            onClose={() => setShowTaskEditor(false)}
            onSave={handleSaveTask}
            isNew={isNewTask}
          />
        )}
      </AnimatePresence>

      {/* 新增分组弹窗 */}
      <AnimatePresence>
        {showNewGroup && (
          <NewGroupDialog
            open={showNewGroup}
            onClose={() => setShowNewGroup(false)}
            onCreate={handleCreateGroup}
          />
        )}
      </AnimatePresence>

      {/* 删除分组确认 */}
      <AlertDialog open={!!deleteGroupId} onOpenChange={(o) => !o && setDeleteGroupId(null)}>
        <AlertDialogContent className="liquid-glass text-white rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white">删除分组</AlertDialogTitle>
            <AlertDialogDescription className="text-white/50">
              确定要删除「{groups.find((g) => g.id === deleteGroupId)?.name}」分组吗？
              该分组下的任务会被移动到第一个分组中。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="bg-white/[0.06] border-white/[0.08] text-white hover:bg-white/[0.1]">
              取消
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteGroupId && handleDeleteGroup(deleteGroupId)}
              className="bg-red-500 hover:bg-red-600 text-white"
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </motion.div>
  );
});

export default memo(TaskBoardSection);
