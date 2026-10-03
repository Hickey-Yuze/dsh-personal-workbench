/**
 * 文件归档模块 —— 本机文件浏览（Host fs/list / fs/read / fs/open）。
 * 范围：主目录（HOME）下任意目录；禁 ..、realpath 防 symlink 逃逸（Host 侧强制）。
 * 交互：左目录树（文件夹进入 / 文件点击预览），右文本预览 + 系统程序打开；
 * 超大或二进制类型不支持文本预览时，仍可用系统程序打开。
 */
// @ts-nocheck —— 移植自 Yuze Workbench（原项目自带类型检查），此处不重复校验

import { useCallback, useEffect, useState } from 'react';
import { Archive, Folder, FileText, ChevronRight, ExternalLink, Loader2, Video, FolderOpen, X, House } from 'lucide-react';
import type { ReactElement } from 'react';
import type { RpcFn } from '../rpc.js';
import { API_PREFIX } from '../rpc.js';

interface Node { name: string; path: string; kind: 'dir' | 'file' }

export function ArchiveModuleView({ rpc }: { rpc: RpcFn }): ReactElement {
  const [stack, setStack] = useState<string[]>(['']);
  const [entries, setEntries] = useState<Node[]>([]);
  const [note, setNote] = useState<{ path: string; kind: 'text' | 'image' | 'video'; content?: string; url?: string } | null>(null);
  const [unsupported, setUnsupported] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [root, setRoot] = useState<string>(() => localStorage.getItem('dsh-pwb:archive_root_v1') ?? '');
  const [roots, setRoots] = useState<string[]>([]);
  const [home, setHome] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [rootInput, setRootInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [reading, setReading] = useState(false);
  const [err, setErr] = useState('');
  const dir = stack[stack.length - 1] ?? '';

  const load = useCallback(async (d: string) => {
    setLoading(true);
    setErr('');
    try {
      const out = await rpc('personal-workbench/fs/list', { path: d, root: root || undefined });
      if (!out?.ok) throw new Error((out?.error as { message?: string })?.message ?? '读取失败');
      setEntries(((out.value as { entries?: Node[] })?.entries ?? []) as Node[]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : '读取失败');
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [rpc, root]);

  useEffect(() => { void load(dir); }, [dir, load, root]);

  useEffect(() => {
    void (async () => {
      const out = await rpc('personal-workbench/fs/roots/list', {});
      if (out?.ok) {
        const v = out.value as { roots: string[]; home: string };
        setRoots(v.roots);
        setHome(v.home);
      }
    })();
  }, [rpc]);

  useEffect(() => { localStorage.setItem('dsh-pwb:archive_root_v1', root); }, [root]);

  const enter = (n: Node) => {
    setUnsupported(null);
    setEditing(false);
    if (n.kind === 'dir') { setNote(null); setStack((s) => [...s, n.path]); return; }
    const ext = n.path.split('.').pop()?.toLowerCase() ?? '';
    const mediaKind = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif'].includes(ext) ? 'image'
      : ['mp4', 'm4v', 'webm', 'mov'].includes(ext) ? 'video' : null;
    if (mediaKind !== null) {
      // 图片/视频走流式 GET（无大小上限；视频 Range 分段可拖进度条）
      setNote({ path: n.path, kind: mediaKind, url: `${API_PREFIX}/fsfile?path=${encodeURIComponent(n.path)}${root ? `&root=${encodeURIComponent(root)}` : ''}` });
      return;
    }
    void (async () => {
      setReading(true);
      setErr('');
      setNote(null);
      setUnsupported(null);
      try {
        const out = await rpc('personal-workbench/fs/read', { path: n.path, root: root || undefined });
        if (!out?.ok) {
          const code = (out?.error as { code?: string })?.code ?? '';
          const msg = (out?.error as { message?: string })?.message ?? '读取失败';
          if (code === 'unsupported' || code === 'too-large') setUnsupported(msg);
          else throw new Error(msg);
        } else {
          const v = out.value as { path: string; kind: 'text'; content: string };
          setNote({ path: v.path, kind: 'text', content: v.content });
        }
      } catch (e) {
        setErr(e instanceof Error ? e.message : '读取失败');
      } finally {
        setReading(false);
      }
    })();
  };

  const pickRoot = async (): Promise<void> => {
    setErr('');
    const out = await rpc('personal-workbench/fs/roots/pick', {});
    if (!out?.ok) {
      const code = (out as { code?: string } | undefined)?.code;
      if (code !== 'cancelled') setErr('系统选择器不可用，可用下方输入路径方式添加');
      return;
    }
    const v = out.value as { path: string; roots: string[] };
    setRoots(v.roots);
    setRoot(v.path);
    setStack(['']);
    setNote(null);
    setPickerOpen(false);
  };

  const addRoot = async (): Promise<void> => {
    const path = rootInput.trim();
    if (path === '') return;
    const out = await rpc('personal-workbench/fs/roots/add', { path });
    if (!out?.ok) { setErr((out?.error as { message?: string })?.message ?? '添加失败'); return; }
    const added = (out.value as { roots: string[] }).roots;
    setRoots(added);
    const real = added.find((r) => r.endsWith('/' + path.split('/').pop()) || r === path) ?? path;
    setRoot(real);
    setRootInput('');
    setStack(['']);
    setNote(null);
    setPickerOpen(false);
  };

  const removeRoot = async (r: string): Promise<void> => {
    await rpc('personal-workbench/fs/roots/remove', { path: r });
    setRoots((prev) => prev.filter((x) => x !== r));
    if (root === r) { setRoot(''); setStack(['']); setNote(null); }
  };

  const saveNote = async (): Promise<void> => {
    if (note === null) return;
    setSaving(true);
    setErr('');
    try {
      const out = await rpc('personal-workbench/fs/write', { path: note.path, content: draft, root: root || undefined });
      if (!out?.ok) throw new Error((out?.error as { message?: string })?.message ?? '保存失败');
      setNote({ path: note.path, kind: 'text', content: draft });
      setEditing(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const openWithSystem = async (rel: string) => {
    const out = await rpc('personal-workbench/fs/open', { path: rel, root: root || undefined });
    if (!out?.ok) setErr((out?.error as { message?: string })?.message ?? '打开失败');
  };

  const crumbs = dir === '' ? [] : dir.split('/');
  const jump = (idx: number) => setStack((s) => s.slice(0, idx + 1));

  return (
    // 不挂 dsh-pwb-dark：本视图全部用 theme.ts 全局类（同知识库机制），避免 Tailwind 作用域化与变量污染
    <div className="dsh-pwb-view">
      <div className="dsh-pwb-toolbar">
        <span className="grid size-7 place-items-center rounded-lg bg-primary/15 text-primary"><Archive className="size-4" /></span>
        <span className="text-sm font-semibold text-white">{root === '' ? '主目录' : (root.split('/').pop() || root)}</span>
        <button type="button" className="dsh-pwb-btn dsh-pwb-btn-primary" onClick={() => void pickRoot()} title="弹出系统选择文件夹对话框">
          <FolderOpen className="size-3.5" /> {root === '' ? '选择文件夹' : '切换根目录'}
        </button>
        <button type="button" className="dsh-pwb-btn" onClick={() => setPickerOpen((v) => !v)} title="输入路径或管理已授权目录">
          管理目录
        </button>
        {root !== '' ? (
          <button type="button" className="dsh-pwb-btn" onClick={() => { setRoot(''); setStack(['']); setNote(null); }} title="回到主目录">
            <House className="size-3.5" /> 主目录
          </button>
        ) : null}
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

      {pickerOpen ? (
        <div className="dsh-pwb-almanac" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              className="dsh-pwb-input dsh-pwb-input-grow"
              style={{ flex: 1 }}
              value={rootInput}
              onChange={(e) => setRootInput(e.target.value)}
              placeholder="或直接输入绝对路径，如 /Users/yuze/Documents（点上方按钮可弹系统选择框）"
              onKeyDown={(e) => { if (e.key === 'Enter') void addRoot(); }}
            />
            <button type="button" className="dsh-pwb-btn dsh-pwb-btn-primary" onClick={() => void addRoot()}>添加并切换</button>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: 'var(--pwb-dimmer, #9aa0a6)' }}>已授权目录：</span>
            {roots.map((r) => (
              <span key={r} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 8px', borderRadius: 8, background: r === root ? 'var(--pwb-accent, #00b862)' : 'var(--pwb-card-hi, #f2f3f5)', color: r === root ? '#fff' : 'var(--pwb-text, #1c1c22)', fontSize: 11, cursor: 'pointer' }}>
                <button type="button" style={{ all: 'unset', cursor: 'pointer' }} onClick={() => { setRoot(r); setStack(['']); setNote(null); }}>
                  {r === home ? '主目录' : (r.split('/').pop() || r)}
                </button>
                {r !== home ? (
                  <button type="button" style={{ all: 'unset', cursor: 'pointer', opacity: 0.6 }} onClick={() => void removeRoot(r)} title="移除">
                    <X className="size-3" />
                  </button>
                ) : null}
              </span>
            ))}
          </div>
        </div>
      ) : null}

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
        <div className="dsh-pwb-split-list" style={{ padding: '8px 10px' }}>
          {dir !== '' ? (
            <button
              type="button"
              className="dsh-pwb-fs-row dsh-pwb-fs-back"
              onClick={() => setStack((s) => s.slice(0, -1))}
            >
              <ChevronRight className="size-4" style={{ transform: 'rotate(180deg)' }} /> 返回上级
            </button>
          ) : null}
          {entries.map((n) => (
            <button
              key={n.path}
              type="button"
              className="dsh-pwb-fs-row"
              onClick={() => enter(n)}
              title={n.kind === 'dir' ? '打开文件夹' : n.name}
            >
              {n.kind === 'dir' ? <Folder className="size-4 dsh-pwb-fs-dir" />
                : ['mp4', 'm4v', 'webm', 'mov'].includes((n.name.split('.').pop() ?? '').toLowerCase()) ? <Video className="size-4 dsh-pwb-fs-file" />
                : <FileText className="size-4 dsh-pwb-fs-file" />}
              <span className="dsh-pwb-fs-name">{n.name}</span>
              {n.kind === 'dir' && <ChevronRight className="size-3.5 dsh-pwb-fs-arrow" />}
            </button>
          ))}
          {!loading && entries.length === 0 ? <div className="dsh-pwb-empty">该目录暂无内容</div> : null}
        </div>

        {/* 右：预览 / 打开 */}
        <div className="dsh-pwb-split-main">
          {reading ? (
            <div className="grid h-full place-items-center"><Loader2 className="size-8 animate-spin text-white/30" /></div>
          ) : note !== null && editing ? (
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 8 }}>
              <div className="dsh-pwb-note-head" style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                <span className="min-w-0 truncate" title={note.path}>编辑中：{note.path}</span>
                <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                  <button type="button" className="dsh-pwb-btn" disabled={saving} onClick={() => { setDraft(note.content ?? ''); setEditing(false); }}>取消</button>
                  <button type="button" className="dsh-pwb-btn dsh-pwb-btn-primary" disabled={saving} onClick={() => void saveNote()}>{saving ? '保存中…' : '保存'}</button>
                </span>
              </div>
              <textarea
                className="dsh-pwb-pre"
                style={{ flex: 1, minHeight: 0, width: '100%', resize: 'none', whiteSpace: 'pre', outline: 'none', border: '1px solid var(--pwb-border, rgba(0,0,0,0.08))', borderRadius: 8, padding: 10, background: 'var(--pwb-card-hi, #f2f3f5)' }}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); void saveNote(); } }}
                autoFocus
              />
            </div>
          ) : note !== null ? (
            <>
              <div className="dsh-pwb-note-head" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className="min-w-0 truncate" title={note.path}>{note.path}</span>
                <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                  {note.kind === 'text' ? (
                    <button type="button" className="dsh-pwb-btn" onClick={() => { setDraft(note.content ?? ''); setEditing(true); }}>编辑</button>
                  ) : null}
                  <button type="button" className="dsh-pwb-btn" onClick={() => void openWithSystem(note.path)}>
                    <ExternalLink className="size-3.5" /> 用系统程序打开
                  </button>
                </span>
              </div>
              {note.kind === 'image' && note.url ? (
                <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'auto', background: 'var(--pwb-card-hi, #f2f3f5)', borderRadius: 10 }}>
                  <img src={note.url} alt={note.path} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                </div>
              ) : note.kind === 'video' && note.url ? (
                <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--pwb-card-hi, #f2f3f5)', borderRadius: 10 }}>
                  <video src={note.url} controls style={{ maxWidth: '100%', maxHeight: '100%' }} />
                </div>
              ) : (
                <pre className="dsh-pwb-pre">{note.content}</pre>
              )}
            </>
          ) : unsupported !== null ? (
            <div className="grid h-full place-items-center px-6 text-center">
              <div>
                <div className="text-xs text-white/60">{unsupported}</div>
                <button type="button" className="dsh-pwb-btn" style={{ marginTop: 10 }} onClick={() => void openWithSystem(crumbs.length > 0 ? `${crumbs.join('/')}` : '.')}>在访达中打开当前目录</button>
              </div>
            </div>
          ) : (
            <div style={{ display: 'grid', placeItems: 'center', height: '100%', padding: '0 24px', textAlign: 'center' }}>
              <div>
                <Archive className="size-10" style={{ margin: '0 auto', color: 'var(--pwb-dimmer, #9aa0a6)', opacity: 0.6 }} />
                <div style={{ marginTop: 12, fontSize: 12, color: 'var(--pwb-dim, #6b7280)' }}>从左侧选择目录或文件</div>
                <div style={{ marginTop: 4, fontSize: 10, color: 'var(--pwb-dimmer, #9aa0a6)' }}>文本与图片可直接预览 · 其他类型用系统程序打开</div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
