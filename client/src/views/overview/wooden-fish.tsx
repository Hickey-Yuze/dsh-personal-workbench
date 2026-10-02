/**
 * 敲木鱼 —— 移植自 Yuze Workbench EntertainmentPage.WoodenFishWidget（交互 1:1）：
 * 点击敲击（缩放动画 + 浮字 + 功德 +1）、自动敲击（可调速度）、音效开关、
 * 今日/累计功德按日累计。差别：原版音效是 /muyu/*.mp3 静态文件，插件不
 * 打包音频资源，这里用 Web Audio 现场合成「笃」声（纯本地，无外链）。
 * 功德数据沿用原版 key（overview_muyu_*），结构对齐。
 */
// @ts-nocheck —— 移植自 Yuze Workbench（原项目自带类型检查），此处不重复校验

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Hammer, Volume2, VolumeX, Play, Pause } from 'lucide-react';

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

/** Web Audio 合成木鱼「笃」声：短促正弦 + 快速衰减，基频随音色序号微移。 */
function playKnock(ctx: AudioContext, soundIndex: number) {
  const t0 = ctx.currentTime;
  const base = 520 + ((soundIndex < 0 ? Math.floor(Math.random() * 4) : soundIndex % 4) * 60);
  const osc = ctx.createOscillator();
  const osc2 = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(base, t0);
  osc.frequency.exponentialRampToValueAtTime(base * 0.32, t0 + 0.09);
  osc2.type = 'triangle';
  osc2.frequency.setValueAtTime(base * 2.7, t0);
  osc2.frequency.exponentialRampToValueAtTime(base * 0.9, t0 + 0.04);
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(0.5, t0 + 0.006);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.13);
  osc.connect(gain);
  osc2.connect(gain);
  gain.connect(ctx.destination);
  osc.start(t0); osc2.start(t0);
  osc.stop(t0 + 0.14); osc2.stop(t0 + 0.06);
}

export function WoodenFishWidget() {
  const initSettings = useMemo(loadSettings, []);
  const [merit, setMerit] = useState<MeritData>(loadMerit);
  const [tapping, setTapping] = useState(false);
  const [knockCount, setKnockCount] = useState(0);
  const [autoTap, setAutoTap] = useState(initSettings.autoTap);
  const [soundIndex, setSoundIndex] = useState(initSettings.soundIndex);
  const [muted, setMuted] = useState(initSettings.muted);
  const [speedPm, setSpeedPm] = useState(initSettings.speedPm);
  const [showSpeed, setShowSpeed] = useState(false);
  const [floaters, setFloaters] = useState<{ id: number; x: number }[]>([]);
  const autoRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const floaterId = useRef(0);
  const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const audioRef = useRef<AudioContext | null>(null);

  useEffect(() => { localStorage.setItem(`dsh-pwb:${SETTINGS_KEY}`, JSON.stringify({ autoTap, soundIndex, muted, speedPm })); }, [autoTap, soundIndex, muted, speedPm]);

  const ensureAudio = useCallback(() => {
    if (!audioRef.current) audioRef.current = new AudioContext();
    if (audioRef.current.state === 'suspended') void audioRef.current.resume();
    return audioRef.current;
  }, []);

  const knock = useCallback(() => {
    setTapping(true);
    if (tapTimer.current) clearTimeout(tapTimer.current);
    tapTimer.current = setTimeout(() => setTapping(false), 120);
    setKnockCount((c) => c + 1);
    if (!muted) playKnock(ensureAudio(), soundIndex);
    // 跨日重置今日功德
    const today = todayStr();
    setMerit((m) => {
      const next: MeritData = m.lastDate === today ? { ...m, total: m.total + 1, today: m.today + 1 } : { total: m.total + 1, today: 1, lastDate: today };
      localStorage.setItem(`dsh-pwb:${MERIT_KEY}`, JSON.stringify(next));
      return next;
    });
    const id = ++floaterId.current;
    const x = 30 + Math.random() * 40;
    setFloaters((f) => [...f.slice(-5), { id, x }]);
    setTimeout(() => setFloaters((f) => f.filter((i) => i.id !== id)), 900);
  }, [ensureAudio, muted, soundIndex]);

  // 自动敲击
  useEffect(() => {
    if (autoRef.current) { clearInterval(autoRef.current); autoRef.current = null; }
    if (autoTap) autoRef.current = setInterval(() => knock(), Math.round(60000 / Math.max(10, speedPm)));
    return () => { if (autoRef.current) { clearInterval(autoRef.current); autoRef.current = null; } };
  }, [autoTap, speedPm, knock]);

  return (
    <div className="dsh-pwb-widget dsh-pwf-muyu relative flex h-full flex-col overflow-hidden">
      <div className="flex items-center gap-2 px-4 pt-3">
        <span className="grid size-7 place-items-center rounded-lg bg-amber-400/15 text-amber-400"><Hammer className="size-4" /></span>
        <span className="text-sm font-semibold text-white">敲木鱼</span>
        <div className="ml-auto flex items-center gap-1">
          <button className="rounded-lg px-2 py-1 text-[11px] text-white/50 hover:bg-white/[0.06] hover:text-white" onClick={() => setShowSpeed((v) => !v)}>
            音效{soundIndex < 0 ? '·随机' : `·${soundIndex + 1}`}
          </button>
          <button className="grid size-7 place-items-center rounded-lg text-white/50 hover:bg-white/[0.06] hover:text-white" onClick={() => setMuted((v) => !v)} title={muted ? '开启音效' : '静音'}>
            {muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
          </button>
          <button className="grid size-7 place-items-center rounded-lg text-white/50 hover:bg-white/[0.06] hover:text-white" onClick={() => setAutoTap((v) => !v)} title="自动敲击">
            {autoTap ? <Pause className="size-4 text-primary" /> : <Play className="size-4" />}
          </button>
        </div>
      </div>

      {showSpeed && (
        <div className="mx-4 mt-2 flex items-center gap-2 rounded-lg bg-white/[0.04] px-3 py-1.5 text-[11px] text-white/50">
          自动速度 {speedPm}/分
          <input type="range" min={20} max={240} step={10} value={speedPm} onChange={(e) => setSpeedPm(Number(e.target.value))} className="flex-1 accent-[var(--primary)]" />
        </div>
      )}

      <div className="relative flex flex-1 flex-col items-center justify-center gap-3 pb-3">
        <div className="flex items-end gap-6">
          <div className="text-center">
            <div className="text-lg font-bold text-white">{merit.today}</div>
            <div className="text-[10px] text-white/40">今日功德</div>
          </div>
          <div className="h-8 w-px bg-white/10" />
          <div className="text-center">
            <div className="text-lg font-bold text-amber-400">{merit.total.toLocaleString()}</div>
            <div className="text-[10px] text-white/40">累计功德</div>
          </div>
        </div>

        <button
          className={`relative grid size-24 place-items-center rounded-full transition-transform ${tapping ? 'scale-90 -rotate-3' : 'scale-100'}`}
          onClick={knock}
          title="点击敲击"
        >
          <svg viewBox="0 0 96 96" className="size-24 drop-shadow-md">
            <ellipse cx="48" cy="58" rx="34" ry="26" fill="#b98a4e" />
            <ellipse cx="48" cy="54" rx="34" ry="24" fill="#d9a962" />
            <path d="M26 52 Q48 40 70 52" stroke="#8a6236" strokeWidth="3" fill="none" strokeLinecap="round" />
            <ellipse cx="48" cy="50" rx="12" ry="7" fill="#5d4426" />
          </svg>
          <span className="absolute -top-1 left-1/2 size-4 -translate-x-1/2 rounded-full bg-stone-300 shadow" />
        </button>

        {floaters.map((f) => (
          <span key={f.id} className="dsh-pwf-floater pointer-events-none absolute text-sm font-bold text-amber-400" style={{ left: `${f.x}%` }}>
            功德 +1
          </span>
        ))}
        <div className="text-[10px] text-white/30">点击木鱼或开启自动敲击模式</div>
      </div>
    </div>
  );
}
