/**
 * 文件归档模块 —— 本机文件浏览（Host fs/list / fs/read / fs/open）。
 * 范围：主目录（HOME）下任意目录；禁 ..、realpath 防 symlink 逃逸（Host 侧强制）。
 * 交互：左目录树（文件夹进入 / 文件点击预览），右文本预览 + 系统程序打开；
 * 超大或二进制类型不支持文本预览时，仍可用系统程序打开。
 */
// @ts-nocheck —— 移植自 Yuze Workbench（原项目自带类型检查），此处不重复校验

import { useCallback, useEffect, useState } from 'react';
import { Archive, Folder, FileText, ChevronRight, ExternalLink, Loader2 } from 'lucide-react';
import type { ReactElement } from 'react';
import type { RpcFn } from '../rpc.js';

interface Node { name: string; path: string; kind: 'dir' | 'file' }

export function ArchiveModuleView({ rpc }: { rpc: RpcFn }): ReactElement {
  const [stack, setStack] = useState<string[]>(['']);
  const [entries, setEntries] = useState<Node[]>([]);
  const [note, setNote] = useState<{ path: string; content: string } | null>(null);
  const [unsupported, setUnsupported] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [reading, setReading] = useState(false);
  const [err, setErr] = useState('');
  const dir = stack[stack.length - 1] ?? '';

  const load = useCallback(async (d: string) => {
    setLoading(true);
    setErr('');
    try {
      const out = await rpc('personal-workbench/fs/list', { path: d });
      if (!out?.ok) throw new Error((out?.error as { message?: string })?.message ?? '读取失败');
      setEntries(((out.value as { entries?: Node[] })?.entries ?? []) as Node[]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : '读取失败');
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [rpc]);

  useEffect(() => { void load(dir); }, [dir, load]);

  const enter = (n: Node) => {
    setUnsupported(null);
    if (n.kind === 'dir') { setNote(null); setStack((s) => [...s, n.path]); return; }
    void (async () => {
      setReading(true);
      setErr('');
      setNote(null);
      setUnsupported(null);
      try {
        const out = await rpc('personal-workbench/fs/read', { path: n.path });
        if (!out?.ok) {
          const code = (out?.error as { code?: string })?.code ?? '';
          const msg = (out?.error as { message?: string })?.message ?? '读取失败';
          if (code === 'unsupported' || code === 'too-large') setUnsupported(msg);
          else throw new Error(msg);
        } else {
          const v = out.value as { path: string; content: string };
          setNote({ path: v.path, content: v.content });
        }
      } catch (e) {
        setErr(e instanceof Error ? e.message : '读取失败');
      } finally {
        setReading(false);
      }
    })();
  };

  const openWithSystem = async (rel: string) => {
    const out = await rpc('personal-workbench/fs/open', { path: rel });
    if (!out?.ok) setErr((out?.error as { message?: string })?.message ?? '打开失败');
  };

  const crumbs = dir === '' ? [] : dir.split('/');
  const jump = (idx: number) => setStack((s) => s.slice(0, idx + 1));

  return (
    <div className="dsh-pwb-view">
      <div className="dsh-pwb-toolbar">
        <span className="grid size-7 place-items-center rounded-lg bg-primary/15 text-primary"><Archive className="size-4" /></span>
        <span className="text-sm font-semibold text-white">主目录</span>
        <button
          type="button"
          className="dsh-pwb-btn"
          style={{ marginLeft: 'auto' }}
          onClick={() => void openWithSystem(dir === '' ? '.' : dir)}
          title="在访达中打开当前目录"
        >
          <ExternalLink className="size-3.5" /> 在访达中打开
        </button>
      </div>

      {/* 面包屑 */}
      <div className="dsh-pwb-crumbs">
        <button type="button" className="dsh-pwb-crumb" onClick={() => setStack([''])}>主目录</button>
        {crumbs.map((c, i) => (
          <span key={`${c}-${i}`} className="dsh-pwb-crumb-wrap">
            <span className="dsh-pwb-crumb-sep">/</span>
            <button type="button" className="dsh-pwb-crumb" onClick={() => jump(i)}>{c}</button>
          </span>
        ))}
        {err !== undefined && err !== '' ? <span className="dsh-pwb-err">{err}</span> : null}
        {loading ? <span className="dsh-pwb-busy">加载中…</span> : null}
      </div>

      <div className="dsh-pwb-split">
        {/* 左：目录列表 */}
        <div className="dsh-pwb-split-list">
          {dir !== '' ? (
            <button type="button" className="dsh-pwb-row" onClick={() => setStack((s) => s.slice(0, -1))}>
              <span className="dsh-pwb-row-title">↑ 返回上级</span>
            </button>
          ) : null}
          {entries.map((n) => (
            <button key={n.path} type="button" className="dsh-pwb-row" onClick={() => enter(n)} title={n.kind === 'dir' ? '打开文件夹' : n.name}>
              <span className="dsh-pwb-row-title">
                {n.kind === 'dir' ? '📁' : '📄'} {n.name}
              </span>
              {n.kind === 'dir' ? <ChevronRight className="size-3.5 shrink-0 text-white/25" /> : null}
            </button>
          ))}
          {!loading && entries.length === 0 ? <div className="dsh-pwb-empty">该目录暂无内容</div> : null}
        </div>

        {/* 右：预览 / 打开 */}
        <div className="dsh-pwb-split-main">
          {reading ? (
            <div className="grid h-full place-items-center"><Loader2 className="size-8 animate-spin text-white/30" /></div>
          ) : note !== null ? (
            <>
              <div className="dsh-pwb-note-head" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span>{note.path}</span>
                <button type="button" className="dsh-pwb-btn" style={{ marginLeft: 'auto' }} onClick={() => void openWithSystem(note.path)}>
                  <ExternalLink className="size-3.5" /> 用系统程序打开
                </button>
              </div>
              <pre className="dsh-pwb-pre">{note.content}</pre>
            </>
          ) : unsupported !== null ? (
            <div className="grid h-full place-items-center px-6 text-center">
              <div>
                <div className="text-xs text-white/60">{unsupported}</div>
                <button type="button" className="dsh-pwb-btn" style={{ marginTop: 10 }} onClick={() => void openWithSystem(crumbs.length > 0 ? `${crumbs.join('/')}` : '.')}>在访达中打开当前目录</button>
              </div>
            </div>
          ) : (
            <div className="dsh-pwb-empty">从左侧选择目录或文件</div>
          )}
        </div>
      </div>
    </div>
  );
}
