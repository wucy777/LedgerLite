import { indexedDB } from 'fake-indexeddb';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CATALOG_AAD,
  SALT_BYTES,
  createVerifier,
  deriveKeys,
  encryptJson,
  entryAad,
  hmacHex,
  randomBytes,
} from '../../src/backend/crypto';
import { LedgerEngine } from '../../src/backend/engine';
import { createDefaultCatalog, DEFAULT_LEDGER_ID } from '../../src/shared/defaults';
import type { Catalog, Entry } from '../../src/shared/types';
import {
  deleteDatabase,
  expenseDraft,
  localIso,
  openRawDatabase,
  rawGet,
  rawGetAll,
} from './helpers';

type StoredPayload<T> =
  | { encrypted: false; value: T }
  | { encrypted: true; iv: ArrayBuffer; data: ArrayBuffer };

interface V1EntryRecord {
  id: string;
  monthTag: string;
  payload: StoredPayload<Entry>;
}

interface V1CatalogRecord {
  key: string;
  payload: StoredPayload<Catalog>;
}

interface MigratedEntryRecord {
  id: string;
  ledgerId?: string;
  monthTag: string;
  payload: StoredPayload<Entry>;
  value?: Entry;
}

interface MigratedLedgerRecord {
  id: string;
  name: string;
  color: string;
  createdAt: string;
  updatedAt: string;
  sort: number;
}

const engines: LedgerEngine[] = [];
const dbNames = new Set<string>();

afterEach(async () => {
  for (const engine of engines) await engine.close();
  engines.length = 0;
  for (const name of dbNames) await deleteDatabase(name);
  dbNames.clear();
});

function openV1(name: string): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      const entries = db.createObjectStore('entries', { keyPath: 'id' });
      entries.createIndex('monthTag', 'monthTag', { unique: false });
      db.createObjectStore('kv', { keyPath: 'key' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('v1 open failed'));
  });
}

async function writeV1(name: string, entries: V1EntryRecord[], kv: unknown[]): Promise<void> {
  const db = await openV1(name);
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['entries', 'kv'], 'readwrite');
      const entryStore = tx.objectStore('entries');
      const kvStore = tx.objectStore('kv');
      for (const record of entries) entryStore.put(record);
      for (const record of kv) kvStore.put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('v1 seed failed'));
      tx.onabort = () => reject(tx.error ?? new Error('v1 seed aborted'));
    });
  } finally {
    db.close();
  }
}

function openMigratedEngine(dbName: string): LedgerEngine {
  const engine = new LedgerEngine({ factory: indexedDB, dbName });
  engines.push(engine);
  return engine;
}

function buildLegacyEntry(overrides: Partial<Entry> = {}): Entry {
  return {
    id: 'legacy-entry',
    type: 'expense',
    amountCents: 1234,
    categoryId: 'cat_food',
    accountId: 'acc_wechat',
    note: '迁移前记录',
    occurredAt: localIso(2026, 3, 5, 12),
    createdAt: '2026-03-05T04:00:00.000Z',
    updatedAt: '2026-03-05T04:00:00.000Z',
    ...overrides,
  };
}

function withCustomCategory(catalog: Catalog): Catalog {
  const next = {
    categories: catalog.categories.map((category) => ({ ...category })),
    accounts: catalog.accounts.map((account) => ({ ...account })),
  };
  next.categories.push({
    id: 'cat_legacy_only',
    name: '旧自定义分类',
    type: 'expense',
    icon: 'other',
    color: '#334455',
    archived: false,
    preset: false,
    sort: 99,
  });
  return next;
}

describe('v1 数据库迁移到 v2', () => {
  it('明文 v1 老库补齐 ledgerId、迁移 catalog key 并创建默认账本', async () => {
    const dbName = `ledgerlite-v1-plain-${Date.now()}`;
    dbNames.add(dbName);
    const marchEntry = buildLegacyEntry();
    const februaryEntry = buildLegacyEntry({
      id: 'legacy-feb',
      amountCents: 5000,
      note: '二月旧记录',
      occurredAt: localIso(2026, 2, 18, 9),
      createdAt: '2026-02-18T01:00:00.000Z',
      updatedAt: '2026-02-18T01:00:00.000Z',
    });
    const legacyCatalog = withCustomCategory(createDefaultCatalog());
    await writeV1(
      dbName,
      [
        { id: marchEntry.id, monthTag: '2026-03', payload: { encrypted: false, value: marchEntry } },
        { id: februaryEntry.id, monthTag: '2026-02', payload: { encrypted: false, value: februaryEntry } },
      ],
      [{ key: 'catalog', payload: { encrypted: false, value: legacyCatalog } }],
    );

    const engine = openMigratedEngine(dbName);
    const init = await engine.initialize();
    expect(init.status).toBe('ready');
    expect(init.ledgers).toHaveLength(1);
    expect(init.ledgers[0]).toMatchObject({ id: DEFAULT_LEDGER_ID, name: '默认账本', sort: 0 });
    expect(init.ledger?.id).toBe(DEFAULT_LEDGER_ID);
    expect(init.catalog).toEqual(legacyCatalog);

    const march = await engine.listMonth({ ledgerId: DEFAULT_LEDGER_ID, month: '2026-03' });
    expect(march.entries).toHaveLength(1);
    expect(march.entries[0]).toEqual(marchEntry);
    expect((await engine.getStats(DEFAULT_LEDGER_ID, '2026-03')).expenseCents).toBe(1234);
    const february = await engine.listMonth({ ledgerId: DEFAULT_LEDGER_ID, month: '2026-02' });
    expect(february.entries.map((entry) => entry.note)).toEqual(['二月旧记录']);
    expect((await engine.getStats(DEFAULT_LEDGER_ID, '2026-02')).expenseCents).toBe(5000);

    const records = await rawGetAll<MigratedEntryRecord>(dbName, 'entries');
    expect(records).toHaveLength(2);
    for (const record of records) {
      expect(record.ledgerId).toBe(DEFAULT_LEDGER_ID);
      expect(record.payload.encrypted).toBe(false);
    }
    const migratedCatalog = await rawGet<V1CatalogRecord>(dbName, 'kv', `catalog:${DEFAULT_LEDGER_ID}`);
    expect(migratedCatalog?.payload).toEqual({ encrypted: false, value: legacyCatalog });
    expect(await rawGet(dbName, 'kv', 'catalog')).toBeUndefined();
    const ledgers = await rawGetAll<MigratedLedgerRecord>(dbName, 'ledgers');
    expect(ledgers).toHaveLength(1);
    expect(ledgers[0]).toMatchObject({ id: DEFAULT_LEDGER_ID, name: '默认账本' });

    const db = await openRawDatabase(dbName);
    try {
      const store = db.transaction('entries', 'readonly').objectStore('entries');
      expect(store.indexNames.contains('ledgerId')).toBe(true);
      expect(store.indexNames.contains('ledgerMonth')).toBe(true);
      expect(store.index('ledgerMonth').keyPath).toEqual(['ledgerId', 'monthTag']);
    } finally {
      db.close();
    }
  });

  it('加密 v1 老库迁移无需口令，旧密文逐字节保留且只补 ledgerId', async () => {
    const dbName = `ledgerlite-v1-encrypted-${Date.now()}`;
    dbNames.add(dbName);
    const salt = randomBytes(SALT_BYTES);
    const keys = await deriveKeys('legacy-secret', salt);
    const verifier = await createVerifier(keys);
    const legacyCatalog = withCustomCategory(createDefaultCatalog());
    const catalogBlob = await encryptJson(keys, legacyCatalog, CATALOG_AAD);
    const firstEntry = buildLegacyEntry({ id: 'legacy-enc-1', note: '加密旧记录一' });
    const secondEntry = buildLegacyEntry({
      id: 'legacy-enc-2',
      amountCents: 9900,
      note: '加密旧记录二',
      occurredAt: localIso(2026, 3, 9, 18),
    });
    const firstTag = await hmacHex(keys, '2026-03');
    const secondTag = await hmacHex(keys, '2026-03');
    const firstBlob = await encryptJson(keys, firstEntry, entryAad(firstEntry.id, firstTag));
    const secondBlob = await encryptJson(keys, secondEntry, entryAad(secondEntry.id, secondTag));
    await writeV1(
      dbName,
      [
        { id: firstEntry.id, monthTag: firstTag, payload: { encrypted: true, ...firstBlob } },
        { id: secondEntry.id, monthTag: secondTag, payload: { encrypted: true, ...secondBlob } },
      ],
      [
        { key: 'catalog', payload: { encrypted: true, ...catalogBlob } },
        { key: 'crypto', salt, verifier },
      ],
    );

    const catalogBytes = [...new Uint8Array(catalogBlob.data)];
    const firstBytes = [...new Uint8Array(firstBlob.data)];
    const secondBytes = [...new Uint8Array(secondBlob.data)];

    const engine = openMigratedEngine(dbName);
    const locked = await engine.initialize();
    expect(locked.status).toBe('locked');
    expect(locked.ledgers).toEqual([]);
    expect(locked.ledger).toBeNull();
    expect(locked.catalog).toBeNull();

    const records = await rawGetAll<MigratedEntryRecord>(dbName, 'entries');
    expect(records).toHaveLength(2);
    for (const record of records) {
      expect(record.ledgerId).toBe(DEFAULT_LEDGER_ID);
      expect(record.payload.encrypted).toBe(true);
      if (!record.payload.encrypted) throw new Error('expected encrypted payload');
      const expected = record.id === firstEntry.id ? firstBytes : secondBytes;
      expect([...new Uint8Array(record.payload.data)]).toEqual(expected);
    }
    const migratedCatalog = await rawGet<V1CatalogRecord>(dbName, 'kv', `catalog:${DEFAULT_LEDGER_ID}`);
    expect(migratedCatalog?.payload.encrypted).toBe(true);
    if (!migratedCatalog || !migratedCatalog.payload.encrypted) throw new Error('expected encrypted catalog');
    expect([...new Uint8Array(migratedCatalog.payload.data)]).toEqual(catalogBytes);
    expect(await rawGet(dbName, 'kv', 'catalog')).toBeUndefined();
    expect((await rawGetAll<MigratedLedgerRecord>(dbName, 'ledgers'))[0]?.id).toBe(DEFAULT_LEDGER_ID);

    await expect(engine.unlock('wrong')).rejects.toMatchObject({ code: 'INVALID_PASSPHRASE' });
    const unlocked = await engine.unlock('legacy-secret');
    expect(unlocked.status).toBe('ready');
    expect(unlocked.ledgers).toHaveLength(1);
    expect(unlocked.ledgers[0]?.id).toBe(DEFAULT_LEDGER_ID);
    expect(unlocked.catalog).toEqual(legacyCatalog);
    const march = await engine.listMonth({ ledgerId: DEFAULT_LEDGER_ID, month: '2026-03' });
    expect(march.entries.map((entry) => entry.note).sort()).toEqual(['加密旧记录一', '加密旧记录二']);
    expect(march.entries.map((entry) => entry.amountCents).sort((a, b) => a - b)).toEqual([1234, 9900]);
    expect((await engine.getStats(DEFAULT_LEDGER_ID, '2026-03')).expenseCents).toBe(11_134);

    // Editing an old (still once-encrypted) record proves the migrated ciphertext stays readable.
    const edited = await engine.saveEntry({
      ledgerId: DEFAULT_LEDGER_ID,
      id: firstEntry.id,
      draft: expenseDraft({ note: '迁移后编辑', amountCents: 2000, occurredAt: firstEntry.occurredAt }),
    });
    expect(edited.note).toBe('迁移后编辑');
    await engine.lock();
    await engine.unlock('legacy-secret');
    const reread = await engine.listMonth({ ledgerId: DEFAULT_LEDGER_ID, month: '2026-03' });
    expect(reread.entries.find((entry) => entry.id === firstEntry.id)?.note).toBe('迁移后编辑');
  });

  it('空 v1 数据库升级后自动获得默认账本与默认目录', async () => {
    const dbName = `ledgerlite-v1-empty-${Date.now()}`;
    dbNames.add(dbName);
    await writeV1(dbName, [], []);
    const engine = openMigratedEngine(dbName);
    const init = await engine.initialize();
    expect(init.status).toBe('ready');
    expect(init.ledgers).toHaveLength(1);
    expect(init.ledgers[0]?.id).toBe(DEFAULT_LEDGER_ID);
    expect(init.catalog?.categories).toHaveLength(15);
    expect(init.catalog?.accounts).toHaveLength(6);
    expect(await rawGetAll<MigratedEntryRecord>(dbName, 'entries')).toHaveLength(0);
    const catalog = await rawGet<V1CatalogRecord>(dbName, 'kv', `catalog:${DEFAULT_LEDGER_ID}`);
    expect(catalog?.payload.encrypted).toBe(false);
  });
});
