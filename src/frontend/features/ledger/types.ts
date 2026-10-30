import type { Entry, EntryType } from '@shared/types';

export interface LedgerDayGroupData {
  /** Local calendar date, YYYY-MM-DD. */
  date: string;
  entries: Entry[];
  expenseCents: number;
  incomeCents: number;
}

export interface LedgerCategoryGroupData {
  categoryId: string;
  type: EntryType;
  entries: Entry[];
  totalCents: number;
}

export type LedgerViewMode = 'timeline' | 'category';
