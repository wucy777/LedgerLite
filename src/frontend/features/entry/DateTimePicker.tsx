import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { formatFullDate, formatTime, localDateKey, weekdayLabel } from '@shared/date';
import { Icon } from '../../components/Icon';
import { useBackHandler } from '../settings/overlay';
import '../../styles/date-picker.css';

/** Height of one wheel row, in px. Mirrored by --dt-row in date-picker.css. */
const ROW_HEIGHT = 40;


interface WheelItem {
  value: number;
  label: string;
}

function wheelItems(values: readonly number[], format: (value: number) => string): WheelItem[] {
  return values.map((value) => ({ value, label: format(value) }));
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function clampDay(value: number, max: number): number {
  return Math.min(Math.max(value, 1), max);
}

interface WheelProps {
  label: string;
  items: WheelItem[];
  value: number;
  onChange: (value: number) => void;
  /** Focused on open so the keyboard can drive the first wheel. */
  autoFocus?: boolean;
}

function Wheel({ label, items, value, onChange, autoFocus }: WheelProps) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<number | null>(null);
  const scrollingRef = useRef(false);
  const settleRef = useRef<number | null>(null);
  const index = Math.max(0, items.findIndex((item) => item.value === value));

  // Follow the value whenever it changes from outside this wheel (quick chips,
  // day clamping). Skipped while the user is flinging, so the fling is not fought.
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list || scrollingRef.current) return;
    const target = index * ROW_HEIGHT;
    if (Math.abs(list.scrollTop - target) > 1) list.scrollTo({ top: target, behavior: 'auto' });
  }, [index]);

  useEffect(
    () => () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      if (settleRef.current !== null) window.clearTimeout(settleRef.current);
    },
    [],
  );

  const readCentre = () => {
    const list = listRef.current;
    if (!list) return;
    const nextIndex = Math.min(items.length - 1, Math.max(0, Math.round(list.scrollTop / ROW_HEIGHT)));
    const item = items[nextIndex];
    if (item && item.value !== value) onChange(item.value);
  };

  const handleScroll = () => {
    scrollingRef.current = true;
    if (settleRef.current !== null) window.clearTimeout(settleRef.current);
    settleRef.current = window.setTimeout(() => {
      scrollingRef.current = false;
    }, 160);
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      readCentre();
    });
  };

  const step = (delta: number) => {
    const nextIndex = Math.min(items.length - 1, Math.max(0, index + delta));
    const item = items[nextIndex];
    if (!item) return;
    const list = listRef.current;
    list?.scrollTo({ top: nextIndex * ROW_HEIGHT, behavior: 'smooth' });
    onChange(item.value);
  };

  return (
    <div className="dt-wheel">
      <div
        ref={listRef}
        className="dt-wheel__list"
        role="listbox"
        aria-label={label}
        tabIndex={autoFocus ? 0 : -1}
        onScroll={handleScroll}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
          event.preventDefault();
          step(event.key === 'ArrowUp' ? -1 : 1);
        }}
      >
        <div className="dt-wheel__pad" aria-hidden="true" />
        {items.map((item, itemIndex) => (
          <button
            key={item.value}
            type="button"
            role="option"
            aria-selected={itemIndex === index}
            tabIndex={-1}
            className={`dt-wheel__item${itemIndex === index ? ' is-selected' : ''}`}
            onClick={() => step(itemIndex - index)}
          >
            {item.label}
          </button>
        ))}
        <div className="dt-wheel__pad" aria-hidden="true" />
      </div>
      <span className="dt-wheel__unit" aria-hidden="true">
        {label}
      </span>
    </div>
  );
}

interface DateTimePickerProps {
  value: string;
  onCancel: () => void;
  onConfirm: (iso: string) => void;
}

/**
 * Secondary layer for choosing the occurrence time. The entry sheet only shows a
 * compact summary row so the main form stays short.
 *
 * One group of five wheels sharing a single selection band: 年 月 日 时 分 read as
 * one control instead of two stacked tables.
 */
export function DateTimePicker({ value, onCancel, onConfirm }: DateTimePickerProps) {
  const initial = new Date(value);
  const [draft, setDraft] = useState(() => (Number.isNaN(initial.getTime()) ? new Date() : initial));
  const panelRef = useRef<HTMLDivElement | null>(null);

  useBackHandler(onCancel, '关闭时间选择', () => panelRef.current);

  useEffect(() => {
    const previous = document.activeElement;
    const timer = window.setTimeout(() => {
      panelRef.current?.querySelector<HTMLElement>('.dt-wheel__list')?.focus({ preventScroll: true });
    }, 0);
    return () => {
      window.clearTimeout(timer);
      if (previous instanceof HTMLElement && previous.isConnected) {
        previous.focus({ preventScroll: true });
      }
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      onCancel();
    };
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [onCancel]);

  const year = draft.getFullYear();
  const month = draft.getMonth() + 1;
  const day = draft.getDate();
  const hour = draft.getHours();
  const minute = draft.getMinutes();
  const maxDay = daysInMonth(year, month);

  const patch = (next: { year?: number; month?: number; day?: number; hour?: number; minute?: number }) => {
    setDraft((current) => {
      const targetYear = next.year ?? current.getFullYear();
      const targetMonth = next.month ?? current.getMonth() + 1;
      const targetDay = clampDay(next.day ?? current.getDate(), daysInMonth(targetYear, targetMonth));
      return new Date(
        targetYear,
        targetMonth - 1,
        targetDay,
        next.hour ?? current.getHours(),
        next.minute ?? current.getMinutes(),
        0,
        0,
      );
    });
  };

  const years: number[] = [];
  const thisYear = new Date().getFullYear();
  const firstYear = Math.min(thisYear, year) - 10;
  const lastYear = Math.max(thisYear, year) + 4;
  for (let cursor = firstYear; cursor <= lastYear; cursor += 1) years.push(cursor);
  const months = Array.from({ length: 12 }, (_, index) => index + 1);
  const days = Array.from({ length: maxDay }, (_, index) => index + 1);
  const hours = Array.from({ length: 24 }, (_, index) => index);
  const minutes = Array.from({ length: 60 }, (_, index) => index);

  const draftKey = localDateKey(draft);
  const todayKey = localDateKey(new Date());

  return createPortal(
    <div className="date-picker" role="dialog" aria-modal="true" aria-label="选择日期与时间">
      <div className="date-picker__scrim" aria-hidden="true" onClick={onCancel} />
      <div className="date-picker__panel" ref={panelRef}>
        <header className="date-picker__head">
          <p className="date-picker__eyebrow">发生时间</p>
          <button type="button" className="date-picker__close" aria-label="关闭" onClick={onCancel}>
            <Icon name="close" size={16} />
          </button>
        </header>

        <div className="date-picker__readout">
          <span className="date-picker__date">{formatFullDate(draftKey)}</span>
          <span className="date-picker__weekday">{weekdayLabel(draftKey)}</span>
          <span className="date-picker__time num">{formatTime(draft.toISOString())}</span>
          {draftKey === todayKey ? <span className="date-picker__badge">今天</span> : null}
        </div>

        <div className="dt-wheels">
          <span className="dt-wheels__band" aria-hidden="true" />
          <Wheel
            label="年"
            items={wheelItems(years, (item) => String(item))}
            value={year}
            onChange={(next) => patch({ year: next })}
            autoFocus
          />
          <Wheel
            label="月"
            items={wheelItems(months, (item) => String(item).padStart(2, '0'))}
            value={month}
            onChange={(next) => patch({ month: next })}
          />
          <Wheel
            label="日"
            items={wheelItems(days, (item) => String(item).padStart(2, '0'))}
            value={day}
            onChange={(next) => patch({ day: next })}
          />
          <span className="dt-wheels__split" aria-hidden="true" />
          <Wheel
            label="时"
            items={wheelItems(hours, (item) => String(item).padStart(2, '0'))}
            value={hour}
            onChange={(next) => patch({ hour: next })}
          />
          <Wheel
            label="分"
            items={wheelItems(minutes, (item) => String(item).padStart(2, '0'))}
            value={minute}
            onChange={(next) => patch({ minute: next })}
          />
        </div>

        <div className="date-picker__quick">
          <button
            type="button"
            className="date-picker__chip"
            onClick={() => setDraft(new Date())}
          >
            <Icon name="refresh" size={13} />
            现在
          </button>
          <button
            type="button"
            className="date-picker__chip"
            onClick={() => {
              const now = new Date();
              setDraft(
                new Date(
                  now.getFullYear(),
                  now.getMonth(),
                  now.getDate() - 1,
                  now.getHours(),
                  now.getMinutes(),
                ),
              );
            }}
          >
            昨天此刻
          </button>
        </div>

        <footer className="date-picker__foot">
          <button type="button" className="secondary-button" onClick={onCancel}>
            取消
          </button>
          <button type="button" className="primary-button" onClick={() => onConfirm(draft.toISOString())}>
            <Icon name="check" size={16} />
            确定
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
