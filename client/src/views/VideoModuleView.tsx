/**
 * 影视平台 —— 对接 Yuze-影视 磁力猫片库（橘汁 172K+，苹果 CMS 协议）：
 * · 搜索/分类 = CF adapter 本地静态索引（yuze-yingshi-jiekou.pages.dev，秒回）
 * · 详情/直链 = SCF 直连（境内出口免风控，实测 2s）→ 磁力猫多入口容灾
 * · 播放 = MP4 直链原生 <video>（picovr 防盗链：模块挂载期全局 no-referrer）
 * · 页面：发现影视（分类板块）/ 搜索 / 分类浏览 / 详情（线路+集数）/ 播放 / 收藏 / 历史
 * · 收藏与历史保存「线路+集数」位置，恢复时直达该集
 * 不造假：无内置假数据，全部来自片库接口；板块拉不到显示「暂无推荐」。
 */
import { useState, useEffect, useCallback } from 'react';
import type { ReactElement } from 'react';
import { Home, Search, Heart, History, Loader2, ChevronLeft, ChevronRight, Play, ArrowLeft } from 'lucide-react';
import type { RpcFn } from '../rpc.js';

type VideoBrief = { id: string; name: string; pic?: string | undefined; remarks?: string | undefined; typeName?: string | undefined; year?: string | undefined };
type VideoDetail = { id: string; name: string; pic?: string; year?: string; typeName?: string; actor?: string; director?: string; content?: string; remarks?: string; lines: Array<{ name: string; episodes: Array<{ name: string; url: string }> }> };
type DiscoverBlock = { key: string; title: string; items: VideoBrief[]; t?: string | undefined };

type RecItem = { id: string; name: string; pic?: string | undefined; remarks?: string | undefined; lineIdx: number; epIdx: number; lineName: string; epName: string };
const FAV_KEY = 'dsh-pwb:video_favorites_v2';
const HIST_KEY = 'dsh-pwb:video_history_v2';

type Route =
  | { page: 'discover' }
  | { page: 'search' }
  | { page: 'category'; t: string; title: string; pg: number }
  | { page: 'detail'; id: string; brief?: VideoBrief | undefined }
  | { page: 'play'; id: string; lineIdx: number; epIdx: number }
  | { page: 'favorites' }
  | { page: 'history' };

type VideoSession = { route: Route; results: VideoBrief[]; query: string };
const gSession: VideoSession = { route: { page: 'discover' }, results: [], query: '' };

function loadList(key: string): RecItem[] {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return [];
    const v = JSON.parse(raw) as RecItem[];
    return Array.isArray(v) ? v : [];
  } catch { return []; }
}
function saveList(key: string, list: RecItem[]): void {
  try { localStorage.setItem(key, JSON.stringify(list.slice(0, 100))); } catch { /* 忽略 */ }
}

/** 海报卡：2:3 竖版 + 备注（更新至X集/已完结）角标。 */
function PosterCard({ item, onOpen }: { item: VideoBrief; onOpen: () => void }): ReactElement {
  return (
    <button type="button" className="dsh-pwb-vd-card" title={item.name} onClick={onOpen}>
      <span className="dsh-pwb-vd-thumb">
        {item.pic !== undefined && item.pic !== '' ? <img src={item.pic} alt="" loading="lazy" /> : <span className="dsh-pwb-vd-thumb-dummy"><Play className="size-6" /></span>}
        {item.remarks !== undefined && item.remarks !== '' ? <i className="dsh-pwb-vd-remarks">{item.remarks}</i> : null}
      </span>
      <b>{item.name}</b>
      <span className="dsh-pwb-vd-meta">{[item.typeName, item.year].filter(Boolean).join(' · ')}</span>
    </button>
  );
}

export function VideoModuleView({ rpc }: { rpc: RpcFn }): ReactElement {
  const [route, setRoute] = useState<Route>(gSession.route);
  const [query, setQuery] = useState(gSession.query);
  const [results, setResults] = useState<VideoBrief[]>(gSession.results);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [discover, setDiscover] = useState<DiscoverBlock[] | null>(null);
  const [discoverLoading, setDiscoverLoading] = useState(false);
  const [catItems, setCatItems] = useState<VideoBrief[]>([]);
  const [catPage, setCatPage] = useState(1);
  const [catPageCount, setCatPageCount] = useState(1);
  const [catLoading, setCatLoading] = useState(false);
  const [detail, setDetail] = useState<VideoDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailErr, setDetailErr] = useState('');
  const [curLine, setCurLine] = useState(0);
  const [curEp, setCurEp] = useState(0);
  const [favorites, setFavorites] = useState<RecItem[]>(() => loadList(FAV_KEY));
  const [history, setHistory] = useState<RecItem[]>(() => loadList(HIST_KEY));

  const go = useCallback((r: Route): void => { setRoute(r); gSession.route = r; }, []);

  // picovr/豆瓣图防盗链：模块挂载期全局 no-referrer，卸载恢复
  useEffect(() => {
    const prev = document.querySelector('meta[name="referrer"]');
    const prevContent = prev?.getAttribute('content') ?? '';
    prev?.remove();
    const m = document.createElement('meta');
    m.name = 'referrer';
    m.content = 'no-referrer';
    document.head.appendChild(m);
    return () => {
      m.remove();
      if (prevContent !== '') {
        const r = document.createElement('meta');
        r.name = 'referrer';
        r.content = prevContent;
        document.head.appendChild(r);
      }
    };
  }, []);

  // 发现页板块
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

  // 搜索
  const doSearch = (kw: string): void => {
    const q = kw.trim();
    if (q === '') return;
    setLoading(true); setErr('');
    void (async () => {
      const out = await rpc('personal-workbench/video/search', { q });
      setLoading(false);
      if (!out?.ok) { setErr((out?.error as { message?: string })?.message ?? '搜索失败'); return; }
      const items = (out.value as { items: VideoBrief[] }).items;
      gSession.query = q; gSession.results = items;
      setQuery(q); setResults(items);
      go({ page: 'search' });
    })();
  };

  // 分类浏览
  const loadCategory = useCallback((t: string, pg: number): void => {
    setCatLoading(true);
    void (async () => {
      const out = await rpc('personal-workbench/video/category', { t, pg });
      setCatLoading(false);
      if (!out?.ok) { setErr((out?.error as { message?: string })?.message ?? '加载失败'); return; }
      const v = out.value as { items: VideoBrief[]; pagecount: number };
      setCatItems(v.items); setCatPage(pg); setCatPageCount(Math.max(1, v.pagecount));
    })();
  }, [rpc]);

  // 详情（detail/play 页共用：play 恢复时也能拉回线路数据）
  useEffect(() => {
    if (route.page !== 'detail' && route.page !== 'play') return;
    const id = route.id;
    if (detail?.id === id) {
      if (route.page === 'play') { setCurLine(Math.min(route.lineIdx, Math.max(0, detail.lines.length - 1))); setCurEp(route.epIdx); }
      return;
    }
    let disposed = false;
    setDetail(null); setDetailErr(''); setDetailLoading(true); setCurLine(0); setCurEp(0);
    void rpc('personal-workbench/video/detail', { id }).then((res) => {
      if (disposed) return;
      setDetailLoading(false);
      if (!res?.ok) { setDetailErr((res?.error as { message?: string })?.message ?? '详情获取失败'); return; }
      const v = (res.value as Omit<VideoDetail, 'id'>);
      const d: VideoDetail = { ...v, id };
      setDetail(d);
      if (route.page === 'play') {
        const li = Math.min(route.lineIdx, Math.max(0, d.lines.length - 1));
        setCurLine(li);
        setCurEp(Math.min(route.epIdx, Math.max(0, (d.lines[li]?.episodes.length ?? 1) - 1)));
      }
    }).catch(() => { if (!disposed) { setDetailLoading(false); setDetailErr('详情获取失败'); } });
    return () => { disposed = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.page, route.page === 'detail' || route.page === 'play' ? route.id : '']);

  const openDetail = (item: VideoBrief): void => { go({ page: 'detail', id: item.id, brief: item }); };
  const openPlay = (lineIdx: number, epIdx: number): void => {
    if (detail === null) return;
    const line = detail.lines[lineIdx];
    const ep = line?.episodes[epIdx];
    go({ page: 'play', id: detail.id, lineIdx, epIdx });
    if (line !== undefined && ep !== undefined) {
      const rec: RecItem = { id: detail.id, name: detail.name, pic: detail.pic, remarks: detail.remarks, lineIdx, epIdx, lineName: line.name, epName: ep.name };
      setHistory((prev) => {
        const next = [rec, ...prev.filter((x) => x.id !== rec.id)].slice(0, 100);
        saveList(HIST_KEY, next);
        return next;
      });
    }
  };
  const isFaved = (id: string): boolean => favorites.some((x) => x.id === id);
  const toggleFav = (): void => {
    if (detail === null) return;
    const line = detail.lines[curLine];
    const ep = line?.episodes[curEp];
    setFavorites((prev) => {
      const next = isFaved(detail.id)
        ? prev.filter((x) => x.id !== detail.id)
        : [{ id: detail.id, name: detail.name, pic: detail.pic, remarks: detail.remarks, lineIdx: curLine, epIdx: curEp, lineName: line?.name ?? '', epName: ep?.name ?? '' }, ...prev].slice(0, 100);
      saveList(FAV_KEY, next);
      return next;
    });
  };
  const resumeRec = (rec: RecItem): void => { go({ page: 'play', id: rec.id, lineIdx: rec.lineIdx, epIdx: rec.epIdx }); };

  // ── 播放页 ──
  const renderPlay = (): ReactElement => {
    const line = detail?.lines[curLine];
    const ep = line?.episodes[curEp];
    const total = line?.episodes.length ?? 0;
    return (
      <div className="dsh-pwb-vd-play">
        {detail === null ? (
          <div className="dsh-pwb-vd-empty">{detailLoading ? <><Loader2 className="size-4 spin" /> 正在获取播放信息…</> : (detailErr !== '' ? detailErr : '加载失败')}</div>
        ) : (
          <>
            <div className="dsh-pwb-vd-player">
              {ep !== undefined ? <video key={ep.url} src={ep.url} controls autoPlay playsInline /> : <div className="dsh-pwb-vd-empty">该线路暂无可播放的集数</div>}
            </div>
            <div className="dsh-pwb-vd-playinfo">
              <h1>{detail.name}{line !== undefined && ep !== undefined ? <span className="dsh-pwb-vd-count">　{line.name} · {ep.name}</span> : null}</h1>
              <div className="dsh-pwb-vd-playacts">
                <button type="button" className="dsh-pwb-vd-favbtn" disabled={curEp <= 0} onClick={() => openPlay(curLine, curEp - 1)}><ChevronLeft className="size-4" /> 上一集</button>
                <button type="button" className="dsh-pwb-vd-favbtn" disabled={curEp >= total - 1} onClick={() => openPlay(curLine, curEp + 1)}>下一集 <ChevronRight className="size-4" /></button>
                <button type="button" className={`dsh-pwb-vd-favbtn${isFaved(detail.id) ? ' on' : ''}`} onClick={toggleFav}>
                  <Heart className="size-4" fill={isFaved(detail.id) ? 'currentColor' : 'none'} /> {isFaved(detail.id) ? '已收藏' : '收藏'}
                </button>
                <button type="button" className="dsh-pwb-vd-favbtn" onClick={() => go({ page: 'detail', id: detail.id, brief: detail })}><ArrowLeft className="size-4" /> 返回详情</button>
              </div>
              {detail.lines.length > 1 ? (
                <div className="dsh-pwb-vd-linetabs">
                  {detail.lines.map((l, i) => (
                    <button key={l.name} type="button" className={`dsh-pwb-vd-linetab${i === curLine ? ' on' : ''}`} onClick={() => openPlay(i, 0)}>{l.name}</button>
                  ))}
                </div>
              ) : null}
              {line !== undefined ? (
                <div className="dsh-pwb-vd-eps">
                  {line.episodes.map((e, i) => (
                    <button key={`${e.name}-${i}`} type="button" className={`dsh-pwb-vd-ep${i === curEp ? ' on' : ''}`} onClick={() => openPlay(curLine, i)}>{e.name}</button>
                  ))}
                </div>
              ) : null}
            </div>
          </>
        )}
      </div>
    );
  };

  // ── 详情页 ──
  const renderDetail = (): ReactElement => {
    const routeBrief = route.page === 'detail' ? route.brief : undefined;
    if (detail === null) {
      return (
        <div className="dsh-pwb-vd-dv">
          {detailLoading || routeBrief !== undefined ? (
            <div className="dsh-pwb-vd-detailhead">
              {routeBrief?.pic !== undefined && routeBrief.pic !== '' ? <img className="dsh-pwb-vd-poster" src={routeBrief.pic} alt="" /> : <span className="dsh-pwb-vd-poster dsh-pwb-vd-thumb-dummy" />}
              <div className="dsh-pwb-vd-detailmeta">
                <h1>{routeBrief?.name ?? ''}</h1>
                <p>{detailLoading ? <><Loader2 className="size-4 spin" /> 正在获取详情与线路…</> : '加载中…'}</p>
              </div>
            </div>
          ) : <div className="dsh-pwb-vd-empty">{detailErr !== '' ? detailErr : '加载失败'}</div>}
        </div>
      );
    }
    return (
      <div className="dsh-pwb-vd-dv">
        <div className="dsh-pwb-vd-detailhead">
          {detail.pic !== undefined && detail.pic !== '' ? <img className="dsh-pwb-vd-poster" src={detail.pic} alt="" /> : <span className="dsh-pwb-vd-poster dsh-pwb-vd-thumb-dummy"><Play className="size-6" /></span>}
          <div className="dsh-pwb-vd-detailmeta">
            <h1>{detail.name}</h1>
            <p>{[detail.typeName, detail.year, detail.remarks].filter(Boolean).join(' · ')}</p>
            <div className="dsh-pwb-vd-playacts">
              <button type="button" className="dsh-pwb-vd-favbtn primary" onClick={() => openPlay(curLine, curEp)}><Play className="size-4" /> 立即播放</button>
              <button type="button" className={`dsh-pwb-vd-favbtn${isFaved(detail.id) ? ' on' : ''}`} onClick={toggleFav}>
                <Heart className="size-4" fill={isFaved(detail.id) ? 'currentColor' : 'none'} /> {isFaved(detail.id) ? '已收藏' : '收藏'}
              </button>
            </div>
            {detail.content !== undefined ? <div className="dsh-pwb-vd-desc">{detail.content}</div> : null}
            {detail.actor !== undefined && detail.actor !== '' ? <p className="dsh-pwb-vd-actor">主演：{detail.actor}</p> : null}
          </div>
        </div>
        <div className="dsh-pwb-vd-rel">
          <h2>播放线路（{detail.lines.length} 条可用）</h2>
          {detail.lines.length === 0 ? (
            <div className="dsh-pwb-vd-empty">该片暂无可播放线路</div>
          ) : (
            <>
              <div className="dsh-pwb-vd-linetabs">
                {detail.lines.map((l, i) => (
                  <button key={l.name} type="button" className={`dsh-pwb-vd-linetab${i === curLine ? ' on' : ''}`} onClick={() => setCurLine(i)}>
                    {l.name} <span className="dsh-pwb-vd-epcount">{l.episodes.length}集</span>
                  </button>
                ))}
              </div>
              <div className="dsh-pwb-vd-eps">
                {(detail.lines[curLine]?.episodes ?? []).map((e, i) => (
                  <button key={`${e.name}-${i}`} type="button" className={`dsh-pwb-vd-ep${i === curEp ? ' on' : ''}`} onClick={() => openPlay(curLine, i)}>{e.name}</button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    );
  };

  // ── 发现页 ──
  const renderDiscover = (): ReactElement => (
    <div className="dsh-pwb-vd-dv">
      {discoverLoading && discover === null ? <div className="dsh-pwb-vd-empty"><Loader2 className="size-4 spin" /> 正在获取片库内容…</div> : null}
      {(discover ?? []).map((block) => (
        <div className="dsh-pwb-vd-block" key={block.key}>
          <div className="dsh-pwb-vd-listhead">
            <h2>{block.title}</h2>
            {block.t !== undefined && block.items.length > 0 ? (
              <button type="button" className="dsh-pwb-vd-clear" onClick={() => { loadCategory(block.t ?? '20', 1); go({ page: 'category', t: block.t ?? '20', title: block.title, pg: 1 }); }}>更多 <ChevronRight className="size-3.5" /></button>
            ) : null}
          </div>
          {block.items.length === 0 ? (
            <div className="dsh-pwb-vd-empty">暂无推荐</div>
          ) : (
            <div className="dsh-pwb-vd-row">
              {block.items.map((it) => <PosterCard key={it.id} item={it} onOpen={() => openDetail(it)} />)}
            </div>
          )}
        </div>
      ))}
      {!discoverLoading && (discover ?? []).length === 0 ? <div className="dsh-pwb-vd-empty">片库暂时不可用，稍后再试</div> : null}
    </div>
  );

  // ── 分类/搜索/收藏/历史 ──
  const renderGrid = (list: VideoBrief[], onOpen: (it: VideoBrief) => void): ReactElement => (
    <div className="dsh-pwb-vd-grid">
      {list.map((it) => <PosterCard key={it.id} item={it} onOpen={() => onOpen(it)} />)}
    </div>
  );

  const renderPage = (): ReactElement => {
    if (route.page === 'discover') return renderDiscover();
    if (route.page === 'play') return renderPlay();
    if (route.page === 'detail') return renderDetail();
    if (route.page === 'category') {
      const t = route.t; const title = route.title;
      return (
        <div className="dsh-pwb-vd-dv">
          <div className="dsh-pwb-vd-listhead">
            <h2>{title}{catPageCount > 1 ? <span className="dsh-pwb-vd-count">　第 {catPage} / {catPageCount} 页</span> : null}</h2>
            <div className="dsh-pwb-vd-pager">
              <button type="button" className="dsh-pwb-vd-favbtn" disabled={catPage <= 1 || catLoading} onClick={() => { loadCategory(t, catPage - 1); go({ page: 'category', t, title, pg: catPage - 1 }); }}><ChevronLeft className="size-4" /> 上一页</button>
              <button type="button" className="dsh-pwb-vd-favbtn" disabled={catPage >= catPageCount || catLoading} onClick={() => { loadCategory(t, catPage + 1); go({ page: 'category', t, title, pg: catPage + 1 }); }}>下一页 <ChevronRight className="size-4" /></button>
            </div>
          </div>
          {catLoading ? <div className="dsh-pwb-vd-empty"><Loader2 className="size-4 spin" /> 加载中…</div> : catItems.length === 0 ? <div className="dsh-pwb-vd-empty">暂无内容</div> : renderGrid(catItems, openDetail)}
        </div>
      );
    }
    if (route.page === 'favorites') {
      return (
        <div className="dsh-pwb-vd-dv">
          <div className="dsh-pwb-vd-listhead">
            <h2>我的收藏 {favorites.length > 0 ? <span className="dsh-pwb-vd-count">{favorites.length} 部</span> : null}</h2>
            {favorites.length > 0 ? <button type="button" className="dsh-pwb-vd-clear" onClick={() => { setFavorites([]); saveList(FAV_KEY, []); }}>清空</button> : null}
          </div>
          {favorites.length === 0 ? <div className="dsh-pwb-vd-empty">还没有收藏影片\n在详情页点「收藏」加入</div> : renderGrid(favorites, (it) => openDetail(it))}
        </div>
      );
    }
    if (route.page === 'history') {
      return (
        <div className="dsh-pwb-vd-dv">
          <div className="dsh-pwb-vd-listhead">
            <h2>观看历史 {history.length > 0 ? <span className="dsh-pwb-vd-count">{history.length} 条</span> : null}</h2>
            {history.length > 0 ? <button type="button" className="dsh-pwb-vd-clear" onClick={() => { setHistory([]); saveList(HIST_KEY, []); }}>清空</button> : null}
          </div>
          {history.length === 0 ? <div className="dsh-pwb-vd-empty">还没有观看记录</div> : (
            <div className="dsh-pwb-vd-grid">
              {history.map((rec) => (
                <span key={rec.id} className="dsh-pwb-vd-cardwrap">
                  <PosterCard item={{ id: rec.id, name: rec.name, pic: rec.pic, remarks: rec.epName !== '' ? `${rec.lineName} · ${rec.epName}` : rec.remarks }} onOpen={() => resumeRec(rec)} />
                  <button type="button" className="dsh-pwb-vd-remove" title="从历史移除" onClick={() => { const next = history.filter((x) => x.id !== rec.id); setHistory(next); saveList(HIST_KEY, next); }}>×</button>
                </span>
              ))}
            </div>
          )}
        </div>
      );
    }
    // search
    return (
      <div className="dsh-pwb-vd-dv">
        <h2>搜索结果{results.length > 0 ? <span className="dsh-pwb-vd-count">{results.length} 部</span> : null}</h2>
        {results.length === 0 ? (
          <div className="dsh-pwb-vd-empty">{err !== '' ? err : (loading ? <><Loader2 className="size-4 spin" /> 搜索中…</> : '在上方搜索框输入片名\n检索 17 万+ 部影视片库')}</div>
        ) : renderGrid(results, openDetail)}
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
            onKeyDown={(e) => { if (e.key === 'Enter') doSearch(query); }} placeholder="搜索电影、剧集、短剧、动漫…" />
          <button type="button" className="dsh-pwb-vd-searchbtn" disabled={loading || query.trim() === ''} onClick={() => doSearch(query)}>
            {loading ? <Loader2 className="size-4 spin" /> : <Search className="size-4" />} 搜索
          </button>
        </div>
        <div className="dsh-pwb-vd-page">{renderPage()}</div>
      </div>
    </div>
  );
}
