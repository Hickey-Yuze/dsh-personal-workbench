/**
 * 影视平台 —— B 站正版内容单源（官方外链播放器）：
 * · 路由：发现影视（主页四板块）/ 搜索 / 播放详情 / 我的收藏 / 观看历史
 * · 播放 = player.bilibili.com 官方 iframe 外链（不解析视频流，不需要 key）
 * · 收藏 / 观看历史 = localStorage；路由与搜索态走全局会话，跨模块不断播
 * 不造假：无内置假数据，全部来自 B 站公开接口；某板块拉不到就显示「暂无推荐」。
 */
import { useState, useEffect } from 'react';
import type { ReactElement } from 'react';
import { Home, Search, Heart, History, Play, Loader2, X, Trash2 } from 'lucide-react';
import type { RpcFn } from '../rpc.js';

type VideoItem = { bvid: string; title: string; author: string; duration: string; pic?: string | undefined; play: number; description?: string | undefined };
type DiscoverBlock = { key: string; title: string; items: VideoItem[] };
type Route = { page: 'discover' } | { page: 'search' } | { page: 'play'; item: VideoItem } | { page: 'favorites' } | { page: 'history' };

const FAV_KEY = 'dsh-pwb:video_favorites_v1';
const HIST_KEY = 'dsh-pwb:video_history_v1';

type VideoSession = { route: Route; results: VideoItem[]; query: string; page: number; isEnd: boolean };
const gSession: VideoSession = { route: { page: 'discover' }, results: [], query: '', page: 1, isEnd: false };

function loadList(key: string): VideoItem[] {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return [];
    const v = JSON.parse(raw) as VideoItem[];
    return Array.isArray(v) ? v : [];
  } catch { return []; }
}
function saveList(key: string, list: VideoItem[]): void {
  try { localStorage.setItem(key, JSON.stringify(list.slice(0, 100))); } catch { /* 忽略 */ }
}
function fmtPlay(n: number): string {
  if (n >= 100000000) return `${(n / 100000000).toFixed(1)}亿`;
  if (n >= 10000) return `${(n / 10000).toFixed(1)}万`;
  return String(n);
}

/** 片卡：16:9 封面 + 时长角标 + 标题 + UP 主 + 播放量。 */
function VideoCard({ item, onOpen }: { item: VideoItem; onOpen: () => void }): ReactElement {
  return (
    <button type="button" className="dsh-pwb-vd-card" title={item.title} onClick={onOpen}>
      <span className="dsh-pwb-vd-thumb">
        {item.pic !== undefined && item.pic !== '' ? <img src={item.pic} alt="" loading="lazy" /> : <span className="dsh-pwb-vd-thumb-dummy"><Play className="size-6" /></span>}
        <i className="dsh-pwb-vd-dur">{item.duration}</i>
      </span>
      <b>{item.title}</b>
      <span className="dsh-pwb-vd-meta">{item.author} · {fmtPlay(item.play)}播放</span>
    </button>
  );
}

export function VideoModuleView({ rpc }: { rpc: RpcFn }): ReactElement {
  const [route, setRoute] = useState<Route>(gSession.route);
  const [query, setQuery] = useState(gSession.query);
  const [results, setResults] = useState<VideoItem[]>(gSession.results);
  const [page, setPage] = useState(gSession.page);
  const [isEnd, setIsEnd] = useState(gSession.isEnd);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [discover, setDiscover] = useState<DiscoverBlock[] | null>(null);
  const [discoverLoading, setDiscoverLoading] = useState(false);
  const [favorites, setFavorites] = useState<VideoItem[]>(() => loadList(FAV_KEY));
  const [history, setHistory] = useState<VideoItem[]>(() => loadList(HIST_KEY));
  const [related, setRelated] = useState<VideoItem[] | null>(null);

  const go = (r: Route): void => { setRoute(r); gSession.route = r; };

  // ── 发现页数据 ──
  useEffect(() => {
    let disposed = false;
    setDiscoverLoading(true);
    void rpc('personal-workbench/video/discover', {}).then((res) => {
      if (disposed) return;
      if (res?.ok) setDiscover((res.value as { blocks: DiscoverBlock[] }).blocks);
      setDiscoverLoading(false);
    }).catch(() => { if (!disposed) setDiscoverLoading(false); });
    return () => { disposed = true; };
  }, [rpc]);

  // ── 搜索（page 1 或追加） ──
  const doSearch = (q: string, p: number): void => {
    const kw = q.trim();
    if (kw === '') return;
    setLoading(true); setErr('');
    void (async () => {
      const out = await rpc('personal-workbench/video/search', { q: kw, page: p });
      setLoading(false);
      if (!out?.ok) { setErr((out?.error as { message?: string })?.message ?? '搜索失败'); return; }
      const items = (out.value as { items: VideoItem[] }).items;
      gSession.query = kw; gSession.page = p; gSession.isEnd = items.length < 10;
      setQuery(kw); setPage(p); setIsEnd(items.length < 10);
      if (p === 1) { setResults(items); gSession.results = items; } else { setResults((prev) => { const next = [...prev, ...items]; gSession.results = next; return next; }); }
      go({ page: 'search' });
    })();
  };

  // ── 打开播放页：记录历史 + 拉相关推荐 ──
  const openVideo = (item: VideoItem): void => {
    go({ page: 'play', item });
    setRelated(null);
    setHistory((prev) => {
      const next = [item, ...prev.filter((x) => x.bvid !== item.bvid)].slice(0, 100);
      saveList(HIST_KEY, next);
      return next;
    });
    const kw = item.title.slice(0, 14);
    void rpc('personal-workbench/video/search', { q: kw, page: 1 }).then((res) => {
      if (!res?.ok) return;
      const items = ((res.value as { items: VideoItem[] }).items ?? []).filter((x) => x.bvid !== item.bvid).slice(0, 8);
      setRelated(items);
    }).catch(() => { /* 相关推荐失败静默 */ });
  };

  const isFaved = (bvid: string): boolean => favorites.some((x) => x.bvid === bvid);
  const toggleFav = (item: VideoItem): void => {
    setFavorites((prev) => {
      const next = isFaved(item.bvid) ? prev.filter((x) => x.bvid !== item.bvid) : [item, ...prev].slice(0, 100);
      saveList(FAV_KEY, next);
      return next;
    });
  };

  // ── 播放页 ──
  const renderPlay = (item: VideoItem): ReactElement => (
    <div className="dsh-pwb-vd-play">
      <div className="dsh-pwb-vd-player">
        <iframe
          src={`https://player.bilibili.com/player.html?bvid=${item.bvid}&autoplay=1&danmaku=0&high_quality=1`}
          title={item.title} allowFullScreen allow="autoplay; fullscreen"
          referrerPolicy="no-referrer-when-downgrade" sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
        />
      </div>
      <div className="dsh-pwb-vd-playinfo">
        <h1>{item.title}</h1>
        <p>{item.author} · {fmtPlay(item.play)}播放 · {item.duration}</p>
        <div className="dsh-pwb-vd-playacts">
          <button type="button" className={`dsh-pwb-vd-favbtn${isFaved(item.bvid) ? ' on' : ''}`} onClick={() => toggleFav(item)}>
            <Heart className="size-4" fill={isFaved(item.bvid) ? 'currentColor' : 'none'} /> {isFaved(item.bvid) ? '已收藏' : '收藏'}
          </button>
          <button type="button" className="dsh-pwb-vd-favbtn" onClick={() => go(gSession.results.length > 0 ? { page: 'search' } : { page: 'discover' })}><X className="size-4" /> 关闭</button>
        </div>
        {item.description !== undefined && item.description !== '' ? <div className="dsh-pwb-vd-desc">{item.description}</div> : null}
      </div>
      <div className="dsh-pwb-vd-rel">
        <h2>相关推荐</h2>
        {related === null ? (
          <div className="dsh-pwb-vd-empty"><Loader2 className="size-4 spin" /> 加载中…</div>
        ) : related.length === 0 ? (
          <div className="dsh-pwb-vd-empty">暂无相关推荐</div>
        ) : (
          <div className="dsh-pwb-vd-grid">
            {related.map((it) => <VideoCard key={it.bvid} item={it} onOpen={() => openVideo(it)} />)}
          </div>
        )}
      </div>
    </div>
  );

  // ── 发现页 ──
  const renderDiscover = (): ReactElement => (
    <div className="dsh-pwb-vd-dv">
      {discoverLoading && discover === null ? (
        <div className="dsh-pwb-vd-empty"><Loader2 className="size-4 spin" /> 正在获取影视内容…</div>
      ) : null}
      {(discover ?? []).map((block) => (
        <div className="dsh-pwb-vd-block" key={block.key}>
          <h2>{block.title}</h2>
          {block.items.length === 0 ? (
            <div className="dsh-pwb-vd-empty">暂无推荐</div>
          ) : (
            <div className="dsh-pwb-vd-row">
              {block.items.map((it) => <VideoCard key={it.bvid} item={it} onOpen={() => openVideo(it)} />)}
            </div>
          )}
        </div>
      ))}
      {!discoverLoading && (discover ?? []).length === 0 ? <div className="dsh-pwb-vd-empty">内容源暂时不可用，稍后再试</div> : null}
    </div>
  );

  // ── 收藏/历史页 ──
  const renderList = (title: string, list: VideoItem[], empty: string, onClear?: () => void): ReactElement => (
    <div className="dsh-pwb-vd-dv">
      <div className="dsh-pwb-vd-listhead">
        <h2>{title} {list.length > 0 ? <span className="dsh-pwb-vd-count">{list.length} 部</span> : null}</h2>
        {onClear !== undefined && list.length > 0 ? (
          <button type="button" className="dsh-pwb-vd-clear" onClick={onClear}><Trash2 className="size-3.5" /> 清空</button>
        ) : null}
      </div>
      {list.length === 0 ? (
        <div className="dsh-pwb-vd-empty">{empty}</div>
      ) : (
        <div className="dsh-pwb-vd-grid">
          {list.map((it) => (
            <span key={it.bvid} className="dsh-pwb-vd-cardwrap">
              <VideoCard item={it} onOpen={() => openVideo(it)} />
              <button type="button" className="dsh-pwb-vd-remove" title={title === '我的收藏' ? '取消收藏' : '从历史移除'}
                onClick={() => {
                  const next = list.filter((x) => x.bvid !== it.bvid);
                  if (title === '我的收藏') { setFavorites(next); saveList(FAV_KEY, next); } else { setHistory(next); saveList(HIST_KEY, next); }
                }}><Trash2 className="size-3.5" /></button>
            </span>
          ))}
        </div>
      )}
    </div>
  );

  const renderPage = (): ReactElement => {
    if (route.page === 'discover') return renderDiscover();
    if (route.page === 'play') return renderPlay(route.item);
    if (route.page === 'favorites') return renderList('我的收藏', favorites, '还没有收藏影片\n在播放页点收藏加入', () => { setFavorites([]); saveList(FAV_KEY, []); });
    if (route.page === 'history') return renderList('观看历史', history, '还没有观看记录', () => { setHistory([]); saveList(HIST_KEY, []); });
    return (
      <div className="dsh-pwb-vd-dv">
        <h2>搜索结果{results.length > 0 ? <span className="dsh-pwb-vd-count">{results.length} 条</span> : null}</h2>
        {results.length === 0 ? (
          <div className="dsh-pwb-vd-empty">{err !== '' ? err : '在上方搜索框输入片名或关键词\n检索 B 站正版影视内容'}</div>
        ) : (
          <>
            <div className="dsh-pwb-vd-grid">
              {results.map((it) => <VideoCard key={it.bvid} item={it} onOpen={() => openVideo(it)} />)}
            </div>
            {!isEnd ? (
              <div className="dsh-pwb-vd-more">
                <button type="button" className="dsh-pwb-vd-morebtn" disabled={loading} onClick={() => doSearch(query, page + 1)}>
                  {loading ? <Loader2 className="size-4 spin" /> : null} 加载更多
                </button>
              </div>
            ) : null}
          </>
        )}
      </div>
    );
  };

  const navItems = [
    { key: 'discover', label: '发现影视', icon: <Home className="size-4" />, active: route.page === 'discover', onClick: () => go({ page: 'discover' }) },
    { key: 'search', label: '搜索影视', icon: <Search className="size-4" />, active: route.page === 'search', onClick: () => go({ page: 'search' }) },
    { key: 'favorites', label: '我的收藏', icon: <Heart className="size-4" />, active: route.page === 'favorites', onClick: () => go({ page: 'favorites' }) },
    { key: 'history', label: '观看历史', icon: <History className="size-4" />, active: route.page === 'history', onClick: () => go({ page: 'history' }) },
  ];

  return (
    <div className="dsh-pwb-vd-shell">
      <div className="dsh-pwb-vd-sidebar">
        <div className="dsh-pwb-vd-nav">
          {navItems.map((item) => (
            <button key={item.key} type="button" className={`dsh-pwb-vd-navitem${item.active ? ' dsh-pwb-vd-nav-active' : ''}`} onClick={item.onClick}>
              {item.icon} {item.label}
            </button>
          ))}
        </div>
      </div>
      <div className="dsh-pwb-vd-body">
        <div className="dsh-pwb-vd-topbar">
          <input className="dsh-pwb-vd-search" value={query} onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') doSearch(query, 1); }} placeholder="搜索电影、剧集、动漫、纪录片…" />
          <button type="button" className="dsh-pwb-vd-searchbtn" disabled={loading || query.trim() === ''} onClick={() => doSearch(query, 1)}>
            {loading ? <Loader2 className="size-4 spin" /> : <Search className="size-4" />} 搜索
          </button>
        </div>
        <div className="dsh-pwb-vd-page">{renderPage()}</div>
      </div>
    </div>
  );
}
