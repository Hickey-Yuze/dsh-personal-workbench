/**
 * 文案：注册到宿主 locale（命名空间 dsh-personal-workbench），取不到时回退本地字典。
 * 新增键必须 zh/en 同时补齐 —— build-client 的接线自检会核对命名空间标记。
 */

export const NS = 'dsh-personal-workbench';

const zh: Record<string, string> = {
  'panel.label': '个人工作台',
  'panel.title': '个人工作台',
  'panel.subtitle': '待办 · 日程 · 知识库 · 更多模块，全部在本机运行',
  'panel.local': '本机运行',
  'act.back': '返回工作台',
  'act.retry': '重试',

  'common.loading': '加载中…',
  'common.delete': '删除',
  'common.close': '关闭',
  'state.ready': '可用',
  'state.pending': '待接入',

  'mod.overview.label': '项目总览',
  'mod.overview.desc': '待办、日程与知识库的聚合视图',
  'mod.todo.label': '待办事项',
  'mod.todo.desc': '分组待办，支持优先级与截止日',
  'mod.archive.label': '文件归档',
  'mod.archive.desc': '本地文件的整理与检索',
  'mod.daily.label': '日常管理',
  'mod.daily.desc': '月历日程与当天清单',
  'mod.music.label': 'Yuze 音乐平台',
  'mod.music.desc': '',
  'mod.film.label': 'Yuze 影视平台',
  'mod.film.desc': '影片检索与播放',
  'mod.entertainment.label': '娱乐平台',
  'mod.entertainment.desc': '摸鱼小工具',
  'mod.knowledge.label': '知识库',
  'mod.knowledge.desc': '浏览与搜索本机 Obsidian 笔记',

  'pending.archive': '文件归档需要选定归档根目录（本机路径）。等你确认要浏览哪个目录，我接上 Host 侧的文件读取。',
  'mod.wip.label': '开发中…',
  'mod.wip.desc': '更多模块，敬请期待',
  'pending.wip': '这个模块正在开发中，敬请期待。',
  'pending.media': '音乐与影视需要内容源。你现在用的是自己的接口（pages.dev / 酷我解析等）——这些算外部服务，按你「不要外链」的要求需要先确认是否允许调用。',
  'pending.fun': '娱乐平台打算做几个纯本地的小工具（无网络请求）。告诉我你想要哪几个，我直接做。',

  'todo.placeholder': '添加待办，回车即可…',
  'todo.add': '添加',
  'todo.due': '截止日',
  'todo.toggle': '完成 / 取消完成',
  'todo.priorityHint': '点击切换优先级',
  'todo.stats': '进行中 / 全部',
  'todo.done': '已完成',
  'todo.empty': '还没有待办，上面输入一条试试',
  'todo.emptyFilter': '该筛选下没有条目',
  'todo.saveFail': '保存失败，稍后自动重试',
  'todo.hostRestart': '本机存储未就绪 —— 重启 Yuze Harness 后生效',
  'todo.sec.overview': '数据概览',
  'todo.sec.board': '任务看板',
  'todo.ov.today': '今日待办',
  'todo.ov.doing': '进行中',
  'todo.ov.done': '已完成',
  'todo.ov.overdue': '逾期任务',
  'todo.ov.unit': '项任务',
  'todo.ov.todayHint': '今天到期，优先处理',
  'todo.ov.todayNone': '今天没有到期的',
  'todo.ov.high': '高优先级',
  'todo.ov.totalHint': '共',
  'todo.ov.doneToday': '今日完成',
  'todo.ov.since': '起逾期',
  'todo.ov.noOverdue': '暂无逾期',
  'todo.search': '搜索任务…',
  'todo.emptyGroup': '暂无任务，上面添加一条',
  'todo.doneTag': '已完成',
  'todo.doingTag': '进行中',
  'todo.filter.all': '全部',
  'todo.filter.open': '进行中',
  'todo.filter.done': '已完成',
  'todo.prio.high': '高',
  'todo.prio.normal': '中',
  'todo.prio.low': '低',

  'sched.prevMonth': '上个月',
  'sched.nextMonth': '下个月',
  'sched.today': '今天',
  'sched.total': '全部日程',
  'sched.items': '条',
  'sched.placeholder': '添加日程，回车即可…',
  'sched.location': '地点（可选）',
  'sched.add': '添加',
  'sched.emptyDay': '这天没有安排',
  'sched.done': '完成 / 取消完成',
  'sched.upcoming': '接下来',

  'kb.searchPlaceholder': '全文搜索笔记，回车执行…',
  'kb.search': '搜索',
  'kb.root': '根目录',
  'kb.vault': '知识库',
  'kb.noHits': '没有匹配的笔记',
  'kb.matches': '处匹配',
  'kb.up': '返回上级',
  'kb.offline': '知识库未连接：请确认 Obsidian 正在运行，且 Local REST API 插件已启用',
  'kb.pick': '从左侧选择目录或笔记',

  'ov.todoOpen': '待办进行中',
  'ov.total': '共',
  'ov.today': '今日安排',
  'ov.overdue': '已逾期',
  'ov.overdueHint': '需要尽快处理',
  'ov.clean': '没有逾期',
  'ov.kb': '知识库条目',
  'ov.kbOffline': '未连接',
  'ov.kbHint': '根目录条目数',
  'ov.todoList': '待办速览',
  'ov.openModule': '打开模块',
  'ov.noTodo': '暂无进行中的待办',
  'ov.schedule': '日程速览',
  'ov.noSchedule': '暂无安排',
  'ov.clock': '当前时间',
  'ov.dayPassed': '今日已过',
  'ov.calendar': '日历',
  'ov.dueToday': '项今天到期',
  'ov.notes': '便签',
  'ov.notesPlaceholder': '随手记点什么，自动保存在本机…',
  'ov.modules': '模块入口',
  'ov.widget.stats': '指标概览',
  'ov.edit': '编辑布局',
  'ov.done': '完成',
  'ov.reset': '重置布局',
  'ov.addWidget': '添加组件',
  'ov.noMoreWidgets': '组件都已在画布上',
  'ov.editHint': '拖顶部把手移动，拖边缘手柄改大小；松手自动保存',
  'ov.dragHint': '点「编辑布局」可拖动与改大小',
  'ov.widgets': '个组件',
};

const en: Record<string, string> = {
  'panel.label': 'Personal Workbench',
  'panel.title': 'Personal Workbench',
  'panel.subtitle': 'Todos, schedule, knowledge base and more — all running locally',
  'panel.local': 'Local',
  'act.back': 'Back to workbench',
  'act.retry': 'Retry',

  'common.loading': 'Loading…',
  'common.delete': 'Delete',
  'common.close': 'Close',
  'state.ready': 'Ready',
  'state.pending': 'Pending',

  'mod.overview.label': 'Overview',
  'mod.overview.desc': 'Aggregated view of todos, schedule and notes',
  'mod.todo.label': 'Todos',
  'mod.todo.desc': 'Grouped todos with priority and due date',
  'mod.archive.label': 'Files',
  'mod.archive.desc': 'Organise and search local files',
  'mod.daily.label': 'Schedule',
  'mod.daily.desc': 'Month calendar and daily agenda',
  'mod.music.label': 'Music',
  'mod.music.desc': 'Search and play',
  'mod.film.label': 'Yuze Films',
  'mod.film.desc': 'Find and play videos',
  'mod.entertainment.label': 'Fun',
  'mod.entertainment.desc': 'Small offline toys',
  'mod.knowledge.label': 'Knowledge base',
  'mod.knowledge.desc': 'Browse and search local Obsidian notes',

  'pending.archive': 'File archive needs an archive root directory on this machine.',
  'mod.wip.label': 'In Progress…',
  'mod.wip.desc': 'More modules coming soon',
  'pending.wip': 'This module is under development. Stay tuned.',
  'pending.media': 'Music and films need a content source. Yours currently point at external services.',
  'pending.fun': 'Fun module will host small fully-offline tools. Tell me which ones you want.',

  'todo.placeholder': 'New todo, press Enter…',
  'todo.add': 'Add',
  'todo.due': 'Due date',
  'todo.toggle': 'Toggle done',
  'todo.priorityHint': 'Click to cycle priority',
  'todo.stats': 'Open / All',
  'todo.done': 'done',
  'todo.empty': 'No todos yet — add one above',
  'todo.emptyFilter': 'Nothing in this filter',
  'todo.saveFail': 'Save failed, will retry',
  'todo.hostRestart': 'Local storage not ready — restart Yuze Harness',
  'todo.sec.overview': 'Overview',
  'todo.sec.board': 'Task board',
  'todo.ov.today': 'Due today',
  'todo.ov.doing': 'In progress',
  'todo.ov.done': 'Completed',
  'todo.ov.overdue': 'Overdue',
  'todo.ov.unit': ' tasks',
  'todo.ov.todayHint': 'due today — do these first',
  'todo.ov.todayNone': 'nothing due today',
  'todo.ov.high': 'high priority',
  'todo.ov.totalHint': 'total',
  'todo.ov.doneToday': 'done today',
  'todo.ov.since': 'overdue since',
  'todo.ov.noOverdue': 'none overdue',
  'todo.search': 'Search tasks…',
  'todo.emptyGroup': 'No tasks — add one above',
  'todo.doneTag': 'Done',
  'todo.doingTag': 'Open',
  'todo.filter.all': 'All',
  'todo.filter.open': 'Open',
  'todo.filter.done': 'Done',
  'todo.prio.high': 'High',
  'todo.prio.normal': 'Mid',
  'todo.prio.low': 'Low',

  'sched.prevMonth': 'Previous month',
  'sched.nextMonth': 'Next month',
  'sched.today': 'Today',
  'sched.total': 'All events',
  'sched.items': 'items',
  'sched.placeholder': 'New event, press Enter…',
  'sched.location': 'Location (optional)',
  'sched.add': 'Add',
  'sched.emptyDay': 'Nothing scheduled',
  'sched.done': 'Toggle done',
  'sched.upcoming': 'Upcoming',

  'kb.searchPlaceholder': 'Full-text search, press Enter…',
  'kb.search': 'Search',
  'kb.root': 'Root',
  'kb.vault': 'Vault',
  'kb.noHits': 'No matching notes',
  'kb.matches': 'matches',
  'kb.up': 'Up one level',
  'kb.offline': 'Knowledge base offline: make sure Obsidian is running with the Local REST API plugin enabled',
  'kb.pick': 'Pick a folder or note on the left',

  'ov.todoOpen': 'Open todos',
  'ov.total': 'total',
  'ov.today': 'Today',
  'ov.overdue': 'Overdue',
  'ov.overdueHint': 'Handle these first',
  'ov.clean': 'Nothing overdue',
  'ov.kb': 'KB entries',
  'ov.kbOffline': 'offline',
  'ov.kbHint': 'root entries',
  'ov.todoList': 'Todo snapshot',
  'ov.openModule': 'Open module',
  'ov.noTodo': 'No open todos',
  'ov.schedule': 'Schedule snapshot',
  'ov.noSchedule': 'Nothing scheduled',
  'ov.clock': 'Now',
  'ov.dayPassed': 'Day',
  'ov.calendar': 'Calendar',
  'ov.dueToday': 'due today',
  'ov.notes': 'Notes',
  'ov.notesPlaceholder': 'Jot something down — saved locally…',
  'ov.modules': 'Modules',
  'ov.widget.stats': 'Metrics',
  'ov.edit': 'Edit layout',
  'ov.done': 'Done',
  'ov.reset': 'Reset layout',
  'ov.addWidget': 'Add widget',
  'ov.noMoreWidgets': 'All widgets are on the canvas',
  'ov.editHint': 'Drag the top handle to move, edge handles to resize; saved on release',
  'ov.dragHint': 'Click “Edit layout” to drag and resize',
  'ov.widgets': 'widgets',
};

let bound: ((key: string, fallback?: string) => string) | undefined;

/** 宿主 locale 服务的最小结构面（inject 声明过，但允许缺席 → 退回本地字典）。 */
interface LocaleLike {
  register?(ns: string, dicts: Record<string, Record<string, string>>): unknown;
  bind?(ns: string): ((key: string) => string) | undefined;
}

export function initI18n(locale: LocaleLike | undefined): void {
  if (locale === undefined || typeof locale.register !== 'function' || typeof locale.bind !== 'function') {
    bound = undefined;
    return;
  }
  try {
    locale.register(NS, { zh, en });
    const lookup = locale.bind(NS);
    if (typeof lookup !== 'function') {
      bound = undefined;
      return;
    }
    bound = (key, fallback) => {
      const value = lookup(key);
      return typeof value === 'string' && value !== '' ? value : (fallback ?? key);
    };
  } catch {
    bound = undefined;
  }
}

export function t(key: string): string {
  if (bound !== undefined) {
    try {
      const out = bound(key);
      if (typeof out === 'string' && out !== '' && out !== key) return out;
    } catch {
      /* 回退本地字典 */
    }
  }
  return zh[key] ?? key;
}

/** 极简模板替换：{name} 形式占位符。 */
export function tpl(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`));
}
