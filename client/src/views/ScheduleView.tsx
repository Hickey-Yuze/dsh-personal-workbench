/**
 * 模块：日常管理（日程）——插件自有数据，落盘 <dataDir>/events.json。
 * 月历 + 当日清单 + 就地新增，全部离线可用。
 */
import { useEffect, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import type { ScheduleEvent } from '../../../src/contract.js';
import { t } from '../i18n.js';
import type { RpcFn } from '../rpc.js';
import { useKv } from '../store.js';
import { humanDate, nowIso, toDateStr, todayStr, uid } from '../util.js';
import { lunarOf } from '../util/lunar.js';
import { loadAutoWeather, wmo } from '../util/wmo.js';

const WEEK = ['日', '一', '二', '三', '四', '五', '六'];

interface Cell {
  date: string;
  day: number;
  inMonth: boolean;
  isToday: boolean;
}

function buildMonth(year: number, month: number): Cell[] {
  const today = todayStr();
  const first = new Date(year, month, 1);
  const start = new Date(year, month, 1 - first.getDay());
  const cells: Cell[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const date = toDateStr(d);
    cells.push({ date, day: d.getDate(), inMonth: d.getMonth() === month, isToday: date === today });
  }
  return cells;
}

function Almanac({ date, weather }: { date: string; weather: ReturnType<typeof loadAutoWeather> }): ReactElement {
  const l = lunarOf(date);
  const day = weather?.daily.find((d) => d.date === date);
  const cur = weather !== null ? wmo(weather.code) : null;
  const dayW = day !== undefined ? wmo(day.code) : null;
  return (
    <div className="dsh-pwb-almanac">
      <span className="dsh-pwb-almanac-date">{l.festival !== undefined ? `${l.festival} · ` : ''}{l.monthDay} · {l.yearGZ}年 · {l.zodiac}</span>
      <span className="dsh-pwb-almanac-yi">宜 {l.yi.slice(0, 4).join(' · ')}</span>
      <span className="dsh-pwb-almanac-ji">忌 {l.ji.slice(0, 4).join(' · ')}</span>
      {dayW !== null && day !== undefined ? (
        <span className="dsh-pwb-almanac-weather" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--pwb-text, #1c1c22)', fontWeight: 600 }}>
          <dayW.Icon className="size-3.5" /> {dayW.label} {Math.round(day.min)}~{Math.round(day.max)}°
          {cur !== null && weather !== null ? ` · 现在 ${Math.round(weather.temp)}° ${cur.label}` : ''}
        </span>
      ) : null}
    </div>
  );
}

export function ScheduleView({ rpc }: { rpc: RpcFn }): ReactElement {
  const { value: events, save, loading } = useKv<ScheduleEvent[]>(rpc, 'events', []);
  const today = todayStr();
  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    return { y: d.getFullYear(), m: d.getMonth() };
  });
  const [selected, setSelected] = useState<string>(today);
  const [title, setTitle] = useState('');
  const [holidays, setHolidays] = useState<Record<string, { holiday: boolean; name: string }>>({});
  const [weather, setWeather] = useState(loadAutoWeather);
  const [startTime, setStartTime] = useState('');
  const [location, setLocation] = useState('');

  const cells = useMemo(() => buildMonth(cursor.y, cursor.m), [cursor]);

  // 天气：复用总览天气卡的共享缓存；无缓存时经 geo/ip 定位静默拉一次
  useEffect(() => {
    let dead = false;
    void (async () => {
      const cached = loadAutoWeather();
      const fresh = cached !== null && Date.now() - new Date(cached.updated).getTime() < 30 * 60 * 1000;
      if (fresh && !dead) { setWeather(cached); return; }
      try {
        const geo = await rpc('personal-workbench/geo/ip', {});
        if (!geo?.ok || dead) { if (cached !== null && !dead) setWeather(cached); return; }
        const gv = geo.value as { lat: number; lon: number; city: string };
        const out = await rpc('personal-workbench/weather/fetch', { lat: gv.lat, lon: gv.lon, fallbackPlace: gv.city });
        if (out?.ok && !dead) {
          const v = out.value as unknown;
          setWeather(v as never);
          try { localStorage.setItem('dsh-pwb:overview_weather_auto_v1', JSON.stringify(v)); } catch { /* 容量满忽略 */ }
        } else if (cached !== null && !dead) {
          setWeather(cached);
        }
      } catch {
        if (cached !== null && !dead) setWeather(cached);
      }
    })();
    return () => { dead = true; };
  }, [rpc]);

  // 法定节假日调休（Host 代理 holiday-cn/timor，多源降级）；拉取失败不显示徽章，不造假
  useEffect(() => {
    let dead = false;
    void (async () => {
      try {
        const out = await rpc('personal-workbench/holidays/fetch', { year: cursor.y });
        if (!out?.ok || dead) return;
        setHolidays((out.value ?? {}) as Record<string, { holiday: boolean; name: string }>);
      } catch { /* 静默：无徽章 */ }
    })();
    return () => { dead = true; };
  }, [cursor.y, rpc]);

  const byDate = useMemo(() => {
    const map = new Map<string, ScheduleEvent[]>();
    for (const e of events) {
      const list = map.get(e.date) ?? [];
      list.push(e);
      map.set(e.date, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => (a.startTime ?? '99').localeCompare(b.startTime ?? '99'));
    }
    return map;
  }, [events]);

  const dayItems = byDate.get(selected) ?? [];
  const upcoming = useMemo(
    () => events.filter((e) => e.date >= today && e.done !== true).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 3),
    [events, today],
  );

  const shift = (delta: number): void => {
    setCursor((prev) => {
      const d = new Date(prev.y, prev.m + delta, 1);
      return { y: d.getFullYear(), m: d.getMonth() };
    });
  };

  const add = (): void => {
    const text = title.trim();
    if (text === '') return;
    const item: ScheduleEvent = {
      id: uid(),
      title: text,
      date: selected,
      createdAt: nowIso(),
      ...(startTime !== '' ? { startTime } : {}),
      ...(location.trim() !== '' ? { location: location.trim() } : {}),
    };
    save((prev) => [...prev, item]);
    setTitle('');
    setStartTime('');
    setLocation('');
  };

  const toggle = (id: string): void => {
    save((prev) => prev.map((e) => (e.id === id ? { ...e, done: e.done !== true } : e)));
  };

  const remove = (id: string): void => {
    save((prev) => prev.filter((e) => e.id !== id));
  };

  return (
    <div className="dsh-pwb-view">
      <div className="dsh-pwb-toolbar">
        <button type="button" className="dsh-pwb-btn" onClick={() => shift(-1)} aria-label={t('sched.prevMonth')}>
          ‹
        </button>
        <span className="dsh-pwb-month">
          {cursor.y} 年 {cursor.m + 1} 月
        </span>
        <button type="button" className="dsh-pwb-btn" onClick={() => shift(1)} aria-label={t('sched.nextMonth')}>
          ›
        </button>
        <button
          type="button"
          className="dsh-pwb-btn"
          onClick={() => {
            const d = new Date();
            setCursor({ y: d.getFullYear(), m: d.getMonth() });
            setSelected(todayStr());
          }}
        >
          {t('sched.today')}
        </button>
        <span className="dsh-pwb-toolbar-right">{t('sched.total')}：{events.length}</span>
      </div>

      <div className="dsh-pwb-view-body">
        <div className="dsh-pwb-cal">
          {WEEK.map((w) => (
            <div key={w} className="dsh-pwb-mcal-head">
              {w}
            </div>
          ))}
          {cells.map((c) => {
            const list = byDate.get(c.date) ?? [];
            return (
              <button
                key={c.date}
                type="button"
                className={[
                  'dsh-pwb-mcal-cell',
                  c.inMonth ? '' : 'dsh-pwb-mcal-out',
                  c.isToday ? 'dsh-pwb-mcal-today' : '',
                  c.date === selected ? 'dsh-pwb-mcal-sel' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => setSelected(c.date)}
              >
                <span className="dsh-pwb-mcal-day">{c.day}{c.isToday ? <i className="dsh-pwb-mcal-now">今</i> : null}</span>
                {(() => {
                  const l = lunarOf(c.date);
                  const hol = holidays[c.date];
                  const dw = weather?.daily.find((d) => d.date === c.date);
                  const W = dw !== undefined ? wmo(dw.code).Icon : null;
                  return (
                    <>
                      <span className={l.festival !== undefined ? (l.festival.includes('节') ? 'dsh-pwb-mcal-lunar dsh-pwb-mcal-festival' : 'dsh-pwb-mcal-lunar dsh-pwb-mcal-jieqi') : 'dsh-pwb-mcal-lunar'}>{l.festival ?? l.short}</span>
                      {hol !== undefined ? <span className={`dsh-pwb-mcal-hol${hol.holiday ? '' : ' dsh-pwb-mcal-ban'}`}>{hol.holiday ? '休' : '班'}</span> : null}
                      {W !== null && dw !== undefined ? (
                        <span className="dsh-pwb-mcal-weather" title={`${wmo(dw.code).label} ${Math.round(dw.min)}~${Math.round(dw.max)}°`}>
                          <W className="size-3" /> {Math.round(dw.max)}°
                        </span>
                      ) : null}
                    </>
                  );
                })()}
                {list.length > 0 ? (
                  <span className="dsh-pwb-mcal-evs">
                    {list.slice(0, 2).map((e) => (
                      <span key={e.id} className={`dsh-pwb-mcal-ev${e.done === true ? ' dsh-pwb-mcal-ev-done' : ''}`}>{e.title}</span>
                    ))}
                    {list.length > 2 ? <span className="dsh-pwb-mcal-more">+{list.length - 2} 更多</span> : null}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>

        <div className="dsh-pwb-day-panel">
          <div className="dsh-pwb-day-head">
            <span className="dsh-pwb-day-title">{humanDate(selected)}</span>
            <span className="dsh-pwb-day-count">{dayItems.length} {t('sched.items')}</span>
          </div>
          <Almanac date={selected} weather={weather} />

          <div className="dsh-pwb-toolbar dsh-pwb-toolbar-inline">
            <input
              className="dsh-pwb-input dsh-pwb-input-grow"
              placeholder={t('sched.placeholder')}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') add();
              }}
            />
            <input
              className="dsh-pwb-input dsh-pwb-input-time"
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
            />
            <input
              className="dsh-pwb-input dsh-pwb-input-mid"
              placeholder={t('sched.location')}
              value={location}
              onChange={(e) => setLocation(e.target.value)}
            />
            <button type="button" className="dsh-pwb-btn dsh-pwb-btn-primary" onClick={add}>
              {t('sched.add')}
            </button>
          </div>

          {loading ? (
            <div className="dsh-pwb-empty">{t('common.loading')}</div>
          ) : dayItems.length === 0 ? (
            <div className="dsh-pwb-empty">{t('sched.emptyDay')}</div>
          ) : (
            dayItems.map((e) => (
              <div key={e.id} className={`dsh-pwb-item${e.done === true ? ' dsh-pwb-item-done' : ''}`}>
                <button
                  type="button"
                  className={`dsh-pwb-check${e.done === true ? ' dsh-pwb-check-on' : ''}`}
                  onClick={() => toggle(e.id)}
                  aria-label={t('sched.done')}
                >
                  {e.done === true ? '✓' : ''}
                </button>
                {e.startTime !== undefined ? <span className="dsh-pwb-time">{e.startTime}</span> : null}
                <span className="dsh-pwb-item-title">{e.title}</span>
                {e.location !== undefined ? <span className="dsh-pwb-tag">{e.location}</span> : null}
                <button
                  type="button"
                  className="dsh-pwb-item-del"
                  onClick={() => remove(e.id)}
                  aria-label={t('common.delete')}
                >
                  ×
                </button>
              </div>
            ))
          )}

          {upcoming.length > 0 ? (
            <div className="dsh-pwb-side">
              <div className="dsh-pwb-side-head">{t('sched.upcoming')}</div>
              {upcoming.map((e) => (
                <div key={e.id} className="dsh-pwb-side-row">
                  <span className="dsh-pwb-side-date">{e.date.slice(5)}</span>
                  <span className="dsh-pwb-item-title">{e.title}</span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
