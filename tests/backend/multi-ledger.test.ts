import { indexedDB } from 'fake-indexeddb';
import { afterEach, describe, expect, it } from 'vitest';
import { LedgerEngine } from '../../src/backend/engine';
import { createDefaultCatalog } from '../../src/shared/defaults';
import type { Entry } from '../../src/shared/types';
import {
  DEFAULT_LEDGER_ID,
  createEngine,
  deleteDatabase,
  localIso,
  rawGetAll,
  saveExpense,
  tickClock,
} from './helpers';

const engines: LedgerEngine[] = [];
const dbNames = new Set<string>();

async function setup(): Promise<{ engine: LedgerEngine; dbName: string }> {
  const context = await createEngine({ now: tickClock() });
  engines.push(context.engine);
  dbNames.add(context.dbName);
  return context;
}

afterEach(async () => {
  for (const engine of engines) await engine.close();
  engines.length = 0;
  for (const name of dbNames) await deleteDatabase(name);
  dbNames.clear();
});

function putLegacyV1Database(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      const entries = db.createObjectStore('entries', { keyPath: 'id' });
      entries.createIndex('monthTag', 'monthTag', { unique: false });
      db.createObjectStore('kv', { keyPath: 'key' });
    };
    request.onerror = () => reject(request.error ?? new Error('v1 open failed'));
    request.onsuccess = () => {
      const db = request.result;
      const entry: Entry = {
        id: 'legacy-entry',
        type: 'expense',
        amountCents: 1234,
        categoryId: 'cat_food',
        accountId: 'acc_wechat',
        note: '迁移前记录',
        occurredAt: localIso(2026, 3, 5, 12),
        createdAt: '2026-03-05T04:00:00.000Z',
        updatedAt: '2026-03-05T04:00:00.000Z',
      };
      const tx = db.transaction(['entries', 'kv'], 'readwrite');
      tx.objectStore('entries').put({
        id: entry.id,
        monthTag: '2026-03',
        payload: { encrypted: false, value: entry },
      });
      tx.objectStore('kv').put({
        key: 'catalog',
        payload: { encrypted: false, value: createDefaultCatalog() },
      });
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error ?? new Error('v1 seed failed'));
    };
  });
}

describe('多账本', () => {
  it('创建、切换、更新、删除账本并按账本隔离记录与目录', async () => {
    const { engine } = await setup();
    const created = await engine.createLedger('旅行');
    const travelId = created.ledger.id;
    expect(created.ledgers).toHaveLength(2);
    expect(created.ledgers.map((ledger) => ledger.name)).toContain('旅行');
    expect(created.catalog.categories).toHaveLength(15);

    await saveExpense(engine, DEFAULT_LEDGER_ID, { note: '家用', occurredAt: localIso(2026, 4, 1) });
    await saveExpense(engine, travelId, { note: '机票', occurredAt: localIso(2026, 4, 2) });
    await engine.addCategory(travelId, { name: '旅行交通', type: 'expense', icon: 'transport', color: '#123456' });

    const home = await engine.listMonth({ ledgerId: DEFAULT_LEDGER_ID, month: '2026-04' });
    const travel = await engine.listMonth({ ledgerId: travelId, month: '2026-04' });
    expect(home.entries.map((entry) => entry.note)).toEqual(['家用']);
    expect(travel.entries.map((entry) => entry.note)).toEqual(['机票']);
    expect((await engine.openLedger(travelId)).catalog.categories.some((category) => category.name === '旅行交通')).toBe(true);
    expect((await engine.openLedger(DEFAULT_LEDGER_ID)).catalog.categories.some((category) => category.name === '旅行交通')).toBe(false);

    const renamed = await engine.updateLedger(travelId, '春季旅行');
    expect(renamed.name).toBe('春季旅行');
    const deleted = await engine.deleteLedger(travelId);
    expect(deleted.ledgers).toHaveLength(1);
    expect((await engine.listMonth({ ledgerId: DEFAULT_LEDGER_ID, month: '2026-04' })).entries).toHaveLength(1);
    await expect(engine.deleteLedger(DEFAULT_LEDGER_ID)).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('加密启停覆盖全部账本的记录与目录', async () => {
    const { engine, dbName } = await setup();
    const other = await engine.createLedger('副账本');
    await saveExpense(engine, DEFAULT_LEDGER_ID, { note: '默认秘密' });
    await saveExpense(engine, other.ledger.id, { note: '副账本秘密' });
    await engine.enableEncryption('multi-ledger-pass');

    const records = await rawGetAll<{ ledgerId: string; payload: { encrypted: boolean } }>(dbName, 'entries');
    expect(records).toHaveLength(2);
    expect(records.every((record) => record.payload.encrypted)).toBe(true);
    await engine.lock();
    const unlocked = await engine.unlock('multi-ledger-pass');
    expect(unlocked.ledgers).toHaveLength(2);
    const otherData = await engine.openLedger(other.ledger.id);
    expect(otherData.catalog.categories).toHaveLength(15);
    const month = await engine.listMonth({ ledgerId: other.ledger.id, month: '2026-03' });
    expect(month.entries[0]?.note).toBe('副账本秘密');
  });

  it('备份只替换指定账本，不影响其他账本', async () => {
    const { engine } = await setup();
    const target = await engine.createLedger('目标');
    await saveExpense(engine, target.ledger.id, { note: '原始目标' });
    await saveExpense(engine, DEFAULT_LEDGER_ID, { note: '默认保留' });
    const backup = await engine.exportBackup(target.ledger.id);
    expect(backup.schema).toBe(2);
    expect(backup.ledgerName).toBe('目标');

    await saveExpense(engine, target.ledger.id, { note: '额外目标' });
    await engine.importBackup(target.ledger.id, backup);
    const targetMonth = await engine.listMonth({ ledgerId: target.ledger.id, month: '2026-03' });
    const defaultMonth = await engine.listMonth({ ledgerId: DEFAULT_LEDGER_ID, month: '2026-03' });
    expect(targetMonth.entries.map((entry) => entry.note)).toEqual(['原始目标']);
    expect(defaultMonth.entries.map((entry) => entry.note)).toEqual(['默认保留']);
  });

  it('v1 数据库迁移为默认账本且不丢失旧记录', async () => {
    const dbName = `ledgerlite-migration-${Date.now()}`;
    dbNames.add(dbName);
    await putLegacyV1Database(dbName);
    const engine = new LedgerEngine({ factory: indexedDB, dbName });
    engines.push(engine);
    const init = await engine.initialize();
    expect(init.status).toBe('ready');
    expect(init.ledgers).toHaveLength(1);
    expect(init.ledgers[0]?.id).toBe(DEFAULT_LEDGER_ID);
    expect(init.catalog?.categories).toHaveLength(15);

    const month = await engine.listMonth({ ledgerId: DEFAULT_LEDGER_ID, month: '2026-03' });
    expect(month.entries.map((entry) => entry.note)).toEqual(['迁移前记录']);
    const records = await rawGetAll<{ ledgerId?: string }>(dbName, 'entries');
    expect(records[0]?.ledgerId).toBe(DEFAULT_LEDGER_ID);
  });
});
