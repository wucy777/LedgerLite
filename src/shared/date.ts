const MONTH_PATTERN = /^(\d{4})-(\d{2})$/;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const;

export function parseMonthKey(month: string): { year: number; monthIndex: number } {
  const match = MONTH_PATTERN.exec(month);
  if (!match) throw new RangeError(`Invalid month: ${month}`);
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  if (monthIndex < 0 || monthIndex > 11) throw new RangeError(`Invalid month: ${month}`);
  return { year, monthIndex };
}

export function isMonthKey(value: string): boolean {
  try {
    parseMonthKey(value);
    return true;
  } catch {
    return false;
  }
}

export function monthKeyOf(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export function monthKeyOfIso(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) throw new RangeError(`Invalid date: ${iso}`);
  return monthKeyOf(date);
}

export function currentMonthKey(now = new Date()): string {
  return monthKeyOf(now);
}

export function shiftMonth(month: string, delta: number): string {
  const { year, monthIndex } = parseMonthKey(month);
  const date = new Date(year, monthIndex + delta, 1, 12);
  return monthKeyOf(date);
}

export function monthLabel(month: string): string {
  const { year, monthIndex } = parseMonthKey(month);
  return `${year}年${monthIndex + 1}月`;
}

export function monthShortLabel(month: string): string {
  const { monthIndex } = parseMonthKey(month);
  return `${monthIndex + 1}月`;
}

export function daysInMonth(month: string): number {
  const { year, monthIndex } = parseMonthKey(month);
  return new Date(year, monthIndex + 1, 0).getDate();
}

export function isCurrentMonth(month: string, now = new Date()): boolean {
  return month === monthKeyOf(now);
}

export function localDateKey(input: Date | string): string {
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) throw new RangeError('Invalid date');
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '--:--';
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

export function weekdayLabel(dateKey: string): string {
  const match = DATE_PATTERN.exec(dateKey);
  if (!match) return '';
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12);
  return WEEKDAYS[date.getDay()] ?? '';
}

export function dayHeading(dateKey: string, now = new Date()): string {
  const today = localDateKey(now);
  const yesterdayDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 12);
  const yesterday = localDateKey(yesterdayDate);
  if (dateKey === today) return '今天';
  if (dateKey === yesterday) return '昨天';
  return formatMonthDay(dateKey);
}

export function formatMonthDay(dateKey: string): string {
  const match = DATE_PATTERN.exec(dateKey);
  if (!match) return dateKey;
  return `${Number(match[2])}月${Number(match[3])}日`;
}

export function formatFullDate(dateKey: string): string {
  const match = DATE_PATTERN.exec(dateKey);
  if (!match) return dateKey;
  return `${Number(match[1])}年${Number(match[2])}月${Number(match[3])}日`;
}

export function datetimeLocalValue(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

export function fromDatetimeLocal(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function dateAtCurrentTime(dateKey: string, now = new Date()): string | null {
  const match = DATE_PATTERN.exec(dateKey);
  if (!match) return null;
  const date = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    now.getHours(),
    now.getMinutes(),
    now.getSeconds(),
    now.getMilliseconds(),
  );
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function isValidDateKey(value: string): boolean {
  const match = DATE_PATTERN.exec(value);
  if (!match) return false;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12);
  return localDateKey(date) === value;
}

export function dateKeyToLocalDate(dateKey: string): Date | null {
  if (!isValidDateKey(dateKey)) return null;
  const match = DATE_PATTERN.exec(dateKey);
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12);
}

export function compareMonth(a: string, b: string): number {
  return a.localeCompare(b);
}
