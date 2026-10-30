import { afterEach, describe, expect, it } from 'vitest';
import { LedgerEngine } from '../../src/backend/engine';
import { LEDGER_COLORS } from '../../src/shared/defaults';
import type { BackupPayload, Entry, Ledger, MonthQuery } from '../../src/shared/types';
import {
  DEFAULT_LEDGER_ID,
  createEngine,
  deleteDatabase,
  expenseDraft,
  localIso,
  rawGet,
  rawGetAll,
  tickClock,
} from './helpers';

interface RawEntryRecord {
  id: string;
  ledgerId: string;
  payload: { encrypted: boolean; value?: Entry };
}

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

async function saveExpenseIn(engine: LedgerEngine, ledgerId: string, note: string, occurredAt = localIso(2026, 3, 5)): Promise<Entry> {
  return engine.saveEntry({ ledgerId, draft: expenseDraft({ note, occurredAt }) });
}

describe('多账本 API 边界', () => {
  it('创建账本按数量分配颜色与排序，并校验名称', async () => {
    const { engine } = await setup();
    const travel = await engine.createLedger('旅行');
    expect(travel.ledger.name).toBe('旅行');
    expect(travel.ledger.color).toBe(LEDGER_COLORS[1]);
    expect(travel.ledger.sort).toBe(1);
    expect(travel.ledgers.map((ledger) => ledger.name)).toEqual(['默认账本', '旅行']);
    expect(travel.catalog.categories).toHaveLength(15);
    expect(travel.catalog.accounts).toHaveLength(5);

    const work = await engine.createLedger('工作');
    expect(work.ledger.color).toBe(LEDGER_COLORS[2]);
    expect(work.ledger.sort).toBe(2);
    expect(work.ledgers.map((ledger) => ledger.name)).toEqual(['默认账本', '旅行', '工作']);

    const renamed = await engine.updateLedger(travel.ledger.id, '春游');
    expect(renamed).toMatchObject({ id: travel.ledger.id, name: '春游' });
    expect(renamed.updatedAt > travel.ledger.updatedAt).toBe(true);

    await expect(engine.createLedger('   ')).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(engine.createLedger('x'.repeat(21))).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(engine.updateLedger(travel.ledger.id, '')).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(engine.updateLedger('missing', 'x')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('缺失或非法 ledgerId 抛 VALIDATION/NOT_FOUND', async () => {
    const { engine } = await setup();
    const missing = { month: '2026-03' } as MonthQuery;
    await expect(engine.listMonth(missing)).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(engine.listMonth({ ledgerId: '', month: '2026-03' })).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(engine.listMonth({ ledgerId: 'missing', month: '2026-03' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(engine.getStats('missing', '2026-03')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(engine.getStats(DEFAULT_LEDGER_ID, '2026-13')).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(engine.saveEntry({ draft: expenseDraft() } as never)).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(engine.saveEntry({ ledgerId: 'missing', draft: expenseDraft() })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(engine.deleteEntry('missing', 'entry')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(engine.deleteEntry(DEFAULT_LEDGER_ID, '')).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(engine.openLedger('missing')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(engine.openLedger('')).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(engine.deleteLedger('missing')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(engine.addCategory('missing', { name: 'x', type: 'expense', icon: 'other', color: '#123456' })).rejects.toMatchObject(
      { code: 'NOT_FOUND' },
    );
    await expect(engine.exportBackup('missing')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(engine.importBackup('missing', {})).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('不能跨账本引用分类、账户或访问记账记录', async () => {
    const { engine } = await setup();
    const other = await engine.createLedger('副账本');
    const otherId = other.ledger.id;
    const otherCatalog = await engine.addCategory(otherId, {
      name: '副账本分类',
      type: 'expense',
      icon: 'other',
      color: '#123456',
    });
    const ownCategory = otherCatalog.categories.find((category) => category.name === '副账本分类');
    const accounts = await engine.addAccount(otherId, { name: '副账本账户', icon: 'wallet', color: '#654321' });
    const ownAccount = accounts.accounts.find((account) => account.name === '副账本账户');
    expect(ownCategory && ownAccount).toBeTruthy();

    await expect(
      engine.saveEntry({
        ledgerId: DEFAULT_LEDGER_ID,
        draft: expenseDraft({ categoryId: ownCategory?.id ?? '' }),
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION', message: '分类不存在' });
    await expect(
      engine.saveEntry({
        ledgerId: DEFAULT_LEDGER_ID,
        draft: expenseDraft({ accountId: ownAccount?.id ?? '' }),
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION', message: '账户不存在' });
    await expect(engine.updateCategory(DEFAULT_LEDGER_ID, ownCategory?.id ?? '', { name: 'x' })).rejects.toMatchObject(
      { code: 'NOT_FOUND' },
    );
    await expect(engine.updateAccount(DEFAULT_LEDGER_ID, ownAccount?.id ?? '', { name: 'x' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });

    const defaultEntry = await saveExpenseIn(engine, DEFAULT_LEDGER_ID, '默认账本记录');
    const otherEntry = await saveExpenseIn(engine, otherId, '副账本记录');
    await expect(engine.deleteEntry(otherId, defaultEntry.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      engine.saveEntry({
        ledgerId: otherId,
        id: defaultEntry.id,
        draft: expenseDraft({ note: '越权编辑' }),
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(engine.deleteEntry(DEFAULT_LEDGER_ID, otherEntry.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect((await engine.listMonth({ ledgerId: DEFAULT_LEDGER_ID, month: '2026-03' })).entries).toHaveLength(1);
    expect((await engine.listMonth({ ledgerId: otherId, month: '2026-03' })).entries).toHaveLength(1);
  });

  it('删除账本在单事务内清空该账本的 ledger、catalog 与 entries，且保留最后一个账本', async () => {
    const { engine, dbName } = await setup();
    const target = await engine.createLedger('待删账本');
    const targetId = target.ledger.id;
    await saveExpenseIn(engine, targetId, '待删记录一', localIso(2026, 3, 1));
    await saveExpenseIn(engine, targetId, '待删记录二', localIso(2026, 4, 2));
    await engine.addCategory(targetId, { name: '待删分类', type: 'expense', icon: 'other', color: '#111111' });
    await saveExpenseIn(engine, DEFAULT_LEDGER_ID, '保留记录');

    const deleted = await engine.deleteLedger(targetId);
    expect(deleted.ledgers.map((ledger) => ledger.id)).toEqual([DEFAULT_LEDGER_ID]);

    const entries = await rawGetAll<RawEntryRecord>(dbName, 'entries');
    expect(entries.filter((entry) => entry.ledgerId === targetId)).toHaveLength(0);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.payload.value?.note).toBe('保留记录');
    expect(await rawGet(dbName, 'kv', `catalog:${targetId}`)).toBeUndefined();
    expect(await rawGet(dbName, 'kv', `catalog:${DEFAULT_LEDGER_ID}`)).toBeDefined();
    const ledgers = await rawGetAll<Ledger>(dbName, 'ledgers');
    expect(ledgers.map((ledger) => ledger.id)).toEqual([DEFAULT_LEDGER_ID]);

    await expect(engine.listMonth({ ledgerId: targetId, month: '2026-03' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect((await engine.listMonth({ ledgerId: DEFAULT_LEDGER_ID, month: '2026-03' })).entries[0]?.note).toBe(
      '保留记录',
    );
    await expect(engine.deleteLedger(DEFAULT_LEDGER_ID)).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('resetAll 清空全部账本并重建默认账本与目录', async () => {
    const { engine, dbName } = await setup();
    const second = await engine.createLedger('第二账本');
    const third = await engine.createLedger('第三账本');
    await saveExpenseIn(engine, DEFAULT_LEDGER_ID, '默认记录');
    await saveExpenseIn(engine, second.ledger.id, '第二记录');
    await saveExpenseIn(engine, third.ledger.id, '第三记录');
    await engine.addCategory(second.ledger.id, { name: '第二分类', type: 'expense', icon: 'other', color: '#222222' });

    const result = await engine.resetAll();
    expect(result.status).toBe('ready');
    expect(result.ledgers.map((ledger) => ledger.id)).toEqual([DEFAULT_LEDGER_ID]);
    expect(result.ledger?.id).toBe(DEFAULT_LEDGER_ID);
    expect(result.catalog?.categories).toHaveLength(15);
    expect(result.catalog?.categories.some((category) => category.name === '第二分类')).toBe(false);
    expect(await rawGetAll(dbName, 'entries')).toHaveLength(0);
    const ledgerRecords = await rawGetAll<Ledger>(dbName, 'ledgers');
    expect(ledgerRecords.map((ledger) => ledger.id)).toEqual([DEFAULT_LEDGER_ID]);
    const kvRecords = await rawGetAll<{ key: string }>(dbName, 'kv');
    expect(kvRecords.map((record) => record.key)).toEqual([`catalog:${DEFAULT_LEDGER_ID}`]);
    await expect(engine.listMonth({ ledgerId: second.ledger.id, month: '2026-03' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('导入兼容 schema 1 与缺少 ledgerName 的 schema 2，且只替换指定账本', async () => {
    const { engine } = await setup();
    const source = await setup();
    await saveExpenseIn(source.engine, DEFAULT_LEDGER_ID, '旧备份记录', localIso(2026, 2, 10));
    const backup = await source.engine.exportBackup(DEFAULT_LEDGER_ID);
    expect(backup.schema).toBe(2);
    expect(backup.ledgerName).toBe('默认账本');

    const schema1 = structuredClone(backup) as BackupPayload;
    schema1.schema = 1;
    delete schema1.ledgerName;

    const first = await engine.createLedger('导入一');
    await saveExpenseIn(engine, DEFAULT_LEDGER_ID, '保留默认记录');
    const firstResult = await engine.importBackup(first.ledger.id, schema1);
    expect(firstResult).toMatchObject({ entryCount: 1, categoryCount: 15, accountCount: 5 });
    expect((await engine.listMonth({ ledgerId: first.ledger.id, month: '2026-02' })).entries[0]?.note).toBe('旧备份记录');
    expect((await engine.listMonth({ ledgerId: DEFAULT_LEDGER_ID, month: '2026-03' })).entries[0]?.note).toBe(
      '保留默认记录',
    );
    expect((await engine.exportBackup(first.ledger.id)).ledgerName).toBe('导入一');

    const schema2 = structuredClone(backup);
    delete schema2.ledgerName;
    const second = await engine.createLedger('导入二');
    await engine.importBackup(second.ledger.id, schema2);
    expect((await engine.listMonth({ ledgerId: second.ledger.id, month: '2026-02' })).entries).toHaveLength(1);

    const invalid = structuredClone(backup) as { schema: number };
    invalid.schema = 3;
    await expect(engine.importBackup(second.ledger.id, invalid)).rejects.toMatchObject({ code: 'IMPORT_INVALID' });
    expect((await engine.listMonth({ ledgerId: second.ledger.id, month: '2026-02' })).entries).toHaveLength(1);
  });

  it('启用与禁用加密覆盖全部账本的 entries 与 catalog', async () => {
    const { engine, dbName } = await setup();
    const second = await engine.createLedger('第二账本');
    const secondId = second.ledger.id;
    await saveExpenseIn(engine, DEFAULT_LEDGER_ID, '默认记录');
    await saveExpenseIn(engine, secondId, '第二记录');
    await engine.addCategory(secondId, { name: '第二分类', type: 'expense', icon: 'other', color: '#222222' });

    const enabled = await engine.enableEncryption('secret');
    expect(enabled.crypto).toEqual({ enabled: true, unlocked: true });
    const encryptedEntries = await rawGetAll<RawEntryRecord>(dbName, 'entries');
    expect(encryptedEntries).toHaveLength(2);
    expect(encryptedEntries.every((record) => record.payload.encrypted)).toBe(true);
    expect(encryptedEntries.map((record) => record.ledgerId).sort()).toEqual(
      [DEFAULT_LEDGER_ID, secondId].sort(),
    );
    const defaultCatalog = await rawGet<{ payload: { encrypted: boolean } }>(
      dbName,
      'kv',
      `catalog:${DEFAULT_LEDGER_ID}`,
    );
    const secondCatalog = await rawGet<{ payload: { encrypted: boolean } }>(
      dbName,
      'kv',
      `catalog:${secondId}`,
    );
    expect(defaultCatalog?.payload.encrypted).toBe(true);
    expect(secondCatalog?.payload.encrypted).toBe(true);

    await engine.lock();
    const unlocked = await engine.unlock('secret');
    expect(unlocked.ledgers).toHaveLength(2);
    expect(
      (await engine.openLedger(secondId)).catalog.categories.some((category) => category.name === '第二分类'),
    ).toBe(true);

    const disabled = await engine.disableEncryption('secret');
    expect(disabled.crypto).toEqual({ enabled: false, unlocked: false });
    const plainEntries = await rawGetAll<RawEntryRecord>(dbName, 'entries');
    expect(plainEntries).toHaveLength(2);
    expect(plainEntries.every((record) => !record.payload.encrypted)).toBe(true);
    const plainDefaultCatalog = await rawGet<{ payload: { encrypted: boolean } }>(
      dbName,
      'kv',
      `catalog:${DEFAULT_LEDGER_ID}`,
    );
    const plainSecondCatalog = await rawGet<{ payload: { encrypted: boolean } }>(
      dbName,
      'kv',
      `catalog:${secondId}`,
    );
    expect(plainDefaultCatalog?.payload.encrypted).toBe(false);
    expect(plainSecondCatalog?.payload.encrypted).toBe(false);
    expect((await engine.listMonth({ ledgerId: secondId, month: '2026-03' })).entries[0]?.note).toBe('第二记录');
  });

  it('加密开启后创建的账本其目录也加密，锁定/解锁后仍可访问', async () => {
    const { engine, dbName } = await setup();
    await engine.enableEncryption('secret');
    const created = await engine.createLedger('加密账本');
    const ledgerId = created.ledger.id;

    const catalogRecord = await rawGet<{ key: string; payload: { encrypted: boolean } }>(
      dbName,
      'kv',
      `catalog:${ledgerId}`,
    );
    expect(catalogRecord?.payload.encrypted).toBe(true);
    const ledgerRecord = await rawGet<Ledger>(dbName, 'ledgers', ledgerId);
    expect(ledgerRecord).toMatchObject({ id: ledgerId, name: '加密账本' });

    await saveExpenseIn(engine, ledgerId, '加密新账本记录');
    await engine.lock();
    const unlocked = await engine.unlock('secret');
    expect(unlocked.ledgers.map((ledger) => ledger.id)).toEqual([DEFAULT_LEDGER_ID, ledgerId]);
    expect((await engine.openLedger(ledgerId)).catalog.categories).toHaveLength(15);
    expect((await engine.listMonth({ ledgerId, month: '2026-03' })).entries[0]?.note).toBe('加密新账本记录');
  });
});
