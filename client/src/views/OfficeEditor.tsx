/**
 * 模块：像素办公室 —— P3 地图编辑器。
 * 左侧家具目录（点选进入放置模式）+ 画布（复用 renderOffice 渲染地图，本组件叠加
 * 半透明网格线 / 放置幽灵预览 / 选中高亮 / 非法红框闪烁）+ 选中拖动删除 + 撤销重做 + 保存恢复。
 * scale/居中数学与 renderer.ts 完全一致（scale = min(cssW/MAP_W, cssH/MAP_H)）；
 * 画布 CSS 比例固定 40:12，故 ox = oy = 0，浮动删除按钮可用百分比直接定位。
 */
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactElement } from 'react';
import { FURN_SIZE, MAP_H, MAP_W, defaultMap } from '../office/map.js';
import { renderOffice } from '../office/renderer.js';
import { furnitureFits, genFurnId, loadOfficeMap, saveOfficeMap } from '../office/store.js';
import type { Furniture, FurnitureKind, OfficeMap } from '../office/types.js';

export interface OfficeEditorProps {
  /** 点击「保存」时回调（localStorage 已先行写入）。 */
  onSave: (m: OfficeMap) => void;
  /** 点击「取消」时回调。 */
  onCancel: () => void;
}

type EditAction =
  | { type: 'add'; furn: Furniture }
  | { type: 'remove'; furn: Furniture }
  | { type: 'move'; id: string; from: { x: number; y: number }; to: { x: number; y: number } }
  | { type: 'reset'; before: Furniture[]; after: Furniture[] };

const HISTORY_LIMIT = 50;
const FLASH_MS = 600;

const GREEN = '#00b45f';
const RED = '#e05050';

const CATALOG: ReadonlyArray<{ kind: FurnitureKind; name: string }> = [
  { kind: 'desk', name: '工位' },
  { kind: 'whiteboard', name: '白板' },
  { kind: 'plant', name: '绿植' },
  { kind: 'coffee', name: '咖啡机' },
  { kind: 'wall', name: '隔断墙' },
  { kind: 'microwave', name: '微波炉' },
  { kind: 'fridge', name: '冰箱' },
];

const SWATCH: Record<FurnitureKind, string> = {
  desk: '#b98a5a',
  whiteboard: '#aab2c0',
  plant: '#4c8a48',
  coffee: '#4b5563',
  wall: '#aeb6c2',
  microwave: '#e5e7eb',
  fridge: '#c9d0d9',
};

interface DragState {
  id: string;
  /** 按下点相对家具左上角的格偏移（拖动全程保持抓取手感）。 */
  dx: number;
  dy: number;
  from: { x: number; y: number };
  cur: { x: number; y: number };
  moved: boolean;
}

interface FlashState {
  x: number;
  y: number;
  w: number;
  h: number;
  until: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

/** 与 renderer.ts 相同的布局数学。 */
function getLayout(canvas: HTMLCanvasElement): { scale: number; ox: number; oy: number } {
  const cssW = canvas.clientWidth || 320;
  const cssH = canvas.clientHeight || 200;
  const scale = Math.min(cssW / MAP_W, cssH / MAP_H);
  return { scale, ox: (cssW - scale * MAP_W) / 2, oy: (cssH - scale * MAP_H) / 2 };
}

function applyForward(list: Furniture[], a: EditAction): Furniture[] {
  switch (a.type) {
    case 'add':
      return [...list, a.furn];
    case 'remove':
      return list.filter((f) => f.id !== a.furn.id);
    case 'move':
      return list.map((f) => (f.id === a.id ? { ...f, x: a.to.x, y: a.to.y } : f));
    case 'reset':
      return a.after;
  }
}

function applyInverse(list: Furniture[], a: EditAction): Furniture[] {
  switch (a.type) {
    case 'add':
      return list.filter((f) => f.id !== a.furn.id);
    case 'remove':
      return [...list, a.furn];
    case 'move':
      return list.map((f) => (f.id === a.id ? { ...f, x: a.from.x, y: a.from.y } : f));
    case 'reset':
      return a.before;
  }
}

function hitFurniture(list: Furniture[], gx: number, gy: number): Furniture | undefined {
  // 倒序命中：后放的画在上层，优先命中
  for (let i = list.length - 1; i >= 0; i--) {
    const f = list[i];
    if (f !== undefined && gx >= f.x && gx < f.x + f.w && gy >= f.y && gy < f.y + f.h) return f;
  }
  return undefined;
}

export function OfficeEditor({ onSave, onCancel }: OfficeEditorProps): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [furniture, setFurniture] = useState<Furniture[]>(() => {
    const saved = loadOfficeMap();
    return saved !== null ? saved.furniture : defaultMap().furniture;
  });
  // rAF/事件回调统一读 ref（与 state 同步更新，避免闭包旧值）
  const furnRef = useRef<Furniture[]>(furniture);

  const [placing, setPlacingState] = useState<FurnitureKind | null>(null);
  const placingRef = useRef<FurnitureKind | null>(null);
  const [selectedId, setSelectedIdState] = useState<string | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const hoverIdRef = useRef<string | null>(null);

  const ghostRef = useRef<{ x: number; y: number } | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const flashRef = useRef<FlashState | null>(null);

  const undoRef = useRef<EditAction[]>([]);
  const redoRef = useRef<EditAction[]>([]);
  const [histTick, setHistTick] = useState(0); // 仅用于触发撤销/重做按钮重渲染

  const setPlacing = (k: FurnitureKind | null): void => {
    placingRef.current = k;
    setPlacingState(k);
    if (k !== null) setSelectedId(null);
  };

  const setSelectedId = (id: string | null): void => {
    selectedIdRef.current = id;
    setSelectedIdState(id);
  };

  const setHover = (id: string | null): void => {
    if (hoverIdRef.current === id) return;
    hoverIdRef.current = id;
    setHoverId(id);
  };

  const setFurns = (next: Furniture[]): void => {
    furnRef.current = next;
    setFurniture(next);
  };

  const pushUndo = (a: EditAction): void => {
    undoRef.current = [...undoRef.current, a].slice(-HISTORY_LIMIT);
    redoRef.current = [];
    setHistTick((t) => t + 1);
  };

  const undo = (): void => {
    const a = undoRef.current[undoRef.current.length - 1];
    if (a === undefined) return;
    undoRef.current = undoRef.current.slice(0, -1);
    redoRef.current = [...redoRef.current, a];
    setFurns(applyInverse(furnRef.current, a));
    setSelectedId(null);
    setHistTick((t) => t + 1);
  };

  const redo = (): void => {
    const a = redoRef.current[redoRef.current.length - 1];
    if (a === undefined) return;
    redoRef.current = redoRef.current.slice(0, -1);
    undoRef.current = [...undoRef.current, a].slice(-HISTORY_LIMIT);
    setFurns(applyForward(furnRef.current, a));
    setSelectedId(null);
    setHistTick((t) => t + 1);
  };

  const deleteSelected = (): void => {
    const id = selectedIdRef.current;
    if (id === null) return;
    const f = furnRef.current.find((x) => x.id === id);
    if (f === undefined) return;
    setFurns(furnRef.current.filter((x) => x.id !== id));
    pushUndo({ type: 'remove', furn: f });
    setSelectedId(null);
  };

  const handleSave = (): void => {
    const m: OfficeMap = { w: MAP_W, h: MAP_H, furniture: furnRef.current };
    saveOfficeMap(m);
    onSave(m);
  };

  const handleReset = (): void => {
    const before = furnRef.current;
    const after = defaultMap().furniture;
    setFurns(after);
    pushUndo({ type: 'reset', before, after });
    setSelectedId(null);
  };

  const togglePlacing = (kind: FurnitureKind): void => {
    setPlacing(placingRef.current === kind ? null : kind);
  };

  /* ───────────── 画布指针交互 ───────────── */

  const cellOf = (e: ReactPointerEvent<HTMLCanvasElement>): { gx: number; gy: number } => {
    const { scale, ox, oy } = getLayout(e.currentTarget);
    return {
      gx: Math.floor((e.nativeEvent.offsetX - ox) / scale),
      gy: Math.floor((e.nativeEvent.offsetY - oy) / scale),
    };
  };

  const handlePointerDown = (e: ReactPointerEvent<HTMLCanvasElement>): void => {
    const { gx, gy } = cellOf(e);
    const placingKind = placingRef.current;
    if (placingKind !== null) {
      // 放置：合法入图（保持放置模式可连续放），非法红框闪烁约 0.6s 回弹
      const s = FURN_SIZE[placingKind];
      if (furnitureFits(furnRef.current, placingKind, gx, gy)) {
        const f: Furniture = { id: genFurnId(placingKind), kind: placingKind, x: gx, y: gy, w: s.w, h: s.h };
        setFurns([...furnRef.current, f]);
        pushUndo({ type: 'add', furn: f });
      } else {
        flashRef.current = { x: gx, y: gy, w: s.w, h: s.h, until: performance.now() + FLASH_MS };
      }
      return;
    }
    const hit = hitFurniture(furnRef.current, gx, gy);
    if (hit !== undefined) {
      setSelectedId(hit.id);
      dragRef.current = {
        id: hit.id,
        dx: gx - hit.x,
        dy: gy - hit.y,
        from: { x: hit.x, y: hit.y },
        cur: { x: hit.x, y: hit.y },
        moved: false,
      };
      setDragActive(true);
      try {
        e.currentTarget.setPointerCapture(e.nativeEvent.pointerId);
      } catch {
        // 指针捕获失败不致命，mouseleave 兜底结束拖动
      }
    } else {
      setSelectedId(null);
    }
  };

  const handlePointerMove = (e: ReactPointerEvent<HTMLCanvasElement>): void => {
    const { gx, gy } = cellOf(e);
    const d = dragRef.current;
    if (d !== null) {
      // 拖动：吸附整格并 clamp 在墙内；是否与它物重叠交给 rAF 红框 + 松手回弹判定
      const f = furnRef.current.find((x) => x.id === d.id);
      if (f === undefined) {
        dragRef.current = null;
        setDragActive(false);
        return;
      }
      const nx = clamp(gx - d.dx, 1, MAP_W - 1 - f.w);
      const ny = clamp(gy - d.dy, 1, MAP_H - 1 - f.h);
      if (nx !== d.cur.x || ny !== d.cur.y) d.moved = true;
      d.cur = { x: nx, y: ny };
      return;
    }
    if (placingRef.current !== null) {
      ghostRef.current = { x: gx, y: gy };
      return;
    }
    const hit = hitFurniture(furnRef.current, gx, gy);
    setHover(hit !== undefined ? hit.id : null);
  };

  const finishDrag = (): void => {
    const d = dragRef.current;
    if (d === null) return;
    dragRef.current = null;
    setDragActive(false);
    const f = furnRef.current.find((x) => x.id === d.id);
    if (f === undefined) return;
    if (d.moved && (d.cur.x !== f.x || d.cur.y !== f.y) && furnitureFits(furnRef.current, f.kind, d.cur.x, d.cur.y, d.id)) {
      setFurns(furnRef.current.map((x) => (x.id === d.id ? { ...x, x: d.cur.x, y: d.cur.y } : x)));
      pushUndo({ type: 'move', id: d.id, from: { x: f.x, y: f.y }, to: { x: d.cur.x, y: d.cur.y } });
    }
    // 非法或拖回原位：不提交，家具保持原位（回弹）
  };

  const handlePointerUp = (e: ReactPointerEvent<HTMLCanvasElement>): void => {
    try {
      e.currentTarget.releasePointerCapture(e.nativeEvent.pointerId);
    } catch {
      // 忽略：未捕获时释放无害
    }
    finishDrag();
  };

  const handlePointerLeave = (): void => {
    if (dragRef.current !== null) {
      dragRef.current = null; // 拖动中移出画布：直接回弹
      setDragActive(false);
    }
    ghostRef.current = null;
    setHover(null);
  };

  /* ───────────── rAF 重绘 + 叠加层 ───────────── */

  useEffect(() => {
    let raf = 0;
    const draw = (): void => {
      raf = requestAnimationFrame(draw);
      const canvas = canvasRef.current;
      if (canvas === null) return;
      const time = performance.now() / 1000;
      // 拖动中的家具以临时位置渲染（不写入正式状态，松手才提交/回弹）
      const d = dragRef.current;
      const drawList =
        d === null
          ? furnRef.current
          : furnRef.current.map((f) => (f.id === d.id ? { ...f, x: d.cur.x, y: d.cur.y } : f));
      renderOffice(canvas, drawList, [], time, { showNames: false });
      const ctx = canvas.getContext('2d');
      if (ctx === null) return;
      const { scale, ox, oy } = getLayout(canvas);

      // 半透明网格线（叠加在 renderOffice 之上）
      ctx.strokeStyle = 'rgba(0,0,0,0.07)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 1; i < MAP_W; i++) {
        ctx.moveTo(ox + i * scale, oy);
        ctx.lineTo(ox + i * scale, oy + MAP_H * scale);
      }
      for (let j = 1; j < MAP_H; j++) {
        ctx.moveTo(ox, oy + j * scale);
        ctx.lineTo(ox + MAP_W * scale, oy + j * scale);
      }
      ctx.stroke();

      // 选中高亮：内白外绿双描边
      const selId = selectedIdRef.current;
      if (selId !== null) {
        const sel = drawList.find((f) => f.id === selId);
        if (sel !== undefined) {
          ctx.strokeStyle = 'rgba(255,255,255,0.95)';
          ctx.lineWidth = 2;
          ctx.strokeRect(ox + sel.x * scale + 1, oy + sel.y * scale + 1, sel.w * scale - 2, sel.h * scale - 2);
          ctx.strokeStyle = 'rgba(0,180,95,0.9)';
          ctx.lineWidth = 1;
          ctx.strokeRect(ox + sel.x * scale - 1.5, oy + sel.y * scale - 1.5, sel.w * scale + 3, sel.h * scale + 3);
        }
      }

      // 拖动中非法位置：红框提示（松手回弹）
      if (d !== null) {
        const df = drawList.find((f) => f.id === d.id);
        if (df !== undefined && !furnitureFits(furnRef.current, df.kind, d.cur.x, d.cur.y, d.id)) {
          ctx.fillStyle = 'rgba(224,80,80,0.25)';
          ctx.fillRect(ox + df.x * scale, oy + df.y * scale, df.w * scale, df.h * scale);
          ctx.strokeStyle = RED;
          ctx.lineWidth = 2;
          ctx.strokeRect(ox + df.x * scale + 1, oy + df.y * scale + 1, df.w * scale - 2, df.h * scale - 2);
        }
      }

      // 放置幽灵预览：合法绿框 / 非法红框
      const placingKind = placingRef.current;
      const ghost = ghostRef.current;
      if (placingKind !== null && ghost !== null && d === null) {
        const s = FURN_SIZE[placingKind];
        const ok = furnitureFits(furnRef.current, placingKind, ghost.x, ghost.y);
        ctx.fillStyle = ok ? 'rgba(0,200,106,0.32)' : 'rgba(224,80,80,0.35)';
        ctx.fillRect(ox + ghost.x * scale, oy + ghost.y * scale, s.w * scale, s.h * scale);
        ctx.strokeStyle = ok ? GREEN : RED;
        ctx.lineWidth = 2;
        ctx.strokeRect(ox + ghost.x * scale + 1, oy + ghost.y * scale + 1, s.w * scale - 2, s.h * scale - 2);
      }

      // 非法放置红框提示（约 0.6s 渐隐）
      const fl = flashRef.current;
      if (fl !== null) {
        const remain = fl.until - performance.now();
        if (remain <= 0) {
          flashRef.current = null;
        } else {
          const alpha = Math.max(0.15, Math.min(0.5, (remain / FLASH_MS) * 0.5));
          ctx.fillStyle = `rgba(224,80,80,${alpha.toFixed(3)})`;
          ctx.fillRect(ox + fl.x * scale, oy + fl.y * scale, fl.w * scale, fl.h * scale);
          ctx.strokeStyle = RED;
          ctx.lineWidth = 2;
          ctx.strokeRect(ox + fl.x * scale + 1, oy + fl.y * scale + 1, fl.w * scale - 2, fl.h * scale - 2);
        }
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  /* ───────────── 键盘快捷键（Ctrl/Cmd+Z 撤销、Ctrl/Cmd+Shift+Z 或 Ctrl/Cmd+Y 重做） ───────────── */

  const keyHandlerRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keyHandlerRef.current = (e: KeyboardEvent): void => {
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    if (mod && !e.shiftKey && key === 'z') {
      e.preventDefault();
      undo();
    } else if (mod && ((e.shiftKey && key === 'z') || key === 'y')) {
      e.preventDefault();
      redo();
    } else if (e.key === 'Escape') {
      setPlacing(null);
      setSelectedId(null);
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIdRef.current !== null) {
      e.preventDefault();
      deleteSelected();
    }
  };

  useEffect(() => {
    const fn = (e: KeyboardEvent): void => keyHandlerRef.current(e);
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, []);

  /* ───────────── 渲染 ───────────── */

  const canUndo = undoRef.current.length > 0;
  const canRedo = redoRef.current.length > 0;
  const selFurn = selectedId !== null ? furniture.find((f) => f.id === selectedId) : undefined;
  const cursor = placing !== null ? 'copy' : dragActive ? 'grabbing' : hoverId !== null ? 'move' : 'default';

  const btnBase: CSSProperties = {
    padding: '6px 16px',
    borderRadius: 8,
    border: '1px solid rgba(127,127,127,0.35)',
    background: 'rgba(127,127,127,0.10)',
    color: 'inherit',
    fontSize: 13,
    cursor: 'pointer',
  };

  return (
    <div className="dsh-pwb-office-ed" style={{ display: 'flex', gap: 12, width: '100%', alignItems: 'stretch' }}>
      {/* 左侧家具目录 */}
      <aside
        className="dsh-pwb-office-ed-catalog"
        style={{ width: 150, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 6 }}
      >
        <div className="dsh-pwb-office-ed-catalog-title" style={{ fontSize: 12, fontWeight: 700, opacity: 0.65, padding: '2px 2px 0' }}>
          家具目录
        </div>
        {CATALOG.map((c) => {
          const active = placing === c.kind;
          const s = FURN_SIZE[c.kind];
          return (
            <button
              key={c.kind}
              type="button"
              className={`dsh-pwb-office-ed-catalog-item${active ? ' dsh-pwb-office-ed-catalog-item-active' : ''}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                width: '100%',
                padding: '8px 10px',
                borderRadius: 8,
                cursor: 'pointer',
                textAlign: 'left',
                color: 'inherit',
                fontSize: 13,
                border: `1px solid ${active ? 'var(--pwb-accent, #00c853)' : 'rgba(127,127,127,0.25)'}`,
                background: active ? 'rgba(0,200,110,0.12)' : 'rgba(127,127,127,0.08)',
              }}
              onClick={() => togglePlacing(c.kind)}
            >
              <span
                style={{ width: 18, height: 18, borderRadius: 4, background: SWATCH[c.kind], border: '1px solid rgba(0,0,0,0.18)', flexShrink: 0 }}
              />
              <span style={{ flex: 1, minWidth: 0 }}>
                <b style={{ display: 'block', fontWeight: 600 }}>{c.name}</b>
                <i style={{ fontStyle: 'normal', fontSize: 11, opacity: 0.6 }}>
                  {s.w}×{s.h} 格
                </i>
              </span>
            </button>
          );
        })}
        <div className="dsh-pwb-office-ed-catalog-tip" style={{ marginTop: 'auto', fontSize: 11, lineHeight: 1.6, opacity: 0.55, padding: '4px 2px' }}>
          点选家具进入放置模式，点击画布放置；再点该目录项或按 Esc 退出。
        </div>
      </aside>

      {/* 右侧：工具条 + 画布 + 底部按钮 */}
      <div className="dsh-pwb-office-ed-main" style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div className="dsh-pwb-office-ed-toolbar" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            type="button"
            className="dsh-pwb-office-ed-btn"
            style={{ ...btnBase, padding: '4px 12px', opacity: canUndo ? 1 : 0.4, cursor: canUndo ? 'pointer' : 'not-allowed' }}
            disabled={!canUndo}
            onClick={() => undo()}
          >
            ↩ 撤销
          </button>
          <button
            type="button"
            className="dsh-pwb-office-ed-btn"
            style={{ ...btnBase, padding: '4px 12px', opacity: canRedo ? 1 : 0.4, cursor: canRedo ? 'pointer' : 'not-allowed' }}
            disabled={!canRedo}
            onClick={() => redo()}
          >
            ↪ 重做
          </button>
          <span style={{ flex: 1 }} />
          <span className="dsh-pwb-office-ed-hint" style={{ fontSize: 12, opacity: 0.6 }}>
            {placing !== null
              ? `放置模式：${CATALOG.find((c) => c.kind === placing)?.name ?? ''} —— 点击画布放置，Esc 退出`
              : '点击家具选中，拖动移动，选中后可删除'}
          </span>
        </div>

        <div className="dsh-pwb-office-ed-canvas-wrap" style={{ position: 'relative', width: '100%', flex: 1, minHeight: 0 }}>
          <canvas
            ref={canvasRef}
            className="dsh-pwb-office-ed-canvas"
            style={{ width: '100%', height: '100%', display: 'block', borderRadius: 8, cursor, touchAction: 'none' }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerLeave={handlePointerLeave}
          />
          {selFurn !== undefined && !dragActive && (() => {
            // 删除按钮按实时布局定位（画布不再固定 40:12，地图垂直居中后百分比会错位）
            const cw = canvasRef.current?.clientWidth ?? 0;
            const chh = canvasRef.current?.clientHeight ?? 0;
            const sc = Math.min(cw / MAP_W, chh / MAP_H);
            const ox = (cw - sc * MAP_W) / 2;
            const oy = (chh - sc * MAP_H) / 2;
            return (
            <button
              type="button"
              className="dsh-pwb-office-ed-del"
              title="删除选中家具"
              style={{
                position: 'absolute',
                left: ox + (selFurn.x + selFurn.w) * sc - 24,
                top: oy + selFurn.y * sc + 3,
                width: 20,
                height: 20,
                padding: 0,
                borderRadius: 6,
                border: 'none',
                background: RED,
                color: '#fff',
                fontSize: 13,
                lineHeight: '20px',
                cursor: 'pointer',
                boxShadow: '0 1px 4px rgba(0,0,0,0.35)',
                zIndex: 2,
              }}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                deleteSelected();
              }}
            >
              ×
            </button>
            );
          })()}
        </div>

        <div className="dsh-pwb-office-ed-footer" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            type="button"
            className="dsh-pwb-office-ed-btn dsh-pwb-office-ed-btn-primary"
            style={{ ...btnBase, background: 'var(--pwb-accent, #00c853)', borderColor: 'transparent', color: '#fff', fontWeight: 600 }}
            onClick={() => handleSave()}
          >
            保存
          </button>
          <button type="button" className="dsh-pwb-office-ed-btn" style={btnBase} onClick={() => handleReset()}>
            恢复默认
          </button>
          <span style={{ flex: 1 }} />
          <button type="button" className="dsh-pwb-office-ed-btn" style={btnBase} onClick={() => onCancel()}>
            取消
          </button>
        </div>
      </div>
    </div>
  );
}
