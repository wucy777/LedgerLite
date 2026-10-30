export const APP_NAME = '简账';
export const APP_VERSION = '0.1.0-beta';
export const BACKUP_SCHEMA = 1;

export const ENTRY_TYPES = ['expense', 'income'] as const;
export type EntryType = (typeof ENTRY_TYPES)[number];
export type EntryFilter = EntryType | 'all';

export type IconName =
  | 'food'
  | 'transport'
  | 'shopping'
  | 'home'
  | 'fun'
  | 'health'
  | 'education'
  | 'other'
  | 'salary'
  | 'bonus'
  | 'invest'
  | 'parttime'
  | 'gift'
  | 'refund'
  | 'wallet'
  | 'wechat'
  | 'alipay'
  | 'bank'
  | 'cash'
  | 'card';

export interface Category {
  id: string;
  name: string;
  type: EntryType;
  icon: IconName;
  color: string;
  /** Archived categories stay resolvable for historical entries but are hidden from the entry picker. */
  archived: boolean;
  preset: boolean;
  sort: number;
}

export interface Account {
  id: string;
  name: string;
  icon: IconName;
  color: string;
  archived: boolean;
  preset: boolean;
  sort: number;
}

export interface Catalog {
  categories: Category[];
  accounts: Account[];
}

export interface Entry {
  id: string;
  type: EntryType;
  amountCents: number;
  categoryId: string;
  accountId: string;
  note: string;
  /** ISO-8601 instant. Display and month bucketing use the device's local time zone. */
  occurredAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface EntryDraft {
  type: EntryType;
  amountCents: number;
  categoryId: string;
  accountId: string;
  note: string;
  occurredAt: string;
}

export interface MonthSummary {
  month: string;
  expenseCents: number;
  incomeCents: number;
  balanceCents: number;
  entryCount: number;
}

export interface DailyTotal {
  /** Local calendar date, YYYY-MM-DD. */
  date: string;
  expenseCents: number;
  incomeCents: number;
  count: number;
}

export interface CategoryTotal {
  categoryId: string;
  name: string;
  icon: IconName;
  color: string;
  amountCents: number;
  count: number;
  /** Fraction in the range 0..1. */
  share: number;
}

export interface MonthStats {
  month: string;
  expenseCents: number;
  incomeCents: number;
  netCents: number;
  entryCount: number;
  activeDays: number;
  daysInMonth: number;
  averageDailyExpenseCents: number;
  peakDay: DailyTotal | null;
  daily: DailyTotal[];
  expenseCategories: CategoryTotal[];
  incomeCategories: CategoryTotal[];
}

export interface CryptoState {
  enabled: boolean;
  unlocked: boolean;
}

export interface InitResult {
  status: 'locked' | 'ready';
  crypto: CryptoState;
  catalog: Catalog | null;
  version: string;
}

export interface MonthQuery {
  month: string;
  search?: string;
  type?: EntryFilter;
}

export interface MonthResult {
  month: string;
  entries: Entry[];
  summary: MonthSummary;
}

export interface SaveEntryInput {
  id?: string;
  draft: EntryDraft;
}

export interface CategoryInput {
  name: string;
  type: EntryType;
  icon: IconName;
  color: string;
}

export interface CategoryPatch {
  name?: string;
  icon?: IconName;
  color?: string;
  archived?: boolean;
}

export interface AccountInput {
  name: string;
  icon: IconName;
  color: string;
}

export interface AccountPatch {
  name?: string;
  icon?: IconName;
  color?: string;
  archived?: boolean;
}

export interface BackupPayload {
  app: 'ledgerlite';
  schema: 1;
  version: string;
  exportedAt: string;
  entries: Entry[];
  catalog: Catalog;
}

export interface ImportResult {
  entryCount: number;
  categoryCount: number;
  accountCount: number;
  catalog: Catalog;
}

export type ErrorCode =
  | 'LOCKED'
  | 'INVALID_PASSPHRASE'
  | 'VALIDATION'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'CRYPTO_UNAVAILABLE'
  | 'STORAGE_FAILED'
  | 'IMPORT_INVALID'
  | 'UNSUPPORTED'
  | 'INTERNAL';

export interface SerializedError {
  code: ErrorCode;
  message: string;
}

export interface StorageApi {
  initialize: { params: void; result: InitResult };
  unlock: { params: { passphrase: string }; result: InitResult };
  lock: { params: void; result: InitResult };
  enableEncryption: { params: { passphrase: string }; result: InitResult };
  disableEncryption: { params: { passphrase: string }; result: InitResult };
  listMonth: { params: MonthQuery; result: MonthResult };
  getStats: { params: { month: string }; result: MonthStats };
  saveEntry: { params: SaveEntryInput; result: Entry };
  deleteEntry: { params: { id: string }; result: void };
  addCategory: { params: CategoryInput; result: Catalog };
  updateCategory: { params: { id: string; patch: CategoryPatch }; result: Catalog };
  addAccount: { params: AccountInput; result: Catalog };
  updateAccount: { params: { id: string; patch: AccountPatch }; result: Catalog };
  exportBackup: { params: void; result: BackupPayload };
  importBackup: { params: { backup: unknown }; result: ImportResult };
  resetAll: { params: void; result: InitResult };
}

export type StorageMethod = keyof StorageApi;

export type RpcRequest = {
  [K in StorageMethod]: {
    id: number;
    method: K;
    params: StorageApi[K]['params'];
  };
}[StorageMethod];

export type RpcResponse =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: SerializedError };

export class LedgerError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = 'LedgerError';
    this.code = code;
  }
}
