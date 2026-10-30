import { LedgerError } from '../shared/types';

export const DB_NAME = 'ledgerlite';
export const DB_VERSION = 1;
export const ENTRY_STORE = 'entries';
export const KV_STORE = 'kv';
export const MONTH_INDEX = 'monthTag';

/** Promise facade over one IDB transaction. All calls below are backed by the same transaction. */
export interface TransactionContext {
  get<T>(store: string, key: IDBValidKey): Promise<T | undefined>;
  getAll<T>(store: string): Promise<T[]>;
  getAllByIndex<T>(store: string, indexName: string, query: IDBValidKey | IDBKeyRange): Promise<T[]>;
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
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(ENTRY_STORE)) {
          const store = db.createObjectStore(ENTRY_STORE, { keyPath: 'id' });
          store.createIndex(MONTH_INDEX, 'monthTag', { unique: false });
        }
        if (!db.objectStoreNames.contains(KV_STORE)) {
          db.createObjectStore(KV_STORE, { keyPath: 'key' });
        }
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
