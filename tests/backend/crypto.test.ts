import { indexedDB } from 'fake-indexeddb';
import { afterEach, describe, expect, it } from 'vitest';
import { LedgerEngine } from '../../src/backend/engine';
import { type Entry } from '../../src/shared/types';
import { DEFAULT_LEDGER_ID, createEngine, deleteDatabase, expenseDraft, incomeDraft, localIso, rawGet, rawGetAll, rawPut, tickClock } from './helpers';

interface RawEntryRecord {
  id: string;
  monthTag: string;
  payload: { encrypted: boolean; iv?: ArrayBuffer; data?: ArrayBuffer; value?: Entry };
}

interface RawCatalogRecord {
  key: string;
  payload: { encrypted: boolean; iv?: ArrayBuffer; data?: ArrayBuffer; value?: unknown };
}

const engines: LedgerEngine[] = [];
const dbNames = new Set<string>();

async function setup(): Promise<{ engine: LedgerEngine; dbName: string }> {
  const context = await createEngine({ now: tickClock() });
  engines.push(context.engine);
  dbNames.add(context.dbName);
  return context;
}

async function reopen(dbName: string): Promise<{ engine: LedgerEngine; init: Awaited<ReturnType<LedgerEngine['initialize']>> }> {
  const engine = new LedgerEngine({ factory: indexedDB, dbName, now: tickClock() });
  engines.push(engine);
  const init = await engine.initialize();
  return { engine, init };
}

afterEach(async () => {
  for (const engine of engines) await engine.close();
  engines.length = 0;
  for (const name of dbNames) await deleteDatabase(name);
  dbNames.clear();
});

function byteValues(buffer: ArrayBuffer): number[] {
  return [...new Uint8Array(buffer)];
}

describe('加密生命周期', () => {
  it('启用加密后重写 entries 与 catalog，每条记录使用独立 IV 与 HMAC monthTag', async () => {
    const { engine, dbName } = await setup();
    const first = await engine.saveEntry({
      ledgerId: DEFAULT_LEDGER_ID,
      draft: expenseDraft({ note: '测试午餐', occurredAt: localIso(2026, 3, 5, 12) }),
    });
    const second = await engine.saveEntry({
      ledgerId: DEFAULT_LEDGER_ID,
      draft: expenseDraft({ note: '测试午餐', occurredAt: localIso(2026, 3, 6, 12) }),
    });

    const enabled = await engine.enableEncryption('correct horse');
    expect(enabled.status).toBe('ready');
    expect(enabled.crypto).toEqual({ enabled: true, unlocked: true });
    expect(enabled.catalog?.categories).toHaveLength(15);

    const records = await rawGetAll<RawEntryRecord>(dbName, 'entries');
    expect(records).toHaveLength(2);
    for (const record of records) {
      expect(record.payload.encrypted).toBe(true);
      expect(record.monthTag).toMatch(/^[0-9a-f]{64}$/);
      expect(record.payload.iv?.byteLength).toBe(12);
      expect(record.payload.data?.byteLength).toBeGreaterThan(0);
      expect(record.payload.value).toBeUndefined();
    }
    const ivs = records.map((record) => byteValues(record.payload.iv as ArrayBuffer));
    expect(ivs[0]).not.toEqual(ivs[1]);
    expect(JSON.stringify(records)).not.toContain('测试午餐');

    const catalog = await rawGet<RawCatalogRecord>(dbName, 'kv', 'catalog:' + DEFAULT_LEDGER_ID);
    expect(catalog?.payload.encrypted).toBe(true);
    expect(JSON.stringify(catalog)).not.toContain('餐饮');

    // Both records remain readable while unlocked and use stable HMAC month tags.
    const month = await engine.listMonth({
      ledgerId: DEFAULT_LEDGER_ID,
      month: '2026-03' });
    expect(month.entries.map((entry) => entry.id).sort()).toEqual([first.id, second.id].sort());
  });

  it('锁定后拒绝数据访问，错误口令无法解锁，正确口令恢复全部数据', async () => {
    const { engine, dbName } = await setup();
    const saved = await engine.saveEntry({
      ledgerId: DEFAULT_LEDGER_ID,
      draft: expenseDraft({ note: '秘密午餐', occurredAt: localIso(2026, 3, 5) }) });
    await engine.enableEncryption('pass-1234');

    const locked = await engine.lock();
    expect(locked.status).toBe('locked');
    expect(locked.catalog).toBeNull();
    expect(locked.crypto).toEqual({ enabled: true, unlocked: false });
    await expect(engine.listMonth({
      ledgerId: DEFAULT_LEDGER_ID,
      month: '2026-03' })).rejects.toMatchObject({ code: 'LOCKED' });
    await expect(engine.getStats(DEFAULT_LEDGER_ID, '2026-03')).rejects.toMatchObject({ code: 'LOCKED' });
    await expect(engine.exportBackup(DEFAULT_LEDGER_ID)).rejects.toMatchObject({ code: 'LOCKED' });

    await expect(engine.unlock('wrong')).rejects.toMatchObject({ code: 'INVALID_PASSPHRASE' });
    expect((await engine.initialize()).status).toBe('locked');

    const reopened = await reopen(dbName);
    expect(reopened.init.status).toBe('locked');
    expect(reopened.init.catalog).toBeNull();
    const unlocked = await reopened.engine.unlock('pass-1234');
    expect(unlocked.status).toBe('ready');
    expect(unlocked.catalog?.categories).toHaveLength(15);
    const month = await reopened.engine.listMonth({
      ledgerId: DEFAULT_LEDGER_ID,
      month: '2026-03' });
    expect(month.entries).toHaveLength(1);
    expect(month.entries[0]?.id).toBe(saved.id);
    expect(month.entries[0]?.note).toBe('秘密午餐');
  });

  it('禁用加密还原明文，错误口令不改变加密状态', async () => {
    const { engine, dbName } = await setup();
    const saved = await engine.saveEntry({
      ledgerId: DEFAULT_LEDGER_ID,
      draft: expenseDraft({ note: '还原我', amountCents: 4321, occurredAt: localIso(2026, 3, 5) }),
    });
    await engine.enableEncryption('secret');

    await expect(engine.disableEncryption('nope')).rejects.toMatchObject({ code: 'INVALID_PASSPHRASE' });
    const stillEncrypted = await rawGet<RawEntryRecord>(dbName, 'entries', saved.id);
    expect(stillEncrypted?.payload.encrypted).toBe(true);
    expect(await rawGet(dbName, 'kv', 'crypto')).toBeDefined();

    const disabled = await engine.disableEncryption('secret');
    expect(disabled.status).toBe('ready');
    expect(disabled.crypto).toEqual({ enabled: false, unlocked: false });
    const plain = await rawGet<RawEntryRecord>(dbName, 'entries', saved.id);
    expect(plain?.payload.encrypted).toBe(false);
    expect(plain?.payload.value?.note).toBe('还原我');
    expect(plain?.monthTag).toBe('2026-03');
    expect(await rawGet(dbName, 'kv', 'crypto')).toBeUndefined();
    const catalog = await rawGet<RawCatalogRecord>(dbName, 'kv', 'catalog:' + DEFAULT_LEDGER_ID);
    expect(catalog?.payload.encrypted).toBe(false);
    expect((await engine.listMonth({
      ledgerId: DEFAULT_LEDGER_ID,
      month: '2026-03' })).entries[0]?.amountCents).toBe(4321);
  });

  it('拒绝篡改后的密文', async () => {
    const { engine, dbName } = await setup();
    const saved = await engine.saveEntry({
      ledgerId: DEFAULT_LEDGER_ID,
      draft: expenseDraft({ occurredAt: localIso(2026, 3, 5) }) });
    await engine.enableEncryption('secret');
    const record = await rawGet<RawEntryRecord>(dbName, 'entries', saved.id);
    expect(record?.payload.encrypted).toBe(true);
    const data = new Uint8Array(record?.payload.data as ArrayBuffer);
    const tampered = new Uint8Array(data.length);
    tampered.set(data);
    tampered[tampered.length - 1] = (tampered[tampered.length - 1] ?? 0) ^ 0xff;
    await rawPut(dbName, 'entries', {
      ...record,
      payload: { ...record?.payload, data: tampered.buffer },
    });
    await expect(engine.listMonth({
      ledgerId: DEFAULT_LEDGER_ID,
      month: '2026-03' })).rejects.toMatchObject({ code: 'INVALID_PASSPHRASE' });
  });

  it('AAD 绑定记录 id 与 monthTag，换绑后的密文无法解密', async () => {
    const { engine, dbName } = await setup();
    const first = await engine.saveEntry({
      ledgerId: DEFAULT_LEDGER_ID,
      draft: expenseDraft({ note: '第一条', occurredAt: localIso(2026, 3, 5) }) });
    const second = await engine.saveEntry({
      ledgerId: DEFAULT_LEDGER_ID,
      draft: expenseDraft({ note: '第二条', occurredAt: localIso(2026, 3, 6) }) });
    await engine.enableEncryption('secret');
    const firstRecord = await rawGet<RawEntryRecord>(dbName, 'entries', first.id);
    const secondRecord = await rawGet<RawEntryRecord>(dbName, 'entries', second.id);
    expect(firstRecord && secondRecord).toBeTruthy();

    // Move the ciphertext of the second entry under the first entry id.
    await rawPut(dbName, 'entries', { ...firstRecord, payload: secondRecord?.payload });
    await expect(engine.listMonth({
      ledgerId: DEFAULT_LEDGER_ID,
      month: '2026-03' })).rejects.toMatchObject({ code: 'INVALID_PASSPHRASE' });
  });

  it('加密状态下搜索、统计、增删改与导出均正常', async () => {
    const { engine } = await setup();
    await engine.saveEntry({
      ledgerId: DEFAULT_LEDGER_ID,
      draft: expenseDraft({ note: 'Coffee', amountCents: 1500, occurredAt: localIso(2026, 3, 2) }) });
    await engine.saveEntry({
      ledgerId: DEFAULT_LEDGER_ID,
      draft: expenseDraft({ note: '打车', categoryId: 'cat_transport', amountCents: 800, occurredAt: localIso(2026, 3, 3) }),
    });
    await engine.saveEntry({
      ledgerId: DEFAULT_LEDGER_ID,
      draft: incomeDraft({ note: '工资', occurredAt: localIso(2026, 3, 5) }) });
    await engine.enableEncryption('secret');

    expect((await engine.listMonth({
      ledgerId: DEFAULT_LEDGER_ID,
      month: '2026-03', search: 'coffee' })).entries).toHaveLength(1);
    expect((await engine.listMonth({
      ledgerId: DEFAULT_LEDGER_ID,
      month: '2026-03', search: '交通' })).entries).toHaveLength(1);
    const stats = await engine.getStats(DEFAULT_LEDGER_ID, '2026-03');
    expect(stats.expenseCents).toBe(2300);
    expect(stats.daily).toHaveLength(31);

    const added = await engine.saveEntry({
      ledgerId: DEFAULT_LEDGER_ID,
      draft: expenseDraft({ note: '新增加密记录', amountCents: 200, occurredAt: localIso(2026, 3, 10) }),
    });
    expect((await engine.listMonth({
      ledgerId: DEFAULT_LEDGER_ID,
      month: '2026-03', search: '新增' })).entries[0]?.id).toBe(added.id);
    const backup = await engine.exportBackup(DEFAULT_LEDGER_ID);
    expect(backup.entries).toHaveLength(4);
    expect(backup.entries.some((entry) => entry.note === '新增加密记录')).toBe(true);
    await engine.deleteEntry(DEFAULT_LEDGER_ID, added.id);
    expect((await engine.listMonth({
      ledgerId: DEFAULT_LEDGER_ID,
      month: '2026-03' })).entries).toHaveLength(3);
  });

  it('加密开启时 resetAll 可在锁定状态执行并恢复未加密默认目录', async () => {
    const { engine, dbName } = await setup();
    await engine.saveEntry({
      ledgerId: DEFAULT_LEDGER_ID,
      draft: expenseDraft({ occurredAt: localIso(2026, 3, 5) }) });
    await engine.enableEncryption('secret');
    await engine.lock();

    const result = await engine.resetAll();
    expect(result.status).toBe('ready');
    expect(result.crypto).toEqual({ enabled: false, unlocked: false });
    expect(result.catalog?.categories).toHaveLength(15);
    expect(result.catalog?.accounts).toHaveLength(5);
    expect(await rawGetAll(dbName, 'entries')).toHaveLength(0);
    expect(await rawGet(dbName, 'kv', 'crypto')).toBeUndefined();
    expect((await engine.listMonth({
      ledgerId: DEFAULT_LEDGER_ID,
      month: '2026-03' })).entries).toHaveLength(0);

    const reopened = await reopen(dbName);
    expect(reopened.init.status).toBe('ready');
    expect(reopened.init.crypto.enabled).toBe(false);
    expect(reopened.init.catalog?.categories).toHaveLength(15);
  });

  it('加密状态机校验参数与重复操作', async () => {
    const { engine } = await setup();
    await expect(engine.enableEncryption('')).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(engine.disableEncryption('secret')).rejects.toMatchObject({ code: 'CONFLICT' });
    await engine.enableEncryption('secret');
    await expect(engine.enableEncryption('secret')).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});
