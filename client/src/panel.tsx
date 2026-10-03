/**
 * 中央面板：模块网格 ↔ 模块视图。
 * 全部功能由插件自身实现——没有 iframe、不依赖任何外部应用或页面。
 */
import { useState } from 'react';
import type { ReactElement } from 'react';
import { t } from './i18n.js';
import { MODULES, moduleById, type ModuleDef } from './modules.js';
import type { RpcFn } from './rpc.js';
import { ensureThemeStyle } from './theme.js';
import { KnowledgeView } from './views/KnowledgeView.js';
import { ModuleBoundary } from './ModuleBoundary.js';
import { ArchiveModuleView } from './views/ArchiveModuleView.js';
import { MusicModuleView } from './views/MusicModuleView.js';
import { VideoModuleView } from './views/VideoModuleView.js';
import { OverviewView } from './views/OverviewView.js';
import { ScheduleView } from './views/ScheduleView.js';
import { TodoView } from './views/TodoView.js';

export const PANEL_ID = 'dsh-personal-workbench';

export interface WorkbenchPanelProps {
  rpc: RpcFn;
}

function ModIcon({ path }: { path: string }): ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={path} />
    </svg>
  );
}

/** 面板标题的图标：四宫格（与侧栏入口同源）。 */
const MARK_ICON = 'M4 4h6v6H4V4Zm10 0h6v6h-6V4ZM4 14h6v6H4v-6Zm10 0h6v6h-6v-6Z';

/** 尚未原生实现的模块：说明下一步，而不是放假数据。 */
function PendingView({ mod }: { mod: ModuleDef }): ReactElement {
  return (
    <div className="dsh-pwb-view">
      <div className="dsh-pwb-view-body">
        <div className="dsh-pwb-pending">
          <strong>{t(`mod.${mod.id}.label`)}</strong>
          <span>{t(mod.pendingKey ?? 'pending.archive')}</span>
        </div>
      </div>
    </div>
  );
}

function ModuleBody({
  id,
  rpc,
  onOpen,
  onBack,
}: {
  id: string;
  rpc: RpcFn;
  onOpen: (next: string) => void;
  onBack: () => void;
}): ReactElement {
  // 单模块崩溃只降级该模块，不再整页白屏
  return (
    <ModuleBoundary label={id}>
      <ModuleSwitch id={id} rpc={rpc} onOpen={onOpen} onBack={onBack} />
    </ModuleBoundary>
  );
}

function ModuleSwitch({
  id,
  rpc,
  onOpen,
  onBack,
}: {
  id: string;
  rpc: RpcFn;
  onOpen: (next: string) => void;
  onBack: () => void;
}): ReactElement {
  switch (id) {
    case 'todo':
      return <TodoView rpc={rpc} onOpen={onOpen} />;
    case 'daily':
      return <ScheduleView rpc={rpc} />;
    case 'knowledge':
      return <KnowledgeView rpc={rpc} />;
    case 'archive':
      return <ArchiveModuleView rpc={rpc} />;
    case 'music':
      return <MusicModuleView rpc={rpc} />;
    case 'film':
      return <VideoModuleView rpc={rpc} />;
    case 'overview':
      return <OverviewView rpc={rpc} onOpen={onOpen} onBack={onBack} />;
    default: {
      const mod = moduleById(id);
      return mod === undefined ? <div className="dsh-pwb-empty">{t('common.loading')}</div> : <PendingView mod={mod} />;
    }
  }
}

export function WorkbenchPanel({ rpc }: WorkbenchPanelProps): ReactElement {
  ensureThemeStyle();
  const [active, setActive] = useState<string | null>(null);

  const current = active === null ? undefined : moduleById(active);

  return (
    <div className="dsh-pwb-panel">
      {active === 'todo' ? (
        // 待办页自带完整标题行（TopBarSection），面板头部只留左侧返回
        <div className="dsh-pwb-head dsh-pwb-head-slim">
          <button type="button" className="dsh-pwb-btn" onClick={() => setActive(null)}>
            ← {t('act.back')}
          </button>
        </div>
      ) : active !== 'overview' ? (
        <>
          {active !== null ? (
            <div className="dsh-pwb-head dsh-pwb-head-slim">
              <button type="button" className="dsh-pwb-btn" onClick={() => setActive(null)}>
                ← {t('act.back')}
              </button>
            </div>
          ) : null}
          <div className="dsh-pwb-head">
            <div className="dsh-pwb-head-main">
              <div className="dsh-pwb-title-row">
                <span className="dsh-pwb-title" style={current !== undefined && current.id === 'music' ? { color: '#34a853', fontWeight: 800 } : undefined}>
                  {current === undefined ? t('panel.title') : t(`mod.${current.id}.label`)}
                </span>
              </div>
              {current === undefined || current.id !== 'music' ? (
                <div className="dsh-pwb-sub">
                  {current === undefined ? t('panel.subtitle') : t(`mod.${current.id}.desc`)}
                </div>
              ) : null}
            </div>
          </div>
        </>
      ) : null}

      <div className="dsh-pwb-body">
        {active === null ? (
          <div className="dsh-pwb-grid">
            {MODULES.map((mod) => (
              <button
                key={mod.id}
                type="button"
                className="dsh-pwb-card"
                style={{ ['--dsh-pwb-card-accent' as string]: mod.accent }}
                onClick={() => setActive(mod.id)}
              >
                <span className="dsh-pwb-card-top">
                  <span className="dsh-pwb-card-icon">
                    <ModIcon path={mod.icon} />
                  </span>
                  <span className="dsh-pwb-card-label">{t(`mod.${mod.id}.label`)}</span>
                </span>
                <span className="dsh-pwb-card-desc">{t(`mod.${mod.id}.desc`)}</span>
                <span className="dsh-pwb-card-foot">
                  <span className={`dsh-pwb-badge${mod.ready ? ' dsh-pwb-badge-ready' : ''}`}>
                    {mod.ready ? t('state.ready') : mod.id === 'wip' ? t('state.wip') : t('state.pending')}
                  </span>
                  <span className="dsh-pwb-card-arrow">→</span>
                </span>
              </button>
            ))}
          </div>
        ) : (
          <ModuleBody id={active} rpc={rpc} onOpen={setActive} onBack={() => setActive(null)} />
        )}
      </div>
    </div>
  );
}
