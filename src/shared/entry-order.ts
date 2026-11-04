import type { Entry } from './types';

function minuteOf(iso: string): number {
  const value = Date.parse(iso);
  return Number.isNaN(value) ? 0 : Math.floor(value / 60_000);
}

/**
 * Newest occurrence first. Occurrence timestamps are compared at minute
 * precision, so entries in the same hour and minute fall back to creation
 * order. updatedAt is intentionally ignored.
 */
export function compareEntryRecency(
  a: Pick<Entry, 'occurredAt' | 'createdAt'>,
  b: Pick<Entry, 'occurredAt' | 'createdAt'>,
): number {
  const occurrence = minuteOf(b.occurredAt) - minuteOf(a.occurredAt);
  if (occurrence !== 0) return occurrence;
  return Date.parse(b.createdAt) - Date.parse(a.createdAt);
}
