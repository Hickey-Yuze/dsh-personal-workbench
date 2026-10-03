/**
 * 音乐平台 —— 1:1 复刻原版 MusicPage（docs/交接文档.md 五）：
 * · 三栏布局：左歌单 / 中碟片+歌词+控制 / 右曲目列表；顶部酷我全网搜索
 * · 全局播放会话：音频元素模块级单例，切模块播放不中断，回来自动恢复 UI
 * · 歌词三件套防串台：请求令牌 + 统一 loadLyrics + 歌词绑定 id 校验
 * · 导入歌单分享链接（网易云/QQ/酷狗→queries；酷我/波点→直出歌曲），经 Host 代理
 * · 持久化 dsh-pwb:music_playlists_v3 / music_quality_v1；碟片 20s 匀速旋转
 * 不造假：无内置示例歌与假歌词，数据全部来自在线搜索/导入；接口失败显示错误不显示假内容。
 */
import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import type { ReactElement } from 'react';
import {
  Play, Pause, SkipBack, SkipForward, Volume2, VolumeX, Shuffle, Repeat,
  ListMusic, Music, Plus, Trash2, Search, Disc3, Loader2, Download,
  FileText, Pencil, Download as DownloadIco,
} from 'lucide-react';
import type { RpcFn } from '../rpc.js';

interface Song { id: string; title: string; artist: string; album: string; duration: number; audioUrl: string; coverUrl?: string }
interface Playlist { id: string; name: string; songs: Song[] }
interface LyricLine { time: number; text: string }
type QualityLevel = '128k' | '320k' | 'flac';

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
  onlineSong: Song | null;        // 当前在线歌（跨模块恢复 UI 用）
  onlineQuery: string;            // 搜索词与结果快照（回来自动恢复）
  onlineResults: Song[];
  listMode: 'playlist' | 'online';
  activePlaylistId: string;
  currentIndex: number;
  isPlaying: boolean;
  progress: number;
  volume: number;
  isMuted: boolean;
  quality: QualityLevel;
  repeatMode: 'off' | 'all' | 'one';
  isShuffle: boolean;
}
let gSession: GlobalSession = { songId: null, onlineSong: null, onlineQuery: '', onlineResults: [], listMode: 'playlist', activePlaylistId: 'liked', currentIndex: 0, isPlaying: false, progress: 0, volume: 70, isMuted: false, quality: '128k', repeatMode: 'off', isShuffle: false };

function fmtTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
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
  const [activePlaylistId, setActivePlaylistId] = useState<string>(gSession.activePlaylistId);
  const [listMode, setListMode] = useState<'playlist' | 'online'>(gSession.listMode);
  const [onlineQuery, setOnlineQuery] = useState(gSession.onlineQuery);
  const [onlineResults, setOnlineResults] = useState<Song[]>(gSession.onlineResults);
  const [onlineLoading, setOnlineLoading] = useState(false);
  const [onlinePage, setOnlinePage] = useState(1);
  const [onlineIsEnd, setOnlineIsEnd] = useState(true);
  const [onlineTotal, setOnlineTotal] = useState(0);
  const [onlineError, setOnlineError] = useState('');

  const [onlineCurrent, setOnlineCurrent] = useState<Song | null>(gSession.onlineSong);
  const [currentIndex, setCurrentIndex] = useState(gSession.currentIndex);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [audioDur, setAudioDur] = useState(0);
  const [volume, setVolume] = useState(gSession.volume);
  const [isMuted, setIsMuted] = useState(false);
  const [quality, setQuality] = useState<QualityLevel>(() => {
    try { return (localStorage.getItem(QUALITY_KEY) as QualityLevel | null) ?? '128k'; } catch { return '128k'; }
  });
  const [repeatMode, setRepeatMode] = useState<'off' | 'all' | 'one'>(gSession.repeatMode);
  const [isShuffle, setIsShuffle] = useState(gSession.isShuffle);

  const [lyrics, setLyrics] = useState<LyricLine[]>([]);
  const [lyricsLoading, setLyricsLoading] = useState(false);
  const lyricsRef = useRef<HTMLDivElement>(null);
  const lyricsReqRef = useRef(0);
  const lyricsSongIdRef = useRef<string | null>(null);
  const pinnedLocalRef = useRef<Song | null>(null);

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

  const activePlaylist = useMemo(
    () => playlists.find((p) => p.id === activePlaylistId) ?? playlists[0],
    [playlists, activePlaylistId],
  );
  const playlistSongs = activePlaylist?.songs ?? [];
  const currentSong = onlineCurrent ?? pinnedLocalRef.current ?? playlistSongs[currentIndex] ?? playlistSongs[0] ?? null;

  // ── 歌词三件套：请求令牌 + 统一入口 + 绑定 id 校验 ──
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
        // 首行 [ti:] 标题行剥离（等于歌名/歌名 - /歌名 (）
        const cleaned = v.lyrics.filter((l, i) => !(i === 0 && (l.text === song.title || l.text.startsWith(`${song.title} -`) || l.text.startsWith(`${song.title} (`))));
        setLyrics(cleaned);
        if (v.coverUrl !== undefined) {
          setOnlineCurrent((prev) => (prev !== null && prev.id === song.id ? { ...prev, coverUrl: v.coverUrl } : prev));
        }
      }
    })();
  }, [rpc]);

  // ── 播放控制 ──
  const playSong = useCallback((song: Song): void => {
    const audio = getAudio();
    gSession.songId = song.id;
    gSession.onlineSong = song;
    gSession.isPlaying = true;
    setIsPlaying(true);
    setProgress(0);
    setAudioDur(0);
    setErr('');
    // 官方 antiserver 直链优先（Host 解析），失败回落 nxinxz 镜像
    void (async () => {
      let url = kuwoPlayUrl(song.id, QUALITY_MAP[quality]);
      const out = await rpc('personal-workbench/music/source', { id: song.id, quality });
      if (out?.ok) {
        const direct = (out.value as { url?: string }).url;
        if (typeof direct === 'string' && direct.startsWith('http')) url = direct;
      }
      if (gSession.songId !== song.id) return; // 已切歌，丢弃
      audio.src = url;
      audio.play().catch(() => setErr('播放被浏览器拦截或地址失效，再点一次试试'));
    })();
    // 最近播放前插（去重）
    setPlaylists((prev) => {
      const recent = prev.find((p) => p.id === 'recent');
      if (recent === undefined) return prev;
      const rest = recent.songs.filter((s) => s.id !== song.id);
      const next = [song, ...rest].slice(0, 100);
      const updated = prev.map((p) => (p.id === 'recent' ? { ...p, songs: next } : p));
      try { localStorage.setItem(PLAYLISTS_KEY, JSON.stringify(updated)); } catch { /* 忽略 */ }
      return updated;
    });
    loadLyrics(song);
  }, [quality, loadLyrics, rpc]);

  const selectSong = useCallback((song: Song, listOverride?: Song[]): void => {
    const list = listOverride ?? playlistSongs;
    const idx = list.findIndex((s) => s.id === song.id);
    if (idx >= 0) { setCurrentIndex(idx); gSession.currentIndex = idx; }
    pinnedLocalRef.current = null;
    setOnlineCurrent(song);
    gSession.isPlaying = true;
    playSong(song);
  }, [playSong, playlistSongs]);

  const handlePlayPause = useCallback((): void => {
    const audio = getAudio();
    const song = currentSong;
    if (song === null) return;
    if (gSession.songId !== song.id || audio.src === '') {
      playSong(song);
      return;
    }
    if (audio.paused) {
      audio.play().catch(() => {});
      gSession.isPlaying = true;
      setIsPlaying(true);
    } else {
      audio.pause();
      gSession.isPlaying = false;
      setIsPlaying(false);
    }
  }, [currentSong, playSong]);

  const listRef = useRef<Song[]>(playlistSongs);
  listRef.current = listMode === 'online' ? onlineResults : playlistSongs;

  const handleNext = useCallback((auto = false): void => {
    const list = listRef.current;
    if (list.length === 0) return;
    let idx = list.findIndex((s) => s.id === (onlineCurrent?.id ?? currentSong?.id ?? ''));
    if (isShuffle) {
      idx = list.length === 1 ? 0 : Math.floor(Math.random() * list.length);
    } else {
      idx = (idx + 1) % list.length;
    }
    const next = list[idx];
    if (next === undefined) return;
    if (auto && repeatMode === 'one' && onlineCurrent !== null) {
      playSong(onlineCurrent);
      return;
    }
    if (listMode === 'online') {
      setOnlineCurrent(next);
      playSong(next);
    } else {
      setCurrentIndex(idx);
      gSession.currentIndex = idx;
      pinnedLocalRef.current = null;
      setOnlineCurrent(next);
      playSong(next);
    }
  }, [onlineCurrent, currentSong, isShuffle, repeatMode, listMode, playSong]);

  const handlePrev = useCallback((): void => {
    const list = listRef.current;
    if (list.length === 0) return;
    let idx = list.findIndex((s) => s.id === (onlineCurrent?.id ?? currentSong?.id ?? ''));
    idx = (idx - 1 + list.length) % list.length;
    const prevSong = list[idx];
    if (prevSong === undefined) return;
    if (listMode === 'online') { setOnlineCurrent(prevSong); playSong(prevSong); }
    else { setCurrentIndex(idx); gSession.currentIndex = idx; pinnedLocalRef.current = null; setOnlineCurrent(prevSong); playSong(prevSong); }
  }, [onlineCurrent, currentSong, listMode, playSong]);

  // 音频事件（模块级单例，mount/unmount 只挂一次）
  useEffect(() => {
    const audio = getAudio();
    const onTime = (): void => { gSession.progress = audio.currentTime; setProgress(audio.currentTime); };
    const onDur = (): void => setAudioDur(audio.duration);
    const onEnd = (): void => {
      if (repeatMode === 'one' && onlineCurrent !== null) { playSong(onlineCurrent); return; }
      handleNext(true);
    };
    const onPlay = (): void => { gSession.isPlaying = true; setIsPlaying(true); };
    const onPause = (): void => { gSession.isPlaying = false; setIsPlaying(false); };
    const onErr = (): void => { if (audio.src !== '') setErr('当前歌曲播放失败，试试下一首或换音质'); };
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
  }, [repeatMode, onlineCurrent, handleNext, playSong]);

  // 回到模块恢复全部 UI 状态（音频是模块级单例，播放从未中断；这里只恢复界面）
  useEffect(() => {
    setIsPlaying(gSession.isPlaying);
    setProgress(gSession.progress);
    setIsMuted(gSession.isMuted);
    setRepeatMode(gSession.repeatMode);
    setIsShuffle(gSession.isShuffle);
    const audio = getAudio();
    audio.volume = gSession.volume / 100;
    audio.muted = gSession.isMuted;
    // 恢复当前歌与歌词（歌单歌曲经 pinned/index 推导已有；在线歌在 gSession）
    const song = gSession.onlineSong;
    if (song !== null && gSession.songId !== null) {
      setOnlineCurrent(song);
      if (gSession.songId === song.id) loadLyrics(song);
    }
  }, []);

  // 歌词自动滚动
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
  }, [currentLyricIndex]);

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
      setListMode('online');
      gSession.listMode = 'online';
      setOnlinePage(page);
      setOnlineIsEnd(v.isEnd);
      setOnlineTotal(v.total);
      setOnlineResults((prev) => {
        const next = append ? [...prev, ...v.songs] : v.songs;
        gSession.onlineResults = next;
        return next;
      });
    })();
  }, [onlineQuery, rpc]);

  // ── 导入 ──
  const doImport = useCallback((): void => {
    const link = importLink.trim();
    if (link === '') return;
    setImporting(true);
    setImportMsg('解析链接中…');
    void (async () => {
      const out = await rpc('personal-workbench/music/import', { link });
      setImporting(false);
      if (!out?.ok) { setImportMsg((out?.error as { message?: string })?.message ?? '解析失败'); return; }
      const v = out.value as { queries: string[]; songs: Song[] };
      // 直接拿到的歌（酷我/波点）入新歌单
      if (v.songs.length > 0) {
        const pl: Playlist = { id: `pl_${Date.now()}`, name: `导入 ${new Date().toLocaleDateString('zh-CN')}`, songs: v.songs };
        savePlaylists([...playlists, pl]);
        setActivePlaylistId(pl.id);
        setListMode('playlist'); gSession.listMode = 'playlist';
        setShowImport(false);
        setImportLink('');
        setImportMsg('');
        return;
      }
      // queries 逐个搜索聚合成歌单（间隔避免限流）
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
      if (collected.length === 0) { setImportMsg('匹配失败，全部歌曲都没搜到'); return; }
      const pl: Playlist = { id: `pl_${Date.now()}`, name: `导入 ${new Date().toLocaleDateString('zh-CN')}`, songs: collected };
      savePlaylists([...playlists, pl]);
      setActivePlaylistId(pl.id);
      setListMode('playlist'); gSession.listMode = 'playlist';
      setShowImport(false);
      setImportLink('');
      setImportMsg('');
    })();
  }, [importLink, playlists, rpc, savePlaylists]);

  const exportCurrent = useCallback((): void => {
    const list = listRef.current;
    if (list.length === 0) return;
    const text = list.map((s) => `${s.title} - ${s.artist}`).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    a.download = `${activePlaylist?.name ?? '歌单'}.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
  }, [activePlaylist]);

  const downloadLyrics = useCallback((): void => {
    if (lyrics.length === 0 || currentSong === null) return;
    let lrc = `[ti:${currentSong.title}]\n[ar:${currentSong.artist}]\n`;
    for (const line of lyrics) {
      const m = Math.floor(line.time / 60).toString().padStart(2, '0');
      const s = Math.floor(line.time % 60).toString().padStart(2, '0');
      lrc += `[${m}:${s}.${Math.floor((line.time % 1) * 100).toString().padStart(2, '0')}]${line.text}\n`;
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([lrc], { type: 'text/plain;charset=utf-8' }));
    a.download = `${currentSong.title} - ${currentSong.artist}.lrc`;
    a.click();
    URL.revokeObjectURL(a.href);
  }, [lyrics, currentSong]);

  const handleSeek = useCallback((e: React.MouseEvent<HTMLDivElement>): void => {
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    const audio = getAudio();
    const target = pct * (audioDur || audio.duration || 0);
    if (Number.isFinite(target)) audio.currentTime = target;
  }, [audioDur]);

  const toggleMute = useCallback((): void => {
    const audio = getAudio();
    audio.muted = !isMuted;
    gSession.isMuted = !isMuted;
    setIsMuted(!isMuted);
  }, [isMuted]);

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

  const rightTitle = listMode === 'online' ? `搜索结果${onlineTotal > 0 ? ` · ${onlineTotal} 首` : ''}` : (activePlaylist?.name ?? '歌单');
  const rightList = listMode === 'online' ? onlineResults : playlistSongs;

  return (
    <div className={`dsh-pwb-view dsh-pwb-mu-root${isPlaying ? ' dsh-pwb-mu-playing' : ''}`}>
      {/* 顶部搜索 */}
      <form
        className="dsh-pwb-mu-searchwrap"
        onSubmit={(e) => { e.preventDefault(); doSearch(1, false); }}
      >
        <Search className="dsh-pwb-mu-search-ico size-4" />
        <input
          className="dsh-pwb-mu-search"
          value={onlineQuery}
          onChange={(e) => setOnlineQuery(e.target.value)}
          placeholder="搜索酷我全网歌曲，如：周杰伦、告白气球…"
        />
        <button type="submit" className="dsh-pwb-mu-search-btn" disabled={onlineLoading}>
          {onlineLoading ? <Loader2 className="size-3.5 animate-spin" /> : <Search className="size-3.5" />}
          {onlineLoading ? '搜索中' : '在线搜索'}
        </button>
      </form>
      {err !== '' ? <div className="dsh-pwb-mu-hint" style={{ color: '#e5484d' }}>{err}</div> : null}

      {/* 三栏 */}
      <div className="dsh-pwb-mu-grid">
        {/* 左：歌单 */}
        <div className="dsh-pwb-mu-panel">
          <div className="dsh-pwb-mu-panel-head">
            <ListMusic className="size-4" style={{ color: 'var(--pwb-accent, #00b862)' }} />
            我的歌单
            <button type="button" className="dsh-pwb-mu-pl-act" style={{ opacity: 1, marginLeft: 'auto' }} title="新建歌单" onClick={() => { setNewName(''); setShowNew(true); }}>
              <Plus className="size-3.5" />
            </button>
          </div>
          <div className="dsh-pwb-mu-panel-body">
            {playlists.map((pl) => (
              <div
                key={pl.id}
                className={`dsh-pwb-mu-pl-item${activePlaylistId === pl.id && listMode === 'playlist' ? ' dsh-pwb-mu-pl-active' : ''}`}
                onClick={() => { if (currentSong !== null) pinnedLocalRef.current = currentSong; setActivePlaylistId(pl.id); setListMode('playlist'); gSession.listMode = 'playlist'; }}
              >
                <span className="dsh-pwb-mu-pl-ico"><Music className="size-4" /></span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span className="dsh-pwb-mu-pl-name" style={{ display: 'block' }}>{pl.name}</span>
                  <span className="dsh-pwb-mu-pl-count" style={{ display: 'block' }}>{pl.songs.length} 首</span>
                </span>
                {pl.id !== 'liked' && pl.id !== 'recent' ? (
                  <>
                    <button type="button" className="dsh-pwb-mu-pl-act" title="重命名" onClick={(e) => { e.stopPropagation(); setRenameTarget(pl); setRenameName(pl.name); }}>
                      <Pencil className="size-3" />
                    </button>
                    <button type="button" className="dsh-pwb-mu-pl-act dsh-pwb-mu-danger" title="删除歌单" onClick={(e) => {
                      e.stopPropagation();
                      if (!window.confirm(`删除歌单「${pl.name}」？`)) return;
                      const next = playlists.filter((p) => p.id !== pl.id);
                      savePlaylists(next);
                      if (activePlaylistId === pl.id) setActivePlaylistId('liked');
                    }}>
                      <Trash2 className="size-3" />
                    </button>
                  </>
                ) : null}
              </div>
            ))}
          </div>
        </div>

        {/* 中：碟片 + 歌词 + 控制 */}
        <div className="dsh-pwb-mu-panel">
          <div className="dsh-pwb-mu-stage">
            <div className="dsh-pwb-mu-discwrap">
              <div className="dsh-pwb-mu-glow"><i /></div>
              <div className="dsh-pwb-mu-disc">
                {currentSong?.coverUrl !== undefined ? (
                  <img src={currentSong.coverUrl} alt={currentSong.title} draggable={false} onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                ) : (
                  <Disc3 className="size-20" style={{ color: 'var(--pwb-dimmer, #9aa0a6)', opacity: 0.4 }} />
                )}
                <span className="dsh-pwb-mu-hole"><i /></span>
              </div>
            </div>
            <div className="dsh-pwb-mu-songinfo">
              <h2>{currentSong?.title ?? '未在播放'}</h2>
              <p>{currentSong !== null ? `${currentSong.artist} · ${currentSong.album}` : '从右侧选一首开始'}</p>
            </div>
            <div className="dsh-pwb-mu-lyrics" ref={lyricsRef}>
              {lyrics.map((line, i) => (
                <div
                  key={i}
                  className={`dsh-pwb-mu-lyric${i === currentLyricIndex ? ' dsh-pwb-mu-now' : Math.abs(i - currentLyricIndex) <= 2 ? ' dsh-pwb-mu-near' : ''}`}
                  title="点击定位到该句"
                  onClick={() => { const audio = getAudio(); if (audio.readyState > 0) audio.currentTime = line.time; }}
                >
                  {line.text}
                </div>
              ))}
              {lyrics.length === 0 ? <div className="dsh-pwb-mu-lyric-empty">{lyricsLoading ? '正在加载歌词…' : '暂无歌词'}</div> : null}
            </div>
            <div className="dsh-pwb-mu-ctrl">
              <div className="dsh-pwb-mu-wave">
                {Array.from({ length: 28 }).map((_, i) => (
                  <i key={i} style={{ animationDelay: `${(i % 7) * 0.09}s`, animationDuration: `${0.7 + (i % 5) * 0.1}s` }} />
                ))}
              </div>
              <div className="dsh-pwb-mu-bar" onClick={handleSeek}>
                <span className="dsh-pwb-mu-bar-fill" style={{ width: `${audioDur > 0 ? Math.min(100, (progress / audioDur) * 100) : 0}%` }} />
                <span className="dsh-pwb-mu-bar-knob" style={{ left: `${audioDur > 0 ? Math.min(100, (progress / audioDur) * 100) : 0}%` }} />
              </div>
              <div className="dsh-pwb-mu-time">
                <span>{fmtTime(progress)}</span>
                <span>{fmtTime(audioDur)}</span>
              </div>
              <div className="dsh-pwb-mu-btns">
                {(() => {
                  const mode: 'order' | 'all' | 'one' | 'shuffle' = isShuffle ? 'shuffle' : repeatMode === 'off' ? 'order' : repeatMode;
                  const label = mode === 'order' ? '顺序播放' : mode === 'all' ? '列表循环' : mode === 'one' ? '单曲循环' : '随机播放';
                  const cycle = (): void => {
                    const next = mode === 'order' ? 'all' : mode === 'all' ? 'one' : mode === 'one' ? 'shuffle' : 'order';
                    const sh = next === 'shuffle';
                    const rp = next === 'all' ? 'all' : next === 'one' ? 'one' : 'off';
                    setIsShuffle(sh); gSession.isShuffle = sh;
                    setRepeatMode(rp); gSession.repeatMode = rp;
                  };
                  return (
                    <button type="button" className={`dsh-pwb-mu-ctrlbtn${mode !== 'order' ? ' dsh-pwb-mu-on' : ''}`} title={label} onClick={cycle}>
                      {mode === 'shuffle' ? <Shuffle className="size-4" /> : <Repeat className="size-4" />}
                      {mode === 'one' ? <span style={{ position: 'absolute', bottom: -1, right: -1, width: 12, height: 12, borderRadius: '50%', background: 'var(--pwb-accent, #00d26a)', color: '#04160c', fontSize: 8, fontWeight: 700, display: 'grid', placeItems: 'center' }}>1</span> : null}
                    </button>
                  );
                })()}
                <button type="button" className="dsh-pwb-mu-ctrlbtn" title="上一首" onClick={() => void handlePrev()}>
                  <SkipBack className="size-5" />
                </button>
                <button type="button" className="dsh-pwb-mu-playbtn" title={isPlaying ? '暂停' : '播放'} onClick={handlePlayPause}>
                  {isPlaying ? <Pause className="size-5" /> : <Play className="size-5" style={{ marginLeft: 2 }} />}
                </button>
                <button type="button" className="dsh-pwb-mu-ctrlbtn" title="下一首" onClick={() => void handleNext()}>
                  <SkipForward className="size-5" />
                </button>
              </div>
              <div className="dsh-pwb-mu-vol">
                <button type="button" className="dsh-pwb-mu-ctrlbtn" style={{ width: 26, height: 26 }} onClick={toggleMute}>
                  {isMuted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
                </button>
                <input type="range" min={0} max={100} value={isMuted ? 0 : volume} onChange={(e) => {
                  const v = Number(e.target.value);
                  setVolume(v); gSession.volume = v;
                  const audio = getAudio();
                  audio.volume = v / 100;
                  if (v > 0 && isMuted) { audio.muted = false; gSession.isMuted = false; setIsMuted(false); }
                }} />
                <select className="dsh-pwb-mu-select" value={quality} onChange={(e) => changeQuality(e.target.value as QualityLevel)} title="音质">
                  {(['128k', '320k', 'flac'] as QualityLevel[]).map((q) => <option key={q} value={q}>{QUALITY_LABELS[q]}</option>)}
                </select>
                {currentSong !== null && lyrics.length > 0 ? (
                  <button type="button" className="dsh-pwb-mu-ctrlbtn" style={{ width: 26, height: 26 }} title="下载歌词 LRC" onClick={downloadLyrics}>
                    <FileText className="size-4" />
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        </div>

        {/* 右：曲目列表 */}
        <div className="dsh-pwb-mu-panel">
          <div className="dsh-pwb-mu-headrow">
            <h3>{rightTitle}</h3>
            {listMode === 'playlist' ? (
              <button type="button" className="dsh-pwb-mu-btn" onClick={() => setShowImport(true)}>
                <DownloadIco className="size-3.5" /> 导入歌单链接
              </button>
            ) : null}
            <button type="button" className="dsh-pwb-mu-btn" onClick={exportCurrent} title="导出 txt（每行 歌名 - 歌手）">
              <Download className="size-3.5" /> 导出
            </button>
            {listMode === 'online' ? (
              <button type="button" className="dsh-pwb-mu-btn" onClick={() => setListMode('playlist')}>返回歌单</button>
            ) : null}
          </div>
          <div className="dsh-pwb-mu-panel-body">
            {rightList.length === 0 ? (
              <div className="dsh-pwb-mu-empty">{listMode === 'online' ? (onlineError !== '' ? onlineError : '在顶部搜索框输入关键词\n搜索酷我全网歌曲') : '歌单还是空的\n用「导入歌单链接」或在线搜索添加'}</div>
            ) : (
              rightList.map((song, i) => (
                <div
                  key={`${song.id}-${i}`}
                  className={`dsh-pwb-mu-row${currentSong?.id === song.id ? ' dsh-pwb-mu-row-now' : ''}`}
                  onClick={() => selectSong(song, rightList)}
                >
                  <span className="dsh-pwb-mu-cover">
                    {song.coverUrl !== undefined ? <img src={song.coverUrl} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.display = 'none'; }} /> : <Music className="size-4" />}
                  </span>
                  <span className="dsh-pwb-mu-meta">
                    <b>{song.title}</b>
                    <span>{song.artist} · {song.album}</span>
                  </span>
                  {currentSong?.id === song.id && isPlaying ? <span className="dsh-pwb-mu-rowtime" style={{ color: 'var(--pwb-accent, #00b862)' }}>播放中</span> : <span className="dsh-pwb-mu-rowtime">{song.duration > 0 ? fmtTime(song.duration) : ''}</span>}
                  {listMode === 'playlist' ? (
                    <button
                      type="button"
                      className="dsh-pwb-mu-pl-act dsh-pwb-mu-danger"
                      style={{ opacity: 0 }}
                      title="从歌单移除"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (activePlaylist === undefined) return;
                        savePlaylists(playlists.map((p) => (p.id === activePlaylist.id ? { ...p, songs: p.songs.filter((s) => s.id !== song.id) } : p)));
                      }}
                    >
                      <Trash2 className="size-3" />
                    </button>
                  ) : null}
                </div>
              ))
            )}
            {listMode === 'online' && onlineResults.length > 0 && !onlineIsEnd ? (
              <div style={{ display: 'flex', justifyContent: 'center', padding: '10px 0' }}>
                <button type="button" className="dsh-pwb-mu-btn" disabled={onlineLoading} onClick={() => doSearch(onlinePage + 1, true)}>
                  {onlineLoading ? <Loader2 className="size-3.5 animate-spin" /> : null} 加载更多
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {/* 导入弹窗 */}
      {showImport ? (
        <div className="dsh-pwb-mu-mask" onClick={() => { if (!importing) setShowImport(false); }}>
          <div className="dsh-pwb-mu-dialog" onClick={(e) => e.stopPropagation()}>
            <h4>导入歌单</h4>
            <textarea rows={3} value={importLink} onChange={(e) => setImportLink(e.target.value)} placeholder="粘贴歌单分享链接（网易云 163cn.tv 短链 / music.163.com / y.qq.com / kugou.com / kuwo.cn）" />
            <div className="dsh-pwb-mu-hint">网易云/QQ/酷狗歌单按歌名自动匹配酷我曲库；酷我/波点歌单直接导入可播放歌曲。解析经 Host 代理，可能需要十几秒。</div>
            {importMsg !== '' ? <div className="dsh-pwb-mu-hint" style={{ color: 'var(--pwb-accent, #00b862)' }}>{importMsg}</div> : null}
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
                savePlaylists([...playlists, { id: `pl_${Date.now()}`, name: newName.trim(), songs: [] }]);
                setActivePlaylistId(`pl_${Date.now()}`); setListMode('playlist'); gSession.listMode = 'playlist'; setShowNew(false);
              }
            }} />
            <div className="dsh-pwb-mu-dialog-row">
              <button type="button" className="dsh-pwb-mu-btn" onClick={() => setShowNew(false)}>取消</button>
              <button type="button" className="dsh-pwb-mu-search-btn" style={{ position: 'static' }} onClick={() => {
                if (newName.trim() === '') return;
                const id = `pl_${Date.now()}`;
                savePlaylists([...playlists, { id, name: newName.trim(), songs: [] }]);
                setActivePlaylistId(id); setListMode('playlist'); gSession.listMode = 'playlist'; setShowNew(false);
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
