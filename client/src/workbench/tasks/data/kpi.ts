// @ts-nocheck —— 移植自 Yuze Workbench 的 TaskDashboard（原项目自带完整类型检查），此处不重复校验
// EXPORTS: IKpi, MOCK_KPIS
export interface IKpi {
  id: string
  title: string
  value: number
  unit: string
  change: number
  changeType: 'increase' | 'decrease'
  iconType: 'todo' | 'progress' | 'completed' | 'overdue'
}

export const MOCK_KPIS: IKpi[] = [
  {
    id: '1',
    title: '今日待办',
    value: 12,
    unit: '项任务',
    change: 20,
    changeType: 'increase',
    iconType: 'todo',
  },
  {
    id: '2',
    title: '进行中',
    value: 28,
    unit: '项任务',
    change: 8,
    changeType: 'increase',
    iconType: 'progress',
  },
  {
    id: '3',
    title: '已完成',
    value: 56,
    unit: '项任务',
    change: 15,
    changeType: 'increase',
    iconType: 'completed',
  },
  {
    id: '4',
    title: '逾期任务',
    value: 3,
    unit: '项任务',
    change: 40,
    changeType: 'decrease',
    iconType: 'overdue',
  },
]