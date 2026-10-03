/**
 * 影视平台 —— 1:1 复刻原版 Yuze-影视 首页形态 + 磁力猫片库播放链路：
 * · 首页（原版 page.jsx 形态）：Hero 搜索框 + 电影/电视剧切换 + 标签 chips + 豆瓣热门网格（分页圆钮）+ 继续观看
 * · 豆瓣榜单 = Host 代理 cmliussss 镜像（原版同源，1h 缓存）；点片 = 片名搜索片库
 * · 搜索/分类/详情/播放 = 磁力猫 CF 索引 + SCF 直连 + MP4 直链（picovr 防盗链：全局 no-referrer）
 * · 收藏/历史 = localStorage（带线路+集数位置，恢复直达该集）；顶栏历史/收藏下拉（原版 Navbar 形态）
 * 不造假：无内置假数据，全部来自豆瓣/片库接口；拉不到显示空态。
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import type { ReactElement } from 'react';
import { Search as SearchIcon, Heart, History, Loader2, ChevronLeft, ChevronRight, Play, ArrowLeft, Trash2, X, Clock } from 'lucide-react';
import type { RpcFn } from '../rpc.js';

type VideoBrief = { id: string; name: string; pic?: string | undefined; remarks?: string | undefined; typeName?: string | undefined; year?: string | undefined };
type DoubanSubject = { title: string; rate: string; cover?: string | undefined };
type VideoDetail = { id: string; name: string; pic?: string; year?: string; typeName?: string; actor?: string; director?: string; content?: string; remarks?: string; lines: Array<{ name: string; episodes: Array<{ name: string; url: string }> }> };

type RecItem = { id: string; name: string; pic?: string | undefined; remarks?: string | undefined; lineIdx: number; epIdx: number; lineName: string; epName: string };
const FAV_KEY = 'dsh-pwb:video_favorites_v2';
const HIST_KEY = 'dsh-pwb:video_history_v2';

type Route =
  | { page: 'home' }
  | { page: 'search' }
  | { page: 'detail'; id: string; brief?: VideoBrief | undefined }
  | { page: 'play'; id: string; lineIdx: number; epIdx: number };

type VideoSession = { route: Route; results: VideoBrief[]; query: string };
const gSession: VideoSession = { route: { page: 'home' }, results: [], query: '' };

const MOVIE_TAGS = ['华语', '热门', '最新', '经典', '豆瓣高分', '冷门佳片', '欧美', '韩国', '日本', '动作', '喜剧', '爱情', '科幻', '悬疑', '恐怖', '治愈'];
const TV_TAGS = ['国产剧', '热门', '美剧', '英剧', '韩剧', '日剧', '港剧', '日本动画', '综艺', '纪录片'];
const PAGE_SIZE = 12;

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

/** 海报卡：2:3 竖版；豆瓣片带评分角标，片库片带备注条。 */
function PosterCard({ name, pic, sub, rate, onClick }: { name: string; pic?: string | undefined; sub?: string | undefined; rate?: string | undefined; onClick: () => void }): ReactElement {
  return (
    <button type="button" className="dsh-pwb-vd-card" title={name} onClick={onClick}>
      <span className="dsh-pwb-vd-thumb">
        {pic !== undefined && pic !== '' ? <img src={pic} alt="" loading="lazy" /> : <span className="dsh-pwb-vd-thumb-dummy"><Play className="size-6" /></span>}
        {rate !== undefined && rate !== '' && rate !== '0' ? <i className="dsh-pwb-vd-rate">{rate}</i> : null}
        {sub !== undefined && sub !== '' ? <i className="dsh-pwb-vd-remarks">{sub}</i> : null}
      </span>
      <b>{name}</b>
    </button>
  );
}

export function VideoModuleView({ rpc }: { rpc: RpcFn }): ReactElement {
  const [route, setRoute] = useState<Route>(gSession.route);
  // 搜索历史（localStorage，最新在前、去重、上限 10 条）
  const VH_KEY = 'dsh-pwb:video_search_history_v1';
  const loadVh = (): string[] => { try { const a = JSON.parse(localStorage.getItem(VH_KEY) ?? '[]') as unknown; return Array.isArray(a) ? a.filter((x): x is string => typeof x === 'string') : []; } catch { return []; } };
  const [vhOpen, setVhOpen] = useState(false);
  const [vhList, setVhList] = useState<string[]>(loadVh);
  const vhRef = useRef<HTMLDivElement | null>(null);
  const saveVh = (list: string[]): void => { setVhList(list); try { localStorage.setItem(VH_KEY, JSON.stringify(list)); } catch { /* 忽略 */ } };
  const pushVh = (q: string): void => saveVh([q, ...vhList.filter((x) => x !== q)].slice(0, 10));
  const removeVh = (q: string): void => saveVh(vhList.filter((x) => x !== q));
  const [query, setQuery] = useState(gSession.query);
  const [results, setResults] = useState<VideoBrief[]>(gSession.results);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  // 首页（原版形态）
  const [mediaType, setMediaType] = useState<'movie' | 'tv'>('movie');
  const [tag, setTag] = useState('华语');
  const [page, setPage] = useState(0);
  const [douban, setDouban] = useState<DoubanSubject[] | null>(null);
  const [doubanLoading, setDoubanLoading] = useState(false);
  // 详情/播放
  const [detail, setDetail] = useState<VideoDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailErr, setDetailErr] = useState('');
  const [curLine, setCurLine] = useState(0);
  const [curEp, setCurEp] = useState(0);
  // 收藏/历史 + 下拉
  const [favorites, setFavorites] = useState<RecItem[]>(() => loadList(FAV_KEY));
  const [history, setHistory] = useState<RecItem[]>(() => loadList(HIST_KEY));
  const [dropOpen, setDropOpen] = useState<'history' | 'favorites' | null>(null);
  const dropRef = useRef<HTMLDivElement | null>(null);

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

  // 下拉点外关闭
  useEffect(() => {
    if (dropOpen === null) return;
    const onDown = (e: MouseEvent): void => {
      if (dropRef.current !== null && !dropRef.current.contains(e.target as Node)) setDropOpen(null);
      if (vhRef.current !== null && !vhRef.current.contains(e.target as Node)) setVhOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [dropOpen]);

  // 豆瓣榜单（原版 fetchRecommendations 同参数）
  useEffect(() => {
    if (route.page !== 'home') return;
    let disposed = false;
    setDoubanLoading(true);
    void rpc('personal-workbench/video/douban', { type: mediaType, tag, pageLimit: PAGE_SIZE, pageStart: page * PAGE_SIZE }).then((res) => {
      if (disposed) return;
      if (res?.ok) setDouban((res.value as { subjects: DoubanSubject[] }).subjects);
      else setDouban([]);
      setDoubanLoading(false);
    }).catch(() => { if (!disposed) { setDouban([]); setDoubanLoading(false); } });
    return () => { disposed = true; };
  }, [rpc, mediaType, tag, page, route.page]);

  const doSearch = (kw: string): void => {
    const q = kw.trim();
    if (q === '') return;
    setLoading(true); setErr(''); setDropOpen(null); setVhOpen(false);
    pushVh(q);
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

  // 详情（detail/play 共用：play 恢复时也能拉回线路数据）
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

  const openDetail = (item: VideoBrief): void => { setDropOpen(null); go({ page: 'detail', id: item.id, brief: item }); };
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

  // ── 播放页 ──
  const renderPlay = (): ReactElement => {
    const line = detail?.lines[curLine];
    const ep = line?.episodes[curEp];
    const total = line?.episodes.length ?? 0;
    return (
      <div className="dsh-pwb-vd-play">
        <button type="button" className="dsh-pwb-vd-backbtn" onClick={() => { if (detail !== null) go({ page: 'detail', id: detail.id }); else go({ page: 'home' }); }}><ArrowLeft className="size-4" /> 返回详情</button>
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
        <button type="button" className="dsh-pwb-vd-backbtn" onClick={() => go({ page: 'home' })}><ArrowLeft className="size-4" /> 返回首页</button>
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

  // ── 首页（原版形态） ──
  const renderHome = (): ReactElement => {
    const tags = mediaType === 'movie' ? MOVIE_TAGS : TV_TAGS;
    const hasPrev = page > 0;
    const hasNext = douban !== null && douban.length >= PAGE_SIZE;
    return (
      <div className="dsh-pwb-vd-home">
        {/* 标签 chips（原版分类横条） */}
        <div className="dsh-pwb-vd-tags">
          {tags.map((tg) => (
            <button key={tg} type="button" className={`dsh-pwb-vd-tag${tg === tag ? ' on' : ''}`}
              onClick={() => { setTag(tg); setPage(0); }}>{tg}</button>
          ))}
        </div>

        {/* 豆瓣热门网格 + 分页圆钮（原版 Popular Section） */}
        <div className="dsh-pwb-vd-sechead">
          <h2><span className="dsh-pwb-vd-bar" /> 豆瓣热门 - {tag}</h2>
          <div className="dsh-pwb-vd-pager">
            <button type="button" className="dsh-pwb-vd-pagebtn" disabled={!hasPrev} title="上一页" onClick={() => setPage(page - 1)}><ChevronLeft className="size-5" /></button>
            <button type="button" className="dsh-pwb-vd-pagebtn" disabled={!hasNext} title="下一页" onClick={() => setPage(page + 1)}><ChevronRight className="size-5" /></button>
          </div>
        </div>
        {doubanLoading ? (
          <div className="dsh-pwb-vd-grid"><div className="dsh-pwb-vd-empty"><Loader2 className="size-4 spin" /> 加载中…</div></div>
        ) : (douban ?? []).length === 0 ? (
          <div className="dsh-pwb-vd-empty">豆瓣榜单暂时不可用，稍后再试</div>
        ) : (
          <div className="dsh-pwb-vd-grid">
            {(douban ?? []).map((s) => (
              <PosterCard key={s.title} name={s.title} pic={s.cover} rate={s.rate} onClick={() => doSearch(s.title)} />
            ))}
          </div>
        )}

        {/* 继续观看（原版 ContinueWatching） */}
        {history.length > 0 ? (
          <div className="dsh-pwb-vd-block">
            <h2><span className="dsh-pwb-vd-bar" /> 继续观看</h2>
            <div className="dsh-pwb-vd-row">
              {history.slice(0, 12).map((rec) => (
                <span key={rec.id} className="dsh-pwb-vd-cardwrap">
                  <PosterCard name={rec.name} pic={rec.pic} sub={rec.epName !== '' ? `${rec.lineName} · ${rec.epName}` : undefined} onClick={() => go({ page: 'play', id: rec.id, lineIdx: rec.lineIdx, epIdx: rec.epIdx })} />
                </span>
              ))}
            </div>
          </div>
        ) : null}

      </div>
    );
  };

  // ── 搜索结果 ──
  const renderSearch = (): ReactElement => (
    <div className="dsh-pwb-vd-dv">
      <div className="dsh-pwb-vd-sechead">
        <h2><span className="dsh-pwb-vd-bar" /> 搜索结果{results.length > 0 ? <span className="dsh-pwb-vd-count">　{results.length} 部</span> : null}</h2>
        <button type="button" className="dsh-pwb-vd-backbtn" onClick={() => go({ page: 'home' })}><ArrowLeft className="size-4" /> 返回首页</button>
      </div>
      {results.length === 0 ? (
        <div className="dsh-pwb-vd-empty">{err !== '' ? err : (loading ? <><Loader2 className="size-4 spin" /> 搜索中…</> : `没有找到「${query}」相关影片`)}</div>
      ) : (
        <div className="dsh-pwb-vd-grid">
          {results.map((it) => <PosterCard key={it.id} name={it.name} pic={it.pic} sub={it.remarks} onClick={() => openDetail(it)} />)}
        </div>
      )}
    </div>
  );

  // ── 收藏/历史下拉面板（原版 Navbar dropdown） ──
  const renderDrop = (kind: 'history' | 'favorites'): ReactElement => {
    const list = kind === 'history' ? history : favorites;
    return (
      <div className="dsh-pwb-vd-drop">
        <div className="dsh-pwb-vd-drophead">
          <b>{kind === 'history' ? '观看历史' : '我的收藏'}</b>
          {list.length > 0 ? (
            <button type="button" className="dsh-pwb-vd-dropclear" onClick={() => {
              if (kind === 'history') { setHistory([]); saveList(HIST_KEY, []); } else { setFavorites([]); saveList(FAV_KEY, []); }
            }}>清空全部</button>
          ) : null}
        </div>
        <div className="dsh-pwb-vd-droplist">
          {list.length === 0 ? (
            <div className="dsh-pwb-vd-empty">{kind === 'history' ? '暂无观看历史' : '暂无收藏影片'}</div>
          ) : list.map((rec) => (
            <div key={rec.id} className="dsh-pwb-vd-dropitem" onClick={() => { setDropOpen(null); go({ page: 'play', id: rec.id, lineIdx: rec.lineIdx, epIdx: rec.epIdx }); }}>
              <span className="dsh-pwb-vd-dropthumb">
                {rec.pic !== undefined && rec.pic !== '' ? <img src={rec.pic} alt="" loading="lazy" /> : <Play className="size-4" />}
                {kind === 'history' ? <i><span style={{ width: '60%' }} /></i> : null}
              </span>
              <span className="dsh-pwb-vd-dropmeta">
                <b>{rec.name}</b>
                <p>{rec.lineName}{rec.epName !== '' ? ` · ${rec.epName}` : ''}</p>
              </span>
              <button type="button" className="dsh-pwb-vd-dropremove" title="删除" onClick={(e) => {
                e.stopPropagation();
                if (kind === 'history') { const next = history.filter((x) => x.id !== rec.id); setHistory(next); saveList(HIST_KEY, next); }
                else { const next = favorites.filter((x) => x.id !== rec.id); setFavorites(next); saveList(FAV_KEY, next); }
              }}><Trash2 className="size-3.5" /></button>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderPage = (): ReactElement => {
    if (route.page === 'home') return renderHome();
    if (route.page === 'play') return renderPlay();
    if (route.page === 'detail') return renderDetail();
    return renderSearch();
  };

  return (
    <div className="dsh-pwb-vd-shell dsh-pwb-vd-shell-single">
      {/* 顶栏：标题区 + 历史/收藏下拉（原版 Navbar） */}
      <div className="dsh-pwb-vd-topnav">
        <div className="dsh-pwb-vd-actions" ref={dropRef}>
          <button type="button" className={`dsh-pwb-vd-roundbtn${dropOpen === 'history' ? ' on' : ''}`} title="观看历史" onClick={() => setDropOpen(dropOpen === 'history' ? null : 'history')}><History className="size-5" /></button>
          <button type="button" className={`dsh-pwb-vd-roundbtn${dropOpen === 'favorites' ? ' on' : ''}`} title="我的收藏" onClick={() => setDropOpen(dropOpen === 'favorites' ? null : 'favorites')}><Heart className="size-5" /></button>
          {dropOpen !== null ? renderDrop(dropOpen) : null}
        </div>
      </div>

      {/* Hero：大搜索框 + 三态切换（原版 SearchBox + media toggle） */}
      <div className="dsh-pwb-vd-hero">
        <div className="dsh-pwb-vd-herosearch">
          <div className="dsh-pwb-vd-vhwrap" ref={vhRef}>
            <input className="dsh-pwb-vd-search" value={query} onChange={(e) => setQuery(e.target.value)}
              onFocus={() => { if (vhList.length > 0) setVhOpen(true); }}
              onKeyDown={(e) => { if (e.key === 'Enter') doSearch(query); }} placeholder="搜索电影、剧集、短剧、动漫…" />
            {vhOpen && vhList.length > 0 ? (
              <div className="dsh-pwb-vd-vhpanel">
                <div className="dsh-pwb-vd-vhhead">
                  <span><Clock className="size-3.5" /> 搜索历史</span>
                  <button type="button" onClick={() => saveVh([])}>清空</button>
                </div>
                {vhList.map((h) => (
                  <div key={h} className="dsh-pwb-vd-vhitem" onMouseDown={(e) => { e.preventDefault(); setQuery(h); doSearch(h); }}>
                    <SearchIcon className="size-4" />
                    <span>{h}</span>
                    <button type="button" title="删除" onClick={(e) => { e.stopPropagation(); removeVh(h); }}><X className="size-3.5" /></button>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
          <button type="button" className="dsh-pwb-vd-searchbtn" disabled={loading || query.trim() === ''} onClick={() => doSearch(query)}>
            {loading ? <Loader2 className="size-4 spin" /> : <SearchIcon className="size-4" />} 搜索
          </button>
        </div>
        <div className="dsh-pwb-vd-toggle">
          <button type="button" className={`dsh-pwb-vd-togglebtn${mediaType === 'movie' ? ' on' : ''}`} onClick={() => { setMediaType('movie'); setTag('华语'); setPage(0); }}>电影</button>
          <span className="dsh-pwb-vd-togglesplit" />
          <button type="button" className={`dsh-pwb-vd-togglebtn${mediaType === 'tv' ? ' on' : ''}`} onClick={() => { setMediaType('tv'); setTag('国产剧'); setPage(0); }}>电视剧</button>
        </div>
      </div>

      <div className="dsh-pwb-vd-main">{renderPage()}</div>
    </div>
  );
}
