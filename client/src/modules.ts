/**
 * 八个模块的唯一事实源：顺序、配色、图标、是否已原生实现。
 * 与 i18n 的 `mod.<id>.label|desc` 一一对应。
 */

export interface ModuleDef {
  id: string;
  /** 强调色（模块图标底与卡片描边）。 */
  accent: string;
  /** 24×24 viewBox 的 SVG path。 */
  icon: string;
  /** 可选：位图 Logo（data URL），页头优先于 icon 渲染。 */
  image?: string;
  /** true = 面板内已原生实现；false = 尚未接入（点击显示说明，而不是假数据）。 */
  ready: boolean;
  /** 未实现时展示的下一步说明键。 */
  pendingKey?: string;
}

export const MODULES: ModuleDef[] = [
  {
    id: 'overview',
    accent: '#00D26A',
    ready: true,
    icon: 'M4 13h6V4H4v9Zm0 7h6v-5H4v5Zm10 0h6v-9h-6v9Zm0-16v5h6V4h-6Z',
  },
  {
    id: 'todo',
    accent: '#38BDF8',
    ready: true,
    icon: 'M9 6h11M9 12h11M9 18h11M4 6l1.2 1.2L7.5 4.8M4 12l1.2 1.2L7.5 10.8M4 18l1.2 1.2L7.5 16.8',
  },
  {
    id: 'archive',
    accent: '#60A5FA',
    ready: true,
    pendingKey: 'pending.archive',
    icon: 'M3 7.5A1.5 1.5 0 0 1 4.5 6h4l2 2.5h7A1.5 1.5 0 0 1 19 10v7.5A1.5 1.5 0 0 1 17.5 19h-13A1.5 1.5 0 0 1 3 17.5v-10Z',
  },
  {
    id: 'daily',
    accent: '#A78BFA',
    ready: true,
    icon: 'M7 3v3m10-3v3M4 8.5h16M5.5 5h13A1.5 1.5 0 0 1 20 6.5v12A1.5 1.5 0 0 1 18.5 20h-13A1.5 1.5 0 0 1 4 18.5v-12A1.5 1.5 0 0 1 5.5 5Zm2.5 8h2v2H8v-2Z',
  },
  {
    id: 'music',
    accent: '#F472B6',
    image: 'data:image/jpeg;base64,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',
    ready: true,
    pendingKey: 'pending.media',
    icon: 'M9 18V6l10-2v12M9 18a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0Zm10-2a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0Z',
  },
  {
    id: 'film',
    accent: '#FBBF24',
    ready: true,
    icon: 'M4 5.5h16v13H4v-13Zm0 4h16M8 5.5v13M16 5.5v13',
  },
  {
    id: 'entertainment',
    accent: '#FB7185',
    ready: false,
    pendingKey: 'pending.fun',
    icon: 'M6 12h4m-2-2v4m6 0h.01M17 11h.01M4.5 7h15A2.5 2.5 0 0 1 22 9.5v5a2.5 2.5 0 0 1-2.5 2.5h-15A2.5 2.5 0 0 1 2 14.5v-5A2.5 2.5 0 0 1 4.5 7Z',
  },
  {
    id: 'knowledge',
    accent: '#34D399',
    ready: true,
    icon: 'M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3V4Zm3 0v16M11 8h5M11 11.5h5',
  },
  {
    id: 'office',
    accent: '#FB923C',
    ready: true,
    icon: 'M4 21V5.5A1.5 1.5 0 0 1 5.5 4h7A1.5 1.5 0 0 1 14 5.5V21M14 10h4.5A1.5 1.5 0 0 1 20 11.5V21M3 21h18M7 8h4M7 12h4M7 16h4M16.5 14h.01M16.5 17h.01',
  },
  {
    // 「开发中」占位卡永远排最后：新增模块一律插到它前面
    id: 'wip',
    accent: '#94A3B8',
    ready: false,
    pendingKey: 'pending.wip',
    icon: 'M14.7 6.3a4.5 4.5 0 0 0-6.4 6.4L3 18l3 3 5.3-5.3a4.5 4.5 0 0 0 6.4-6.4l-3.2 3.2-2.8-2.8 3.2-3.2Z',
  },
];

export function moduleById(id: string): ModuleDef | undefined {
  return MODULES.find((m) => m.id === id);
}
