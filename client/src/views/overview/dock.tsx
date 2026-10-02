/**
 * 启动器 —— 移植自 Yuze Workbench OverviewPage.DockWidget（交互 1:1）：
 * 应用网格、点击启动、右上角手动添加/删除、显示总数。
 * 数据源差别：原版走 Electron 枚举本机应用；插件走 Host RPC
 * `personal-workbench/apps/list`（只列 .app 名称）与 `apps/open`（open -a，
 * 带白名单校验）。自定义项沿用原版 key（overview_dock_items_v1）。
 */
// @ts-nocheck —— 移植自 Yuze Workbench（原项目自带类型检查），此处不重复校验

import { useCallback, useEffect, useState } from 'react';
import { LayoutGrid, Plus, Trash2, X } from 'lucide-react';
import type { RpcFn } from '../../rpc.js';

interface DockItem { label: string; path: string }

const DOCK_KEY = 'overview_dock_items_v1';
const COLOR_POOL = ['#00D26A', '#38BDF8', '#F59E0B', '#F472B6', '#A78BFA', '#34D399', '#FB7185', '#60A5FA'];
const colorOf = (label: string) => COLOR_POOL[[...label].reduce((a, c) => a + c.charCodeAt(0), 0) % COLOR_POOL.length];

function loadCustom(): DockItem[] {
  try {
    const raw = localStorage.getItem(`dsh-pwb:${DOCK_KEY}`);
    if (raw) return JSON.parse(raw) as DockItem[];
  } catch { /* ignore */ }
  return [];
}

export function DockWidget({ rpc }: { rpc: RpcFn }) {
  const [apps, setApps] = useState<string[]>([]);
  const [custom, setCustom] = useState<DockItem[]>(loadCustom);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [running, setRunning] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => { localStorage.setItem(`dsh-pwb:${DOCK_KEY}`, JSON.stringify(custom)); }, [custom]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const out = await rpc('personal-workbench/apps/list', {});
        if (alive) setApps((out as { apps?: string[] }).apps ?? []);
      } catch { /* Host 未重启时端点不存在：静默 */ }
    })();
    return () => { alive = false; };
  }, [rpc]);

  const launch = useCallback(async (label: string) => {
    setRunning(label);
    setError('');
    try {
      await rpc('personal-workbench/apps/open', { name: label });
    } catch (e) {
      setError(e instanceof Error ? e.message : '启动失败');
    } finally {
      setTimeout(() => setRunning(null), 600);
    }
  }, [rpc]);

  const items: DockItem[] = [
    ...apps.map((a) => ({ label: a, path: a })),
    ...custom.filter((c) => !apps.some((a) => a === c.label)),
  ].slice(0, 80);
  const shown = items.slice(0, 8);

  return (
    <div className="dsh-pwb-widget relative flex h-full flex-col">
      <div className="flex items-center gap-2 px-4 pt-3">
        <span className="grid size-7 place-items-center rounded-lg bg-primary/15 text-primary"><LayoutGrid className="size-4" /></span>
        <div className="leading-tight">
          <div className="text-sm font-semibold text-white">启动器</div>
          <div className="text-[10px] text-white/40">点击启动应用 · 共 {items.length} 个</div>
        </div>
        <div className="ml-auto flex items-center gap-1">
          <button className="grid size-7 place-items-center rounded-lg text-white/40 hover:bg-white/[0.06] hover:text-white" onClick={() => setAdding((v) => !v)} title="添加">
            {adding ? <X className="size-4" /> : <Plus className="size-4" />}
          </button>
        </div>
      </div>

      {adding && (
        <div className="mx-4 mt-2 flex gap-1.5">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="输入 /Applications 里的应用名…"
            className="min-w-0 flex-1 rounded-lg border border-white/[0.08] bg-white/[0.05] px-2.5 py-1.5 text-xs text-white outline-none placeholder:text-white/30"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && name.trim()) { setCustom((c) => [...c, { label: name.trim(), path: name.trim() }]); setName(''); }
            }}
          />
          <button
            className="rounded-lg bg-primary px-2.5 text-xs font-semibold text-[var(--primary-foreground,#0c1d14)]"
            onClick={() => { if (name.trim()) { setCustom((c) => [...c, { label: name.trim(), path: name.trim() }]); setName(''); } }}
          >
            添加
          </button>
        </div>
      )}
      {error && <div className="mx-4 mt-1 text-[10px] text-red-400">{error}</div>}

      <div className="grid flex-1 grid-cols-4 content-start gap-2 overflow-y-auto p-4 pt-3">
        {shown.length === 0 && <div className="col-span-4 grid place-items-center py-6 text-xs text-white/30">正在读取本机应用列表…（需重启宿主后生效）</div>}
        {shown.map((it) => (
          <div key={it.label} className="group relative">
            <button
              className="flex w-full flex-col items-center gap-1.5 rounded-xl p-2 transition-colors hover:bg-white/[0.05]"
              onClick={() => void launch(it.label)}
              title={`启动 ${it.label}`}
            >
              <span
                className="grid size-11 place-items-center rounded-xl text-sm font-bold text-white shadow-sm"
                style={{ background: `linear-gradient(135deg, ${colorOf(it.label)}, ${colorOf(it.label)}cc)` }}
              >
                {it.label.slice(0, 2)}
              </span>
              <span className="w-full truncate text-center text-[10px] text-white/60">{it.label}</span>
            </button>
            <button
              className="absolute right-0.5 top-0.5 hidden size-5 place-items-center rounded-md bg-white/[0.08] text-white/50 hover:text-red-400 group-hover:grid"
              onClick={() => setCustom((c) => c.filter((x) => x.label !== it.label))}
              title="从启动器移除"
            >
              <Trash2 className="size-3" />
            </button>
          </div>
        ))}
      </div>
      {running && <div className="pointer-events-none absolute inset-x-0 bottom-2 text-center text-[10px] text-primary">正在启动 {running}…</div>}
    </div>
  );
}
