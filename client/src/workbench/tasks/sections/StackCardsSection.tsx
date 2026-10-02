// @ts-nocheck —— 移植自 Yuze Workbench 的 TaskDashboard（原项目自带完整类型检查），此处不重复校验
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { FolderOpen, Play, Pause, Gauge, CornerDownLeft } from 'lucide-react';
import { Slider } from '../components/slider';
import { scopedStorage } from '../lib/compat';
import { desktopApi, isElectron, storageMode, type FileNode } from '../lib/compat';
import { getArchiveRoot, onArchiveChanged } from '../lib/compat';
import { useNavigate } from '../lib/compat';
import { cn } from '../lib/utils';

const BOOK_W = 96;
const BOOK_H = 104;
const DEFAULT_SPEED = 36;
const MAX_SPEED = 120;
const SPEED_KEY = 'stack_cards_speed_v1';
const loadSpeed = () => Number(scopedStorage.getItem(SPEED_KEY)) || DEFAULT_SPEED;
const saveSpeed = (v: number) => scopedStorage.setItem(SPEED_KEY, String(v));

interface ArchiveFolder {
  name: string;
  path: string;
  count: number;
}

interface BookCardProps {
  folder: ArchiveFolder;
  index: number;
  total: number;
  radius: number;
  isTop: boolean;
  hoveredIndex: number | null;
  selectedIndex: number | null;
  onHover: (i: number | null) => void;
  onSelect: (i: number) => void;
}

function BookCard({
  folder,
  index,
  total,
  radius,
  isTop,
  hoveredIndex,
  selectedIndex,
  onHover,
  onSelect,
}: BookCardProps) {
  const angle = (360 / total) * index; // 在圆环上的角度
  const isHovered = hoveredIndex === index;
  const isSelected = selectedIndex === index;
  const isDimmed =
    (hoveredIndex !== null && hoveredIndex !== index) ||
    (selectedIndex !== null && selectedIndex !== index);
  const animating = isHovered || isSelected;

  return (
    <div
      onMouseEnter={() => onHover(index)}
      onMouseLeave={() => onHover(null)}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(index);
      }}
      className="absolute left-1/2 top-1/2 cursor-grab active:cursor-grabbing select-none"
      style={{
        width: BOOK_W,
        height: BOOK_H,
        marginLeft: -BOOK_W / 2,
        marginTop: -BOOK_H / 2,
        transformStyle: 'preserve-3d',
        // 截面式排列（内边朝旋转中心、外边朝外）；选中时正面转回朝向用户并向上抽出
        transform: `rotateY(${angle}deg) translateZ(${radius}px) rotateY(${
          isSelected ? 0 : 90
        }deg)${
          isSelected
            ? ' translateY(-120px) scale(1.06)'
            : isHovered
            ? ' translateZ(16px)'
            : ''
        }`,
        transition: animating
          ? 'transform 0.55s cubic-bezier(0.16, 1, 0.3, 1), filter 0.3s ease'
          : 'filter 0.3s ease',
        filter: isDimmed ? 'brightness(0.4) saturate(0.7)' : 'brightness(1)',
        zIndex: isSelected ? 3000 : isHovered ? 2000 : 500 - index,
      }}
    >
      {/* 透明扩大命中区：截面卡正面投影退化为窄条，命中区反向旋转面向用户，保证可点 */}
      <div
        className="absolute inset-y-0 -inset-x-[30px] cursor-grab active:cursor-grabbing"
        style={{
          transform: isSelected ? 'rotateY(0deg)' : 'rotateY(-90deg)',
          transformStyle: 'preserve-3d',
        }}
        onMouseEnter={() => onHover(index)}
        onMouseLeave={() => onHover(null)}
        onClick={(e) => {
          e.stopPropagation();
          onSelect(index);
        }}
      ></div>

      {/* 卡片本体：macOS 文件夹形（本体 + 左上角标签，淡绿液态玻璃） */}
      <div className="absolute inset-0 pointer-events-none">
        {/* 本体（满宽圆角矩形） */}
        <div
          className="absolute inset-x-0 bottom-0 top-[18%] rounded-[10px] backdrop-blur-2xl overflow-hidden"
          style={{
            background:
              'linear-gradient(170deg, rgba(220,252,231,0.28) 0%, rgba(187,247,208,0.14) 42%, rgba(134,239,172,0.06) 100%)',
            boxShadow:
              'inset 0 1.5px 0 rgba(255,255,255,0.48), inset 1.5px 0 0 rgba(255,255,255,0.12), inset -1.5px 0 0 rgba(255,255,255,0.08), inset 0 -2px 4px rgba(255,255,255,0.05)',
          }}
        >
          {/* 虹彩微光 */}
          <div className="absolute inset-0" style={{ background: 'conic-gradient(from 210deg at 62% 30%, transparent 0deg, rgba(56,189,248,0.09) 55deg, transparent 115deg, rgba(167,139,250,0.08) 200deg, transparent 265deg, rgba(244,114,182,0.05) 320deg, transparent 360deg)' }}></div>
          {/* 流体波纹 */}
          <div className="absolute inset-0" style={{ background: 'repeating-linear-gradient(102deg, rgba(255,255,255,0.035) 0px, rgba(255,255,255,0.035) 1px, transparent 1px, transparent 8px)', opacity: 0.7 }}></div>
          {/* 左缘高光 */}
          <div className="absolute left-0 top-[10%] bottom-[8%] w-[2px] rounded-full bg-gradient-to-b from-white/[0.4] via-white/[0.1] to-transparent"></div>
          {/* 内容：名称 + 子项数 */}
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 px-2">
            <div className={cn('w-full text-center text-[11px] font-medium truncate', isTop ? 'text-white' : 'text-white/90')}>
              {folder.name}
            </div>
            <div className="text-[9px] text-white/45 tabular-nums">
              {folder.count} 项
            </div>
          </div>
        </div>

        {/* 标签（左上角凸起，macOS 文件夹特征） */}
        <div
          className={cn(
            'absolute left-0 top-0 h-[24%] w-[46%] rounded-tl-[10px] rounded-tr-[4px] rounded-b-[3px] border border-b-0 backdrop-blur-2xl',
            isTop ? 'border-primary/35 bg-gradient-to-b from-primary/[0.28] to-primary/[0.12]' : 'border-white/[0.18] bg-gradient-to-b from-white/[0.14] to-white/[0.06]'
          )}
        >
          <div className="absolute -top-[40%] left-[10%] w-[80%] h-[80%] rounded-[50%] bg-white/[0.18] blur-md"></div>
        </div>

        {/* 顶部接缝阴影（标签与本体连接处） */}
        <div className="absolute left-[46%] top-[18%] right-0 h-[3px] bg-gradient-to-r from-black/[0.08] to-transparent pointer-events-none"></div>
      </div>

      {/* 抽取选中态：信息展开（名称横排 + 路径 + 提示） */}
      {isSelected && (
        <div className="absolute -top-11 left-1/2 -translate-x-1/2 w-[240px] rounded-xl bg-black/60 backdrop-blur-xl border border-primary/30 shadow-[0_16px_40px_-10px_rgba(0,0,0,0.7)] p-3 pointer-events-none">
          <div className="text-[13px] font-bold text-white truncate">
            {folder.name}
          </div>
          <div className="text-[11px] text-white/55 mt-0.5 truncate">
            {folder.count} 个子项 · {folder.path}
          </div>
          <div className="flex items-center gap-1 mt-2 text-[10px] text-primary/90">
            <CornerDownLeft className="size-3" />
            再次点击跳转文件归档
          </div>
        </div>
      )}
    </div>
  );
}

function StackCardsSection() {
  const navigate = useNavigate();
  const [rotationY, setRotationY] = useState(-20); // 初始 Y 轴旋转
  const [rotationX, setRotationX] = useState(-25); // 俯视角（3D 展示台）
  const [isDragging, setIsDragging] = useState(false);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [selectionAnimating, setSelectionAnimating] = useState(false);
  const [rotateSpeed, setRotateSpeed] = useState(loadSpeed);
  const [paused, setPaused] = useState(false);
  // 归档联动数据
  const [rootPath, setRootPath] = useState<string | null>(null);
  const [folders, setFolders] = useState<ArchiveFolder[] | null>(null);
  const [loading, setLoading] = useState(true);
  const dragStartRef = useRef({ x: 0, y: 0, rotY: 0, rotX: 0 });
  const autoRotateRef = useRef<number | null>(null);
  const speedRef = useRef(DEFAULT_SPEED);
  const movedRef = useRef(false);
  const animTimerRef = useRef<number | null>(null);
  const selectedIndexRef = useRef<number | null>(null);
  const pausedRef = useRef(false);

  // 从归档根目录加载文件夹列表
  const loadFolders = useCallback(async () => {
    const root = getArchiveRoot();
    setRootPath(root);
    if (!root) {
      setFolders(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    let tree: FileNode | null = null;
    if (isElectron) {
      tree = await desktopApi.openDirectoryAt(root);
    } else if (storageMode === 'vfs') {
      tree = await desktopApi.openDirectory();
    }
    if (tree) {
      const dirs = (tree.children ?? []).filter(
        (c): c is FileNode => c.type === 'directory'
      );
      setFolders(
        dirs.map((d) => ({
          name: d.name,
          path: d.path,
          count: d.children?.length ?? 0,
        }))
      );
    } else {
      setFolders(null);
    }
    setLoading(false);
  }, []);

  // 挂载加载 + 归档联动 + 定时/聚焦刷新
  useEffect(() => {
    loadFolders();
    const off = onArchiveChanged(() => loadFolders());
    const focusH = () => loadFolders();
    window.addEventListener('focus', focusH);
    const timer = window.setInterval(loadFolders, 10000);
    return () => {
      off();
      window.removeEventListener('focus', focusH);
      clearInterval(timer);
    };
  }, [loadFolders]);

  // 同步选中索引到 ref（供指针事件判断）
  useEffect(() => {
    selectedIndexRef.current = selectedIndex;
  }, [selectedIndex]);

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  // 同步速度到 ref（供 rAF 循环实时读取，无需重启动画）
  useEffect(() => {
    speedRef.current = rotateSpeed;
  }, [rotateSpeed]);

  const list = folders ?? [];
  const totalCards = Math.max(list.length, 1);
  // 文件夹多时加大半径，避免卡片拥挤
  const cardRadius = Math.min(320, Math.max(190, 150 + totalCards * 12));
  const SCENE_SIZE = cardRadius * 2 + BOOK_W;

  // 自动旋转（未拖拽、未选中、未暂停时缓慢自转）
  const startAutoRotate = useCallback(() => {
    if (autoRotateRef.current) return;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      setRotationY((prev) => prev + dt * speedRef.current);
      autoRotateRef.current = requestAnimationFrame(tick);
    };
    autoRotateRef.current = requestAnimationFrame(tick);
  }, []);

  const stopAutoRotate = useCallback(() => {
    if (autoRotateRef.current) {
      cancelAnimationFrame(autoRotateRef.current);
      autoRotateRef.current = null;
    }
  }, []);

  // 鼠标按下开始拖拽
  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      setIsDragging(true);
      movedRef.current = false;
      stopAutoRotate();
      dragStartRef.current = {
        x: e.clientX,
        y: e.clientY,
        rotY: rotationY,
        rotX: rotationX,
      };
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    },
    [rotationY, rotationX, stopAutoRotate]
  );

  // 拖拽移动
  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!isDragging) return;
      const dx = e.clientX - dragStartRef.current.x;
      const dy = e.clientY - dragStartRef.current.y;
      if (Math.hypot(dx, dy) > 6) movedRef.current = true;
      // 水平拖动 = Y 轴旋转，垂直拖动 = X 轴旋转
      const newRotY = dragStartRef.current.rotY + dx * 0.4;
      let newRotX = dragStartRef.current.rotX - dy * 0.2;
      // 限制 X 轴旋转范围，防止翻过头
      newRotX = Math.max(-30, Math.min(30, newRotX));
      setRotationY(newRotY);
      setRotationX(newRotX);
    },
    [isDragging]
  );

  // 拖拽结束
  const handlePointerUp = useCallback(() => {
    setIsDragging(false);
    // 松手后 1 秒恢复自动旋转（选中或暂停状态下不恢复）
    setTimeout(() => {
      if (!pausedRef.current && selectedIndexRef.current === null)
        startAutoRotate();
    }, 1000);
  }, [startAutoRotate]);

  // 点击书籍卡片：未选中 → 抽取展示并转正；已选中 → 跳转文件归档定位
  const handleSelect = useCallback(
    (index: number) => {
      if (movedRef.current) return;
      if (selectedIndex === index) {
        const f = folders?.[index];
        if (f) {
          navigate(`/archive?path=${encodeURIComponent(f.path)}`);
        }
        return;
      }
      stopAutoRotate();
      setSelectedIndex(index);
      // 将该书转到正前方（最短路径）
      const angle = (360 / totalCards) * index;
      const target = -angle;
      const diff = ((target - rotationY + 540) % 360) - 180;
      setRotationY((prev) => prev + diff);
      setSelectionAnimating(true);
      if (animTimerRef.current) clearTimeout(animTimerRef.current);
      animTimerRef.current = window.setTimeout(
        () => setSelectionAnimating(false),
        850
      );
    },
    [selectedIndex, rotationY, totalCards, folders, navigate, stopAutoRotate]
  );

  // 点击空白区域取消选中
  const handleDeselect = useCallback(() => {
    if (movedRef.current) return;
    setSelectedIndex(null);
    if (!paused) startAutoRotate();
  }, [paused, startAutoRotate]);

  // 播放 / 暂停
  const togglePause = useCallback(() => {
    if (paused) {
      setPaused(false);
      if (selectedIndexRef.current === null) startAutoRotate();
    } else {
      setPaused(true);
      stopAutoRotate();
    }
  }, [paused, startAutoRotate, stopAutoRotate]);

  // 速度调节
  const handleSpeedChange = useCallback(
    (value: number[]) => {
      const speed = value[0] ?? 0;
      setRotateSpeed(speed);
      saveSpeed(speed);
      if (speed === 0) stopAutoRotate();
      else if (autoRotateRef.current === null && !paused) startAutoRotate();
    },
    [paused, startAutoRotate, stopAutoRotate]
  );

  // 组件挂载时启动自动旋转
  useEffect(() => {
    const timer = setTimeout(() => startAutoRotate(), 800);
    return () => {
      clearTimeout(timer);
      stopAutoRotate();
      if (animTimerRef.current) clearTimeout(animTimerRef.current);
    };
  }, [startAutoRotate, stopAutoRotate]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.8, delay: 0.3 }}
      className="relative w-full h-full min-h-[600px] flex items-center justify-center overflow-hidden"
      style={{ perspective: '1400px' }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onPointerLeave={handlePointerUp}
      onClick={handleDeselect}
    >
      {/* 背景光晕（书架环境光） */}
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[560px] h-[320px] rounded-full bg-primary/5 blur-[90px] pointer-events-none animate-glow"></div>
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[420px] h-[220px] rounded-full bg-white/5 blur-[80px] pointer-events-none animate-glow" style={{ animationDelay: '-2s' }}></div>

      {list.length === 0 ? (
        // 空态：未选择归档目录 / 目录无文件夹 / 加载中
        <div className="flex flex-col items-center gap-3 text-center select-none">
          {loading ? (
            <>
              <div className="size-8 rounded-full border-2 border-white/10 border-t-primary animate-spin"></div>
              <div className="text-xs text-white/40">正在读取归档目录…</div>
            </>
          ) : !rootPath ? (
            <>
              <FolderOpen className="size-10 text-white/15" strokeWidth={1.2} />
              <div className="text-sm text-white/50">
                3D 书架卡片与「文件归档」联动
              </div>
              <div className="text-xs text-white/30">
                请先在「文件归档」中选择目录，此处将环形陈列其中的文件夹
              </div>
            </>
          ) : (
            <>
              <FolderOpen className="size-10 text-white/15" strokeWidth={1.2} />
              <div className="text-sm text-white/50">本机知识库暂未连接</div>
              <div className="text-xs text-white/30">
                启动 Obsidian 后，这里会展示你知识库里的文件夹
              </div>
            </>
          )}
        </div>
      ) : (
        <>
          {/* 3D 场景容器：固定尺寸并绝对居中，旋转始终围绕场景中心 */}
          <div
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
            style={{
              width: SCENE_SIZE,
              height: SCENE_SIZE,
              transformStyle: 'preserve-3d',
            }}
          >
            {/* 旋转层 */}
            <div
              className="relative w-full h-full"
              style={{
                transformStyle: 'preserve-3d',
                transform: `rotateX(${rotationX}deg) rotateY(${rotationY}deg)`,
                transition:
                  isDragging || !selectionAnimating
                    ? 'transform 0.1s ease-out'
                    : 'transform 0.9s cubic-bezier(0.16, 1, 0.3, 1)',
                cursor: isDragging ? 'grabbing' : 'grab',
              }}
            >
              {/* 书籍卡片环（数量/名称与文件归档一致） */}
              {list.map((f, i) => (
                <BookCard
                  key={f.path}
                  folder={f}
                  index={i}
                  total={totalCards}
                  radius={cardRadius}
                  isTop={i === 0}
                  hoveredIndex={hoveredIndex}
                  selectedIndex={selectedIndex}
                  onHover={setHoveredIndex}
                  onSelect={handleSelect}
                />
              ))}

              {/* 地面软阴影（每本书底部平放椭圆投影） */}
              {list.map((f, i) => (
                <div
                  key={`shadow-${f.path}`}
                  className="absolute left-1/2 top-1/2 pointer-events-none"
                  style={{
                    width: BOOK_W + 14,
                    height: 22,
                    marginLeft: -(BOOK_W + 14) / 2,
                    marginTop: -11,
                    transform: `rotateY(${(360 / totalCards) * i}deg) translateZ(${cardRadius}px) rotateY(90deg) translateY(${BOOK_H / 2 + 14}px) rotateX(90deg)`,
                    background:
                      selectedIndex === i
                        ? 'radial-gradient(ellipse at center, rgba(0,210,106,0.4), transparent 68%)'
                        : 'radial-gradient(ellipse at center, rgba(0,210,106,0.14), transparent 46%), radial-gradient(ellipse at center, rgba(0,0,0,0.32), transparent 70%)',
                    filter: 'blur(7px)',
                  }}
                ></div>
              ))}

              {/* 地面轨道（椭圆光圈） */}
              <div
                className="absolute left-1/2 top-1/2 rounded-[50%] border border-white/[0.08] pointer-events-none"
                style={{
                  width: cardRadius * 2 + 36,
                  height: (cardRadius * 2 + 36) * 0.4,
                  marginLeft: -(cardRadius * 2 + 36) / 2,
                  marginTop: -((cardRadius * 2 + 36) * 0.4) / 2,
                  transform: `rotateX(90deg) translateY(${BOOK_H / 2 + 20}px)`,
                  boxShadow: 'inset 0 0 40px rgba(0,210,106,0.04)',
                }}
              ></div>
              <div
                className="absolute left-1/2 top-1/2 rounded-[50%] border border-primary/[0.06] pointer-events-none"
                style={{
                  width: cardRadius * 2 + 8,
                  height: (cardRadius * 2 + 8) * 0.4,
                  marginLeft: -(cardRadius * 2 + 8) / 2,
                  marginTop: -((cardRadius * 2 + 8) * 0.4) / 2,
                  transform: `rotateX(90deg) translateY(${BOOK_H / 2 + 20}px)`,
                }}
              ></div>
            </div>
          </div>

          {/* 调速控制条（贴底悬浮，选中卡片时隐藏避免遮挡） */}
          {selectedIndex === null && (
            <div
              className="absolute bottom-[30px] left-1/2 -translate-x-1/2 z-[3500] flex items-center gap-3 px-3 py-2 rounded-xl bg-black/50 backdrop-blur-xl border border-white/[0.1] shadow-lg select-none"
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <button
                onClick={togglePause}
                className="size-7 rounded-lg flex items-center justify-center bg-white/[0.06] border border-white/[0.1] text-white/80 hover:text-white hover:bg-white/[0.12] transition-all"
                title={paused ? '继续旋转' : '暂停旋转'}
              >
                {paused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
              </button>
              <div className="w-32">
                <Slider
                  value={[rotateSpeed]}
                  min={0}
                  max={MAX_SPEED}
                  step={1}
                  onValueChange={(v) => handleSpeedChange(v as number[])}
                />
              </div>
              <div className="flex items-center gap-1 min-w-[52px] justify-end text-[11px] text-white/60 tabular-nums">
                <Gauge className="size-3.5 text-primary/70" />
                <span>{rotateSpeed}°/s</span>
              </div>
            </div>
          )}

          {/* 操作提示 */}
          {selectedIndex === null && (
            <div className="absolute bottom-[6px] left-1/2 -translate-x-1/2 text-[11px] text-white/30 flex items-center gap-2 pointer-events-none">
              <span className="size-1.5 rounded-full bg-white/20"></span>
              拖拽旋转 · 点击抽取查看 · 再次点击跳转文件归档
            </div>
          )}
        </>
      )}
    </motion.div>
  );
}

export default memo(StackCardsSection);