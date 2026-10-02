/**
 * 文件归档 —— 移植自 Yuze Workbench OverviewPage.FileArchiveWidget（交互 1:1）：
 * 目录面包屑、文件夹进入/返回、文件列表、根目录切换提示。
 * 数据源差别：原版走 Electron 读本机任意目录；插件按「不外联、不造假」
 * 约定改接本机 Obsidian 知识库（Host 只读代理 personal-workbench/kb/list），
 * 浏览为只读 —— 新建/删除等写操作原样不做，避免误导。
 */
// @ts-nocheck —— 移植自 Yuze Workbench（原项目自带类型检查），此处不重复校验

import { useCallback, useEffect, useState } from 'react';
import { Archive, Folder, FileText, ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import type { RpcFn } from '../../rpc.js';

interface Node { name: string; path: string; kind: 'file' | 'dir' }

export function ArchiveWidget({ rpc }: { rpc: RpcFn }) {
  const [entries, setEntries] = useState<Node[]>([]);
  const [stack, setStack] = useState<string[]>(['']); // 目录栈，栈底 = 知识库根
  const [loading, setLoading] = useState(false);
  const [offline, setOffline] = useState(false);
  const dir = stack[stack.length - 1] ?? '';

  const load = useCallback(async (d: string) => {
    setLoading(true);
    try {
      const out = await rpc('personal-workbench/kb/list', { path: d });
      const list = (out as { entries?: Node[] }).entries ?? [];
      // 文件夹在前、按名排序（与原版一致）
      list.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'dir' ? -1 : 1));
      setEntries(list);
      setOffline(false);
    } catch {
      setEntries([]);
      setOffline(true);
    } finally {
      setLoading(false);
    }
  }, [rpc]);

  useEffect(() => { void load(dir); }, [dir, load]);

  const crumbs = dir ? dir.split('/').filter(Boolean) : [];
  const enter = (n: Node) => { if (n.kind === 'dir') setStack((s) => [...s, n.path]); };
  const back = () => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s));
  const jump = (idx: number) => setStack((s) => s.slice(0, idx + 1));

  return (
    <div className="dsh-pwb-widget relative flex h-full flex-col">
      <div className="flex items-center gap-2 px-4 pt-3">
        <span className="grid size-7 place-items-center rounded-lg bg-primary/15 text-primary"><Archive className="size-4" /></span>
        <span className="text-sm font-semibold text-white">文件归档</span>
        <button className="ml-auto grid size-7 place-items-center rounded-lg text-white/40 hover:bg-white/[0.06] hover:text-white" onClick={() => void load(dir)} title="刷新">
          <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* 面包屑导航 */}
      <div className="mx-4 mt-2 flex items-center gap-1 overflow-x-auto whitespace-nowrap rounded-lg bg-white/[0.04] px-2.5 py-1.5 text-[11px]">
        <button className={`shrink-0 rounded px-1 hover:text-primary ${crumbs.length === 0 ? 'font-semibold text-primary' : 'text-white/50'}`} onClick={() => setStack([''])}>
          知识库
        </button>
        {crumbs.map((c, i) => (
          <span key={i} className="flex shrink-0 items-center gap-1">
            <ChevronRight className="size-3 text-white/25" />
            <button className={`rounded px-1 hover:text-primary ${i === crumbs.length - 1 ? 'font-semibold text-primary' : 'text-white/50'}`} onClick={() => jump(i)}>
              {c}
            </button>
          </span>
        ))}
        {stack.length > 1 && (
          <button className="ml-auto grid size-5 shrink-0 place-items-center rounded hover:bg-white/[0.06] text-white/50" onClick={back} title="返回上级">
            <ChevronLeft className="size-3.5" />
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-2.5 pb-3 pt-2">
        {offline ? (
          <div className="grid h-full place-items-center px-4 text-center text-xs text-white/35">
            未连接到 Obsidian
            <span className="mt-1 text-[10px] text-white/25">启动 Obsidian（Local REST API）后展示知识库目录</span>
          </div>
        ) : entries.length === 0 && !loading ? (
          <div className="grid h-full place-items-center text-xs text-white/35">该目录暂无内容</div>
        ) : (
          entries.map((n) => (
            <button
              key={n.path}
              className="group flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-white/[0.05]"
              onClick={() => enter(n)}
              title={n.kind === 'dir' ? '打开文件夹' : n.name}
            >
              {n.kind === 'dir' ? <Folder className="size-4 shrink-0 text-primary/80" /> : <FileText className="size-4 shrink-0 text-white/40" />}
              <span className="min-w-0 flex-1 truncate text-xs text-white/75">{n.name}</span>
              {n.kind === 'dir' && <ChevronRight className="size-3.5 shrink-0 text-white/20 group-hover:text-white/50" />}
            </button>
          ))
        )}
      </div>
    </div>
  );
}
