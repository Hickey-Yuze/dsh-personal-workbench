// @ts-nocheck —— 移植自 Yuze Workbench 的 TaskDashboard（原项目自带完整类型检查），此处不重复校验
import { memo, useState } from 'react';
import { motion } from 'framer-motion';
import { Search, Bell, Mail, Plus, ChevronDown, Sparkles, Filter, ArrowUpDown, LayoutGrid } from 'lucide-react';
import { toast } from '../lib/compat';

function TopBarComponent({ onNewTask, onSearch }: { onNewTask?: () => void; onSearch?: (keyword: string) => void }) {
  const [keyword, setKeyword] = useState('');

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (keyword.trim()) {
      onSearch?.(keyword.trim());
      setKeyword('');
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      className="flex flex-col gap-4 mb-6"
    >
      {/* 标题行 */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-bold text-white tracking-tight">
            待办事项
          </h1>
          <p className="text-sm text-white/50 mt-1">高效规划 · 智能协同 · 结果驱动</p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* 搜索框 */}
          <form onSubmit={onSubmit} className="relative w-[340px] hidden lg:block">
            <div className="absolute inset-0 liquid-glass rounded-2xl border border-white/[0.08]"></div>
            <div className="relative flex items-center h-11 px-4 gap-2.5">
              <Search className="size-4 text-white/40 shrink-0" />
              <input
                type="text"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="搜索任务、项目或文件…"
                className="flex-1 bg-transparent outline-none text-sm text-white placeholder:text-white/30"
              />
              <kbd className="shrink-0 text-[10px] text-white/30 bg-white/[0.06] border border-white/[0.06] rounded px-1.5 py-0.5 font-mono">
                ⌘K
              </kbd>
            </div>
            <span className="absolute inset-0 rounded-2xl border-flow opacity-20 pointer-events-none"></span>
          </form>

          {/* 图标按钮组 */}
          <div className="flex items-center gap-1.5">
            <button
              className="relative size-10 rounded-xl bg-white/[0.04] border border-white/[0.08] hover:bg-white/[0.08] hover:border-white/15 transition-all flex items-center justify-center text-white/70 hover:text-white group"
              onClick={() => toast.info('暂无新通知')}
            >
              <Bell className="size-[18px]" />
              <span className="absolute top-2 right-2 size-2 rounded-full bg-primary ring-2 ring-black animate-glow"></span>
            </button>
            <button
              className="size-10 rounded-xl bg-white/[0.04] border border-white/[0.08] hover:bg-white/[0.08] hover:border-white/15 transition-all flex items-center justify-center text-white/70 hover:text-white"
              onClick={() => toast.info('暂无新消息')}
            >
              <Mail className="size-[18px]" />
            </button>
            <button
              className="flex items-center gap-2 h-10 px-3.5 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 transition-all font-medium text-sm group relative overflow-hidden"
              onClick={() => (onNewTask ? onNewTask() : toast.success('新增任务'))}
            >
              <span className="absolute left-0 top-0 h-full w-16 bg-gradient-to-r from-transparent via-white/30 to-transparent animate-shine pointer-events-none"></span>
              <Plus className="size-4" />
              <span>新增任务</span>
              <ChevronDown className="size-4 opacity-70" />
            </button>
          </div>
        </div>
      </div>

      {/* 移动端搜索框 */}
      <form onSubmit={onSubmit} className="relative lg:hidden">
        <div className="absolute inset-0 liquid-glass rounded-2xl border border-white/[0.08]"></div>
        <div className="relative flex items-center h-11 px-4 gap-2.5">
          <Search className="size-4 text-white/40 shrink-0" />
          <input
            type="text"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜索任务、项目或文件…"
            className="flex-1 bg-transparent outline-none text-sm text-white placeholder:text-white/30"
          />
        </div>
      </form>


    </motion.div>
  );
}

export default memo(TopBarComponent);
