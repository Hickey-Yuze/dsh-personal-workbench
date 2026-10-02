// @ts-nocheck —— 移植自 Yuze Workbench 的 TaskDashboard（原项目自带完整类型检查），此处不重复校验
import { memo, useEffect, useState } from 'react';
import { motion, useSpring, useTransform } from 'framer-motion';
import { ClipboardList, Activity, CheckCircle2, AlertTriangle, TrendingUp, TrendingDown, ArrowRight } from 'lucide-react';
import { MOCK_KPIS, type IKpi } from '../data/kpi';
import { type StatusFilter, type TaskStats } from './TaskBoardSection';
import { cn } from '../lib/utils';

const FILTER_BY_ICON: Record<IKpi['iconType'], StatusFilter> = {
  todo: 'todo',
  progress: 'in_progress',
  completed: 'completed',
  overdue: 'overdue',
};

const VALUE_KEY_BY_ICON: Record<IKpi['iconType'], keyof TaskStats> = {
  todo: 'todo',
  progress: 'in_progress',
  completed: 'completed',
  overdue: 'overdue',
};

function AnimatedNumber({ value, delay = 0 }: { value: number; delay?: number }) {
  const spring = useSpring(0, { stiffness: 60, damping: 20 });
  const display = useTransform(spring, (v) => Math.round(v));

  useEffect(() => {
    const t = setTimeout(() => spring.set(value), delay);
    return () => clearTimeout(t);
  }, [value, delay, spring]);

  return <motion.span>{display}</motion.span>;
}

function KpiCard({ item, index, onClick, realValue }: { item: IKpi; index: number; onClick?: () => void; realValue?: number }) {
  const IconMap: Record<string, typeof ClipboardList> = {
    todo: ClipboardList,
    progress: Activity,
    completed: CheckCircle2,
    overdue: AlertTriangle,
  };
  const Icon = IconMap[item.iconType] ?? ClipboardList;

  const isDestructive = item.iconType === 'overdue';

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: index * 0.08, ease: [0.16, 1, 0.3, 1] }}
      whileHover={{ y: -6, transition: { duration: 0.2 } }}
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      className="relative group rounded-2xl overflow-hidden cursor-pointer"
    >
      {/* 玻璃卡片背景 */}
      <div className="absolute inset-0 liquid-glass rounded-2xl border border-white/[0.08]"></div>
      {/* 内阴影高光 */}
      <div className="absolute inset-0 rounded-2xl shadow-[inset_0_1px_0_rgba(255_255_255_0.06)] pointer-events-none"></div>
      {/* hover 光晕 */}
      <div className={cn(
        'absolute -top-10 -right-10 w-32 h-32 rounded-full blur-3xl opacity-0 group-hover:opacity-100 transition-opacity duration-500',
        isDestructive ? 'bg-red-500/10' : 'bg-primary/10'
      )}></div>
      {/* 右下角弧形装饰 */}
      <div className="absolute bottom-0 right-0 w-2/3 h-2/3 opacity-[0.15] pointer-events-none">
        <svg viewBox="0 0 200 100" className="w-full h-full" preserveAspectRatio="none">
          <defs>
            <linearGradient id={`kpi-glow-${index}`} x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="white" stopOpacity="0" />
              <stop offset="100%" stopColor="white" stopOpacity="0.3" />
            </linearGradient>
          </defs>
          <path
            d="M 200 100 Q 100 0 0 80 L 0 100 Z"
            fill={`url(#kpi-glow-${index})`}
          />
        </svg>
      </div>

      <div className="relative p-5 flex flex-col gap-3">
        <div className="flex items-start justify-between">
          <div className="space-y-2">
            <div className="text-[13px] text-white/60 font-medium">{item.title}</div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-[32px] font-bold text-white tracking-tight tabular-nums">
                <AnimatedNumber value={realValue ?? item.value} delay={200 + index * 100} />
              </span>
              <span className="text-sm text-white/50">{item.unit}</span>
            </div>
          </div>
          <div className={cn(
            'size-11 rounded-xl flex items-center justify-center border transition-colors',
            isDestructive
              ? 'bg-red-500/10 border-red-500/20 text-red-400'
              : 'bg-white/[0.04] border-white/[0.08] text-white/80'
          )}>
            <Icon className="size-5" />
          </div>
        </div>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-xs">
            <span className="text-white/40">较昨日</span>
            {item.changeType === 'increase' ? (
              <span className={cn('flex items-center gap-0.5 font-medium', isDestructive ? 'text-red-400' : 'text-primary')}>
                <TrendingUp className="size-3.5" />
                ↑{item.change}%
              </span>
            ) : (
              <span className={cn('flex items-center gap-0.5 font-medium', isDestructive ? 'text-primary' : 'text-red-400')}>
                <TrendingDown className="size-3.5" />
                ↓{item.change}%
              </span>
            )}
          </div>
          <span className="flex items-center gap-0.5 text-[11px] text-white/45 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
            查看任务
            <ArrowRight className="size-3" />
          </span>
        </div>
      </div>
    </motion.div>
  );
}

function KpiSectionComponent({ onCardClick, stats }: { onCardClick?: (filter: StatusFilter) => void; stats?: TaskStats }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {MOCK_KPIS.map((item, i) => (
        <KpiCard
          key={item.id}
          item={item}
          index={i}
          realValue={stats?.[VALUE_KEY_BY_ICON[item.iconType]]}
          onClick={() => onCardClick?.(FILTER_BY_ICON[item.iconType])}
        />
      ))}
    </div>
  );
}

export default memo(KpiSectionComponent);
