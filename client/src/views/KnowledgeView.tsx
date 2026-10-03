/**
 * 模块：知识库——本机 Obsidian Local REST API 的只读浏览器。
 * 目录下钻 / 笔记阅读 / 全文搜索；API key 由 Host 侧持有，浏览器拿不到。
 */
import { useCallback, useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import type { KbEntry, KbSearchHit } from '../../../src/contract.js';
import { t } from '../i18n.js';
import type { RpcFn } from '../rpc.js';
import { useKnowledge } from '../store.js';
import { clip } from '../util.js';

export function KnowledgeView({ rpc }: { rpc: RpcFn }): ReactElement {
  const kb = useKnowledge(rpc);
  const [dir, setDir] = useState('');
  const [entries, setEntries] = useState<KbEntry[]>([]);
  const [note, setNote] = useState<{ path: string; content: string } | null>(null);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<KbSearchHit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | undefined>(undefined);

  const loadDir = useCallback(
    async (target: string) => {
      setBusy(true);
      setErr(undefined);
      try {
        const out = await kb.list(target);
        setEntries(out.entries);
        setDir(target);
        setNote(null);
        setHits(null);
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
        setEntries([]);
      } finally {
        setBusy(false);
      }
    },
    [kb],
  );

  useEffect(() => {
    void loadDir('');
    // 进入模块加载一次；loadDir 引用已随 kb 稳定，无需纳入依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openNote = async (path: string): Promise<void> => {
    setBusy(true);
    setErr(undefined);
    try {
      const out = await kb.read(path);
      setNote({ path: out.path, content: out.content });
      setHits(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const runSearch = async (): Promise<void> => {
    const q = query.trim();
    if (q === '') {
      setHits(null);
      return;
    }
    setBusy(true);
    setErr(undefined);
    try {
      const out = await kb.search(q);
      setHits(out.hits);
      setNote(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setHits([]);
    } finally {
      setBusy(false);
    }
  };

  const crumbs = dir === '' ? [] : dir.split('/');
  const parent = crumbs.slice(0, -1).join('/');

  return (
    <div className="dsh-pwb-view">
      <div className="dsh-pwb-toolbar">
        <input
          className="dsh-pwb-input dsh-pwb-input-grow"
          placeholder={t('kb.searchPlaceholder')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void runSearch();
          }}
        />
        <button type="button" className="dsh-pwb-btn dsh-pwb-btn-primary" onClick={() => void runSearch()}>
          {t('kb.search')}
        </button>
        <button
          type="button"
          className="dsh-pwb-btn"
          onClick={() => {
            setQuery('');
            setHits(null);
            void loadDir('');
          }}
        >
          {t('kb.root')}
        </button>
      </div>

      <div className="dsh-pwb-crumbs">
        <button type="button" className="dsh-pwb-crumb" onClick={() => void loadDir('')}>
          {t('kb.vault')}
        </button>
        {crumbs.map((c, i) => (
          <span key={`${c}-${i}`} className="dsh-pwb-crumb-wrap">
            <span className="dsh-pwb-crumb-sep">/</span>
            <button
              type="button"
              className="dsh-pwb-crumb"
              onClick={() => void loadDir(crumbs.slice(0, i + 1).join('/'))}
            >
              {c}
            </button>
          </span>
        ))}
        {err !== undefined ? <span className="dsh-pwb-err">{err}</span> : null}
        {busy ? <span className="dsh-pwb-busy">{t('common.loading')}</span> : null}
      </div>

      <div className="dsh-pwb-split">
        <div className="dsh-pwb-split-list">
          {hits !== null ? (
            hits.length === 0 ? (
              <div className="dsh-pwb-empty">{t('kb.noHits')}</div>
            ) : (
              hits.map((h) => (
                <button key={h.path} type="button" className="dsh-pwb-row" onClick={() => void openNote(h.path)}>
                  <span className="dsh-pwb-row-title">{h.path}</span>
                  <span className="dsh-pwb-row-sub">{clip(h.snippet, 90)}</span>
                  <span className="dsh-pwb-row-meta">
                    {h.matches} {t('kb.matches')}
                  </span>
                </button>
              ))
            )
          ) : dir !== '' ? (
            <>
              <button type="button" className="dsh-pwb-row dsh-pwb-row-up" onClick={() => void loadDir(parent)}>
                <span className="dsh-pwb-row-title">↑ {t('kb.up')}</span>
              </button>
              {entries.map((e) => (
                <button
                  key={e.path}
                  type="button"
                  className="dsh-pwb-row"
                  onClick={() => (e.kind === 'dir' ? void loadDir(e.path) : void openNote(e.path))}
                >
                  <span className="dsh-pwb-row-title">
                    {e.kind === 'dir' ? '📁' : '📄'} {e.name}
                  </span>
                </button>
              ))}
            </>
          ) : entries.length === 0 && !busy ? (
            <div className="dsh-pwb-empty">{t('kb.offline')}</div>
          ) : (
            entries.map((e) => (
              <button
                key={e.path}
                type="button"
                className="dsh-pwb-row"
                onClick={() => (e.kind === 'dir' ? void loadDir(e.path) : void openNote(e.path))}
              >
                <span className="dsh-pwb-row-title">
                  {e.kind === 'dir' ? '📁' : '📄'} {e.name}
                </span>
              </button>
            ))
          )}
        </div>

        <div className="dsh-pwb-split-main">
          {note === null ? (
            <div className="dsh-pwb-empty">{t('kb.pick')}</div>
          ) : (
            <>
              <div className="dsh-pwb-note-head">{note.path}</div>
              <pre className="dsh-pwb-pre">{note.content}</pre>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
