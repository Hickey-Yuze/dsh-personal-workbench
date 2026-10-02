/**
 * 模块：日常管理（日程）——插件自有数据，落盘 <dataDir>/events.json。
 * 月历 + 当日清单 + 就地新增，全部离线可用。
 */
import { useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import type { ScheduleEvent } from '../../../src/contract.js';
import { t } from '../i18n.js';
import type { RpcFn } from '../rpc.js';
import { useKv } from '../store.js';
import { humanDate, nowIso, toDateStr, todayStr, uid } from '../util.js';

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

export function ScheduleView({ rpc }: { rpc: RpcFn }): ReactElement {
  const { value: events, save, loading } = useKv<ScheduleEvent[]>(rpc, 'events', []);
  const today = todayStr();
  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    return { y: d.getFullYear(), m: d.getMonth() };
  });
  const [selected, setSelected] = useState<string>(today);
  const [title, setTitle] = useState('');
  const [startTime, setStartTime] = useState('');
  const [location, setLocation] = useState('');

  const cells = useMemo(() => buildMonth(cursor.y, cursor.m), [cursor]);

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
            <div key={w} className="dsh-pwb-cal-head">
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
                  'dsh-pwb-cal-cell',
                  c.inMonth ? '' : 'dsh-pwb-cal-out',
                  c.isToday ? 'dsh-pwb-cal-today' : '',
                  c.date === selected ? 'dsh-pwb-cal-sel' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => setSelected(c.date)}
              >
                <span className="dsh-pwb-cal-day">{c.day}</span>
                {list.length > 0 ? (
                  <span className="dsh-pwb-cal-dots">
                    {list.slice(0, 3).map((e) => (
                      <i key={e.id} className={e.done === true ? 'dsh-pwb-dot-done' : 'dsh-pwb-dot-live'} />
                    ))}
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
