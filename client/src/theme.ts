/**
 * 样式注入（单例，幂等）。
 *
 * 配色跟随宿主主题（--dsw-alias-* 令牌），不写死深色 —— 面板背景色与宿主一致，
 * 卡片用 bg-layer + border-l2 做层次；强调色则取自各模块自己的 accent。
 * 唯一的例外是 **侧栏入口按钮**：它必须与宿主「新会话 / 定时任务」同款（浅色硬编码）。
 *
 * 侧栏按钮为什么全是 !important：宿主对侧栏内的 button 有更高特异性的规则，
 * 普通类选择器会被整体覆盖（无描边、文字左对齐、box-sizing 失效）。
 * 与 dsh-cron-board 同一战场、同一解法。
 */

const STYLE_ID = 'dsh-personal-workbench-style';

const CSS = `
/* ── 侧栏入口：与宿主「新会话 / 定时任务」同款（浅色，硬编码 + !important） ── */
.dsh-pwb-sidebar-btn {
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  gap: 8px !important;
  margin: 4px auto 8px !important;
  padding: 11px 16px !important;
  border: 1px solid rgba(20, 20, 30, 0.1) !important;
  border-radius: 10px !important;
  background: #ffffff !important;
  color: #1c1c22 !important;
  font-size: 14px !important;
  font-weight: 600 !important;
  cursor: pointer !important;
  transition: background 0.15s ease, border-color 0.15s ease, transform 0.1s ease !important;
  white-space: nowrap !important;
  box-sizing: border-box !important;
  font-family: inherit !important;
  box-shadow: 0 1px 2px rgba(20, 20, 30, 0.04) !important;
}
.dsh-pwb-sidebar-btn:hover {
  background: #f6f6f8 !important;
  border-color: rgba(20, 20, 30, 0.18) !important;
}
.dsh-pwb-sidebar-btn:active { transform: scale(0.985) !important; }
.dsh-pwb-sidebar-icon { display: inline-flex !important; align-items: center !important; line-height: 1 !important; }
.dsh-pwb-sidebar-label { font-size: 14px !important; display: inline-block !important; }

/* ── 面板：跟随宿主主题 ── */
.dsh-pwb-panel {
  --pwb-bg: var(--dsw-alias-bg-base, #ffffff);
  --pwb-card: var(--dsw-alias-bg-layer-1, #ffffff);
  --pwb-card-hi: var(--dsw-alias-bg-layer-2, #f5f6f8);
  --pwb-border: var(--dsw-alias-border-l2, rgba(20, 20, 30, 0.1));
  --pwb-border-hi: var(--dsw-alias-border-l3, rgba(20, 20, 30, 0.2));
  --pwb-text: var(--dsw-alias-label-primary, #1c1c22);
  --pwb-dim: var(--dsw-alias-label-secondary, #6b7280);
  --pwb-dimmer: var(--dsw-alias-label-tertiary, #9aa0a6);
  --pwb-accent: var(--dsw-alias-brand-primary, #00b862);
  --pwb-radius: 14px;

  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  color: var(--pwb-text);
  background: var(--pwb-bg);
  font-size: 13px;
}
.dsh-pwb-head { display: flex; align-items: flex-start; gap: 12px; padding: 20px 24px 14px; }
.dsh-pwb-head-main { flex: 1; min-width: 0; }
.dsh-pwb-title-row { display: flex; align-items: center; gap: 9px; }
.dsh-pwb-title-mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 8px;
  background: linear-gradient(150deg, #00d26a, #00a854);
  color: #04160c;
  flex: 0 0 auto;
}
.dsh-pwb-title { font-size: 17px; font-weight: 650; letter-spacing: 0.2px; }
.dsh-pwb-sub { margin-top: 4px; font-size: 12px; color: var(--pwb-dim); }
.dsh-pwb-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 999px;
  border: 1px solid var(--pwb-border);
  background: var(--pwb-card);
  font-size: 11.5px;
  color: var(--pwb-dim);
  white-space: nowrap;
  flex: 0 0 auto;
}
.dsh-pwb-chip-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #00d26a;
  box-shadow: 0 0 6px rgba(0, 210, 106, 0.7);
}
.dsh-pwb-body { flex: 1; min-height: 0; overflow: auto; padding: 4px 24px 24px; }

/* ── 模块索引卡片网格 ── */
.dsh-pwb-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 13px; }
.dsh-pwb-card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 15px;
  border-radius: var(--pwb-radius);
  border: 1px solid var(--pwb-border);
  background: var(--pwb-card);
  cursor: pointer;
  text-align: left;
  font-family: inherit;
  color: var(--pwb-text);
  transition: border-color 0.16s ease, transform 0.16s ease, background 0.16s ease;
}
.dsh-pwb-card:hover { border-color: var(--pwb-border-hi); background: var(--pwb-card-hi); transform: translateY(-2px); }
.dsh-pwb-card-top { display: flex; align-items: center; gap: 10px; }
.dsh-pwb-card-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 10px;
  color: #05170d;
  background: var(--dsh-pwb-card-accent, #00d26a);
  flex: 0 0 auto;
}
.dsh-pwb-card-label { font-size: 14px; font-weight: 600; }
.dsh-pwb-card-desc { font-size: 12px; line-height: 1.55; color: var(--pwb-dim); min-height: 36px; }
.dsh-pwb-card-foot { display: flex; align-items: center; justify-content: space-between; font-size: 11px; }
.dsh-pwb-badge { padding: 2px 8px; border-radius: 999px; font-weight: 600; background: var(--pwb-card-hi); color: var(--pwb-dim); }
.dsh-pwb-badge-ready { background: rgba(0, 210, 106, 0.14); color: #0a9c53; }
.dsh-pwb-card-arrow { color: var(--pwb-dimmer); }

/* ── 通用 ── */
.dsh-pwb-view { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.dsh-pwb-view-body { flex: 1; min-height: 0; overflow: auto; }
.dsh-pwb-crumbs { display: flex; align-items: center; flex-wrap: wrap; gap: 4px; padding-bottom: 10px; font-size: 12px; color: var(--pwb-dim); }
.dsh-pwb-crumb { border: none; background: none; padding: 2px 5px; border-radius: 6px; font: inherit; color: var(--pwb-accent); cursor: pointer; }
.dsh-pwb-crumb:hover { background: var(--pwb-card-hi); }
.dsh-pwb-crumb-wrap { display: inline-flex; align-items: center; gap: 2px; }
.dsh-pwb-crumb-sep { opacity: 0.5; }
.dsh-pwb-busy { margin-left: auto; opacity: 0.7; }
.dsh-pwb-err { margin-left: 8px; color: var(--dsw-alias-state-error-primary, #e5484d); }
.dsh-pwb-dimtext { font-size: 11.5px; color: var(--pwb-dimmer); font-weight: 400; }
.dsh-pwb-link {
  border: none;
  background: none;
  padding: 0;
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  color: #0a9c53;
  cursor: pointer;
}
.dsh-pwb-link:hover { text-decoration: underline; }

/* ── 工具条 / 控件 ── */
.dsh-pwb-toolbar { display: flex; align-items: center; gap: 8px; padding: 12px 0; flex-wrap: wrap; }
.dsh-pwb-toolbar-inline { padding: 8px 0; }
.dsh-pwb-toolbar-right { margin-left: auto; font-size: 12px; color: var(--pwb-dim); }
.dsh-pwb-month { font-size: 13px; font-weight: 600; min-width: 108px; text-align: center; }
.dsh-pwb-input, .dsh-pwb-select {
  box-sizing: border-box;
  height: 32px;
  padding: 0 11px;
  border-radius: 9px;
  border: 1px solid var(--pwb-border);
  background: var(--pwb-card);
  color: var(--pwb-text);
  font-size: 12.5px;
  font-family: inherit;
  outline: none;
}
.dsh-pwb-input::placeholder { color: var(--pwb-dimmer); }
.dsh-pwb-input:focus, .dsh-pwb-select:focus { border-color: var(--pwb-accent); }
.dsh-pwb-input-grow { flex: 1; min-width: 160px; }
.dsh-pwb-input-date { width: 134px; }
.dsh-pwb-input-time { width: 104px; }
.dsh-pwb-input-mid { width: 152px; }
.dsh-pwb-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  height: 32px;
  padding: 0 13px;
  border-radius: 9px;
  border: 1px solid var(--pwb-border);
  background: var(--pwb-card);
  color: var(--pwb-text);
  font-size: 12.5px;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  white-space: nowrap;
  vertical-align: middle;
}
.dsh-pwb-btn svg { display: block; flex-shrink: 0; }
.dsh-pwb-btn:hover { background: var(--pwb-card-hi); border-color: var(--pwb-border-hi); }
.dsh-pwb-btn-primary { border-color: transparent; background: #00d26a; color: #04160c; }
.dsh-pwb-btn-primary:hover { filter: brightness(1.06); background: #00d26a; }

/* ── 添加组件下拉 ── */
.dsh-pwb-addwrap { position: relative; }
.dsh-pwb-addmenu {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: 40;
  min-width: 168px;
  padding: 5px;
  border-radius: 11px;
  border: 1px solid var(--pwb-border);
  background: var(--pwb-card);
  box-shadow: 0 12px 32px rgba(20, 20, 30, 0.16);
}
.dsh-pwb-additem {
  display: block;
  width: 100%;
  padding: 7px 10px;
  border: none;
  border-radius: 8px;
  background: none;
  font: inherit;
  font-size: 12.5px;
  text-align: left;
  color: var(--pwb-text);
  cursor: pointer;
}
.dsh-pwb-additem:hover { background: var(--pwb-card-hi); }
.dsh-pwb-addempty { padding: 8px 10px; font-size: 12px; color: var(--pwb-dimmer); }

/* ── 筛选 ── */
.dsh-pwb-pills { display: flex; align-items: center; gap: 6px; padding-bottom: 11px; }
.dsh-pwb-pill {
  padding: 5px 12px;
  border-radius: 999px;
  border: 1px solid transparent;
  background: var(--pwb-card-hi);
  color: var(--pwb-dim);
  font-size: 12px;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
}
.dsh-pwb-pill:hover { color: var(--pwb-text); }
.dsh-pwb-pill-on { background: #00d26a; color: #04160c; }
.dsh-pwb-pills-right { margin-left: auto; font-size: 12px; color: var(--pwb-dim); }

/* ── 列表条目 ── */
.dsh-pwb-group { margin-bottom: 15px; }
.dsh-pwb-group-head { display: flex; align-items: center; gap: 7px; margin-bottom: 7px; }
.dsh-pwb-group-name { font-size: 12.5px; font-weight: 650; }
.dsh-pwb-group-count { min-width: 18px; padding: 1px 6px; border-radius: 999px; background: var(--pwb-card-hi); font-size: 11px; text-align: center; color: var(--pwb-dim); }
.dsh-pwb-item {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 9px 11px;
  margin-bottom: 5px;
  border-radius: 10px;
  border: 1px solid var(--pwb-border);
  background: var(--pwb-card);
}
.dsh-pwb-item:hover { background: var(--pwb-card-hi); }
.dsh-pwb-item-flat { background: transparent; border-color: transparent; padding: 8px 7px; margin-bottom: 0; }
.dsh-pwb-item-flat:hover { background: var(--pwb-card-hi); }
.dsh-pwb-item-done .dsh-pwb-item-title { text-decoration: line-through; opacity: 0.45; }
.dsh-pwb-item-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }
.dsh-pwb-item-del {
  border: none;
  background: none;
  color: var(--pwb-dimmer);
  font-size: 17px;
  line-height: 1;
  cursor: pointer;
  padding: 0 3px;
  border-radius: 6px;
}
.dsh-pwb-item-del:hover { color: var(--dsw-alias-state-error-primary, #e5484d); background: rgba(229, 72, 77, 0.1); }
.dsh-pwb-check {
  flex: 0 0 auto;
  width: 17px;
  height: 17px;
  border-radius: 5px;
  border: 1.5px solid var(--pwb-border-hi);
  background: transparent;
  color: #04160c;
  font-size: 12px;
  line-height: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  padding: 0;
}
.dsh-pwb-check-on { background: #00d26a; border-color: #00d26a; }
.dsh-pwb-prio {
  flex: 0 0 auto;
  width: 20px;
  height: 20px;
  border-radius: 6px;
  border: none;
  font-size: 11px;
  font-weight: 700;
  font-family: inherit;
  cursor: pointer;
  color: #0b0c0d;
}
.dsh-pwb-prio-high { background: #ff6b6b; }
.dsh-pwb-prio-normal { background: #f0b429; }
.dsh-pwb-prio-low { background: #9aa0a6; }
.dsh-pwb-tag { flex: 0 0 auto; padding: 1px 8px; border-radius: 999px; background: var(--pwb-card-hi); font-size: 11px; color: var(--pwb-dim); }
.dsh-pwb-tag-today { background: rgba(0, 210, 106, 0.16); color: #0a9c53; font-weight: 600; }
.dsh-pwb-time { flex: 0 0 auto; font-variant-numeric: tabular-nums; font-size: 12px; color: var(--pwb-dim); }

/* ── 区块小标题（数据概览 / 任务看板） ── */
.dsh-pwb-sec-head { display: flex; align-items: center; gap: 10px; padding: 14px 0 9px; flex-wrap: wrap; }
.dsh-pwb-sec-title { font-size: 13px; font-weight: 650; }
.dsh-pwb-sec-tools { display: flex; align-items: center; gap: 6px; margin-left: auto; flex-wrap: wrap; }

/* ── 数据概览卡 ── */
.dsh-pwb-ovgrid { display: grid; grid-template-columns: repeat(auto-fit, minmax(196px, 1fr)); gap: 13px; }
.dsh-pwb-ovcard {
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding: 15px 16px;
  border-radius: var(--pwb-radius);
  border: 1px solid var(--pwb-border);
  background: var(--pwb-card);
  position: relative;
  overflow: hidden;
}
.dsh-pwb-ovcard::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 3px;
  background: var(--pwb-metric-accent, #00d26a);
}
.dsh-pwb-ovcard-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.dsh-pwb-ovcard-label { font-size: 12.5px; color: var(--pwb-dim); }
.dsh-pwb-ovcard-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 9px;
  background: var(--pwb-card-hi);
  color: var(--pwb-metric-accent, #00d26a);
  flex: 0 0 auto;
}
.dsh-pwb-ovcard-value {
  font-size: 30px;
  font-weight: 700;
  line-height: 1.15;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.6px;
  display: flex;
  align-items: baseline;
  gap: 6px;
}
.dsh-pwb-ovcard-unit { font-size: 12px; font-weight: 500; color: var(--pwb-dimmer); letter-spacing: 0; }
.dsh-pwb-ovcard-foot { font-size: 11.5px; color: var(--pwb-dimmer); }

/* ── 任务看板 ── */
.dsh-pwb-board { display: flex; flex-direction: column; gap: 11px; }
.dsh-pwb-groupcard {
  border-radius: var(--pwb-radius);
  border: 1px solid var(--pwb-border);
  background: var(--pwb-card);
  overflow: hidden;
}
.dsh-pwb-groupcard-head {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  padding: 12px 14px;
  border: none;
  background: none;
  font: inherit;
  color: var(--pwb-text);
  cursor: pointer;
  text-align: left;
}
.dsh-pwb-groupcard-head:hover { background: var(--pwb-card-hi); }
.dsh-pwb-groupcard-dot { width: 8px; height: 8px; border-radius: 50%; background: #00d26a; flex: 0 0 auto; }
.dsh-pwb-groupcard-name { font-size: 13px; font-weight: 650; }
.dsh-pwb-groupcard-caret { margin-left: auto; font-size: 11px; color: var(--pwb-dimmer); transition: transform 0.15s ease; }
.dsh-pwb-groupcard-caret-off { transform: rotate(-90deg); }
.dsh-pwb-groupcard-empty { padding: 4px 14px 15px; font-size: 12px; color: var(--pwb-dimmer); text-align: center; }

/* 任务行：第一行勾选+标题，第二行优先级+截止时间+状态 */
.dsh-pwb-task { padding: 9px 14px 10px; border-top: 1px solid var(--pwb-border); }
.dsh-pwb-task:hover { background: var(--pwb-card-hi); }
.dsh-pwb-task-line { display: flex; align-items: center; gap: 9px; }
.dsh-pwb-task-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }
.dsh-pwb-task-meta { display: flex; align-items: center; gap: 8px; margin-top: 6px; padding-left: 26px; }
.dsh-pwb-task-time {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11.5px;
  color: var(--pwb-dim);
  font-variant-numeric: tabular-nums;
}
.dsh-pwb-task-state { margin-left: auto; font-size: 11.5px; color: var(--pwb-dim); }
.dsh-pwb-task-state-done { color: #0a9c53; }
.dsh-pwb-task .dsh-pwb-prio {
  width: auto;
  height: 18px;
  padding: 0 7px;
  font-size: 10.5px;
  border-radius: 5px;
}
.dsh-pwb-empty { padding: 22px 12px; text-align: center; font-size: 12.5px; color: var(--pwb-dimmer); }
.dsh-pwb-side { margin-top: 16px; padding-top: 13px; border-top: 1px dashed var(--pwb-border); }
.dsh-pwb-side-head { font-size: 12px; font-weight: 650; margin-bottom: 7px; }
.dsh-pwb-side-row { display: flex; align-items: center; gap: 9px; padding: 5px 4px; font-size: 12.5px; }
.dsh-pwb-side-date { flex: 0 0 auto; font-variant-numeric: tabular-nums; color: var(--pwb-dim); }

/* ── 月历 ── */
/* 总览日历卡（恢复原紧凑样式；节日/节假日徽章为模块页 mcal 专属） */
.dsh-pwb-cal { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; }
.dsh-pwb-cal-head { text-align: center; font-size: 11px; font-weight: 600; color: var(--pwb-dimmer); padding-bottom: 3px; }
.dsh-pwb-cal-cell {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  min-height: 30px;
  border-radius: 8px;
  border: 1px solid transparent;
  background: var(--pwb-card-hi);
  font-family: inherit;
  font-size: 11.5px;
  color: var(--pwb-text);
  cursor: pointer;
  padding: 2px;
}
.dsh-pwb-cal-cell:hover { border-color: var(--pwb-border-hi); }
.dsh-pwb-cal-out { opacity: 0.35; }
.dsh-pwb-cal-today { border-color: #00d26a; font-weight: 700; }
.dsh-pwb-cal-sel { background: #00d26a; color: #04160c; border-color: transparent; }
.dsh-pwb-cal-sel .dsh-pwb-cal-dots i { background: #04160c; }
.dsh-pwb-cal-day { font-variant-numeric: tabular-nums; }
.dsh-pwb-cal-dots { display: inline-flex; gap: 2px; }
.dsh-pwb-cal-dots i { width: 4px; height: 4px; border-radius: 50%; display: inline-block; }
.dsh-pwb-dot-live { background: #00d26a; }
.dsh-pwb-dot-done { background: var(--pwb-dimmer); }

/* 日常管理模块页日历（专属 mcal 前缀：大格子+农历+节日+节假日徽章+日程条） */
.dsh-pwb-mcal { display: grid; grid-template-columns: repeat(7, 1fr); gap: 6px; }
.dsh-pwb-mcal-head { text-align: center; font-size: 12px; font-weight: 650; color: var(--pwb-dimmer); padding-bottom: 5px; }
.dsh-pwb-mcal-cell {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 5px;
  min-height: 76px;
  border-radius: 12px;
  border: 1px solid var(--pwb-border);
  background: var(--pwb-card);
  font-family: inherit;
  color: var(--pwb-text);
  cursor: pointer;
  padding: 8px 9px;
  text-align: left;
  transition: box-shadow 0.15s ease, transform 0.15s ease, border-color 0.15s ease;
}
.dsh-pwb-mcal-cell:hover { border-color: var(--pwb-border-hi); box-shadow: 0 3px 10px rgba(0, 0, 0, 0.07); transform: translateY(-1px); }
.dsh-pwb-mcal-out { opacity: 0.38; }
.dsh-pwb-mcal-today { border-color: #00d26a; box-shadow: 0 0 0 1px #00d26a inset; }
.dsh-pwb-mcal-sel { background: #00d26a; color: #ffffff; border-color: transparent; box-shadow: 0 4px 14px rgba(0, 210, 106, 0.35); }
.dsh-pwb-mcal-day {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 15px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.dsh-pwb-mcal-now {
  font-style: normal;
  font-size: 9px;
  font-weight: 700;
  line-height: 1;
  color: #ffffff;
  background: #00d26a;
  border-radius: 5px;
  padding: 2px 4px;
}
.dsh-pwb-mcal-sel .dsh-pwb-mcal-now { color: #00d26a; background: #ffffff; }
.dsh-pwb-mcal-evs { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.dsh-pwb-mcal-ev {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 10px;
  font-weight: 500;
  line-height: 1.5;
  padding: 1px 6px;
  border-radius: 6px;
  background: rgba(0, 210, 106, 0.09);
  color: var(--pwb-text);
}
.dsh-pwb-mcal-ev::before { content: '● '; font-size: 6px; color: #00b862; vertical-align: 1px; }
.dsh-pwb-mcal-ev-done { opacity: 0.55; text-decoration: line-through; }
.dsh-pwb-mcal-ev-done::before { color: var(--pwb-dimmer); }
.dsh-pwb-mcal-more { font-size: 9.5px; color: var(--pwb-dimmer); padding-left: 2px; }
.dsh-pwb-mcal-sel .dsh-pwb-mcal-ev { background: rgba(255, 255, 255, 0.22); color: #ffffff; }
.dsh-pwb-mcal-sel .dsh-pwb-mcal-ev::before { color: #ffffff; }
.dsh-pwb-mcal-sel .dsh-pwb-mcal-more { color: rgba(255, 255, 255, 0.8); }
.dsh-pwb-cal-cell-static { pointer-events: none; }

/* ── 当日面板 ── */
.dsh-pwb-day-panel { display: flex; flex-direction: column; gap: 4px; }
.dsh-pwb-day-head { display: flex; align-items: baseline; gap: 9px; }
.dsh-pwb-day-title { font-size: 13.5px; font-weight: 650; }
.dsh-pwb-day-count { font-size: 12px; color: var(--pwb-dimmer); }

/* ── 音乐平台（Yuze-音乐网站形态：侧边栏+主内容+底部播放栏+全屏播放器+队列浮层）── */
.dsh-pwb-mu-shell { display: flex; flex-direction: column; height: 100%; min-height: 0; gap: 0; }
.dsh-pwb-mu-body { display: flex; flex: 1; min-height: 0; gap: 12px; }
.dsh-pwb-mu-sidebar {
  width: 224px; flex-shrink: 0; display: flex; flex-direction: column; min-height: 0;
  border-radius: 16px; border: 1px solid var(--pwb-border);
  background: var(--pwb-card); overflow: hidden;
}
.dsh-pwb-mu-logo { display: flex; align-items: center; gap: 10px; padding: 14px 14px 10px; }
.dsh-pwb-mu-logo-ico { width: 34px; height: 34px; border-radius: 10px; background: var(--pwb-accent); color: color-mix(in srgb, var(--pwb-accent) 14%, black); display: grid; place-items: center; flex-shrink: 0; }
.dsh-pwb-mu-logo b { font-size: 14px; font-weight: 750; color: var(--pwb-text); display: block; line-height: 1.2; }
.dsh-pwb-mu-logo span { font-size: 10.5px; color: var(--pwb-dimmer, #9aa0a6); }
.dsh-pwb-mu-nav { padding: 4px 8px; display: flex; flex-direction: column; gap: 2px; }
.dsh-pwb-mu-navitem {
  display: flex; align-items: center; gap: 9px; padding: 8px 10px; border-radius: 10px;
  border: none; background: transparent; color: var(--pwb-dim, #6b7280);
  font-size: 12.5px; font-weight: 600; font-family: inherit; cursor: pointer; text-align: left; width: 100%;
  transition: background 0.15s ease, color 0.15s ease;
}
.dsh-pwb-mu-navitem:hover { background: var(--pwb-card-hi, #f2f3f5); color: var(--pwb-text); }
.dsh-pwb-mu-navitem.dsh-pwb-mu-nav-active { background: color-mix(in srgb, var(--pwb-accent) 12%, transparent); color: var(--pwb-accent); }
.dsh-pwb-mu-sb-head { display: flex; align-items: center; justify-content: space-between; padding: 10px 14px 4px; font-size: 11px; font-weight: 700; color: var(--pwb-dimmer, #9aa0a6); letter-spacing: 0.4px; }
.dsh-pwb-mu-sb-head button { border: none; background: transparent; color: var(--pwb-dimmer, #9aa0a6); cursor: pointer; padding: 2px; border-radius: 6px; display: grid; place-items: center; }
.dsh-pwb-mu-sb-head button:hover { color: var(--pwb-accent); background: var(--pwb-card-hi, #f2f3f5); }
.dsh-pwb-mu-sb-list { flex: 1; overflow-y: auto; min-height: 0; padding: 2px 8px 8px; }
.dsh-pwb-mu-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 12px; min-height: 0; }
.dsh-pwb-mu-topbar { position: relative; display: flex; align-items: center; flex-shrink: 0; }
.dsh-pwb-mu-search {
  width: 100%; height: 38px; padding: 0 108px 0 36px;
  border-radius: 999px; border: 1px solid var(--pwb-border);
  background: var(--pwb-card); color: var(--pwb-text);
  font-size: 13px; font-family: inherit; outline: none;
  transition: border-color 0.2s ease;
}
.dsh-pwb-mu-search::placeholder { color: var(--pwb-dimmer, #9aa0a6); }
.dsh-pwb-mu-search:focus { border-color: color-mix(in srgb, var(--pwb-accent) 50%, transparent); }
.dsh-pwb-mu-search-ico { position: absolute; left: 12px; color: var(--pwb-dimmer, #9aa0a6); pointer-events: none; }
.dsh-pwb-mu-search-btn {
  position: absolute; right: 5px; height: 28px; padding: 0 14px;
  display: inline-flex; align-items: center; gap: 5px;
  border: none; border-radius: 999px; background: var(--pwb-accent); color: color-mix(in srgb, var(--pwb-accent) 14%, black);
  font-size: 11.5px; font-weight: 650; font-family: inherit; cursor: pointer;
}
.dsh-pwb-mu-search-btn:disabled { opacity: 0.6; cursor: default; }
.dsh-pwb-mu-page { flex: 1; min-height: 0; overflow-y: auto; border-radius: 16px; border: 1px solid var(--pwb-border); background: var(--pwb-card); padding: 14px 16px; }
.dsh-pwb-mu-page h2 { margin: 0 0 12px; font-size: 16px; font-weight: 750; color: var(--pwb-text); display: flex; align-items: center; gap: 8px; }
.dsh-pwb-mu-page h2 .dsh-pwb-mu-count { font-size: 11.5px; font-weight: 550; color: var(--pwb-dimmer, #9aa0a6); }
.dsh-pwb-mu-plate-head { display: flex; align-items: flex-end; justify-content: space-between; margin-bottom: 14px; }
.dsh-pwb-mu-chiprow { display: flex; gap: 8px; margin-bottom: 14px; flex-wrap: wrap; }
.dsh-pwb-mu-chip { padding: 5px 13px; border-radius: 999px; border: 1px solid var(--pwb-border); background: var(--pwb-card-hi, #f2f3f5); color: var(--pwb-dim, #6b7280); font-size: 11.5px; font-weight: 600; font-family: inherit; cursor: pointer; }
.dsh-pwb-mu-chip.dsh-pwb-mu-chip-on { background: var(--pwb-accent); border-color: transparent; color: color-mix(in srgb, var(--pwb-accent) 14%, black); }
/* 歌曲行 */
.dsh-pwb-mu-row {
  display: flex; align-items: center; gap: 10px;
  padding: 7px 10px; border-radius: 12px; cursor: pointer;
  transition: background 0.15s ease; border: 1px solid transparent; margin: 0 0 2px;
}
.dsh-pwb-mu-row:hover { background: var(--pwb-card-hi, #f2f3f5); }
.dsh-pwb-mu-row.dsh-pwb-mu-row-now { background: color-mix(in srgb, var(--pwb-accent) 10%, transparent); border-color: color-mix(in srgb, var(--pwb-accent) 30%, transparent); }
.dsh-pwb-mu-rowidx { width: 22px; text-align: center; font-size: 11px; color: var(--pwb-dimmer, #9aa0a6); font-variant-numeric: tabular-nums; flex-shrink: 0; }
.dsh-pwb-mu-cover { width: 40px; height: 40px; border-radius: 9px; background: linear-gradient(135deg, var(--pwb-card-hi, #f2f3f5), var(--pwb-card, #fff)); display: grid; place-items: center; overflow: hidden; flex-shrink: 0; color: var(--pwb-dimmer, #9aa0a6); }
.dsh-pwb-mu-cover img { width: 100%; height: 100%; object-fit: cover; }
.dsh-pwb-mu-meta { flex: 1; min-width: 0; }
.dsh-pwb-mu-meta b { display: block; font-size: 12.5px; font-weight: 650; color: var(--pwb-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-pwb-mu-meta span { display: block; font-size: 10.5px; color: var(--pwb-dimmer, #9aa0a6); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-pwb-mu-rowtime { font-size: 10.5px; color: var(--pwb-dimmer, #9aa0a6); font-variant-numeric: tabular-nums; }
.dsh-pwb-mu-rowact { width: 26px; height: 26px; border-radius: 8px; border: none; background: transparent; color: var(--pwb-dimmer, #9aa0a6); display: grid; place-items: center; cursor: pointer; opacity: 0; transition: opacity 0.15s ease; flex-shrink: 0; }
.dsh-pwb-mu-row:hover .dsh-pwb-mu-rowact { opacity: 1; }
.dsh-pwb-mu-rowact:hover { background: rgba(0, 0, 0, 0.06); color: var(--pwb-text); }
.dsh-pwb-mu-rowact.dsh-pwb-mu-loved { color: #e5484d; opacity: 1; }
.dsh-pwb-mu-rowact.dsh-pwb-mu-danger:hover { color: #e5484d; }
.dsh-pwb-mu-empty { text-align: center; color: var(--pwb-dimmer, #9aa0a6); font-size: 12.5px; padding: 60px 20px; line-height: 2; white-space: pre-line; }
.dsh-pwb-mu-more { display: flex; justify-content: center; padding: 12px 0 4px; }
.dsh-pwb-mu-btn { height: 28px; padding: 0 12px; border-radius: 9px; border: 1px solid var(--pwb-border); background: var(--pwb-card-hi, #f2f3f5); color: var(--pwb-text); font-size: 11.5px; font-weight: 600; font-family: inherit; cursor: pointer; display: inline-flex; align-items: center; gap: 5px; white-space: nowrap; }
.dsh-pwb-mu-btn:hover { border-color: var(--pwb-border-hi, #d8dade); }
.dsh-pwb-mu-btn.dsh-pwb-mu-btn-primary { background: var(--pwb-accent); border-color: transparent; color: color-mix(in srgb, var(--pwb-accent) 14%, black); }
/* ── 底部播放栏 ── */
.dsh-pwb-mu-bar {
  flex-shrink: 0; display: flex; align-items: center; gap: 14px;
  border-radius: 16px; border: 1px solid var(--pwb-border);
  background: var(--pwb-card); padding: 9px 14px;
}
.dsh-pwb-mu-bar-song { display: flex; align-items: center; gap: 10px; width: 220px; flex-shrink: 0; min-width: 0; cursor: pointer; }
.dsh-pwb-mu-bar-song img, .dsh-pwb-mu-bar-song .dsh-pwb-mu-cover { width: 46px; height: 46px; border-radius: 10px; }
.dsh-pwb-mu-bar-song .dsh-pwb-mu-meta b { font-size: 13px; }
.dsh-pwb-mu-bar-ctrl { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: center; gap: 4px; }
.dsh-pwb-mu-bar-btns { display: flex; align-items: center; gap: 12px; }
.dsh-pwb-mu-ctrlbtn { width: 30px; height: 30px; border-radius: 50%; border: none; background: transparent; color: var(--pwb-dim, #6b7280); display: grid; place-items: center; cursor: pointer; transition: background 0.15s ease, color 0.15s ease; position: relative; }
.dsh-pwb-mu-ctrlbtn:hover { background: var(--pwb-card-hi, #f2f3f5); color: var(--pwb-text); }
.dsh-pwb-mu-ctrlbtn.dsh-pwb-mu-on { color: var(--pwb-accent); }
.dsh-pwb-mu-playbtn {
  width: 38px; height: 38px; border-radius: 50%; border: none; cursor: pointer;
  display: grid; place-items: center;
  background: var(--pwb-accent); color: color-mix(in srgb, var(--pwb-accent) 14%, black);
  box-shadow: 0 4px 14px color-mix(in srgb, var(--pwb-accent) 30%, transparent);
}
.dsh-pwb-mu-playbtn:hover { filter: brightness(1.08); }
.dsh-pwb-mu-prog { display: flex; align-items: center; gap: 8px; width: min(520px, 90%); }
.dsh-pwb-mu-prog .dsh-pwb-mu-bar { position: relative; overflow: hidden; flex: 1; padding: 0; border: none; background: var(--pwb-card-hi, #f2f3f5); }
.dsh-pwb-mu-time { font-size: 10px; color: var(--pwb-dimmer, #9aa0a6); font-variant-numeric: tabular-nums; width: 34px; }
.dsh-pwb-mu-time:last-child { text-align: right; }
.dsh-pwb-mu-bar-fill { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 4px; background: var(--pwb-accent); }
.dsh-pwb-mu-bar-knob { position: absolute; top: 50%; width: 11px; height: 11px; border-radius: 50%; background: #fff; box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3); transform: translate(-50%, -50%); opacity: 0; transition: opacity 0.15s ease; }
.dsh-pwb-mu-bar:hover .dsh-pwb-mu-bar-knob { opacity: 1; }
.dsh-pwb-mu-bar-right { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
.dsh-pwb-mu-vol { display: flex; align-items: center; gap: 6px; color: var(--pwb-dim, #6b7280); }
.dsh-pwb-mu-vol input[type='range'] { width: 74px; accent-color: var(--pwb-accent); height: 4px; }
.dsh-pwb-mu-select { height: 26px; border-radius: 8px; border: 1px solid var(--pwb-border); background: var(--pwb-card-hi, #f2f3f5); color: var(--pwb-text); font-size: 11px; font-family: inherit; padding: 0 6px; outline: none; cursor: pointer; }
/* ── 全屏播放器（1:1 复刻参考站：封面模糊铺满+左黑胶+右歌词+底部控制，沉浸暗色） ── */
.dsh-pwb-mu-fs { position: fixed; inset: 0; z-index: 95; display: flex; flex-direction: column; align-items: center; background: linear-gradient(160deg, #2b2b30, #17171a); color: #fff; overflow: hidden; animation: dsh-pwb-fadein 0.3s ease; }
.dsh-pwb-mu-fs-bg { position: absolute; inset: -90px; background-size: cover; background-position: center; filter: blur(90px) brightness(0.55) saturate(1.15); transform: scale(1.08); }
.dsh-pwb-mu-fs-shade { position: absolute; inset: 0; background: rgba(10, 10, 14, 0.38); }
.dsh-pwb-mu-fs-collapse { position: absolute !important; top: 18px; left: 22px; width: 42px; height: 42px; border-radius: 50%; border: none; cursor: pointer; background: rgba(255, 255, 255, 0.92); color: #333; display: grid; place-items: center; box-shadow: 0 4px 14px rgba(0, 0, 0, 0.3); transition: transform 0.15s ease; z-index: 3; }
.dsh-pwb-mu-fs-collapse:hover { transform: scale(1.06); }
.dsh-pwb-mu-fs-collapse:active { transform: scale(0.94); }
.dsh-pwb-mu-fs-tag { position: absolute; top: 22px; left: 0; right: 0; text-align: center; font-size: 12.5px; font-weight: 600; letter-spacing: 4px; color: rgba(255, 255, 255, 0.55); }
.dsh-pwb-mu-fs-stage { position: relative; flex: 1; min-height: 0; display: flex; align-items: center; justify-content: center; gap: 56px; width: min(1060px, 92%); margin: 0 auto; }
.dsh-pwb-mu-fs-left { flex: 0 0 auto; display: grid; place-items: center; }
/* 黑胶唱片：同心圆纹理 + 封面贴芯 + 中心孔，播放时整体旋转 */
.dsh-pwb-mu-fs-disc {
  position: relative; width: 340px !important; height: 340px !important; max-width: 32vw; max-height: 32vw; border-radius: 50% !important;
  overflow: hidden; flex-shrink: 0;
  background: repeating-radial-gradient(circle at 50% 50%, #17171a 0px, #26262a 1.5px, #17171a 3px);
  box-shadow: 0 30px 90px rgba(0, 0, 0, 0.65), inset 0 0 0 1px rgba(255, 255, 255, 0.09), 0 0 0 1px rgba(255, 255, 255, 0.04);
  display: grid; place-items: center;
  animation: dsh-pwb-disc-spin 20s linear infinite; animation-play-state: paused;
}
.dsh-pwb-mu-playing .dsh-pwb-mu-fs-disc { animation-play-state: running; }
.dsh-pwb-mu-fs-disc img { width: 56%; height: 56%; border-radius: 50% !important; object-fit: cover; box-shadow: 0 0 0 7px rgba(8, 8, 10, 0.75), 0 10px 34px rgba(0, 0, 0, 0.5); }
.dsh-pwb-mu-fs-disc-dummy { width: 56%; height: 56%; border-radius: 50%; background: radial-gradient(circle, #33333a, #1c1c20); box-shadow: 0 0 0 7px rgba(8, 8, 10, 0.75); display: grid; place-items: center; color: rgba(255, 255, 255, 0.35); }
.dsh-pwb-mu-fs-disc i { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 15px; height: 15px; border-radius: 50%; background: #0a0a0c; box-shadow: inset 0 0 0 3.5px #26262a, 0 0 0 5px rgba(8, 8, 10, 0.75); }
/* 右侧歌词：垂直居中、当前行品牌绿高亮、上下渐隐遮罩 */
.dsh-pwb-mu-fs-right { position: relative; flex: 1; min-width: 0; align-self: center; height: min(460px, 78%); display: flex; flex-direction: column; overflow: hidden; }
.dsh-pwb-mu-fs-lyrics { position: relative; flex: 1; min-height: 0; overflow-y: auto; scrollbar-width: none; text-align: center; padding: 190px 12px; box-sizing: border-box; }
.dsh-pwb-mu-fs-lyrics::-webkit-scrollbar { display: none; }
.dsh-pwb-mu-fs-lyric { font-size: 14.5px; line-height: 2.4; color: rgba(255, 255, 255, 0.52); cursor: pointer; transition: all 0.3s ease; }
.dsh-pwb-mu-fs-lyric:hover { color: rgba(255, 255, 255, 0.85); }
.dsh-pwb-mu-fs-lyric.dsh-pwb-mu-now { font-size: 17px; font-weight: 700; color: var(--pwb-accent, #34c759); }
.dsh-pwb-mu-fs-lyric-empty { text-align: center; color: rgba(255, 255, 255, 0.4); font-size: 13px; padding: 40px 0; }
/* 底部：歌名/歌手/进度/控制 */
.dsh-pwb-mu-fs-bottom { position: relative; width: min(700px, 90%); margin: 0 auto 34px; text-align: center; padding: 6px 0 22px; }
.dsh-pwb-mu-fs-bottom h2 { margin: 0; font-size: 23px; font-weight: 800; color: #fff; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-pwb-mu-fs-bottom > p { margin: 5px 0 16px; font-size: 13px; color: rgba(255, 255, 255, 0.6); }
.dsh-pwb-mu-fs-prog { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
.dsh-pwb-mu-fs-track { position: relative; flex: 1; height: 4px; border-radius: 2px; background: rgba(255, 255, 255, 0.22); cursor: pointer; }
.dsh-pwb-mu-fs-track-fill { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 2px; background: rgba(255, 255, 255, 0.92); }
.dsh-pwb-mu-fs-track-knob { position: absolute; top: 50%; width: 11px; height: 11px; border-radius: 50%; background: #fff; transform: translate(-50%, -50%); box-shadow: 0 1px 5px rgba(0, 0, 0, 0.4); opacity: 0; transition: opacity 0.15s ease; }
.dsh-pwb-mu-fs-track:hover .dsh-pwb-mu-fs-track-knob { opacity: 1; }
.dsh-pwb-mu-fs-time { font-size: 10.5px; color: rgba(255, 255, 255, 0.55); font-variant-numeric: tabular-nums; width: 36px; }
.dsh-pwb-mu-fs-btns { display: flex; align-items: center; justify-content: center; gap: 22px; }
.dsh-pwb-mu-fs-cbtn { width: 34px; height: 34px; border-radius: 50%; border: none; background: transparent; color: rgba(255, 255, 255, 0.82); display: grid; place-items: center; cursor: pointer; transition: all 0.15s ease; position: relative; }
.dsh-pwb-mu-fs-cbtn:hover { background: rgba(255, 255, 255, 0.14); color: #fff; }
.dsh-pwb-mu-fs-cbtn.dsh-pwb-mu-on { color: var(--pwb-accent, #34c759); }
.dsh-pwb-mu-fs-cbtn.dsh-pwb-mu-loved { color: #ff5b6a; }
.dsh-pwb-mu-fs-play { width: 52px; height: 52px; border-radius: 50%; border: none; cursor: pointer; display: grid; place-items: center; background: #ffffff; color: #111114; box-shadow: 0 10px 30px rgba(0, 0, 0, 0.45); transition: transform 0.15s ease; }
.dsh-pwb-mu-fs-play:hover { transform: scale(1.05); }
.dsh-pwb-mu-fs-play:active { transform: scale(0.96); }

/* ── 发现页（发现音乐：三板块横排卡） ── */
.dsh-pwb-mu-dv { padding: 22px 26px 30px; }
.dsh-pwb-mu-dv-title { margin: 0 0 4px; font-size: 20px; font-weight: 800; color: var(--pwb-text); }
.dsh-pwb-mu-dv-block { margin-top: 20px; }
.dsh-pwb-mu-dv-block h2 { margin: 0 0 12px; font-size: 15.5px; font-weight: 750; color: var(--pwb-text); }
.dsh-pwb-mu-dv-row { display: flex; gap: 16px; overflow-x: auto; padding-bottom: 6px; scrollbar-width: none; }
.dsh-pwb-mu-dv-row::-webkit-scrollbar { display: none; }
.dsh-pwb-mu-dv-card { flex: 0 0 auto; width: 158px; border: none; background: transparent; text-align: left; cursor: pointer; padding: 0; display: flex; flex-direction: column; gap: 2px; border-radius: 12px; }
.dsh-pwb-mu-dv-card img { width: 158px; height: 158px; border-radius: 12px; object-fit: cover; display: block; margin-bottom: 7px; box-shadow: 0 6px 18px rgba(20, 20, 30, 0.12); transition: transform 0.15s ease; }
.dsh-pwb-mu-dv-card:hover img { transform: scale(1.03); }
.dsh-pwb-mu-dv-dummy { width: 158px; height: 158px; border-radius: 12px; display: grid; place-items: center; background: var(--pwb-card-hi, #f2f3f5); color: var(--pwb-dimmer, #9aa0a6); margin-bottom: 7px; }
.dsh-pwb-mu-dv-card b { font-size: 13px; font-weight: 650; color: var(--pwb-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-pwb-mu-dv-card span { font-size: 12px; color: var(--pwb-dim, #6b7280); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-pwb-mu-dv-empty { color: var(--pwb-dim, #6b7280); font-size: 13px; padding: 26px 0; display: flex; align-items: center; gap: 8px; }

/* ── 队列浮层 ── */
.dsh-pwb-mu-queue {
  position: fixed; right: 16px; bottom: 86px; z-index: 60;
  width: 320px; max-height: 420px; display: flex; flex-direction: column; min-height: 0;
  border-radius: 16px; border: 1px solid var(--pwb-border); background: var(--pwb-card);
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.18); overflow: hidden;
}
.dsh-pwb-mu-queue-head { display: flex; align-items: center; justify-content: space-between; padding: 11px 14px; border-bottom: 1px solid var(--pwb-border); font-size: 12.5px; font-weight: 700; color: var(--pwb-text); }
.dsh-pwb-mu-queue-body { flex: 1; overflow-y: auto; min-height: 0; padding: 6px 0; }
/* ── 弹窗 ── */
.dsh-pwb-mu-mask { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.35); display: grid; place-items: center; z-index: 90; }
.dsh-pwb-mu-dialog { width: min(420px, calc(100vw - 48px)); border-radius: 16px; border: 1px solid var(--pwb-border); background: var(--pwb-card); padding: 18px; display: flex; flex-direction: column; gap: 10px; box-shadow: 0 24px 60px rgba(0, 0, 0, 0.2); }
.dsh-pwb-mu-dialog h4 { margin: 0; font-size: 14px; font-weight: 700; color: var(--pwb-text); }
.dsh-pwb-mu-dialog * { box-sizing: border-box; }
.dsh-pwb-mu-dialog textarea, .dsh-pwb-mu-dialog input {
  width: 100%; border-radius: 10px; border: 1px solid var(--pwb-border); background: var(--pwb-card-hi, #f2f3f5);
  color: var(--pwb-text); font-size: 12.5px; font-family: inherit; padding: 9px 11px; outline: none; resize: none;
}
.dsh-pwb-mu-dialog textarea { scrollbar-width: none; }
.dsh-pwb-mu-dialog textarea::-webkit-scrollbar { width: 0; height: 0; display: none; }
.dsh-pwb-mu-dialog textarea:focus, .dsh-pwb-mu-dialog input:focus { border-color: color-mix(in srgb, var(--pwb-accent) 50%, transparent); }
.dsh-pwb-mu-dialog-row { display: flex; gap: 8px; justify-content: flex-end; }
.dsh-pwb-mu-hint { font-size: 11px; color: var(--pwb-dimmer, #9aa0a6); line-height: 1.7; }
@keyframes dsh-pwb-disc-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
.dsh-pwb-mu-grid2 { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; }
.dsh-pwb-mu-plcard { border-radius: 14px; border: 1px solid var(--pwb-border); background: var(--pwb-card-hi, #f2f3f5); padding: 14px; cursor: pointer; transition: transform 0.15s ease, box-shadow 0.15s ease; }
.dsh-pwb-mu-plcard:hover { transform: translateY(-2px); box-shadow: 0 6px 16px rgba(0, 0, 0, 0.08); }
.dsh-pwb-mu-plcard b { display: block; font-size: 13px; font-weight: 700; color: var(--pwb-text); margin-top: 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-pwb-mu-plcard span { font-size: 11px; color: var(--pwb-dimmer, #9aa0a6); }

/* ── 影视平台（磁力猫片库：竖版海报卡+详情线路集数+MP4 播放） ── */
.dsh-pwb-vd-shell { display: flex; height: 100%; min-height: 0; color: var(--pwb-text, #1c1c22); }
.dsh-pwb-vd-sidebar { width: 208px; flex: 0 0 auto; border-right: 1px solid var(--pwb-border); background: var(--pwb-card); display: flex; flex-direction: column; padding: 14px 12px; }
.dsh-pwb-vd-nav { display: flex; flex-direction: column; gap: 4px; }
.dsh-pwb-vd-navitem { display: flex; align-items: center; gap: 9px; padding: 9px 11px; border: none; border-radius: 9px; background: transparent; color: var(--pwb-text); font-size: 13.5px; font-weight: 550; font-family: inherit; cursor: pointer; text-align: left; transition: background .15s ease; }
.dsh-pwb-vd-navitem:hover { background: var(--pwb-card-hi); }
.dsh-pwb-vd-nav-active { background: color-mix(in srgb, var(--pwb-accent) 12%, transparent); color: var(--pwb-accent); font-weight: 700; }
.dsh-pwb-vd-body { flex: 1; min-width: 0; display: flex; flex-direction: column; min-height: 0; }
.dsh-pwb-vd-topbar { display: flex; gap: 10px; padding: 14px 22px 0; }
.dsh-pwb-vd-search { flex: 1; height: 38px; border-radius: 19px; border: 1px solid var(--pwb-border); background: var(--pwb-card); color: var(--pwb-text); font-size: 13px; font-family: inherit; padding: 0 16px; outline: none; }
.dsh-pwb-vd-search:focus { border-color: color-mix(in srgb, var(--pwb-accent) 50%, transparent); }
.dsh-pwb-vd-searchbtn { height: 38px; padding: 0 18px; border-radius: 19px; border: none; background: var(--pwb-accent); color: color-mix(in srgb, var(--pwb-accent) 12%, black); font-size: 13px; font-weight: 650; font-family: inherit; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; }
.dsh-pwb-vd-searchbtn:disabled { opacity: .55; cursor: default; }
.dsh-pwb-vd-page { flex: 1; min-height: 0; overflow-y: auto; }
.dsh-pwb-vd-dv { padding: 18px 24px 30px; }
.dsh-pwb-vd-block { margin-bottom: 26px; }
.dsh-pwb-vd-block h2, .dsh-pwb-vd-dv > h2 { margin: 0; font-size: 15.5px; font-weight: 750; }
.dsh-pwb-vd-count { font-size: 12px; font-weight: 500; color: var(--pwb-dim); }
.dsh-pwb-vd-row { display: flex; gap: 14px; overflow-x: auto; padding: 12px 0 6px; scrollbar-width: none; }
.dsh-pwb-vd-row::-webkit-scrollbar { display: none; }
.dsh-pwb-vd-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(132px, 1fr)); gap: 16px; padding-top: 12px; }
.dsh-pwb-vd-card { flex: 0 0 auto; width: 132px; border: none; background: transparent; text-align: left; cursor: pointer; padding: 0; display: flex; flex-direction: column; gap: 2px; border-radius: 10px; font-family: inherit; }
.dsh-pwb-vd-thumb { position: relative; display: block; width: 132px; aspect-ratio: 2 / 3; border-radius: 10px; overflow: hidden; background: var(--pwb-card-hi); margin-bottom: 7px; }
.dsh-pwb-vd-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; transition: transform .18s ease; }
.dsh-pwb-vd-card:hover .dsh-pwb-vd-thumb img { transform: scale(1.04); }
.dsh-pwb-vd-thumb-dummy { width: 100%; height: 100%; display: grid; place-items: center; color: var(--pwb-dimmer); }
.dsh-pwb-vd-remarks { position: absolute; left: 0; right: 0; bottom: 0; padding: 14px 8px 5px; background: linear-gradient(transparent, rgba(0,0,0,.78)); color: #fff; font-size: 11px; font-style: normal; text-align: center; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-pwb-vd-card b { font-size: 13px; font-weight: 620; color: var(--pwb-text); line-height: 1.45; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.dsh-pwb-vd-meta { font-size: 11.5px; color: var(--pwb-dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-pwb-vd-empty { color: var(--pwb-dim); font-size: 13px; padding: 28px 0; display: flex; align-items: center; gap: 8px; white-space: pre-line; }
.dsh-pwb-vd-more { display: grid; place-items: center; padding: 18px 0 6px; }
.dsh-pwb-vd-play { padding: 18px 24px 30px; }
.dsh-pwb-vd-player { position: relative; width: min(920px, 100%); aspect-ratio: 16 / 9; border-radius: 14px; overflow: hidden; background: #000; box-shadow: 0 10px 34px rgba(20,20,30,.16); }
.dsh-pwb-vd-player video { position: absolute; inset: 0; width: 100%; height: 100%; display: block; background: #000; }
.dsh-pwb-vd-playinfo { width: min(920px, 100%); margin-top: 14px; }
.dsh-pwb-vd-playinfo h1 { margin: 0 0 10px; font-size: 17px; font-weight: 750; line-height: 1.5; }
.dsh-pwb-vd-playacts { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 14px; }
.dsh-pwb-vd-favbtn { display: inline-flex; align-items: center; gap: 6px; padding: 7px 15px; border-radius: 17px; border: 1px solid var(--pwb-border); background: var(--pwb-card); color: var(--pwb-text); font-size: 13px; font-weight: 550; font-family: inherit; cursor: pointer; }
.dsh-pwb-vd-favbtn:disabled { opacity: .45; cursor: default; }
.dsh-pwb-vd-favbtn.primary { background: var(--pwb-accent); border-color: transparent; color: color-mix(in srgb, var(--pwb-accent) 12%, black); font-weight: 700; }
.dsh-pwb-vd-favbtn.on { color: #ff5b6a; border-color: color-mix(in srgb, #ff5b6a 40%, transparent); background: color-mix(in srgb, #ff5b6a 8%, transparent); }
.dsh-pwb-vd-pager { display: flex; gap: 10px; }
.dsh-pwb-vd-linetabs { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
.dsh-pwb-vd-linetab { padding: 6px 14px; border-radius: 15px; border: 1px solid var(--pwb-border); background: var(--pwb-card); color: var(--pwb-text); font-size: 12.5px; font-weight: 550; font-family: inherit; cursor: pointer; }
.dsh-pwb-vd-linetab.on { background: color-mix(in srgb, var(--pwb-accent) 14%, transparent); border-color: color-mix(in srgb, var(--pwb-accent) 45%, transparent); color: var(--pwb-accent); font-weight: 700; }
.dsh-pwb-vd-epcount { font-size: 11px; font-weight: 500; opacity: .75; }
.dsh-pwb-vd-eps { display: flex; flex-wrap: wrap; gap: 8px; }
.dsh-pwb-vd-ep { min-width: 56px; padding: 7px 12px; border-radius: 9px; border: 1px solid var(--pwb-border); background: var(--pwb-card); color: var(--pwb-text); font-size: 12.5px; font-family: inherit; font-variant-numeric: tabular-nums; cursor: pointer; }
.dsh-pwb-vd-ep:hover { border-color: color-mix(in srgb, var(--pwb-accent) 45%, transparent); }
.dsh-pwb-vd-ep.on { background: var(--pwb-accent); border-color: transparent; color: color-mix(in srgb, var(--pwb-accent) 12%, black); font-weight: 700; }
.dsh-pwb-vd-desc { font-size: 12.5px; color: var(--pwb-dim); line-height: 1.75; background: var(--pwb-card-hi); border-radius: 10px; padding: 10px 14px; margin: 12px 0 0; display: -webkit-box; -webkit-line-clamp: 6; -webkit-box-orient: vertical; overflow: hidden; }
.dsh-pwb-vd-actor { font-size: 12px; color: var(--pwb-dim); margin: 10px 0 0; }
.dsh-pwb-vd-rel { width: min(920px, 100%); margin-top: 24px; }
.dsh-pwb-vd-rel h2 { margin: 0 0 12px; font-size: 15px; font-weight: 700; }
.dsh-pwb-vd-detailhead { display: flex; gap: 22px; align-items: flex-start; }
.dsh-pwb-vd-poster { flex: 0 0 auto; width: 168px; aspect-ratio: 2 / 3; border-radius: 12px; object-fit: cover; box-shadow: 0 8px 26px rgba(20,20,30,.16); background: var(--pwb-card-hi); display: block; }
.dsh-pwb-vd-detailmeta { flex: 1; min-width: 0; }
.dsh-pwb-vd-detailmeta h1 { margin: 0 0 6px; font-size: 20px; font-weight: 800; line-height: 1.4; }
.dsh-pwb-vd-detailmeta p { margin: 0 0 12px; font-size: 12.5px; color: var(--pwb-dim); }
.dsh-pwb-vd-listhead { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.dsh-pwb-vd-listhead h2 { margin: 0; font-size: 15.5px; font-weight: 750; }
.dsh-pwb-vd-clear { display: inline-flex; align-items: center; gap: 5px; padding: 6px 12px; border-radius: 15px; border: 1px solid var(--pwb-border); background: var(--pwb-card); color: var(--pwb-dim); font-size: 12px; font-family: inherit; cursor: pointer; }
.dsh-pwb-vd-cardwrap { position: relative; display: block; }
.dsh-pwb-vd-remove { position: absolute; top: 6px; right: 6px; width: 24px; height: 24px; border-radius: 50%; border: none; background: rgba(0,0,0,.55); color: #fff; display: grid; place-items: center; cursor: pointer; opacity: 0; transition: opacity .15s ease; font-size: 15px; line-height: 1; }
.dsh-pwb-vd-cardwrap:hover .dsh-pwb-vd-remove { opacity: 1; }
/* ── 影视首页（原版形态：Hero 搜索+三态切换+标签 chips+豆瓣网格+顶栏下拉） ── */
.dsh-pwb-vd-shell-single { flex-direction: column; overflow-y: auto; }
.dsh-pwb-vd-topnav { display: flex; justify-content: flex-end; padding: 12px 22px 0; position: sticky; top: 0; z-index: 20; }
.dsh-pwb-vd-actions { position: relative; display: flex; gap: 8px; }
.dsh-pwb-vd-roundbtn { width: 40px; height: 40px; border-radius: 50%; border: 1px solid var(--pwb-border); background: var(--pwb-card); color: var(--pwb-dim); display: grid; place-items: center; cursor: pointer; transition: all .15s ease; }
.dsh-pwb-vd-roundbtn:hover, .dsh-pwb-vd-roundbtn.on { background: var(--pwb-card-hi); color: var(--pwb-text); }
.dsh-pwb-vd-drop { position: absolute; right: 0; top: 48px; width: 340px; background: var(--pwb-card); border: 1px solid var(--pwb-border); border-radius: 14px; box-shadow: 0 12px 40px rgba(20,20,30,.18); overflow: hidden; z-index: 50; }
.dsh-pwb-vd-drophead { display: flex; align-items: center; justify-content: space-between; padding: 13px 16px; border-bottom: 1px solid var(--pwb-border); font-size: 14px; }
.dsh-pwb-vd-dropclear { border: none; background: transparent; color: #ff5b6a; font-size: 12px; font-weight: 600; font-family: inherit; cursor: pointer; }
.dsh-pwb-vd-droplist { max-height: 380px; overflow-y: auto; }
.dsh-pwb-vd-dropitem { display: flex; gap: 12px; padding: 10px 16px; cursor: pointer; border-bottom: 1px solid var(--pwb-border); align-items: center; }
.dsh-pwb-vd-dropitem:last-child { border-bottom: none; }
.dsh-pwb-vd-dropitem:hover { background: var(--pwb-card-hi); }
.dsh-pwb-vd-dropthumb { position: relative; flex: 0 0 auto; width: 52px; height: 76px; border-radius: 8px; overflow: hidden; background: var(--pwb-card-hi); color: var(--pwb-dimmer); display: grid; place-items: center; }
.dsh-pwb-vd-dropthumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.dsh-pwb-vd-dropthumb i { position: absolute; left: 0; right: 0; bottom: 0; height: 4px; background: rgba(20,20,30,.25); }
.dsh-pwb-vd-dropthumb i span { display: block; height: 100%; background: var(--pwb-accent); }
.dsh-pwb-vd-dropmeta { flex: 1; min-width: 0; }
.dsh-pwb-vd-dropmeta b { display: block; font-size: 13px; font-weight: 650; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-pwb-vd-dropmeta p { margin: 3px 0 0; font-size: 11.5px; color: var(--pwb-dim); }
.dsh-pwb-vd-dropremove { flex: 0 0 auto; width: 26px; height: 26px; border: none; border-radius: 50%; background: transparent; color: var(--pwb-dimmer); display: grid; place-items: center; cursor: pointer; opacity: 0; }
.dsh-pwb-vd-dropitem:hover .dsh-pwb-vd-dropremove { opacity: 1; }
.dsh-pwb-vd-dropremove:hover { color: #ff5b6a; }
.dsh-pwb-vd-hero { display: flex; flex-direction: column; align-items: center; gap: 16px; padding: 6px 22px 4px; }
.dsh-pwb-vd-herosearch { display: flex; gap: 10px; width: min(640px, 100%); }
.dsh-pwb-vd-herosearch .dsh-pwb-vd-search { height: 44px; border-radius: 22px; font-size: 14px; }
.dsh-pwb-vd-herosearch .dsh-pwb-vd-searchbtn { height: 44px; border-radius: 22px; font-size: 14px; }
.dsh-pwb-vd-toggle { display: inline-flex; align-items: center; gap: 2px; background: var(--pwb-card-hi); border-radius: 12px; padding: 4px; }
.dsh-pwb-vd-togglebtn { padding: 8px 26px; border: none; border-radius: 9px; background: transparent; color: var(--pwb-dim); font-size: 13.5px; font-weight: 650; font-family: inherit; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; transition: all .15s ease; }
.dsh-pwb-vd-togglebtn.on { background: var(--pwb-accent); color: color-mix(in srgb, var(--pwb-accent) 12%, black); box-shadow: 0 1px 3px rgba(20,20,30,.12); }
.dsh-pwb-vd-togglesplit { width: 1px; height: 16px; background: var(--pwb-border); }
.dsh-pwb-vd-main { padding: 10px 24px 34px; }
.dsh-pwb-vd-home { display: flex; flex-direction: column; gap: 8px; }
.dsh-pwb-vd-tags { display: flex; gap: 10px; overflow-x: auto; padding: 10px 2px; scrollbar-width: none; }
.dsh-pwb-vd-tags::-webkit-scrollbar { display: none; }
.dsh-pwb-vd-tag { flex: 0 0 auto; padding: 8px 20px; border-radius: 10px; border: 1px solid var(--pwb-border); background: var(--pwb-card); color: var(--pwb-dim); font-size: 13px; font-weight: 550; font-family: inherit; cursor: pointer; transition: all .15s ease; }
.dsh-pwb-vd-tag:hover { background: var(--pwb-card-hi); color: var(--pwb-text); }
.dsh-pwb-vd-tag.on { background: color-mix(in srgb, var(--pwb-accent) 10%, transparent); border-color: color-mix(in srgb, var(--pwb-accent) 55%, transparent); color: var(--pwb-accent); font-weight: 700; }
.dsh-pwb-vd-sechead { display: flex; align-items: center; justify-content: space-between; margin: 12px 0 2px; }
.dsh-pwb-vd-sechead h2, .dsh-pwb-vd-block h2 { display: flex; align-items: center; gap: 10px; margin: 0; font-size: 17px; font-weight: 750; }
.dsh-pwb-vd-bar { width: 4px; height: 20px; border-radius: 2px; background: var(--pwb-accent); display: inline-block; }
.dsh-pwb-vd-pager { display: flex; gap: 8px; }
.dsh-pwb-vd-pagebtn { width: 36px; height: 36px; border-radius: 10px; border: 1px solid var(--pwb-border); background: var(--pwb-card); color: var(--pwb-dim); display: grid; place-items: center; cursor: pointer; transition: all .15s ease; }
.dsh-pwb-vd-pagebtn:disabled { opacity: .4; cursor: default; }
.dsh-pwb-vd-pagebtn:not(:disabled):hover { border-color: color-mix(in srgb, var(--pwb-accent) 50%, transparent); color: var(--pwb-accent); }
.dsh-pwb-vd-rate { position: absolute; right: 0; bottom: 0; padding: 3px 8px; border-radius: 10px 0 0 0; background: rgba(0,0,0,.72); color: #f5c518; font-size: 11.5px; font-style: normal; font-weight: 700; font-variant-numeric: tabular-nums; }
.dsh-pwb-vd-backbtn { display: inline-flex; align-items: center; gap: 6px; padding: 7px 14px; margin-bottom: 14px; border-radius: 17px; border: 1px solid var(--pwb-border); background: var(--pwb-card); color: var(--pwb-dim); font-size: 12.5px; font-family: inherit; cursor: pointer; }
.dsh-pwb-vd-backbtn:hover { color: var(--pwb-text); }


/* ── 实时日薪：金额心跳（咚-咚 双脉冲节律）── */
.dsh-pwb-salary-beat {
  display: inline-block;
  animation: dsh-pwb-heartbeat 1.15s ease-in-out infinite;
  transform-origin: 50% 60%;
  will-change: transform;
}
@keyframes dsh-pwb-heartbeat {
  0%, 100% { transform: scale(1); }
  12% { transform: scale(1.055); }
  24% { transform: scale(1); }
  36% { transform: scale(1.075); }
  52% { transform: scale(1); }
}

/* ── 文件归档：全局类（不依赖 dsh-pwb-dark 作用域，避免 Tailwind 作用域化失效与变量环境污染）── */
.dsh-pwb-fs-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 7px 9px;
  border: none;
  border-radius: 9px;
  background: none;
  font-family: inherit;
  font-size: 12.5px;
  text-align: left;
  cursor: pointer;
  color: var(--pwb-text, #1c1c22);
}
.dsh-pwb-fs-row:hover { background: var(--pwb-card-hi, #f2f3f5); }
.dsh-pwb-fs-dir { color: var(--pwb-accent, #00b862); }
.dsh-pwb-fs-file { color: var(--pwb-dim, #6b7280); }
.dsh-pwb-fs-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-pwb-fs-arrow { flex-shrink: 0; color: var(--pwb-dimmer, #9aa0a6); }
.dsh-pwb-fs-back { color: var(--pwb-dim, #6b7280); }
.dsh-pwb-fs-back:hover { color: var(--pwb-text, #1c1c22); background: var(--pwb-card-hi, #f2f3f5); }

/* ── 知识库分栏 ── */
.dsh-pwb-split { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(200px, 33%) 1fr; gap: 13px; }
.dsh-pwb-split-list, .dsh-pwb-split-main {
  overflow: auto;
  border: 1px solid var(--pwb-border);
  border-radius: var(--pwb-radius);
  background: var(--pwb-card);
}
.dsh-pwb-split-list { padding: 7px; }
.dsh-pwb-split-main { padding: 14px 16px; min-width: 0; }
.dsh-pwb-row {
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 100%;
  padding: 8px 10px;
  border-radius: 9px;
  border: none;
  background: none;
  font-family: inherit;
  text-align: left;
  cursor: pointer;
  color: var(--pwb-text);
}
.dsh-pwb-row:hover { background: var(--pwb-card-hi); }
.dsh-pwb-row-up { opacity: 0.75; }
.dsh-pwb-row-title { font-size: 12.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-pwb-row-sub { font-size: 11.5px; color: var(--pwb-dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-pwb-row-meta { font-size: 11px; color: var(--pwb-dimmer); }
.dsh-pwb-note-head {
  font-size: 12px;
  font-weight: 650;
  padding-bottom: 9px;
  margin-bottom: 10px;
  border-bottom: 1px solid var(--pwb-border);
  color: var(--pwb-dim);
}
.dsh-pwb-pre {
  margin: 0;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--pwb-text);
}

/* ── 总览：可拖拽网格 ── */
.dsh-pwb-canvas { width: 100%; padding-bottom: 6px; }
.dsh-pwb-cell { position: relative; min-width: 0; min-height: 0; }
.dsh-pwb-cell-body {
  height: 100%;
  border-radius: var(--pwb-radius);
  border: 1px solid var(--pwb-border);
  background: var(--pwb-card);
  overflow: hidden;
  transition: border-color 0.16s ease, box-shadow 0.16s ease;
}
.dsh-pwb-canvas:not(.dsh-pwb-canvas-edit) .dsh-pwb-cell:hover .dsh-pwb-cell-body {
  border-color: var(--pwb-border-hi);
  box-shadow: 0 4px 18px rgba(20, 20, 30, 0.06);
}
@keyframes dsh-pwf-float-up { 0% { opacity: 0; transform: translateY(6px); } 15% { opacity: 1; } 100% { opacity: 0; transform: translateY(-46px); } }
.dsh-pwf-floater { top: 38%; animation: dsh-pwf-float-up 0.9s ease-out forwards; }
/* 表单细节：原生控件按浅色渲染（宿主 color-scheme:dark 会把 time/number 内部件渲染成白条），number 去上下箭头，秒位跳动 pop */
.dsh-pwb-dark { color-scheme: light; }
/* 日期/时间选择弹层跟随页面根元素的 color-scheme（容器级声明管不到弹层）——宿主浅色主题下根就该是 light，声明之 */
html { color-scheme: light !important; }
.dsh-pwb-dark input[type='number'] { -moz-appearance: textfield; appearance: textfield; }
.dsh-pwb-dark input[type='number']::-webkit-inner-spin-button,
.dsh-pwb-dark input[type='number']::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
@keyframes dsh-pwb-sec-pop { 0% { transform: translateY(2px) scale(0.82); opacity: 0.35; } 100% { transform: none; opacity: 1; } }
.dsh-pwb-sec-pop { animation: dsh-pwb-sec-pop 0.32s ease-out; }

/* 木鱼敲击动画（照抄原版）：双份同名 keyframes 交替切换实现无重挂载重播 */
@keyframes dsh-pwf-hammer-knock-0 { 0% { transform: rotate(6deg); } 50% { transform: rotate(-26deg); } 100% { transform: rotate(6deg); } }
@keyframes dsh-pwf-hammer-knock-1 { 0% { transform: rotate(6deg); } 50% { transform: rotate(-26deg); } 100% { transform: rotate(6deg); } }
@keyframes dsh-pwf-fish-knock-0 {
  0% { transform: rotateX(14deg) rotateY(-6deg) scale(1); }
  20% { transform: rotateX(8deg) rotateY(-20deg) scale(1.06); }
  40% { transform: rotateX(20deg) rotateY(4deg) scale(1); }
  60% { transform: rotateX(12deg) rotateY(16deg) scale(1); }
  80% { transform: rotateX(16deg) rotateY(-8deg) scale(1); }
  100% { transform: rotateX(14deg) rotateY(-6deg) scale(1); }
}
@keyframes dsh-pwf-fish-knock-1 {
  0% { transform: rotateX(14deg) rotateY(-6deg) scale(1); }
  20% { transform: rotateX(8deg) rotateY(-20deg) scale(1.06); }
  40% { transform: rotateX(20deg) rotateY(4deg) scale(1); }
  60% { transform: rotateX(12deg) rotateY(16deg) scale(1); }
  80% { transform: rotateX(16deg) rotateY(-8deg) scale(1); }
  100% { transform: rotateX(14deg) rotateY(-6deg) scale(1); }
}
.dsh-pwf-stage { cursor: pointer; -webkit-tap-highlight-color: transparent; }

/* 万年历：农历小字 + 休/班标记 */
.dsh-pwb-cal-lunar { margin-top: 1px; font-size: 8px; line-height: 1.1; color: var(--pwb-dim); }
.dsh-pwb-mcal-lunar { margin-top: 0; font-size: 10.5px; line-height: 1.1; color: var(--pwb-dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dsh-pwb-mcal-sel .dsh-pwb-mcal-lunar { color: rgba(255, 255, 255, 0.85); }
.dsh-pwb-mcal-festival { color: #e5484d; font-weight: 650; }
.dsh-pwb-mcal-jieqi { color: #00b862; font-weight: 650; }
.dsh-pwb-mcal-sel .dsh-pwb-mcal-festival, .dsh-pwb-mcal-sel .dsh-pwb-mcal-jieqi { color: #ffffff; }
.dsh-pwb-mcal-hol {
  margin-left: auto;
  font-style: normal;
  font-size: 9px;
  font-weight: 700;
  line-height: 1;
  color: #ffffff;
  background: #e5484d;
  border-radius: 5px;
  padding: 2px 4px;
}
.dsh-pwb-mcal-hol.dsh-pwb-mcal-ban { background: var(--pwb-dimmer, #9aa0a6); }
.dsh-pwb-mcal-weather {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  margin-left: auto;
  font-size: 10.5px;
  font-weight: 600;
  color: var(--pwb-dim, #6b7280);
  white-space: nowrap;
}
.dsh-pwb-almanac {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
  padding: 8px 12px;
  border-radius: 10px;
  background: var(--pwb-card-hi);
  font-size: 12px;
}
.dsh-pwb-almanac-date { font-weight: 650; color: var(--pwb-text); }
.dsh-pwb-almanac-yi { color: #00b862; font-weight: 600; }
.dsh-pwb-almanac-ji { color: #e5484d; font-weight: 600; }
.dsh-pwb-cal-off { background: rgba(229, 72, 77, 0.09); border-radius: 8px; }
.dsh-pwb-cal-off .dsh-pwb-cal-day, .dsh-pwb-cal-off .dsh-pwb-cal-lunar { color: #e5484d; }
.dsh-pwb-cal-work { box-shadow: inset 0 0 0 1px rgba(0, 210, 106, 0.4); border-radius: 8px; }
.dsh-pwb-cal-work .dsh-pwb-cal-lunar { color: #00b865; }

.dsh-pwb-cell-drag .dsh-pwb-cell-body { opacity: 0.72; border-color: #00d26a; box-shadow: 0 8px 28px rgba(0, 210, 106, 0.18); }
.dsh-pwb-canvas-edit .dsh-pwb-cell-body { border-style: solid; border-color: transparent; }
.dsh-pwb-canvas-edit .dsh-pwb-cell:hover .dsh-pwb-cell-body { border-color: transparent; }

/* 拖动条 */
.dsh-pwb-dragbar {
  position: absolute;
  top: -11px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 30;
  height: 22px;
  width: 76px;
  border-radius: 999px;
  border: 1px solid var(--pwb-border-hi);
  background: var(--pwb-card);
  color: var(--pwb-dim);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: grab;
  opacity: 0;
  transition: opacity 0.15s ease, background 0.15s ease, border-color 0.15s ease;
}
.dsh-pwb-dragbar:active { cursor: grabbing; }
.dsh-pwb-cell:hover .dsh-pwb-dragbar { opacity: 1; }
.dsh-pwb-dragbar:hover { background: rgba(0, 210, 106, 0.16); border-color: #00d26a; color: #0a9c53; }

/* 删除按钮 */
.dsh-pwb-cell-del {
  position: absolute;
  top: -11px;
  right: 6px;
  z-index: 30;
  width: 22px;
  height: 22px;
  border-radius: 999px;
  border: 1px solid rgba(229, 72, 77, 0.4);
  background: var(--pwb-card);
  color: var(--dsw-alias-state-error-primary, #e5484d);
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s ease, background 0.15s ease;
}
.dsh-pwb-cell:hover .dsh-pwb-cell-del { opacity: 1; }
.dsh-pwb-cell-del:hover { background: rgba(229, 72, 77, 0.14); }

/* 尺寸提示 */
.dsh-pwb-cell-size {
  position: absolute;
  bottom: 7px;
  right: 9px;
  z-index: 30;
  padding: 1px 6px;
  border-radius: 6px;
  border: 1px solid var(--pwb-border);
  background: var(--pwb-card);
  font-size: 10px;
  color: var(--pwb-dimmer);
  font-variant-numeric: tabular-nums;
  opacity: 0;
  transition: opacity 0.15s ease;
  pointer-events: none;
}
.dsh-pwb-cell:hover .dsh-pwb-cell-size { opacity: 1; }

/* 8 向缩放手柄 */
.dsh-pwb-handle {
  position: absolute;
  z-index: 30;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 5px;
  border: 1px solid var(--pwb-border-hi);
  background: var(--pwb-card);
  opacity: 0;
  transition: opacity 0.15s ease, background 0.15s ease, border-color 0.15s ease;
}
.dsh-pwb-cell:hover .dsh-pwb-handle { opacity: 1; }
.dsh-pwb-handle:hover { background: #00d26a; border-color: #00d26a; }
.dsh-pwb-handle-inner { display: block; background: var(--pwb-dim); border-color: var(--pwb-dim); border-style: solid; border-width: 0; }
.dsh-pwb-handle:hover .dsh-pwb-handle-inner { background: #04160c; border-color: #04160c; }

/* ── 卡片内的组件外壳 ── */
.dsh-pwb-widget { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.dsh-pwb-widget-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 11px 14px 9px;
  border-bottom: 1px solid var(--pwb-border);
  flex: 0 0 auto;
}
.dsh-pwb-widget-title { font-size: 12.5px; font-weight: 650; }
.dsh-pwb-widget-body { flex: 1; min-height: 0; overflow: auto; padding: 9px 10px; }

/* 指标条（12 列 × 1 行） */
.dsh-pwb-metrics { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; height: 100%; }
.dsh-pwb-metric {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 3px;
  padding: 12px 14px;
  border-radius: 12px;
  border: 1px solid var(--pwb-border);
  background: var(--pwb-card);
  font-family: inherit;
  text-align: left;
  cursor: pointer;
  position: relative;
  overflow: hidden;
  color: var(--pwb-text);
}
.dsh-pwb-metric::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 3px;
  background: var(--pwb-metric-accent, #00d26a);
}
.dsh-pwb-metric:hover { background: var(--pwb-card-hi); }
.dsh-pwb-metric-label { font-size: 12px; color: var(--pwb-dim); }
.dsh-pwb-metric-value { font-size: 26px; font-weight: 700; line-height: 1.2; font-variant-numeric: tabular-nums; letter-spacing: -0.5px; }
.dsh-pwb-metric-hint { font-size: 11px; color: var(--pwb-dimmer); }

/* 时钟 */
.dsh-pwb-clock { font-size: 30px; font-weight: 700; font-variant-numeric: tabular-nums; letter-spacing: -1px; line-height: 1.2; }
.dsh-pwb-clock-sec { font-size: 16px; color: var(--pwb-dim); margin-left: 2px; }
.dsh-pwb-progress-wrap { display: flex; align-items: center; gap: 9px; margin-top: 9px; }
.dsh-pwb-progress { flex: 1; height: 5px; border-radius: 999px; background: var(--pwb-card-hi); overflow: hidden; }
.dsh-pwb-progress-fill { height: 100%; border-radius: 999px; background: linear-gradient(90deg, #00d26a, #6ee7a8); }

/* 便签 */
/* 便签：与卡片同底（透明+主题字色），不引入独立配色 */
.dsh-pwb-notes {
  width: 100%;
  height: 100%;
  min-height: 90px;
  resize: none;
  border: none;
  outline: none;
  background: transparent !important;
  box-shadow: none !important;
  border-radius: 0;
  padding: 0;
  color: var(--pwb-text);
  font-family: inherit;
  font-size: 12.5px;
  line-height: 1.7;
}
.dsh-pwb-notes::placeholder { color: var(--pwb-dimmer); }

/* 模块快捷入口 */
.dsh-pwb-modlist { display: flex; flex-wrap: wrap; gap: 8px; align-content: flex-start; }
.dsh-pwb-modchip {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 7px 13px;
  border-radius: 10px;
  border: 1px solid var(--pwb-border);
  background: var(--pwb-card);
  color: var(--pwb-text);
  font-family: inherit;
  font-size: 12.5px;
  cursor: pointer;
}
.dsh-pwb-modchip:hover { background: var(--pwb-card-hi); border-color: var(--pwb-border-hi); }
.dsh-pwb-modchip-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--pwb-metric-accent, #00d26a); }

/* ── 未实现模块说明 ── */
.dsh-pwb-pending {
  display: flex;
  flex-direction: column;
  gap: 10px;
  align-items: flex-start;
  padding: 24px;
  border-radius: var(--pwb-radius);
  border: 1px dashed var(--pwb-border-hi);
  background: var(--pwb-card);
  font-size: 13px;
  line-height: 1.75;
  color: var(--pwb-dim);
  max-width: 640px;
}
`;

export function ensureThemeStyle(): void {
  if (typeof document === 'undefined') return;
  const existing = document.getElementById(STYLE_ID);
  if (existing !== null) {
    // HMR / 重复 apply：内容可能已更新，替换而不是跳过，避免旧样式残留
    existing.textContent = CSS;
    return;
  }
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}
