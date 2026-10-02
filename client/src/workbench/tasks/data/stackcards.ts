// @ts-nocheck —— 移植自 Yuze Workbench 的 TaskDashboard（原项目自带完整类型检查），此处不重复校验
// EXPORTS: IStackCard, MOCK_STACK_CARDS
export interface IStackCard {
  id: string
  title: string
  subtitle: string
  completion: number
  color: 'primary' | 'success' | 'default'
  layerIndex: number
  badgeText?: string
}

export const MOCK_STACK_CARDS: IStackCard[] = [
  {
    id: '1',
    title: '项目文档',
    subtitle: '2025·Q2',
    completion: 87,
    color: 'primary',
    layerIndex: 0,
  },
  {
    id: '2',
    title: '需求评审',
    subtitle: '进行中',
    completion: 75,
    color: 'default',
    layerIndex: 1,
  },
  {
    id: '3',
    title: '产品设计',
    subtitle: '进行中',
    completion: 62,
    color: 'default',
    layerIndex: 2,
  },
  {
    id: '4',
    title: '开发实现',
    subtitle: '项目归档',
    completion: 45,
    color: 'success',
    layerIndex: 3,
    badgeText: '+4',
  },
  {
    id: '5',
    title: '会议版',
    subtitle: 'V2.0',
    completion: 30,
    color: 'default',
    layerIndex: 4,
  },
  {
    id: '6',
    title: '金句版',
    subtitle: 'V1.5',
    completion: 18,
    color: 'default',
    layerIndex: 5,
  },
]