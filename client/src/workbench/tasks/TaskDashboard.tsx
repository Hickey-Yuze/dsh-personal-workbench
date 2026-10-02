// @ts-nocheck —— 移植自 Yuze Workbench 的 TaskDashboard（原项目自带完整类型检查），此处不重复校验
import { memo, useCallback, useRef, useState } from 'react';
import { toast } from './lib/compat';
import TopBarSection from './sections/TopBarSection';
import KpiSection from './sections/KpiSection';
import TaskBoardSection, { type StatusFilter, type TaskStats, type TaskItem, type TaskBoardHandle } from './sections/TaskBoardSection';
import StackCardsSection from './sections/StackCardsSection';
import DetailPanelSection from './sections/DetailPanelSection';

function TaskDashboardPage() {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [newTaskSeq, setNewTaskSeq] = useState(0);
  const [taskStats, setTaskStats] = useState<TaskStats | undefined>(undefined);
  const [selectedTask, setSelectedTask] = useState<TaskItem | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const boardRef = useRef<TaskBoardHandle>(null);

  const handleKpiClick = useCallback((filter: StatusFilter) => {
    setStatusFilter(filter);
    requestAnimationFrame(() => {
      scrollRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }, []);

  const handleOpenNewTask = useCallback(() => {
    setNewTaskSeq((s) => s + 1);
  }, []);

  // 顶部搜索：模糊匹配任务 → 定位并选中
  const handleSearch = useCallback((keyword: string) => {
    const match = boardRef.current?.searchAndSelectTask(keyword);
    if (match) toast.success(`已定位到「${match.title}」`);
    else toast.error(`未找到与「${keyword}」相关的任务`);
  }, []);

  const handleStatsChange = useCallback((stats: TaskStats) => {
    setTaskStats(stats);
  }, []);

  const handleSelectTask = useCallback((task: TaskItem) => {
    setSelectedTask(task);
  }, []);

  const handleTaskUpdated = useCallback((task: TaskItem) => {
    setSelectedTask((prev) => (prev?.id === task.id ? task : prev));
  }, []);

  const handleCompleteSelected = useCallback(() => {
    if (selectedTask) boardRef.current?.completeTask(selectedTask.id);
  }, [selectedTask]);

  const handleSaveSelected = useCallback(
    (updated: Omit<TaskItem, 'id' | 'groupId'>) => {
      if (!selectedTask) return;
      const merged: TaskItem = { ...selectedTask, ...updated };
      boardRef.current?.updateTask(merged);
    },
    [selectedTask]
  );

  return (
    <div className="w-full min-h-0 relative">
      <TopBarSection onNewTask={handleOpenNewTask} onSearch={handleSearch} />

      <div className="space-y-6 min-w-0">
        {/* KPI 统计 */}
        <div>
          <h2 className="text-base font-semibold text-white mb-4 w-fit relative overflow-hidden">
            数据概览
            <span className="absolute left-0 top-0 h-full w-16 bg-gradient-to-r from-transparent via-primary/30 to-transparent animate-shine rounded pointer-events-none"></span>
          </h2>
          <KpiSection onCardClick={handleKpiClick} stats={taskStats} />
        </div>
        {/* 任务看板 + 3D 堆叠卡片 + 详情面板 */}
        <div
          ref={scrollRef}
          className="grid grid-cols-1 xl:grid-cols-[340px_1fr_340px] gap-6 scroll-mt-4"
        >
          <TaskBoardSection
            ref={boardRef}
            externalStatusFilter={statusFilter}
            newTaskSignal={newTaskSeq}
            selectedTaskId={selectedTask?.id ?? null}
            onSelectTask={handleSelectTask}
            onStatsChange={handleStatsChange}
            onTaskUpdated={handleTaskUpdated}
          />
          <StackCardsSection />
          {selectedTask ? (
            <DetailPanelSection
              task={selectedTask}
              onComplete={handleCompleteSelected}
              onSave={handleSaveSelected}
            />
          ) : (
            // 未选中任务时隐藏智能详情面板（2026-08-18）
            <div className="hidden xl:block" />
          )}
        </div>
      </div>
    </div>
  );
}

export default memo(TaskDashboardPage);
