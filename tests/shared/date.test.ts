import { describe, expect, it } from 'vitest';
import {
  currentMonthKey,
  dateAtCurrentTime,
  datetimeLocalValue,
  dayHeading,
  daysInMonth,
  formatFullDate,
  formatMonthDay,
  fromDatetimeLocal,
  isValidDateKey,
  localDateKey,
  monthKeyOf,
  monthKeyOfIso,
  monthLabel,
  shiftMonth,
  weekdayLabel,
} from '../../src/shared/date';

describe('date utilities', () => {
  it('handles month keys across year boundaries', () => {
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(monthLabel('2026-10')).toBe('2026年10月');
    expect(daysInMonth('2024-02')).toBe(29);
    expect(daysInMonth('2026-02')).toBe(28);
  });

  it('maps local dates without relying on UTC slicing', () => {
    const date = new Date(2026, 9, 30, 23, 59);
    expect(localDateKey(date)).toBe('2026-10-30');
    expect(monthKeyOf(date)).toBe('2026-10');
    expect(monthKeyOfIso(date.toISOString())).toBe('2026-10');
    expect(currentMonthKey(date)).toBe('2026-10');
    expect(formatFullDate('2026-10-30')).toBe('2026年10月30日');
    expect(formatMonthDay('2026-10-05')).toBe('10月5日');
    expect(weekdayLabel('2026-10-30')).toBe('周五');
  });

  it('formats relative day headings', () => {
    const now = new Date(2026, 9, 30, 12, 0);
    expect(dayHeading('2026-10-30', now)).toBe('今天');
    expect(dayHeading('2026-10-29', now)).toBe('昨天');
    expect(dayHeading('2026-10-01', now)).toBe('10月1日');
  });

  it('validates date keys strictly', () => {
    expect(isValidDateKey('2024-02-29')).toBe(true);
    expect(isValidDateKey('2026-02-29')).toBe(false);
    expect(isValidDateKey('2026-13-01')).toBe(false);
    expect(isValidDateKey('2026-1-01')).toBe(false);
  });

  it('converts datetime-local values without changing wall-clock time', () => {
    const iso = fromDatetimeLocal('2026-10-30T09:05');
    expect(iso).not.toBeNull();
    expect(datetimeLocalValue(iso as string)).toBe('2026-10-30T09:05');
    const atCurrentTime = dateAtCurrentTime('2026-10-29', new Date(2026, 9, 30, 15, 4, 3));
    const parsed = new Date(atCurrentTime as string);
    expect(localDateKey(parsed)).toBe('2026-10-29');
    expect(parsed.getHours()).toBe(15);
    expect(parsed.getMinutes()).toBe(4);
  });
});
