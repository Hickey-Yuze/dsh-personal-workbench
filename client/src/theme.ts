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
}
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
.dsh-pwb-cal-cell-static { pointer-events: none; }

/* ── 当日面板 ── */
.dsh-pwb-day-panel { display: flex; flex-direction: column; gap: 4px; }
.dsh-pwb-day-head { display: flex; align-items: baseline; gap: 9px; }
.dsh-pwb-day-title { font-size: 13.5px; font-weight: 650; }
.dsh-pwb-day-count { font-size: 12px; color: var(--pwb-dimmer); }

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
.dsh-pwb-notes {
  width: 100%;
  height: 100%;
  min-height: 90px;
  resize: none;
  border: none;
  outline: none;
  background: transparent;
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
