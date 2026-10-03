/**
 * 音乐平台 —— UI 1:1 复刻 Yuze-音乐网站（侧边栏+主内容+底部播放栏+全屏播放器+播放队列浮层）：
 * · 路由：搜索 / 我的收藏 / 最近播放 / 歌单详情（参考页路由形态，数据源保持酷我单源）
 * · 收藏 = liked 歌单心形 toggle；最近播放 = recent 歌单（播歌自动前插）
 * · 底部播放栏：封面+歌曲信息｜播放模式(四态循环)/上下首/播放+进度条｜收藏/音质/音量/队列/全屏
 * · 全屏播放器：黑胶唱片（20s 旋转，暂停停）+ 伪频谱柱 + 歌词同步（点击跳播）
 * · 逻辑层复用：模块级音频单例跨模块不断播、全局会话恢复 UI、歌词三件套、歌单导入（Host 代理）
 * 不造假：无内置假歌与假歌词，全部来自在线搜索/导入。
 */
import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import type { CSSProperties, ReactElement } from 'react';
import {
  Play, Pause, SkipBack, SkipForward, Shuffle, Repeat, Repeat1, Heart,
  ListMusic, Music, Plus, Trash2, Search, Loader2, Download, Volume2, VolumeX,
  Maximize2, X, ListEnd, Disc3, Pencil, Import, ChevronDown, Home, ChevronLeft,
} from 'lucide-react';
import type { RpcFn } from '../rpc.js';

interface Song { id: string; title: string; artist: string; album: string; duration: number; audioUrl: string; coverUrl?: string }
interface Playlist { id: string; name: string; songs: Song[] }
interface LyricLine { time: number; text: string }
type QualityLevel = '128k' | '320k' | 'flac';
type Route = { page: 'discover' } | { page: 'singer'; name: string; coverUrl?: string | undefined } | { page: 'search' } | { page: 'favorites' } | { page: 'history' } | { page: 'playlist'; id: string };

const PLAYLISTS_KEY = 'dsh-pwb:music_playlists_v3';
const QUALITY_KEY = 'dsh-pwb:music_quality_v1';
const QUALITY_MAP: Record<QualityLevel, string> = { '128k': 'standard', '320k': 'exhigh', 'flac': 'lossless' };
const QUALITY_LABELS: Record<QualityLevel, string> = { '128k': '标准 128K', '320k': '高品质 320K', 'flac': '无损 FLAC' };

function kuwoPlayUrl(id: string, level: string): string {
  return `https://music.nxinxz.com/kw.php?id=${encodeURIComponent(id)}&level=${level}&type=mp3`;
}

// ── 全局播放会话（跨模块切换不中断）──
let persistentAudio: HTMLAudioElement | null = null;
function getAudio(): HTMLAudioElement {
  if (persistentAudio === null) {
    persistentAudio = new Audio();
    persistentAudio.volume = 0.7;
  }
  return persistentAudio;
}
interface GlobalSession {
  songId: string | null;
  onlineSong: Song | null;
  list: Song[];                 // 当前播放列表（队列）
  listLabel: string;
  route: Route;
  currentIndex: number;
  isPlaying: boolean;
  progress: number;
  volume: number;
  isMuted: boolean;
  quality: QualityLevel;
  playMode: 'order' | 'all' | 'one' | 'shuffle';
}
let gSession: GlobalSession = { songId: null, onlineSong: null, list: [], listLabel: '', route: { page: 'discover' }, currentIndex: 0, isPlaying: false, progress: 0, volume: 70, isMuted: false, quality: '128k', playMode: 'order' };

function fmtTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  return `${Math.floor(sec / 60)}:${Math.floor(sec % 60).toString().padStart(2, '0')}`;
}

function loadPlaylists(): Playlist[] {
  try {
    const raw = localStorage.getItem(PLAYLISTS_KEY);
    if (raw !== null) {
      const list = JSON.parse(raw) as Playlist[];
      if (Array.isArray(list)) return list;
    }
  } catch { /* 损坏则重建 */ }
  return [
    { id: 'liked', name: '我喜欢的音乐', songs: [] },
    { id: 'recent', name: '最近播放', songs: [] },
  ];
}

export function MusicModuleView({ rpc }: { rpc: RpcFn }): ReactElement {
  const [playlists, setPlaylists] = useState<Playlist[]>(loadPlaylists);
  const [route, setRoute] = useState<Route>(gSession.route);
  const [onlineQuery, setOnlineQuery] = useState('');
  const [onlineResults, setOnlineResults] = useState<Song[]>(gSession.route.page === 'search' ? gSession.list : []);
  // 发现页数据（Host 端点打包三板块；30 分钟内存缓存，前端仅存 state）
  const [discover, setDiscover] = useState<{ hot: Song[]; douyin: Song[]; singers: Array<{ name: string; coverUrl?: string; sample: { id: string; title: string; artist: string } | null }> } | null>(null);
  const [discoverLoading, setDiscoverLoading] = useState(false);
  const [singerData, setSingerData] = useState<{ name: string; songs: Song[] } | null>(null);
  const [singerLoading, setSingerLoading] = useState(false);
  // 黑胶正圆兜底：样式表带 !important 的规则会压过普通内联样式，用 setProperty important 级别强制
  const fsDiscRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = fsDiscRef.current;
    if (el === null) return;
    el.style.setProperty('border-radius', '50%', 'important');
    el.style.setProperty('width', '340px', 'important');
    el.style.setProperty('height', '340px', 'important');
    el.style.setProperty('corner-shape', 'round', 'important');
    el.querySelectorAll<HTMLElement>('img, span, i').forEach((c) => { c.style.setProperty('corner-shape', 'round', 'important'); c.style.setProperty('border-radius', '50%', 'important'); });
  }, []);
  const [singerError, setSingerError] = useState('');
  const [onlineLoading, setOnlineLoading] = useState(false);
  const [onlinePage, setOnlinePage] = useState(1);
  const [onlineIsEnd, setOnlineIsEnd] = useState(true);
  const [onlineTotal, setOnlineTotal] = useState(0);
  const [onlineError, setOnlineError] = useState('');

  const [current, setCurrent] = useState<Song | null>(gSession.onlineSong);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [audioDur, setAudioDur] = useState(0);
  const [volume, setVolume] = useState(gSession.volume);
  const [isMuted, setIsMuted] = useState(false);
  const [quality, setQuality] = useState<QualityLevel>(() => {
    try { return (localStorage.getItem(QUALITY_KEY) as QualityLevel | null) ?? '128k'; } catch { return '128k'; }
  });
  const [playMode, setPlayMode] = useState<'order' | 'all' | 'one' | 'shuffle'>(gSession.playMode);

  const [lyrics, setLyrics] = useState<LyricLine[]>([]);
  const [lyricsLoading, setLyricsLoading] = useState(false);
  const lyricsRef = useRef<HTMLDivElement>(null);
  const lyricsReqRef = useRef(0);
  const lyricsSongIdRef = useRef<string | null>(null);

  const [showQueue, setShowQueue] = useState(false);
  const [showFull, setShowFull] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [importLink, setImportLink] = useState('');
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState('');
  const [renameTarget, setRenameTarget] = useState<Playlist | null>(null);
  const [renameName, setRenameName] = useState('');
  const [err, setErr] = useState('');

  const savePlaylists = useCallback((list: Playlist[]): void => {
    setPlaylists(list);
    try { localStorage.setItem(PLAYLISTS_KEY, JSON.stringify(list)); } catch { /* 容量满忽略 */ }
  }, []);

  const lovedSongs = useMemo(() => playlists.find((p) => p.id === 'liked')?.songs ?? [], [playlists]);
  const recentSongs = useMemo(() => playlists.find((p) => p.id === 'recent')?.songs ?? [], [playlists]);
  const userPlaylists = useMemo(() => playlists.filter((p) => p.id !== 'liked' && p.id !== 'recent'), [playlists]);
  const isLoved = useCallback((song: Song | null): boolean => song !== null && lovedSongs.some((s) => s.id === song.id), [lovedSongs]);

  // ── 歌词三件套 ──
  const loadLyrics = useCallback((song: Song): void => {
    const req = ++lyricsReqRef.current;
    lyricsSongIdRef.current = song.id;
    setLyrics([]);
    setLyricsLoading(true);
    void (async () => {
      const out = await rpc('personal-workbench/music/detail', { id: song.id });
      if (lyricsReqRef.current !== req || lyricsSongIdRef.current !== song.id) return;
      setLyricsLoading(false);
      if (out?.ok) {
        const v = out.value as { lyrics: LyricLine[]; coverUrl?: string };
        const cleaned = v.lyrics.filter((l, i) => !(i === 0 && (l.text === song.title || l.text.startsWith(`${song.title} -`) || l.text.startsWith(`${song.title} (`))));
        setLyrics(cleaned);
        if (v.coverUrl) setCurrent((prev) => (prev !== null && prev.id === song.id ? { ...prev, coverUrl: v.coverUrl } : prev));
      }
    })();
  }, [rpc]);

  // ── 播放 ──
  const playSong = useCallback((song: Song, list: Song[], label: string): void => {
    const audio = getAudio();
    gSession.songId = song.id;
    gSession.onlineSong = song;
    gSession.list = list;
    gSession.listLabel = label;
    gSession.currentIndex = Math.max(0, list.findIndex((s) => s.id === song.id));
    gSession.isPlaying = true;
    setCurrent(song);
    setIsPlaying(true);
    setProgress(0);
    setAudioDur(0);
    setErr('');
    void (async () => {
      let url = kuwoPlayUrl(song.id, QUALITY_MAP[quality]);
      const out = await rpc('personal-workbench/music/source', { id: song.id, quality });
      if (out?.ok) {
        const direct = (out.value as { url?: string }).url;
        if (typeof direct === 'string' && direct.startsWith('http')) url = direct;
      }
      if (gSession.songId !== song.id) return;
      audio.src = url;
      audio.play().catch(() => { /* src 加载失败由 error 事件(onErr)统一降级/报错 */ });
    })();
    // 最近播放前插
    setPlaylists((prev) => {
      const recent = prev.find((p) => p.id === 'recent');
      if (recent === undefined) return prev;
      const rest = recent.songs.filter((s) => s.id !== song.id);
      const updated = prev.map((p) => (p.id === 'recent' ? { ...p, songs: [song, ...rest].slice(0, 200) } : p));
      try { localStorage.setItem(PLAYLISTS_KEY, JSON.stringify(updated)); } catch { /* 忽略 */ }
      return updated;
    });
    loadLyrics(song);
  }, [quality, loadLyrics]);

  const handleNext = useCallback((auto = false): void => {
    const list = gSession.list;
    if (list.length === 0) return;
    const cur = gSession.onlineSong;
    if (auto && playMode === 'one' && cur !== null) { playSong(cur, list, gSession.listLabel); return; }
    let idx = list.findIndex((s) => s.id === (cur?.id ?? ''));
    if (playMode === 'shuffle') idx = list.length === 1 ? 0 : Math.floor(Math.random() * list.length);
    else idx = (idx + 1) % list.length;
    const next = list[idx];
    if (next === undefined) return;
    playSong(next, list, gSession.listLabel);
  }, [playMode, playSong]);

  const handlePrev = useCallback((): void => {
    const list = gSession.list;
    if (list.length === 0) return;
    let idx = list.findIndex((s) => s.id === (gSession.onlineSong?.id ?? ''));
    idx = playMode === 'shuffle' && list.length > 1 ? Math.floor(Math.random() * list.length) : (idx - 1 + list.length) % list.length;
    const prev = list[idx];
    if (prev !== undefined) playSong(prev, list, gSession.listLabel);
  }, [playMode, playSong]);

  const handlePlayPause = useCallback((): void => {
    const audio = getAudio();
    const song = gSession.onlineSong;
    if (song === null) return;
    if (gSession.songId !== song.id || audio.src === '') { playSong(song, gSession.list, gSession.listLabel); return; }
    if (audio.paused) { audio.play().catch(() => {}); gSession.isPlaying = true; setIsPlaying(true); }
    else { audio.pause(); gSession.isPlaying = false; setIsPlaying(false); }
  }, [playSong]);

  // 音频事件（单例只挂一次）
  useEffect(() => {
    const audio = getAudio();
    const onTime = (): void => { gSession.progress = audio.currentTime; setProgress(audio.currentTime); };
    const onDur = (): void => setAudioDur(audio.duration);
    const onEnd = (): void => handleNext(true);
    const onPlay = (): void => { gSession.isPlaying = true; setIsPlaying(true); };
    const onPause = (): void => { gSession.isPlaying = false; setIsPlaying(false); };
    const onErr = (): void => {
      if (audio.src === '') return;
      const q = gSession.quality;
      if (q === 'flac' || q === '320k') {
        const next: QualityLevel = q === 'flac' ? '320k' : '128k';
        gSession.quality = next;
        try { localStorage.setItem(QUALITY_KEY, next); } catch { /* 忽略 */ }
        setQuality(next);
        setErr(next === '320k' ? '无损音源不可用，已自动切换 320K' : '320K 音源不可用，已切换标准音质');
        void (async () => {
          let url = kuwoPlayUrl(gSession.songId ?? '', QUALITY_MAP[next]);
          const out = await rpc('personal-workbench/music/source', { id: gSession.songId ?? '', quality: next });
          if (out?.ok) {
            const d = (out.value as { url?: string }).url;
            if (typeof d === 'string' && d.startsWith('http')) url = d;
          }
          if (gSession.songId === null) return;
          audio.src = url;
          audio.play().catch(() => { /* 最终失败交给下一次 onErr 报错 */ });
        })();
      } else {
        setErr('当前歌曲播放失败，试试下一首或换音质');
      }
    };
    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('loadedmetadata', onDur);
    audio.addEventListener('ended', onEnd);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('error', onErr);
    return () => {
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('loadedmetadata', onDur);
      audio.removeEventListener('ended', onEnd);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('error', onErr);
    };
  }, [handleNext]);

  // 回到模块恢复 UI
  useEffect(() => {
    setIsPlaying(gSession.isPlaying);
    setProgress(gSession.progress);
    setIsMuted(gSession.isMuted);
    setPlayMode(gSession.playMode);
    const audio = getAudio();
    audio.volume = gSession.volume / 100;
    audio.muted = gSession.isMuted;
    const song = gSession.onlineSong;
    if (song !== null && gSession.songId !== null) {
      setCurrent(song);
      if (gSession.songId === song.id) loadLyrics(song);
    }
  }, [loadLyrics]);

  // 歌词滚动
  const currentLyricIndex = useMemo(() => {
    let idx = -1;
    for (let i = 0; i < lyrics.length; i++) {
      const line = lyrics[i];
      if (line !== undefined && line.time <= progress + 0.2) idx = i; else break;
    }
    return idx;
  }, [lyrics, progress]);
  useEffect(() => {
    const el = lyricsRef.current;
    if (el === null || currentLyricIndex < 0) return;
    const active = el.children[currentLyricIndex] as HTMLElement | undefined;
    if (active !== undefined) el.scrollTo({ top: active.offsetTop - el.clientHeight / 2, behavior: 'smooth' });
  }, [currentLyricIndex, showFull]);

  // ── 搜索 ──
  const doSearch = useCallback((page: number, append: boolean): void => {
    const q = onlineQuery.trim();
    if (q === '') return;
    setOnlineLoading(true);
    setOnlineError('');
    void (async () => {
      const out = await rpc('personal-workbench/music/search', { q, page });
      setOnlineLoading(false);
      if (!out?.ok) { setOnlineError((out?.error as { message?: string })?.message ?? '搜索失败'); return; }
      const v = out.value as { songs: Song[]; isEnd: boolean; total: number };
      setRoute({ page: 'search' });
      gSession.route = { page: 'search' };
      setOnlinePage(page);
      setOnlineIsEnd(v.isEnd);
      setOnlineTotal(v.total);
      setOnlineResults((prev) => {
        const next = append ? [...prev, ...v.songs] : v.songs;
        gSession.list = next;
        gSession.listLabel = `搜索：${q}`;
        return next;
      });
    })();
  }, [onlineQuery, rpc]);

  // ── 收藏 toggle（liked 歌单）──
  const toggleLove = useCallback((song: Song): void => {
    setPlaylists((prev) => {
      const loved = prev.find((p) => p.id === 'liked');
      if (loved === undefined) return prev;
      const has = loved.songs.some((s) => s.id === song.id);
      const updated = prev.map((p) => (p.id === 'liked' ? { ...p, songs: has ? p.songs.filter((s) => s.id !== song.id) : [song, ...p.songs] } : p));
      try { localStorage.setItem(PLAYLISTS_KEY, JSON.stringify(updated)); } catch { /* 忽略 */ }
      return updated;
    });
  }, []);

  // ── 导入 ──
  const doImport = useCallback((): void => {
    const link = importLink.trim();
    if (link === '') return;
    setImporting(true);
    setImportMsg('解析链接中…');
    void (async () => {
      const out = await rpc('personal-workbench/music/import', { link });
      if (!out?.ok) { setImporting(false); setImportMsg((out?.error as { message?: string })?.message ?? '解析失败'); return; }
      const v = out.value as { queries: string[]; songs: Song[] };
      if (v.songs.length > 0) {
        const pl: Playlist = { id: `pl_${Date.now()}`, name: `导入 ${new Date().toLocaleDateString('zh-CN')}`, songs: v.songs };
        savePlaylists([...playlists, pl]);
        setImporting(false); setShowImport(false); setImportLink(''); setImportMsg('');
        setRoute({ page: 'playlist', id: pl.id }); gSession.route = { page: 'playlist', id: pl.id };
        return;
      }
      setImportMsg(`匹配到 ${v.queries.length} 首，搜索匹配中…`);
      const collected: Song[] = [];
      for (const q of v.queries) {
        const r = await rpc('personal-workbench/music/search', { q, page: 1 });
        if (r?.ok) {
          const songs = (r.value as { songs: Song[] }).songs;
          const first = songs[0];
          if (first !== undefined) collected.push(first);
        }
      }
      setImporting(false);
      if (collected.length === 0) { setImportMsg('匹配失败，全部歌曲都没搜到'); return; }
      const pl: Playlist = { id: `pl_${Date.now()}`, name: `导入 ${new Date().toLocaleDateString('zh-CN')}`, songs: collected };
      savePlaylists([...playlists, pl]);
      setShowImport(false); setImportLink(''); setImportMsg('');
      setRoute({ page: 'playlist', id: pl.id }); gSession.route = { page: 'playlist', id: pl.id };
    })();
  }, [importLink, playlists, rpc, savePlaylists]);

  const exportCurrent = useCallback((): void => {
    const list = route.page === 'search' ? onlineResults : route.page === 'favorites' ? lovedSongs : route.page === 'history' ? recentSongs : route.page === 'discover' ? gSession.list : playlists.find((p) => p.id === (route.page === 'playlist' ? route.id : ''))?.songs ?? [];
    if (list.length === 0) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([list.map((s) => `${s.title} - ${s.artist}`).join('\n')], { type: 'text/plain;charset=utf-8' }));
    a.download = `${gSession.listLabel !== '' ? gSession.listLabel : '歌单'}.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
  }, [route, onlineResults, lovedSongs, recentSongs, playlists]);

  const downloadLyrics = useCallback((): void => {
    if (lyrics.length === 0 || current === null) return;
    let lrc = `[ti:${current.title}]\n[ar:${current.artist}]\n`;
    for (const line of lyrics) lrc += `[${Math.floor(line.time / 60).toString().padStart(2, '0')}:${Math.floor(line.time % 60).toString().padStart(2, '0')}.${Math.floor((line.time % 1) * 100).toString().padStart(2, '0')}]${line.text}\n`;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([lrc], { type: 'text/plain;charset=utf-8' }));
    a.download = `${current.title} - ${current.artist}.lrc`;
    a.click();
    URL.revokeObjectURL(a.href);
  }, [lyrics, current]);

  const handleSeek = useCallback((e: React.MouseEvent<HTMLDivElement>): void => {
    const rect = e.currentTarget.getBoundingClientRect();
    const audio = getAudio();
    const target = ((e.clientX - rect.left) / rect.width) * (audioDur || audio.duration || 0);
    if (Number.isFinite(target) && target > 0) audio.currentTime = target;
  }, [audioDur]);

  const changeQuality = useCallback((q: QualityLevel): void => {
    setQuality(q);
    gSession.quality = q;
    try { localStorage.setItem(QUALITY_KEY, q); } catch { /* 忽略 */ }
    const audio = getAudio();
    if (gSession.songId !== null && audio.src !== '') {
      const wasPlaying = !audio.paused;
      void (async () => {
        let url = kuwoPlayUrl(gSession.songId ?? '', QUALITY_MAP[q]);
        const out = await rpc('personal-workbench/music/source', { id: gSession.songId ?? '', quality: q });
        if (out?.ok) {
          const direct = (out.value as { url?: string }).url;
          if (typeof direct === 'string' && direct.startsWith('http')) url = direct;
        }
        audio.src = url;
        if (wasPlaying) audio.play().catch(() => {});
      })();
    }
  }, [rpc]);

  const cycleMode = useCallback((): void => {
    const next = playMode === 'order' ? 'all' : playMode === 'all' ? 'one' : playMode === 'one' ? 'shuffle' : 'order';
    setPlayMode(next);
    gSession.playMode = next;
  }, [playMode]);

  // ── 页面渲染 ──
  useEffect(() => {
    let disposed = false;
    setDiscoverLoading(true);
    void Promise.resolve(rpc('personal-workbench/music/discover', {} as never)).then((res) => {
      if (disposed) return;
      // rpc 统一包装 { ok, value }：discover 数据在 value 里（此前直读 res 导致永远「暂无推荐」）
      const out = res as { value?: { hot?: Song[]; douyin?: Song[]; singers?: Array<{ name: string; coverUrl?: string; sample: { id: string; title: string; artist: string } | null }> } };
      const d = out.value ?? {};
      if (Array.isArray(d.hot)) setDiscover({ hot: d.hot ?? [], douyin: d.douyin ?? [], singers: d.singers ?? [] });
      setDiscoverLoading(false);
    }).catch(() => { if (!disposed) setDiscoverLoading(false); });
    return () => { disposed = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 歌手页取数（酷我 30 首，Host 缓存 30 分钟）
  useEffect(() => {
    if (route.page !== 'singer') return;
    const name = route.name;
    if (singerData?.name === name) return;
    let disposed = false;
    setSingerLoading(true); setSingerError('');
    void Promise.resolve(rpc('personal-workbench/music/singer', { name })).then((out) => {
      if (disposed) return;
      const v = (out?.value ?? null) as { name: string; songs: Song[] } | null;
      if (v !== null && Array.isArray(v.songs)) setSingerData({ name: v.name, songs: v.songs });
      else setSingerError((out?.error as { message?: string })?.message ?? '歌手歌曲加载失败（若刚更新代码请重启宿主）');
      setSingerLoading(false);
    }).catch(() => { if (!disposed) { setSingerError('歌手歌曲加载失败'); setSingerLoading(false); } });
    return () => { disposed = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.page, route.page === 'singer' ? route.name : '']);

  const renderPage = (): ReactElement => {
    if (route.page === 'discover') {
      const dvCards = (title: string, songs: Song[], label: string) => (
        <div className="dsh-pwb-mu-dv-block" key={title}>
          <h2>{title}</h2>
          {songs.length === 0 ? (
            <div className="dsh-pwb-mu-dv-empty">暂无推荐</div>
          ) : (
            <div className="dsh-pwb-mu-dv-row">
              {songs.map((song, i) => (
                <button key={`${song.id}-${i}`} type="button" className="dsh-pwb-mu-dv-card" title={`${song.title} - ${song.artist}`}
                  onClick={() => playSong(song, songs, label)}>
                  {song.coverUrl !== undefined && song.coverUrl !== '' ? (
                    <img src={song.coverUrl} alt="" loading="lazy" />
                  ) : <span className="dsh-pwb-mu-dv-dummy"><Music className="size-6" /></span>}
                  <b>{song.title}</b>
                  <span>{song.artist}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      );
      const singerCards = (title: string) => {
        const list = discover?.singers ?? [];
        return (
          <div className="dsh-pwb-mu-dv-block" key={title}>
            <h2>{title}</h2>
            {list.length === 0 ? (
              <div className="dsh-pwb-mu-dv-empty">暂无推荐</div>
            ) : (
              <div className="dsh-pwb-mu-dv-row">
                {list.map((sg) => (
                  <button key={sg.name} type="button" className="dsh-pwb-mu-dv-card" title={`搜索 ${sg.name}`}
                    onClick={() => { setRoute({ page: 'singer', name: sg.name, coverUrl: sg.coverUrl }); gSession.route = { page: 'singer', name: sg.name, coverUrl: sg.coverUrl }; }}>
                    {sg.coverUrl !== undefined && sg.coverUrl !== '' ? (
                      <img src={sg.coverUrl} alt="" loading="lazy" />
                    ) : <span className="dsh-pwb-mu-dv-dummy"><Music className="size-6" /></span>}
                    <b>{sg.name}</b>
                    <span>歌手</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      };
      return (
        <div className="dsh-pwb-mu-dv">
          <h1 className="dsh-pwb-mu-dv-title">发现音乐</h1>
          {discoverLoading && discover === null ? <div className="dsh-pwb-mu-dv-empty"><Loader2 className="size-4 spin" /> 正在发现好音乐…</div> : null}
          {singerCards('歌手推荐')}
          {dvCards('热门推荐', discover?.hot ?? [], '发现·热门推荐')}
          {dvCards('抖音推荐', discover?.douyin ?? [], '发现·抖音推荐')}
        </div>
      );
    }
    if (route.page === 'singer') {
      const songs = singerData?.songs ?? [];
      const cover = route.coverUrl;
      return (
        <>
          <button type="button" className="dsh-pwb-mu-btn" style={{ alignSelf: 'flex-start' }} onClick={() => { setRoute({ page: 'discover' }); gSession.route = { page: 'discover' }; }}>
            <ChevronLeft className="size-4" /> 返回
          </button>
          <div className="dsh-pwb-mu-sg-head">
            {cover !== undefined && cover !== '' ? <img className="dsh-pwb-mu-sg-avatar" src={cover} alt="" /> : <span className="dsh-pwb-mu-sg-avatar dsh-pwb-mu-sg-dummy"><Music className="size-8" /></span>}
            <div className="dsh-pwb-mu-sg-meta">
              <i className="dsh-pwb-mu-sg-badge">酷我</i>
              <h1>{route.name}</h1>
              <span>{singerLoading && singerData === null ? '加载中…' : `${songs.length} 首歌曲`}</span>
            </div>
          </div>
          <div className="dsh-pwb-mu-sg-acts">
            <button type="button" className="dsh-pwb-mu-sg-playall" disabled={songs.length === 0}
              onClick={() => { const first = songs[0]; if (first !== undefined) playSong(first, songs, `歌手·${route.name}`); }}>
              <Play className="size-4" /> 播放全部
            </button>
            <button type="button" className="dsh-pwb-mu-sg-save" disabled={songs.length === 0}
              onClick={() => {
                const pl: Playlist = { id: `pl_${Date.now()}`, name: `${route.name}·热门${songs.length}首`, songs };
                savePlaylists([...playlists, pl]);
                setRoute({ page: 'playlist', id: pl.id }); gSession.route = { page: 'playlist', id: pl.id };
              }}>
              <Plus className="size-4" /> 保存到歌单
            </button>
          </div>
          {singerError !== '' && songs.length === 0 ? <div className="dsh-pwb-mu-empty">{singerError}</div> : null}
          {songs.map((song, i) => (
            <SongRow key={`${song.id}-${i}`} song={song} idx={i + 1} now={current?.id === song.id} playing={isPlaying} loved={isLoved(song)}
              onPlay={() => playSong(song, songs, `歌手·${route.name}`)} onLove={() => toggleLove(song)} />
          ))}
        </>
      );
    }
    if (route.page === 'search') {
      return (
        <>
          <h2>搜索结果{onlineTotal > 0 ? <span className="dsh-pwb-mu-count">{onlineTotal} 首</span> : null}</h2>
          {onlineResults.length === 0 ? (
            <div className="dsh-pwb-mu-empty">{onlineError !== '' ? onlineError : '在上方搜索框输入关键词\n搜索酷我全网歌曲'}</div>
          ) : (
            <>
              {onlineResults.map((song, i) => (
                <SongRow key={`${song.id}-${i}`} song={song} idx={i + 1} now={current?.id === song.id} playing={isPlaying}
                  loved={isLoved(song)} onPlay={() => playSong(song, onlineResults, `搜索：${onlineQuery.trim()}`)} onLove={() => toggleLove(song)} />
              ))}
              {!onlineIsEnd ? (
                <div className="dsh-pwb-mu-more">
                  <button type="button" className="dsh-pwb-mu-btn" disabled={onlineLoading} onClick={() => doSearch(onlinePage + 1, true)}>
                    {onlineLoading ? <Loader2 className="size-3.5 animate-spin" /> : null} 加载更多
                  </button>
                </div>
              ) : null}
            </>
          )}
        </>
      );
    }
    if (route.page === 'favorites') {
      return (
        <>
          <h2><Heart className="size-4" style={{ color: '#e5484d' }} /> 我的收藏 <span className="dsh-pwb-mu-count">{lovedSongs.length} 首</span></h2>
          {lovedSongs.length === 0 ? <div className="dsh-pwb-mu-empty">还没有收藏{'\n'}播放时点右下角爱心收藏</div> :
            lovedSongs.map((song, i) => <SongRow key={song.id} song={song} idx={i + 1} now={current?.id === song.id} playing={isPlaying} loved onPlay={() => playSong(song, lovedSongs, '我的收藏')} onLove={() => toggleLove(song)} />)}
        </>
      );
    }
    if (route.page === 'history') {
      return (
        <>
          <h2><ListEnd className="size-4" /> 最近播放 <span className="dsh-pwb-mu-count">{recentSongs.length} 首</span></h2>
          {recentSongs.length === 0 ? <div className="dsh-pwb-mu-empty">暂无播放记录</div> :
            recentSongs.map((song, i) => <SongRow key={`${song.id}-${i}`} song={song} idx={i + 1} now={current?.id === song.id} playing={isPlaying} loved={isLoved(song)} onPlay={() => playSong(song, recentSongs, '最近播放')} onLove={() => toggleLove(song)} />)}
        </>
      );
    }
    const pl = playlists.find((p) => p.id === route.id);
    return (
      <>
        <div className="dsh-pwb-mu-plate-head">
          <h2 style={{ margin: 0 }}><Music className="size-4" /> {pl?.name ?? '歌单'} <span className="dsh-pwb-mu-count">{pl?.songs.length ?? 0} 首</span></h2>
          <div style={{ display: 'flex', gap: 8 }}>
            {pl !== undefined && pl.id !== 'liked' && pl.id !== 'recent' ? (
              <>
                <button type="button" className="dsh-pwb-mu-btn" onClick={() => { setRenameTarget(pl); setRenameName(pl.name); }}><Pencil className="size-3.5" /> 重命名</button>
                <button type="button" className="dsh-pwb-mu-btn" onClick={() => { if (!window.confirm(`删除歌单「${pl.name}」？`)) return; const next = playlists.filter((p) => p.id !== pl.id); savePlaylists(next); setRoute({ page: 'favorites' }); gSession.route = { page: 'favorites' }; }}><Trash2 className="size-3.5" /> 删除歌单</button>
              </>
            ) : null}
            <button type="button" className="dsh-pwb-mu-btn" onClick={exportCurrent}><Download className="size-3.5" /> 导出</button>
          </div>
        </div>
        {pl === undefined || pl.songs.length === 0 ? <div className="dsh-pwb-mu-empty">歌单还是空的{'\n'}用「导入歌单链接」或在线搜索添加</div> :
          pl.songs.map((song, i) => <SongRow key={`${song.id}-${i}`} song={song} idx={i + 1} now={current?.id === song.id} playing={isPlaying} loved={isLoved(song)} onPlay={() => playSong(song, pl.songs, pl.name)} onLove={() => toggleLove(song)}
            onRemove={pl.id !== 'liked' && pl.id !== 'recent' ? () => savePlaylists(playlists.map((p) => (p.id === pl.id ? { ...p, songs: p.songs.filter((s) => s.id !== song.id) } : p))) : undefined} />)}
      </>
    );
  };

  const navItems: Array<{ key: string; label: string; icon: ReactElement; active: boolean; onClick: () => void }> = [
    { key: 'discover', label: '发现音乐', icon: <Home className="size-4" />, active: route.page === 'discover', onClick: () => { setRoute({ page: 'discover' }); gSession.route = { page: 'discover' }; } },
    { key: 'search', label: '搜索音乐', icon: <Search className="size-4" />, active: route.page === 'search', onClick: () => { setRoute({ page: 'search' }); gSession.route = { page: 'search' }; } },
    { key: 'favorites', label: '我的收藏', icon: <Heart className="size-4" />, active: route.page === 'favorites', onClick: () => { setRoute({ page: 'favorites' }); gSession.route = { page: 'favorites' }; } },
    { key: 'history', label: '最近播放', icon: <ListEnd className="size-4" />, active: route.page === 'history', onClick: () => { setRoute({ page: 'history' }); gSession.route = { page: 'history' }; } },
  ];

  return (
    <div className={`dsh-pwb-view dsh-pwb-mu-shell${isPlaying ? ' dsh-pwb-mu-playing' : ''}`}>
      <div className="dsh-pwb-mu-body">
        {/* 侧边栏 */}
        <div className="dsh-pwb-mu-sidebar">
          <div className="dsh-pwb-mu-nav" style={{ paddingTop: 10 }}>
            {navItems.map((item) => (
              <button key={item.key} type="button" className={`dsh-pwb-mu-navitem${item.active ? ' dsh-pwb-mu-nav-active' : ''}`} onClick={item.onClick}>
                {item.icon} {item.label}
              </button>
            ))}
          </div>
          <div className="dsh-pwb-mu-sb-head">
            我的歌单
            <span style={{ display: 'flex', gap: 2 }}>
              <button type="button" title="导入歌单" onClick={() => setShowImport(true)}><Import className="size-3.5" /></button>
              <button type="button" title="新建歌单" onClick={() => { setNewName(''); setShowNew(true); }}><Plus className="size-4" /></button>
            </span>
          </div>
          <div className="dsh-pwb-mu-sb-list">
            {userPlaylists.map((pl) => (
              <div key={pl.id} className={`dsh-pwb-mu-pl-item${route.page === 'playlist' && route.id === pl.id ? ' dsh-pwb-mu-pl-active' : ''}`}
                onClick={() => { setRoute({ page: 'playlist', id: pl.id }); gSession.route = { page: 'playlist', id: pl.id }; }}>
                <span className="dsh-pwb-mu-pl-ico"><Music className="size-4" /></span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span className="dsh-pwb-mu-pl-name" style={{ display: 'block' }}>{pl.name}</span>
                  <span className="dsh-pwb-mu-pl-count" style={{ display: 'block' }}>{pl.songs.length} 首</span>
                </span>
                <button type="button" className="dsh-pwb-mu-pl-act" title="重命名" onClick={(e) => { e.stopPropagation(); setRenameTarget(pl); setRenameName(pl.name); }}><Pencil className="size-3" /></button>
                <button type="button" className="dsh-pwb-mu-pl-act dsh-pwb-mu-danger" title="删除" onClick={(e) => { e.stopPropagation(); if (!window.confirm(`删除歌单「${pl.name}」？`)) return; savePlaylists(playlists.filter((p) => p.id !== pl.id)); }}><Trash2 className="size-3" /></button>
              </div>
            ))}
          </div>
        </div>

        {/* 主内容 */}
        <div className="dsh-pwb-mu-main">
          <form className="dsh-pwb-mu-topbar" onSubmit={(e) => { e.preventDefault(); doSearch(1, false); }}>
            <Search className="dsh-pwb-mu-search-ico size-4" />
            <input className="dsh-pwb-mu-search" value={onlineQuery} onChange={(e) => setOnlineQuery(e.target.value)} placeholder="搜索歌曲、歌手、专辑..." />
            <button type="submit" className="dsh-pwb-mu-search-btn" disabled={onlineLoading}>
              {onlineLoading ? <Loader2 className="size-3.5 animate-spin" /> : <Search className="size-3.5" />}
              {onlineLoading ? '搜索中' : '在线搜索'}
            </button>
          </form>
          {err !== '' ? <div className="dsh-pwb-mu-hint" style={{ color: '#e5484d', flexShrink: 0 }}>{err}</div> : null}
          <div className="dsh-pwb-mu-page">{renderPage()}</div>
        </div>
      </div>

      {/* 底部播放栏 */}
      <div className="dsh-pwb-mu-bar">
        <div className="dsh-pwb-mu-bar-song" title="打开全屏播放" onClick={() => setShowFull(true)}>
          <span className="dsh-pwb-mu-cover">
            {current?.coverUrl ? <img src={current.coverUrl} alt="" onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} /> : <Disc3 className="size-5" />}
          </span>
          <span className="dsh-pwb-mu-meta">
            <b>{current?.title ?? '未在播放'}</b>
            <span>{current !== null ? current.artist : '选择一首歌开始'}</span>
          </span>
        </div>
        <div className="dsh-pwb-mu-bar-ctrl">
          <div className="dsh-pwb-mu-bar-btns">
            {(() => {
              const ModeIcon = playMode === 'shuffle' ? Shuffle : playMode === 'one' ? Repeat1 : Repeat;
              return (
                <button type="button" className={`dsh-pwb-mu-ctrlbtn${playMode !== 'order' ? ' dsh-pwb-mu-on' : ''}`} title={playMode === 'order' ? '顺序播放' : playMode === 'all' ? '列表循环' : playMode === 'one' ? '单曲循环' : '随机播放'} onClick={cycleMode}>
                  <ModeIcon className="size-4" />
                </button>
              );
            })()}
            <button type="button" className="dsh-pwb-mu-ctrlbtn" title="上一首" onClick={handlePrev}><SkipBack className="size-4" /></button>
            <button type="button" className="dsh-pwb-mu-playbtn" title={isPlaying ? '暂停' : '播放'} onClick={handlePlayPause}>
              {isPlaying ? <Pause className="size-4" /> : <Play className="size-4" style={{ marginLeft: 2 }} />}
            </button>
            <button type="button" className="dsh-pwb-mu-ctrlbtn" title="下一首" onClick={() => handleNext()}><SkipForward className="size-4" /></button>
          </div>
          <div className="dsh-pwb-mu-prog">
            <span className="dsh-pwb-mu-time">{fmtTime(progress)}</span>
            <div className="dsh-pwb-mu-bar" onClick={handleSeek}>
              <span className="dsh-pwb-mu-bar-fill" style={{ width: `${audioDur > 0 ? Math.min(100, (progress / audioDur) * 100) : 0}%` }} />
              <span className="dsh-pwb-mu-bar-knob" style={{ left: `${audioDur > 0 ? Math.min(100, (progress / audioDur) * 100) : 0}%` }} />
            </div>
            <span className="dsh-pwb-mu-time">{fmtTime(audioDur)}</span>
          </div>
        </div>
        <div className="dsh-pwb-mu-bar-right">
          <button type="button" className="dsh-pwb-mu-ctrlbtn" title={isLoved(current) ? '取消收藏' : '收藏'} disabled={current === null}
            style={isLoved(current) ? { color: '#e5484d' } : undefined}
            onClick={() => { if (current !== null) toggleLove(current); }}>
            <Heart className="size-4" fill={isLoved(current) ? 'currentColor' : 'none'} />
          </button>
          <select className="dsh-pwb-mu-select" value={quality} onChange={(e) => changeQuality(e.target.value as QualityLevel)} title="音质">
            {(['128k', '320k', 'flac'] as QualityLevel[]).map((q) => <option key={q} value={q}>{QUALITY_LABELS[q]}</option>)}
          </select>
          <button type="button" className="dsh-pwb-mu-ctrlbtn" title={isMuted ? '取消静音' : '静音'} onClick={() => {
            const audio = getAudio();
            audio.muted = !isMuted;
            gSession.isMuted = !isMuted;
            setIsMuted(!isMuted);
          }}>
            {isMuted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
          </button>
          <input type="range" min={0} max={100} value={isMuted ? 0 : volume} style={{ width: 64, accentColor: 'var(--pwb-accent)' }} onChange={(e) => {
            const v = Number(e.target.value);
            setVolume(v); gSession.volume = v;
            const audio = getAudio();
            audio.volume = v / 100;
            if (v > 0 && isMuted) { audio.muted = false; gSession.isMuted = false; setIsMuted(false); }
          }} />
          <button type="button" className="dsh-pwb-mu-ctrlbtn" title="下载歌词 LRC" disabled={lyrics.length === 0} onClick={downloadLyrics}><Download className="size-4" /></button>
          <button type="button" className="dsh-pwb-mu-ctrlbtn" title="播放列表" onClick={() => setShowQueue((v) => !v)}><ListMusic className="size-4" /></button>
          <button type="button" className="dsh-pwb-mu-ctrlbtn" title="全屏播放" onClick={() => setShowFull(true)}><Maximize2 className="size-4" /></button>
        </div>
      </div>

      {/* 队列浮层 */}
      {showQueue ? (
        <div className="dsh-pwb-mu-queue">
          <div className="dsh-pwb-mu-queue-head">
            播放列表{gSession.listLabel !== '' ? ` · ${gSession.listLabel}` : ` · ${gSession.list.length} 首`}
            <button type="button" className="dsh-pwb-mu-pl-act" style={{ opacity: 1 }} onClick={() => setShowQueue(false)}><X className="size-4" /></button>
          </div>
          <div className="dsh-pwb-mu-queue-body">
            {gSession.list.length === 0 ? <div className="dsh-pwb-mu-empty">队列是空的</div> :
              gSession.list.map((song, i) => (
                <SongRow key={`${song.id}-${i}`} song={song} idx={i + 1} now={current?.id === song.id} playing={isPlaying} loved={isLoved(song)}
                  onPlay={() => playSong(song, gSession.list, gSession.listLabel)} onLove={() => toggleLove(song)} />
              ))}
          </div>
        </div>
      ) : null}

      {/* 全屏播放器（图二形态：封面模糊背景+黑胶+歌词+底部控制） */}
      {showFull ? (
        <div className="dsh-pwb-mu-fs">
          {current?.coverUrl ? <div className="dsh-pwb-mu-fs-bg" style={{ backgroundImage: `url(${current.coverUrl})` }} /> : null}
          <div className="dsh-pwb-mu-fs-shade" />
          <button type="button" className="dsh-pwb-mu-fs-collapse" title="收起" onClick={() => setShowFull(false)}><ChevronDown className="size-5" /></button>
          <div className="dsh-pwb-mu-fs-tag">正在播放</div>
          <div className="dsh-pwb-mu-fs-stage">
            <div className="dsh-pwb-mu-fs-left">
              <div ref={fsDiscRef} className="dsh-pwb-mu-fs-disc">
                {current?.coverUrl ? <img src={current.coverUrl} alt="" onError={(e) => { e.currentTarget.style.display = 'none'; }} /> : <span className="dsh-pwb-mu-fs-disc-dummy"><Disc3 className="size-9" /></span>}
                <i />
              </div>
            </div>
            <div className="dsh-pwb-mu-fs-right">
              <div className="dsh-pwb-mu-fs-lyrics" ref={lyricsRef}>
                {lyrics.map((line, i) => (
                  <div key={i} className={`dsh-pwb-mu-fs-lyric${i === currentLyricIndex ? ' dsh-pwb-mu-now' : ''}`}
                    title="点击定位到该句"
                    onClick={() => { const audio = getAudio(); if (audio.readyState > 0) audio.currentTime = line.time; }}>
                    {line.text}
                  </div>
                ))}
                {lyrics.length === 0 ? <div className="dsh-pwb-mu-fs-lyric-empty">{lyricsLoading ? '正在加载歌词…' : '暂无歌词'}</div> : null}
              </div>
            </div>
          </div>
          <div className="dsh-pwb-mu-fs-bottom">
            <h2>{current?.title ?? '未在播放'}</h2>
            <p>{current !== null ? current.artist : ''}</p>
            <div className="dsh-pwb-mu-fs-prog">
              <span className="dsh-pwb-mu-fs-time">{fmtTime(progress)}</span>
              <div className="dsh-pwb-mu-fs-track" onClick={handleSeek}>
                <span className="dsh-pwb-mu-fs-track-fill" style={{ width: `${audioDur > 0 ? Math.min(100, (progress / audioDur) * 100) : 0}%` }} />
                <span className="dsh-pwb-mu-fs-track-knob" style={{ left: `${audioDur > 0 ? Math.min(100, (progress / audioDur) * 100) : 0}%` }} />
              </div>
              <span className="dsh-pwb-mu-fs-time">{fmtTime(audioDur)}</span>
            </div>
            <div className="dsh-pwb-mu-fs-btns">
              {(() => {
                const ModeIcon = playMode === 'shuffle' ? Shuffle : playMode === 'one' ? Repeat1 : Repeat;
                return (
                  <button type="button" className={`dsh-pwb-mu-fs-cbtn${playMode !== 'order' ? ' dsh-pwb-mu-on' : ''}`} title={playMode === 'order' ? '顺序播放' : playMode === 'all' ? '列表循环' : playMode === 'one' ? '单曲循环' : '随机播放'} onClick={cycleMode}>
                    <ModeIcon className="size-4.5" />
                  </button>
                );
              })()}
              <button type="button" className="dsh-pwb-mu-fs-cbtn" title="上一首" onClick={handlePrev}><SkipBack className="size-5" /></button>
              <button type="button" className="dsh-pwb-mu-fs-play" title={isPlaying ? '暂停' : '播放'} onClick={handlePlayPause}>
                {isPlaying ? <Pause className="size-6" /> : <Play className="size-6" style={{ marginLeft: 3 }} />}
              </button>
              <button type="button" className="dsh-pwb-mu-fs-cbtn" title="下一首" onClick={() => handleNext()}><SkipForward className="size-5" /></button>
              <button type="button" className={`dsh-pwb-mu-fs-cbtn${isLoved(current) ? ' dsh-pwb-mu-loved' : ''}`} title={isLoved(current) ? '取消收藏' : '收藏'} disabled={current === null}
                onClick={() => { if (current !== null) toggleLove(current); }}>
                <Heart className="size-4.5" fill={isLoved(current) ? 'currentColor' : 'none'} />
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* 导入弹窗 */}
      {showImport ? (
        <div className="dsh-pwb-mu-mask" onClick={() => { if (!importing) setShowImport(false); }}>
          <div className="dsh-pwb-mu-dialog" onClick={(e) => e.stopPropagation()}>
            <h4>导入歌单</h4>
            <textarea rows={4} value={importLink} onChange={(e) => setImportLink(e.target.value)} placeholder="粘贴歌单分享链接" style={{ overflowY: 'auto' }} />
            <div className="dsh-pwb-mu-hint">网易云/QQ/酷狗歌单按歌名自动匹配酷我曲库；酷我/波点歌单直接导入可播放歌曲。解析经 Host 代理，可能需要十几秒。</div>
            {importMsg !== '' ? <div className="dsh-pwb-mu-hint" style={{ color: 'var(--pwb-accent)' }}>{importMsg}</div> : null}
            <div className="dsh-pwb-mu-dialog-row">
              <button type="button" className="dsh-pwb-mu-btn" onClick={() => setShowImport(false)} disabled={importing}>取消</button>
              <button type="button" className="dsh-pwb-mu-search-btn" style={{ position: 'static' }} onClick={doImport} disabled={importing || importLink.trim() === ''}>
                {importing ? <Loader2 className="size-3.5 animate-spin" /> : null} 开始导入
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* 新建歌单弹窗 */}
      {showNew ? (
        <div className="dsh-pwb-mu-mask" onClick={() => setShowNew(false)}>
          <div className="dsh-pwb-mu-dialog" onClick={(e) => e.stopPropagation()}>
            <h4>新建歌单</h4>
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="歌单名称" onKeyDown={(e) => {
              if (e.key === 'Enter' && newName.trim() !== '') {
                const id = `pl_${Date.now()}`;
                savePlaylists([...playlists, { id, name: newName.trim(), songs: [] }]);
                setShowNew(false);
                setRoute({ page: 'playlist', id }); gSession.route = { page: 'playlist', id };
              }
            }} />
            <div className="dsh-pwb-mu-dialog-row">
              <button type="button" className="dsh-pwb-mu-btn" onClick={() => setShowNew(false)}>取消</button>
              <button type="button" className="dsh-pwb-mu-search-btn" style={{ position: 'static' }} onClick={() => {
                if (newName.trim() === '') return;
                const id = `pl_${Date.now()}`;
                savePlaylists([...playlists, { id, name: newName.trim(), songs: [] }]);
                setShowNew(false);
                setRoute({ page: 'playlist', id }); gSession.route = { page: 'playlist', id };
              }}>创建</button>
            </div>
          </div>
        </div>
      ) : null}

      {/* 重命名弹窗 */}
      {renameTarget !== null ? (
        <div className="dsh-pwb-mu-mask" onClick={() => setRenameTarget(null)}>
          <div className="dsh-pwb-mu-dialog" onClick={(e) => e.stopPropagation()}>
            <h4>重命名歌单</h4>
            <input value={renameName} onChange={(e) => setRenameName(e.target.value)} onKeyDown={(e) => {
              if (e.key === 'Enter' && renameName.trim() !== '' && renameTarget !== null) {
                savePlaylists(playlists.map((p) => (p.id === renameTarget.id ? { ...p, name: renameName.trim() } : p)));
                setRenameTarget(null);
              }
            }} />
            <div className="dsh-pwb-mu-dialog-row">
              <button type="button" className="dsh-pwb-mu-btn" onClick={() => setRenameTarget(null)}>取消</button>
              <button type="button" className="dsh-pwb-mu-search-btn" style={{ position: 'static' }} onClick={() => {
                if (renameName.trim() === '' || renameTarget === null) return;
                savePlaylists(playlists.map((p) => (p.id === renameTarget.id ? { ...p, name: renameName.trim() } : p)));
                setRenameTarget(null);
              }}>确定</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** 歌曲行（列表/队列通用） */
function SongRow({ song, idx, now, playing, loved, onPlay, onLove, onRemove }: {
  song: Song; idx?: number; now: boolean; playing: boolean; loved: boolean;
  onPlay: () => void; onLove: () => void; onRemove?: () => void;
}): ReactElement {
  return (
    <div className={`dsh-pwb-mu-row${now ? ' dsh-pwb-mu-row-now' : ''}`} onClick={onPlay}>
      {idx !== undefined ? <span className="dsh-pwb-mu-rowidx">{now && playing ? '♪' : idx}</span> : null}
      <span className="dsh-pwb-mu-cover">
        {song.coverUrl ? <img src={song.coverUrl} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.display = 'none'; }} /> : <Music className="size-4" />}
      </span>
      <span className="dsh-pwb-mu-meta">
        <b>{song.title}</b>
        <span>{song.artist} · {song.album}</span>
      </span>
      <button type="button" className={`dsh-pwb-mu-rowact${loved ? ' dsh-pwb-mu-loved' : ''}`} title={loved ? '取消收藏' : '收藏'}
        onClick={(e) => { e.stopPropagation(); onLove(); }}>
        <Heart className="size-3.5" fill={loved ? 'currentColor' : 'none'} />
      </button>
      <span className="dsh-pwb-mu-rowtime">{now && playing ? '播放中' : song.duration > 0 ? fmtTime(song.duration) : ''}</span>
      {onRemove !== undefined ? (
        <button type="button" className="dsh-pwb-mu-rowact dsh-pwb-mu-danger" title="从歌单移除" onClick={(e) => { e.stopPropagation(); onRemove(); }}>
          <Trash2 className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
}
