import { createDefaultLedger, DEFAULT_LEDGER_ID } from '../shared/defaults';
import { LedgerError } from '../shared/types';

export const DB_NAME = 'ledgerlite';
export const DB_VERSION = 2;
export const ENTRY_STORE = 'entries';
export const KV_STORE = 'kv';
export const LEDGER_STORE = 'ledgers';
export const MONTH_INDEX = 'monthTag';
export const LEDGER_INDEX = 'ledgerId';
export const LEDGER_MONTH_INDEX = 'ledgerMonth';

/** Catalog records live under a per-ledger key so each ledger owns an independent catalog. */
export function catalogKey(ledgerId: string): string {
  return `catalog:${ledgerId}`;
}

/** Promise facade over one IDB transaction. All calls below are backed by the same transaction. */
export interface TransactionContext {
  get<T>(store: string, key: IDBValidKey): Promise<T | undefined>;
  getAll<T>(store: string): Promise<T[]>;
  getAllByIndex<T>(store: string, indexName: string, query: IDBValidKey | IDBKeyRange): Promise<T[]>;
  getAllKeysByIndex(store: string, indexName: string, query: IDBValidKey | IDBKeyRange): Promise<IDBValidKey[]>;
  put(store: string, value: unknown): Promise<IDBValidKey>;
  delete(store: string, key: IDBValidKey): Promise<void>;
  clear(store: string): Promise<void>;
}

function storageFailure(): LedgerError {
  return new LedgerError('STORAGE_FAILED', '本地存储操作失败');
}

function toLedgerError(error: unknown): LedgerError {
  if (error instanceof LedgerError) return error;
  return storageFailure();
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(storageFailure());
  });
}

function createContext(transaction: IDBTransaction): TransactionContext {
  return {
    get<T>(store: string, key: IDBValidKey): Promise<T | undefined> {
      return requestResult(transaction.objectStore(store).get(key) as IDBRequest<T | undefined>);
    },
    getAll<T>(store: string): Promise<T[]> {
      return requestResult(transaction.objectStore(store).getAll() as IDBRequest<T[]>);
    },
    getAllByIndex<T>(store: string, indexName: string, query: IDBValidKey | IDBKeyRange): Promise<T[]> {
      return requestResult(transaction.objectStore(store).index(indexName).getAll(query) as IDBRequest<T[]>);
    },
    getAllKeysByIndex(store: string, indexName: string, query: IDBValidKey | IDBKeyRange): Promise<IDBValidKey[]> {
      return requestResult(
        transaction.objectStore(store).index(indexName).getAllKeys(query) as IDBRequest<IDBValidKey[]>,
      );
    },
    put(store: string, value: unknown): Promise<IDBValidKey> {
      return requestResult(transaction.objectStore(store).put(value));
    },
    delete(store: string, key: IDBValidKey): Promise<void> {
      return requestResult(transaction.objectStore(store).delete(key));
    },
    clear(store: string): Promise<void> {
      return requestResult(transaction.objectStore(store).clear());
    },
  };
}

/**
 * v1 kept a single catalog under kv['catalog'] and no ledgerId on entries. The upgrade only adds the
 * new top-level `ledgerId` and moves the catalog key; payloads (including encrypted ones) are copied
 * byte-for-byte so a migration never needs the passphrase.
 */
function migrateFromV1(transaction: IDBTransaction, entryStore: IDBObjectStore): void {
  const cursorRequest = entryStore.openCursor();
  cursorRequest.onsuccess = () => {
    const cursor = cursorRequest.result;
    if (!cursor) return;
    const record = cursor.value as Record<string, unknown> & { ledgerId?: unknown };
    if (record.ledgerId !== DEFAULT_LEDGER_ID) {
      cursor.update({ ...record, ledgerId: DEFAULT_LEDGER_ID });
    }
    cursor.continue();
  };

  const kvStore = transaction.objectStore(KV_STORE);
  const legacyCatalogRequest = kvStore.get('catalog');
  legacyCatalogRequest.onsuccess = () => {
    const record = legacyCatalogRequest.result as { key: string } & Record<string, unknown> | undefined;
    if (!record) return;
    const migrated = kvStore.put({ ...record, key: catalogKey(DEFAULT_LEDGER_ID) });
    migrated.onsuccess = () => {
      kvStore.delete('catalog');
    };
  };

  const ledgerStore = transaction.objectStore(LEDGER_STORE);
  const defaultLedgerRequest = ledgerStore.get(DEFAULT_LEDGER_ID);
  defaultLedgerRequest.onsuccess = () => {
    if (!defaultLedgerRequest.result) {
      ledgerStore.put(createDefaultLedger());
    }
  };
}

/**
 * Only synchronous IDB calls are allowed here: an upgrade transaction cannot await a non-IDB promise,
 * so the migration is driven entirely by request `onsuccess` callbacks.
 */
function upgradeDatabase(db: IDBDatabase, transaction: IDBTransaction, oldVersion: number): void {
  let entryStore: IDBObjectStore;
  if (!db.objectStoreNames.contains(ENTRY_STORE)) {
    entryStore = db.createObjectStore(ENTRY_STORE, { keyPath: 'id' });
  } else {
    entryStore = transaction.objectStore(ENTRY_STORE);
  }
  if (!entryStore.indexNames.contains(MONTH_INDEX)) {
    entryStore.createIndex(MONTH_INDEX, 'monthTag', { unique: false });
  }
  if (!entryStore.indexNames.contains(LEDGER_INDEX)) {
    entryStore.createIndex(LEDGER_INDEX, 'ledgerId', { unique: false });
  }
  if (!entryStore.indexNames.contains(LEDGER_MONTH_INDEX)) {
    entryStore.createIndex(LEDGER_MONTH_INDEX, ['ledgerId', 'monthTag'], { unique: false });
  }
  if (!db.objectStoreNames.contains(KV_STORE)) {
    db.createObjectStore(KV_STORE, { keyPath: 'key' });
  }
  if (!db.objectStoreNames.contains(LEDGER_STORE)) {
    db.createObjectStore(LEDGER_STORE, { keyPath: 'id' });
  }
  if (oldVersion > 0 && oldVersion < 2) {
    migrateFromV1(transaction, entryStore);
  }
}

/**
 * Thin native-IndexedDB wrapper. The IDBFactory is injected so the same engine can run in
 * the browser, in a Web Worker and inside tests without touching global state.
 */
export class LedgerDatabase {
  private dbPromise: Promise<IDBDatabase> | null = null;

  constructor(
    private readonly factory: IDBFactory,
    private readonly name: string = DB_NAME,
  ) {}

  open(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;
    const promise = new Promise<IDBDatabase>((resolve, reject) => {
      let request: IDBOpenDBRequest;
      try {
        request = this.factory.open(this.name, DB_VERSION);
      } catch {
        reject(storageFailure());
        return;
      }
      request.onupgradeneeded = (event) => {
        const transaction = request.transaction;
        if (!transaction) return;
        upgradeDatabase(request.result, transaction, event.oldVersion);
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => db.close();
        resolve(db);
      };
      request.onerror = () => reject(storageFailure());
      request.onblocked = () => reject(new LedgerError('STORAGE_FAILED', '本地存储被占用，请关闭其他标签页'));
    });
    this.dbPromise = promise;
    void promise.catch(() => {
      if (this.dbPromise === promise) this.dbPromise = null;
    });
    return promise;
  }

  async close(): Promise<void> {
    if (!this.dbPromise) return;
    const promise = this.dbPromise;
    this.dbPromise = null;
    try {
      const db = await promise;
      db.close();
    } catch {
      // Nothing to close when opening failed.
    }
  }

  async get<T>(store: string, key: IDBValidKey): Promise<T | undefined> {
    return this.run([store], 'readonly', (tx) => tx.get<T>(store, key));
  }

  async getAll<T>(store: string): Promise<T[]> {
    return this.run([store], 'readonly', (tx) => tx.getAll<T>(store));
  }

  async getAllByIndex<T>(store: string, indexName: string, query: IDBValidKey | IDBKeyRange): Promise<T[]> {
    return this.run([store], 'readonly', (tx) => tx.getAllByIndex<T>(store, indexName, query));
  }

  /**
   * Runs `work` inside a single transaction. Resolves after the transaction commits, so every
   * write made through the context is durable and atomic across all stores in `stores`.
   */
  async run<T>(
    stores: readonly string[],
    mode: IDBTransactionMode,
    work: (tx: TransactionContext) => Promise<T>,
  ): Promise<T> {
    const db = await this.open();
    return new Promise<T>((resolve, reject) => {
      let transaction: IDBTransaction;
      try {
        transaction = db.transaction([...stores], mode);
      } catch {
        reject(storageFailure());
        return;
      }
      let settled = false;
      let result!: T;
      let workFailure: unknown;

      const fail = (error: unknown): void => {
        if (settled) return;
        settled = true;
        reject(toLedgerError(error));
      };

      transaction.oncomplete = () => {
        if (settled) return;
        settled = true;
        resolve(result);
      };
      transaction.onerror = () => fail(transaction.error);
      transaction.onabort = () => fail(workFailure ?? transaction.error);

      work(createContext(transaction)).then(
        (value) => {
          result = value;
        },
        (error: unknown) => {
          workFailure = error;
          try {
            transaction.abort();
          } catch {
            // Transaction already finished; the rejection below still wins because it settled first.
          }
          fail(error);
        },
      );
    });
  }
}
