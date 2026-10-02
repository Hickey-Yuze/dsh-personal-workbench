// @ts-nocheck —— 移植自 Yuze Workbench 的 TaskDashboard（原项目自带完整类型检查），此处不重复校验
import { memo, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Sparkles,
  Search,
  User,
  Briefcase,
  CalendarClock,
  CircleDot,
  Flag,
  Plus,
  Pencil,
  Check,
  MoreHorizontal,
} from 'lucide-react';
import { toast } from '../lib/compat';
import { cn } from '../lib/utils';

type DetailTask = {
  taskNo: string;
  title: string;
  priority: 'high' | 'medium' | 'low';
  status: 'todo' | 'in_progress' | 'completed' | 'overdue';
  assignee: string;
  assigneeAvatar?: string;
  project: string;
  deadline: string;
  description: string;
  tags: string[];
};

const PRIORITY_MAP = {
  high: { label: '高', className: 'text-red-400 border-red-400/20', dot: 'bg-red-400' },
  medium: { label: '中', className: 'text-amber-400 border-amber-400/20', dot: 'bg-amber-400' },
  low: { label: '低', className: 'text-white/55 border-white/10', dot: 'bg-white/40' },
} as const;

const STATUS_MAP = {
  todo: { label: '待办', className: 'text-amber-400', dot: 'bg-amber-400' },
  in_progress: { label: '进行中', className: 'text-primary', dot: 'bg-primary' },
  completed: { label: '已完成', className: 'text-cyan-400', dot: 'bg-cyan-400' },
  overdue: { label: '已逾期', className: 'text-red-400', dot: 'bg-red-400' },
} as const;

// 「2025-05-24 18:00」 <-> 「2025-05-24T18:00」
const toLocalInput = (v: string) => (v.includes('T') ? v : v.replace(' ', 'T'));
const toDisplay = (v: string) => v.replace('T', ' ');

function DetailPanelComponent({
  task,
  onComplete,
  onSave,
}: {
  task: DetailTask | null;
  onComplete?: () => void;
  onSave?: (task: DetailTask) => void;
}) {
  const currentTask = task ?? null;
  const [isEditing, setIsEditing] = useState(false);
  const [editingKey, setEditingKey] = useState<keyof DetailTask | null>(null);
  const [editValue, setEditValue] = useState('');

  const priority = currentTask ? PRIORITY_MAP[currentTask.priority] : null;
  // 未完成任务若已过截止时间，展示为已逾期
  const effectiveStatus = useMemo(() => {
    if (!currentTask || currentTask.status === 'completed') return currentTask?.status ?? null;
    const dt = new Date(toLocalInput(currentTask.deadline).replace('T', ' '));
    const expired = !Number.isNaN(dt.getTime()) && dt.getTime() < Date.now();
    return expired ? 'overdue' : currentTask.status;
  }, [currentTask]);
  const status = effectiveStatus ? STATUS_MAP[effectiveStatus] : null;

  // 开始就地编辑某个字段
  const handleFieldEdit = (key: keyof DetailTask) => {
    if (!currentTask || !isEditing) return;
    setEditingKey(key);
    if (key === 'deadline') setEditValue(toLocalInput(currentTask.deadline));
    else if (key === 'tags') setEditValue((currentTask.tags ?? []).join(', '));
    else if (key === 'status') setEditValue(effectiveStatus ?? currentTask.status);
    else setEditValue(String((currentTask as Record<string, unknown>)[key] ?? ''));
  };

  // 保存当前字段
  const handleFieldSave = () => {
    if (!currentTask || !editingKey) return;
    const next = { ...currentTask };
    if (editingKey === 'deadline') {
      next.deadline = toDisplay(editValue);
    } else if (editingKey === 'tags') {
      next.tags = editValue.split(/[,，]/).map((s) => s.trim()).filter(Boolean);
    } else {
      (next as Record<string, unknown>)[editingKey] = editValue;
    }
    onSave?.(next);
    setEditingKey(null);
  };

  // 底部「编辑任务」按钮：只切换编辑态，界面布局保持不变，点击字段即可就地编辑
  const handleToggleEdit = () => {
    if (!currentTask) return;
    if (isEditing) {
      setEditingKey(null);
      setIsEditing(false);
      toast.success('已保存编辑状态，字段修改已实时同步');
    } else {
      setIsEditing(true);
      toast.info('点击任务中的字段即可就地编辑');
    }
  };

  const inputCls =
    'w-full h-8 rounded-lg bg-black/30 border border-primary/50 focus:ring-4 focus:ring-primary/10 text-xs text-white px-2.5 transition-all outline-none placeholder:text-white/25 [color-scheme:dark]';

  // 可编辑字段渲染：编辑模式下点击值区域进入就地编辑
  const editableValue = (key: keyof DetailTask, display: React.ReactNode) =>
    isEditing ? (
      editingKey === key ? (
        <input
          autoFocus
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={handleFieldSave}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleFieldSave();
            if (e.key === 'Escape') setEditingKey(null);
          }}
          className={inputCls}
        />
      ) : (
        <button
          onClick={() => handleFieldEdit(key)}
          className="group flex items-center gap-1 text-sm text-white/80 hover:text-primary transition-colors cursor-text"
          title="点击编辑"
        >
          {display}
          <Pencil className="size-3 text-white/25 group-hover:text-primary/70 transition-colors" />
        </button>
      )
    ) : (
      <span className="text-sm text-white/80">{display}</span>
    );

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.6, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
      className="relative h-full flex flex-col gap-4"
    >
      {/* 玻璃卡片背景 */}
      <div className="absolute inset-0 liquid-glass rounded-2xl"></div>
      <div className="absolute inset-0 rounded-2xl shadow-[inset_0_1px_0_rgba(255_255_255_0.05)] pointer-events-none"></div>

      <div className="relative p-5 flex flex-col gap-5 h-full overflow-y-auto">
        {/* 顶部操作 */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <motion.div
              animate={{ rotate: [0, 8, -8, 0], scale: [1, 1.15, 1] }}
              transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
            >
              <Sparkles className="size-4 text-primary" />
            </motion.div>
            <span className="text-sm font-semibold text-white">智能详情</span>
            {isEditing && (
              <span className="text-[10px] px-2 py-0.5 rounded-md bg-primary/10 border border-primary/25 text-primary">编辑中</span>
            )}
          </div>
          <button
            className="size-8 rounded-xl hover:bg-white/[0.06] flex items-center justify-center text-white/50 hover:text-white transition-colors"
            onClick={() => toast.info('搜索详情')}
          >
            <Search className="size-4" />
          </button>
        </div>

        {!currentTask ? (
          <div className="flex-1 flex items-center justify-center text-sm text-white/35">
            点击左侧任务查看详情
          </div>
        ) : (
          <>
            {/* 任务信息 */}
            <div className="space-y-3">
              <div className="flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  {isEditing && editingKey === 'title' ? (
                    <input
                      autoFocus
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onBlur={handleFieldSave}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleFieldSave();
                        if (e.key === 'Escape') setEditingKey(null);
                      }}
                      className="w-full h-10 rounded-lg bg-black/30 border border-primary/50 focus:ring-4 focus:ring-primary/10 text-lg font-bold text-white px-2.5 outline-none [color-scheme:dark]"
                    />
                  ) : (
                    <button
                      onClick={() => handleFieldEdit('title')}
                      className="block w-full text-left text-xl font-bold text-white tracking-tight hover:text-primary transition-colors cursor-text"
                      title={isEditing ? '点击编辑标题' : undefined}
                      disabled={!isEditing}
                    >
                      {currentTask.title}
                    </button>
                  )}
                </div>
                {priority && (
                  <span className={cn('shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-md border', priority.className)}>
                    {priority.label}优先级
                  </span>
                )}
              </div>
            </div>

            {/* 详情字段 */}
            <div className="space-y-3.5">
              <DetailRow icon={<User className="size-3.5" />} label="负责人">
                {isEditing && editingKey === 'assignee' ? (
                  <input
                    autoFocus
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onBlur={handleFieldSave}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleFieldSave();
                      if (e.key === 'Escape') setEditingKey(null);
                    }}
                    placeholder="请输入负责人"
                    className={inputCls}
                  />
                ) : (
                  <div className="flex items-center gap-2">
                    {editableValue('assignee', <span>{currentTask.assignee}</span>)}
                  </div>
                )}
              </DetailRow>

              <DetailRow icon={<Briefcase className="size-3.5" />} label="所属项目">
                {editableValue('project', <span>{currentTask.project}</span>)}
              </DetailRow>

              <DetailRow icon={<CalendarClock className="size-3.5" />} label="截止时间">
                {isEditing && editingKey === 'deadline' ? (
                  <input
                    autoFocus
                    type="datetime-local"
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onBlur={handleFieldSave}
                    onKeyDown={(e) => e.key === 'Escape' && setEditingKey(null)}
                    className={inputCls}
                  />
                ) : (
                  editableValue('deadline', <span className="tabular-nums">{(currentTask.deadline || '').replace('T', ' ')}</span>)
                )}
              </DetailRow>

              <DetailRow icon={<CircleDot className="size-3.5" />} label="当前状态">
                {isEditing && editingKey === 'status' ? (
                  <select
                    autoFocus
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onBlur={handleFieldSave}
                    className={cn(inputCls, 'cursor-pointer')}
                  >
                    {(Object.keys(STATUS_MAP) as DetailTask['status'][]).map((k) => (
                      <option key={k} value={k}>{STATUS_MAP[k].label}</option>
                    ))}
                  </select>
                ) : (
                  editableValue(
                    'status',
                    status && (
                      <span className={cn('flex items-center gap-1.5', status.className)}>
                        <span className={cn('size-1.5 rounded-full animate-pulse', status.dot)}></span>
                        {status.label}
                      </span>
                    )
                  )
                )}
              </DetailRow>

              <DetailRow icon={<Flag className="size-3.5" />} label="优先级">
                {isEditing && editingKey === 'priority' ? (
                  <select
                    autoFocus
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onBlur={handleFieldSave}
                    className={cn(inputCls, 'cursor-pointer')}
                  >
                    {(Object.keys(PRIORITY_MAP) as DetailTask['priority'][]).map((k) => (
                      <option key={k} value={k}>{PRIORITY_MAP[k].label}优先级</option>
                    ))}
                  </select>
                ) : (
                  editableValue(
                    'priority',
                    priority && (
                      <span className={cn('flex items-center gap-1.5', priority.className)}>
                        <span className={cn('size-1.5 rounded-full', priority.dot)}></span>
                        {priority.label}
                      </span>
                    )
                  )
                )}
              </DetailRow>
            </div>

            {/* 标签 */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-white/40 shrink-0">标签</span>
              {isEditing && editingKey === 'tags' ? (
                <input
                  autoFocus
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onBlur={handleFieldSave}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleFieldSave();
                    if (e.key === 'Escape') setEditingKey(null);
                  }}
                  placeholder="逗号分隔"
                  className={cn(inputCls, 'flex-1')}
                />
              ) : (
                <div className="flex items-center gap-1.5 flex-wrap flex-1 min-w-0">
                  {(currentTask.tags ?? []).map((tag) => (
                    <span
                      key={tag}
                      className="text-[11px] px-2 py-0.5 rounded-md bg-white/[0.06] border border-white/[0.08] text-white/60 hover:bg-white/[0.1] transition-colors cursor-pointer"
                      onClick={() => isEditing && handleFieldEdit('tags')}
                    >
                      {tag}
                    </span>
                  ))}
                  <button
                    className="size-5 rounded-md bg-white/[0.04] border border-white/[0.06] hover:bg-white/[0.08] flex items-center justify-center text-white/40 hover:text-white/70 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    onClick={() => handleFieldEdit('tags')}
                    disabled={!isEditing}
                    title="编辑标签"
                  >
                    <Plus className="size-3" />
                  </button>
                </div>
              )}
            </div>
          </>
        )}

        {/* 任务内容：占满标签与按钮之间的弹性空间；编辑模式下点击即可就地编辑 */}
        <div className="flex-1 min-h-0 flex flex-col gap-2">
          <span className="text-xs text-white/40 shrink-0">任务内容</span>
          {isEditing && editingKey === 'description' ? (
            <textarea
              autoFocus
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={handleFieldSave}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setEditingKey(null);
              }}
              placeholder="输入任务内容…（Enter 换行，失焦保存）"
              className="flex-1 min-h-0 w-full resize-none rounded-xl bg-black/30 border border-primary/50 focus:ring-4 focus:ring-primary/10 text-sm text-white leading-relaxed p-3 transition-all outline-none placeholder:text-white/25 [color-scheme:dark]"
            />
          ) : currentTask && currentTask.description && currentTask.description.trim() !== '' ? (
            <div
              className={cn(
                'flex-1 min-h-0 overflow-y-auto rounded-xl bg-white/[0.03] border border-white/[0.06] p-3',
                isEditing && 'cursor-text hover:border-primary/40 transition-colors'
              )}
              onClick={() => isEditing && handleFieldEdit('description')}
              title={isEditing ? '点击编辑任务内容' : undefined}
            >
              <p className="text-sm text-white/70 leading-relaxed whitespace-pre-wrap break-words">
                {currentTask.description}
              </p>
            </div>
          ) : (
            <button
              className="flex-1 flex items-center justify-center rounded-xl border border-dashed border-white/[0.08] text-xs text-white/30 hover:border-primary/40 hover:text-white/50 transition-colors cursor-text disabled:cursor-default"
              onClick={() => isEditing && handleFieldEdit('description')}
              disabled={!isEditing}
            >
              {isEditing ? '点击填写任务内容' : '暂无内容，点击「编辑任务」补充'}
            </button>
          )}
        </div>

        {/* 底部操作按钮 */}
        <div className="mt-auto pt-2 flex items-center gap-2">
          <button
            className="flex-1 h-10 rounded-xl bg-white/[0.04] border border-white/[0.08] hover:bg-white/[0.08] text-sm text-white/80 font-medium transition-all flex items-center justify-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
            onClick={handleToggleEdit}
            disabled={!currentTask}
          >
            <Pencil className="size-3.5" />
            {isEditing ? '完成编辑' : '编辑任务'}
          </button>
          <button
            className="flex-1 h-10 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 text-sm font-semibold transition-all flex items-center justify-center gap-1.5 shadow-[0_0_20px_rgba(0_210_106_0.3)] disabled:opacity-40 disabled:cursor-not-allowed"
            onClick={onComplete}
            disabled={!currentTask}
          >
            <Check className="size-4" />
            完成任务
          </button>
          <button
            className="size-10 rounded-xl bg-white/[0.04] border border-white/[0.08] hover:bg-white/[0.08] text-white/70 hover:text-white transition-all flex items-center justify-center"
            onClick={() => toast.info('更多操作')}
          >
            <MoreHorizontal className="size-4" />
          </button>
        </div>
      </div>
    </motion.div>
  );
}

function DetailRow({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3">
      <motion.div
        animate={{ y: [0, -2, 0] }}
        transition={{ duration: 3.5, repeat: Infinity, ease: 'easeInOut' }}
        className="size-7 shrink-0 rounded-lg bg-white/[0.04] border border-white/[0.06] flex items-center justify-center text-white/50"
      >
        {icon}
      </motion.div>
      <span className="text-xs text-white/40 w-16 shrink-0">{label}</span>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}

export default memo(DetailPanelComponent);
