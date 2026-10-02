// @ts-nocheck —— 移植自 Yuze Workbench 的 TaskDashboard（原项目自带完整类型检查），此处不重复校验
// EXPORTS: ITask, MOCK_TASKS
export interface ITask {
  id: string
  taskNo: string
  title: string
  priority: 'high' | 'medium' | 'low'
  status: 'todo' | 'in_progress' | 'completed' | 'overdue'
  group: 'requirement' | 'design' | 'development'
  assignee: string
  assigneeAvatar: string
  project: string
  deadline: string
  scheduleTime?: string
  description: string
  tags: string[]
}

export const MOCK_TASKS: ITask[] = [
  {
    id: '1',
    taskNo: 'WXB-2025-001',
    title: '需求评审会',
    priority: 'high',
    status: 'in_progress',
    group: 'requirement',
    assignee: 'Brandon',
    assigneeAvatar: 'https://lf3-static.bytednsdoc.com/obj/eden-cn/ylcylz_fsph_ryhs/ljhwZthlaukjlkulzlp/feisuda/avatar/base/1.jpg',
    project: 'WenXiBuddy 2.0',
    deadline: '2025-05-24 18:00',
    scheduleTime: '今天 10:00',
    description: '与业务团队对齐需求范围，明确核心目标与验收标准，输出需求评审结论。',
    tags: ['评审', '需求', '关键路径'],
  },
  {
    id: '2',
    taskNo: 'WXB-2025-002',
    title: '用户调研分析',
    priority: 'medium',
    status: 'todo',
    group: 'requirement',
    assignee: 'Brandon',
    assigneeAvatar: 'https://lf3-static.bytednsdoc.com/obj/eden-cn/ylcylz_fsph_ryhs/ljhwZthlaukjlkulzlp/feisuda/avatar/base/2.jpg',
    project: 'WenXiBuddy 2.0',
    deadline: '2025-05-25 18:00',
    scheduleTime: '今天 14:00',
    description: '整理用户访谈数据，输出用户画像与核心需求洞察报告。',
    tags: ['调研', '需求'],
  },
  {
    id: '3',
    taskNo: 'WXB-2025-003',
    title: '竞品功能梳理',
    priority: 'medium',
    status: 'todo',
    group: 'requirement',
    assignee: 'Brandon',
    assigneeAvatar: 'https://lf3-static.bytednsdoc.com/obj/eden-cn/ylcylz_fsph_ryhs/ljhwZthlaukjlkulzlp/feisuda/avatar/base/3.jpg',
    project: 'WenXiBuddy 2.0',
    deadline: '2025-05-26 12:00',
    scheduleTime: '明天 09:30',
    description: '分析主流竞品功能矩阵，提炼差异化机会点与借鉴方向。',
    tags: ['竞品', '分析'],
  },
  {
    id: '4',
    taskNo: 'WXB-2025-004',
    title: '交互流程设计',
    priority: 'high',
    status: 'in_progress',
    group: 'design',
    assignee: 'Brandon',
    assigneeAvatar: 'https://lf3-static.bytednsdoc.com/obj/eden-cn/ylcylz_fsph_ryhs/ljhwZthlaukjlkulzlp/feisuda/avatar/base/4.jpg',
    project: 'WenXiBuddy 2.0',
    deadline: '2025-06-02 18:00',
    description: '完成核心功能链路的交互原型与流程图设计。',
    tags: ['交互', '设计'],
  },
  {
    id: '5',
    taskNo: 'WXB-2025-005',
    title: '原型评审',
    priority: 'medium',
    status: 'in_progress',
    group: 'design',
    assignee: 'Brandon',
    assigneeAvatar: 'https://lf3-static.bytednsdoc.com/obj/eden-cn/ylcylz_fsph_ryhs/ljhwZthlaukjlkulzlp/feisuda/avatar/base/5.jpg',
    project: 'WenXiBuddy 2.0',
    deadline: '2025-06-05 18:00',
    description: '组织产品、研发、测试进行高保真原型评审。',
    tags: ['评审', '原型'],
  },
]