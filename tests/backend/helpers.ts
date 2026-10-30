import { indexedDB } from 'fake-indexeddb';
import { LedgerEngine } from '../../src/backend/engine';
import { DEFAULT_LEDGER_ID } from '../../src/shared/defaults';
import type { Entry, EntryDraft } from '../../src/shared/types';

export { DEFAULT_LEDGER_ID };

let sequence = 0;

export interface TestEngine {
  engine: LedgerEngine;
  dbName: string;
}

export interface TestEngineOptions {
  now?: () => Date;
  generateId?: () => string;
}

export async function createEngine(options: TestEngineOptions = {}): Promise<TestEngine> {
  const dbName = `ledgerlite-test-${Date.now()}-${sequence}`;
  sequence += 1;
  const engine = new LedgerEngine({
    factory: indexedDB,
    dbName,
    now: options.now,
    generateId: options.generateId,
  });
  const init = await engine.initialize();
  if (init.status !== 'ready') throw new Error('测试数据库初始化失败');
  return { engine, dbName };
}

export async function closeEngine(context: TestEngine): Promise<void> {
  await context.engine.close();
  await deleteDatabase(context.dbName);
}

export function deleteDatabase(name: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error('deleteDatabase failed'));
    request.onblocked = () => reject(new Error('deleteDatabase blocked'));
  });
}

/** Monotonic clock so createdAt/updatedAt ordering is deterministic. */
export function tickClock(start = new Date('2026-03-01T08:00:00.000Z')): () => Date {
  let tick = start.getTime();
  return () => {
    const value = new Date(tick);
    tick += 1000;
    return value;
  };
}

/** Builds an instant whose local calendar date is the requested one. */
export function localIso(year: number, month: number, day: number, hour = 12, minute = 0): string {
  return new Date(year, month - 1, day, hour, minute, 0, 0).toISOString();
}

export function expenseDraft(overrides: Partial<EntryDraft> = {}): EntryDraft {
  return {
    type: 'expense',
    amountCents: 1000,
    categoryId: 'cat_food',
    accountId: 'acc_wechat',
    note: '',
    occurredAt: localIso(2026, 3, 5),
    ...overrides,
  };
}

export function incomeDraft(overrides: Partial<EntryDraft> = {}): EntryDraft {
  return {
    type: 'income',
    amountCents: 100_000,
    categoryId: 'cat_salary',
    accountId: 'acc_wechat',
    note: '',
    occurredAt: localIso(2026, 3, 5),
    ...overrides,
  };
}

export async function saveExpense(
  engine: LedgerEngine,
  ledgerId: string = DEFAULT_LEDGER_ID,
  overrides: Partial<EntryDraft> = {},
): Promise<Entry> {
  return engine.saveEntry({ ledgerId, draft: expenseDraft(overrides) });
}

export async function saveIncome(
  engine: LedgerEngine,
  ledgerId: string = DEFAULT_LEDGER_ID,
  overrides: Partial<EntryDraft> = {},
): Promise<Entry> {
  return engine.saveEntry({ ledgerId, draft: incomeDraft(overrides) });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

export function openRawDatabase(name: string): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(name);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('open failed'));
  });
}

export async function rawGetAll<T>(dbName: string, storeName: string): Promise<T[]> {
  const db = await openRawDatabase(dbName);
  try {
    const transaction = db.transaction(storeName, 'readonly');
    return await requestResult(transaction.objectStore(storeName).getAll() as IDBRequest<T[]>);
  } finally {
    db.close();
  }
}

export async function rawGet<T>(dbName: string, storeName: string, key: IDBValidKey): Promise<T | undefined> {
  const db = await openRawDatabase(dbName);
  try {
    const transaction = db.transaction(storeName, 'readonly');
    return await requestResult(transaction.objectStore(storeName).get(key) as IDBRequest<T | undefined>);
  } finally {
    db.close();
  }
}

export async function rawPut(dbName: string, storeName: string, value: unknown): Promise<void> {
  const db = await openRawDatabase(dbName);
  try {
    const transaction = db.transaction(storeName, 'readwrite');
    await requestResult(transaction.objectStore(storeName).put(value));
  } finally {
    db.close();
  }
}
