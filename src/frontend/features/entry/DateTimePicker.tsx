import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { formatFullDate, formatTime, localDateKey, weekdayLabel } from '@shared/date';
import { Icon } from '../../components/Icon';
import { useBackHandler } from '../settings/overlay';
import '../../styles/date-picker.css';

const ROW_HEIGHT = 34;
const WEEKDAY_SHORT = ['日', '一', '二', '三', '四', '五', '六'] as const;

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
}

function Wheel({ label, items, value, onChange }: WheelProps) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const settleRef = useRef<number | null>(null);
  const index = Math.max(0, items.findIndex((item) => item.value === value));

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const target = index * ROW_HEIGHT;
    if (Math.abs(list.scrollTop - target) > 2) {
      list.scrollTo({ top: target, behavior: 'auto' });
    }
  }, [index]);

  useEffect(
    () => () => {
      if (settleRef.current !== null) window.clearTimeout(settleRef.current);
    },
    [],
  );

  const commit = () => {
    const list = listRef.current;
    if (!list) return;
    const nextIndex = Math.min(items.length - 1, Math.max(0, Math.round(list.scrollTop / ROW_HEIGHT)));
    const item = items[nextIndex];
    if (!item) return;
    list.scrollTo({ top: nextIndex * ROW_HEIGHT, behavior: 'smooth' });
    if (item.value !== value) onChange(item.value);
  };

  return (
    <div className="wheel">
      <div
        ref={listRef}
        className="wheel__list"
        role="listbox"
        aria-label={label}
        tabIndex={0}
        onScroll={() => {
          if (settleRef.current !== null) window.clearTimeout(settleRef.current);
          settleRef.current = window.setTimeout(commit, 110);
        }}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
          event.preventDefault();
          const delta = event.key === 'ArrowUp' ? -1 : 1;
          const nextIndex = Math.min(items.length - 1, Math.max(0, index + delta));
          const item = items[nextIndex];
          if (item) onChange(item.value);
        }}
      >
        {items.map((item, itemIndex) => (
          <button
            key={item.value}
            type="button"
            role="option"
            aria-selected={itemIndex === index}
            tabIndex={-1}
            className={`wheel__item${itemIndex === index ? ' is-selected' : ''}`}
            onClick={() => onChange(item.value)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <span className="wheel__unit">{label}</span>
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
 */
export function DateTimePicker({ value, onCancel, onConfirm }: DateTimePickerProps) {
  const initial = new Date(value);
  const [draft, setDraft] = useState(() => (Number.isNaN(initial.getTime()) ? new Date() : initial));
  const panelRef = useRef<HTMLDivElement | null>(null);

  useBackHandler(onCancel, '关闭时间选择');

  useEffect(() => {
    const previous = document.activeElement;
    const timer = window.setTimeout(() => {
      panelRef.current?.querySelector<HTMLElement>('.wheel__list')?.focus({ preventScroll: true });
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
          <div>
            <p className="date-picker__eyebrow">发生时间</p>
            <h2 className="date-picker__title">
              {formatFullDate(draftKey)}
              <span>{weekdayLabel(draftKey)}</span>
            </h2>
          </div>
          <button type="button" className="date-picker__close" aria-label="关闭" onClick={onCancel}>
            <Icon name="close" size={16} />
          </button>
        </header>

        <p className="date-picker__preview num">
          {formatTime(draft.toISOString())}
          {draftKey === todayKey ? <span className="date-picker__badge">今天</span> : null}
        </p>

        <div className="date-picker__wheels">
          <div className="date-picker__row">
            <Wheel
              label="年"
              items={wheelItems(years, (item) => String(item))}
              value={year}
              onChange={(next) => patch({ year: next })}
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
          </div>
          <div className="date-picker__row date-picker__row--time">
            <Wheel
              label="时"
              items={wheelItems(hours, (item) => String(item).padStart(2, '0'))}
              value={hour}
              onChange={(next) => patch({ hour: next })}
            />
            <span className="date-picker__colon" aria-hidden="true">
              :
            </span>
            <Wheel
              label="分"
              items={wheelItems(minutes, (item) => String(item).padStart(2, '0'))}
              value={minute}
              onChange={(next) => patch({ minute: next })}
            />
            <span className="date-picker__weekday">{`周${WEEKDAY_SHORT[draft.getDay()] ?? ''}`}</span>
          </div>
        </div>

        <div className="date-picker__quick">
          <button
            type="button"
            onClick={() => setDraft(new Date())}
            className="date-picker__chip"
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
          <button
            type="button"
            className="primary-button"
            onClick={() => onConfirm(draft.toISOString())}
          >
            <Icon name="check" size={16} />
            确定
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
