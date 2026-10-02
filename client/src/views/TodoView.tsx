/**
 * 模块：待办事项 —— 1:1 复刻 Yuze Workbench 的 TaskDashboard。
 *
 * 页面本体（TopBar / KPI / 任务看板 / 3D 堆叠卡 / 详情面板）是从原项目整目录搬过来的，
 * 源码未做任何视觉改动；差异只在依赖层，由 ../workbench/tasks/lib/compat 兜住：
 *   scopedStorage → localStorage + 异步落盘到插件目录
 *   desktopApi    → 本机知识库（Host 侧代理）
 *   sonner / react-router → 插件内的轻量等价物
 *
 * 整个页面包在 `.dsh-pwb-dark` 容器里 —— Tailwind 那一千多条工具类在构建期已被作用域化，
 * 只在容器内生效，不会碰到宿主界面。
 */
import { useEffect } from 'react';
import type { ReactElement } from 'react';
import type { RpcFn } from '../rpc.js';
import { ensureWorkbenchStyle } from '../workbench/style.js';
import TaskDashboard from '../workbench/tasks/TaskDashboard.js';
import { attachWorkbenchBridge } from '../workbench/tasks/lib/compat.js';

export function TodoView({ rpc, onOpen }: { rpc: RpcFn; onOpen: (id: string) => void }): ReactElement {
  useEffect(() => {
    ensureWorkbenchStyle();
  }, []);

  useEffect(() => {
    attachWorkbenchBridge({ rpc, openModule: onOpen });
  }, [rpc, onOpen]);

  return (
    <div className="dsh-pwb-dark dsh-pwb-board-wrap">
      <TaskDashboard />
    </div>
  );
}
