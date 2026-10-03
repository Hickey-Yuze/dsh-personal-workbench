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
    ready: true,
    pendingKey: 'pending.media',
    icon: 'M9 18V6l10-2v12M9 18a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0Zm10-2a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0Z',
  },
  {
    id: 'film',
    accent: '#FBBF24',
    ready: false,
    pendingKey: 'pending.media',
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
];

export function moduleById(id: string): ModuleDef | undefined {
  return MODULES.find((m) => m.id === id);
}
