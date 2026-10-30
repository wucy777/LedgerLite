import type { Entry } from '@shared/types';

export interface LedgerDayGroupData {
  /** Local calendar date, YYYY-MM-DD. */
  date: string;
  entries: Entry[];
  expenseCents: number;
  incomeCents: number;
}
