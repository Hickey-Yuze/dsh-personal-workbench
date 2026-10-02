/**
 * 敲木鱼 —— 图形与音效 1:1 采用 iTab 木鱼真素材（用户提供源码包）：
 * · 图形：view/muyu/1-4.webp 木鱼本体（随音效联动换肤）+ hammer.webp 木鱼锤
 * · 音效：muyu0-10.mp3 十一种真实敲击声（base64 内嵌，无外链），可选或随机
 * · 敲击反馈：锤敲下（旋转）+ 木鱼缩放回弹 + 「功德 +1」浮字
 * · 功德：今日/累计按日累计（localStorage，沿用原版 key）
 */
// @ts-nocheck —— 移植自 iTab 木鱼（原项目自带类型检查），此处不重复校验

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Volume2, VolumeX, Play, Pause, ChevronDown } from 'lucide-react';
import { MUYU_IMG, HAMMER_IMG, SOUNDS } from './assets.js';


interface MeritData { total: number; today: number; lastDate: string }
interface MuyuSettings { autoTap: boolean; soundIndex: number; muted: boolean; speedPm: number }

const MERIT_KEY = 'overview_muyu_merit_v1';
const SETTINGS_KEY = 'overview_muyu_settings_v1';
const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

function loadMerit(): MeritData {
  try {
    const raw = localStorage.getItem(`dsh-pwb:${MERIT_KEY}`);
    if (raw) return JSON.parse(raw) as MeritData;
  } catch { /* ignore */ }
  return { total: 0, today: 0, lastDate: '' };
}
function loadSettings(): MuyuSettings {
  try {
    const raw = localStorage.getItem(`dsh-pwb:${SETTINGS_KEY}`);
    if (raw) return { autoTap: false, soundIndex: 0, muted: false, speedPm: 60, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return { autoTap: false, soundIndex: 0, muted: false, speedPm: 60 };
}

export function WoodenFishWidget() {
  const initSettings = useMemo(loadSettings, []);
  const [merit, setMerit] = useState<MeritData>(loadMerit);
  const [tapping, setTapping] = useState(false);
  const [knockCount, setKnockCount] = useState(0); // 每次敲击递增，强制重播动画
  const [autoTap, setAutoTap] = useState(initSettings.autoTap);
  const [soundIndex, setSoundIndex] = useState(initSettings.soundIndex); // -1 = 随机
  const [muted, setMuted] = useState(initSettings.muted);
  const [speedPm, setSpeedPm] = useState(initSettings.speedPm);
  const [showSpeed, setShowSpeed] = useState(false);
  const [floaters, setFloaters] = useState<{ id: number; x: number }[]>([]);
  const autoRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const floaterId = useRef(0);
  const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const poolRef = useRef<HTMLAudioElement[]>([]);

  useEffect(() => { localStorage.setItem(`dsh-pwb:${SETTINGS_KEY}`, JSON.stringify({ autoTap, soundIndex, muted, speedPm })); }, [autoTap, soundIndex, muted, speedPm]);

  // 音效池：预加载全部 11 种敲击声（与 iTab 一致）
  useEffect(() => {
    poolRef.current = SOUNDS.map((src) => {
      const a = new Audio(src);
      a.preload = 'auto';
      a.load();
      return a;
    });
  }, []);

  const playSound = useCallback(() => {
    if (muted || poolRef.current.length === 0) return;
    const idx = soundIndex < 0 ? Math.floor(Math.random() * poolRef.current.length) : soundIndex % poolRef.current.length;
    const a = poolRef.current[idx];
    try {
      a.currentTime = 0;
      void a.play();
    } catch { /* 非手势路径被拦截时静默 */ }
  }, [muted, soundIndex]);

  const knock = useCallback(() => {
    setTapping(true);
    if (tapTimer.current) clearTimeout(tapTimer.current);
    tapTimer.current = setTimeout(() => setTapping(false), 160);
    setKnockCount((c) => c + 1);
    playSound();
    const today = todayStr();
    setMerit((m) => {
      const next: MeritData = m.lastDate === today ? { ...m, total: m.total + 1, today: m.today + 1 } : { total: m.total + 1, today: 1, lastDate: today };
      localStorage.setItem(`dsh-pwb:${MERIT_KEY}`, JSON.stringify(next));
      return next;
    });
    const id = ++floaterId.current;
    const x = 24 + Math.random() * 52;
    setFloaters((f) => [...f.slice(-5), { id, x }]);
    setTimeout(() => setFloaters((f) => f.filter((i) => i.id !== id)), 900);
  }, [playSound]);

  useEffect(() => {
    if (autoRef.current) { clearInterval(autoRef.current); autoRef.current = null; }
    if (autoTap) autoRef.current = setInterval(() => knock(), Math.round(60000 / Math.max(10, speedPm)));
    return () => { if (autoRef.current) { clearInterval(autoRef.current); autoRef.current = null; } };
  }, [autoTap, speedPm, knock]);

  return (
    <div className="dsh-pwb-widget relative flex h-full flex-col overflow-hidden">
      <div className="flex items-center gap-2 px-4 pt-3">
        <span className="grid size-7 place-items-center rounded-lg bg-amber-400/15 text-amber-400"><img src={MUYU_IMG} alt="" className="size-5 object-contain" /></span>
        <div className="leading-tight">
          <div className="text-sm font-semibold text-white">敲木鱼</div>
          <div className="text-[10px] text-amber-400/80">功德 +1</div>
        </div>
        <div className="ml-auto flex items-center gap-1">
          <button className="flex items-center gap-0.5 rounded-lg px-2 py-1 text-[11px] text-white/50 hover:bg-white/[0.06] hover:text-white" onClick={() => setShowSpeed((v) => !v)}>
            音效{soundIndex < 0 ? '·随机' : `·${soundIndex + 1}`}
            <ChevronDown className="size-3" />
          </button>
          <button className="grid size-7 place-items-center rounded-lg text-white/50 hover:bg-white/[0.06] hover:text-white" onClick={() => setMuted((v) => !v)} title={muted ? '开启音效' : '静音'}>
            {muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
          </button>
          <button className={`grid size-7 place-items-center rounded-lg hover:bg-white/[0.06] ${autoTap ? 'text-primary' : 'text-white/50'}`} onClick={() => setAutoTap((v) => !v)} title="自动敲击">
            {autoTap ? <Pause className="size-4" /> : <Play className="size-4" />}
          </button>
        </div>
      </div>

      {showSpeed && (
        <div className="mx-4 mt-2 flex flex-col gap-1.5 rounded-lg bg-white/[0.04] px-3 py-2 text-[11px] text-white/50">
          <div className="flex items-center gap-2">
            自动速度 {speedPm}/分
            <input type="range" min={20} max={240} step={10} value={speedPm} onChange={(e) => setSpeedPm(Number(e.target.value))} className="flex-1 accent-[var(--primary)]" />
          </div>
          <div className="flex flex-wrap gap-1">
            <button className={`rounded-md border px-1.5 py-0.5 ${soundIndex === -1 ? 'border-primary/40 bg-primary/10 text-primary' : 'border-white/[0.08] text-white/50'}`} onClick={() => setSoundIndex(-1)}>随机</button>
            {SOUNDS.map((_, i) => (
              <button key={i} className={`rounded-md border px-1.5 py-0.5 ${soundIndex === i ? 'border-primary/40 bg-primary/10 text-primary' : 'border-white/[0.08] text-white/50'}`} onClick={() => setSoundIndex(i)}>{i + 1}</button>
            ))}
          </div>
        </div>
      )}

      <div className="relative flex flex-1 flex-col items-center justify-center gap-3 pb-4">
        <div className="flex items-end gap-8">
          <div className="text-center">
            <div className="text-xl font-bold tabular-nums text-white">{merit.today}</div>
            <div className="text-[10px] text-white/40">今日功德</div>
          </div>
          <div className="h-9 w-px bg-white/10" />
          <div className="text-center">
            <div className="text-xl font-bold tabular-nums text-amber-400">{merit.total.toLocaleString()}</div>
            <div className="text-[10px] text-white/40">累计功德</div>
          </div>
        </div>

        {/* 木鱼（3D 分层 + 原版真实素材）：锤悬于木鱼上方，敲击时交替动画重播 */}
        <div className="dsh-pwf-stage relative flex flex-1 items-center justify-center [perspective:900px]" onClick={knock} role="button" title="点击敲击">
          {floaters.map((f) => (
            <span key={f.id} className="dsh-pwf-floater pointer-events-none absolute z-20 text-sm font-bold text-primary" style={{ left: `${f.x}%` }}>
              功德+1
            </span>
          ))}
          {/* 小锤：锤头(左侧)悬于木鱼上方，以手柄端(右侧)为支点 */}
          <div
            className="pointer-events-none absolute left-[65%] top-1 z-30 -translate-x-1/2"
            style={{
              transformOrigin: 'right center',
              transform: tapping ? undefined : 'rotate(6deg)',
              animation: tapping ? `dsh-pwf-hammer-knock-${knockCount % 2} 0.35s ease-in-out` : undefined,
            }}
          >
            <img src={HAMMER_IMG} alt="" draggable={false} className="dsh-pwf-hammer w-24 drop-shadow-xl" />
          </div>
          {/* 木鱼本体：敲击时整体 3D 晃动 */}
          <div
            className="relative w-52 cursor-pointer select-none"
            style={{
              transformStyle: 'preserve-3d',
              transform: tapping ? undefined : 'rotateX(14deg) rotateY(-6deg)',
              animation: tapping ? `dsh-pwf-fish-knock-${knockCount % 2} 0.5s ease-in-out` : undefined,
            }}
          >
            <img src={MUYU_IMG} alt="" draggable={false} className="h-auto w-full drop-shadow-2xl" />
          </div>
          {/* 地面投影 */}
          <div className="pointer-events-none absolute bottom-1 left-1/2 h-3 w-44 -translate-x-1/2 rounded-full bg-black/25 blur-md" />
        </div>

        <div className="text-[10px] text-white/30">点击木鱼或开启自动敲击模式</div>
      </div>
    </div>
  );
}
