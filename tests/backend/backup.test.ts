import { afterEach, describe, expect, it } from 'vitest';
import { LedgerEngine } from '../../src/backend/engine';
import type { BackupPayload, Entry } from '../../src/shared/types';
import { DEFAULT_LEDGER_ID, createEngine, deleteDatabase, expenseDraft, incomeDraft, localIso, rawGet, rawGetAll, tickClock } from './helpers';

interface RawEntryRecord {
  id: string;
  monthTag: string;
  payload: { encrypted: boolean; iv?: ArrayBuffer; data?: ArrayBuffer; value?: Entry };
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

async function createSourceBackup(): Promise<BackupPayload> {
  const { engine } = await setup();
  await engine.addCategory(DEFAULT_LEDGER_ID, { name: '宠物', type: 'expense', icon: 'other', color: '#123456' });
  await engine.saveEntry({
    ledgerId: DEFAULT_LEDGER_ID,
    draft: expenseDraft({ note: '备份咖啡', amountCents: 1800, occurredAt: localIso(2026, 2, 10, 9) }),
  });
  await engine.saveEntry({
    ledgerId: DEFAULT_LEDGER_ID,
    draft: incomeDraft({ note: '备份工资', amountCents: 88_000, occurredAt: localIso(2026, 2, 20, 10) }),
  });
  return engine.exportBackup(DEFAULT_LEDGER_ID);
}

describe('备份导出与导入', () => {
  it('导出备份包含明文记录、目录和元信息', async () => {
    const { engine } = await setup();
    await engine.saveEntry({ ledgerId: DEFAULT_LEDGER_ID, draft: expenseDraft({ note: '导出测试', occurredAt: localIso(2026, 3, 5) }) });
    const backup = await engine.exportBackup(DEFAULT_LEDGER_ID);
    expect(backup.app).toBe('ledgerlite');
    expect(backup.schema).toBe(2);
    expect(backup.version).toMatch(/^0\.1\.0/);
    expect(Number.isNaN(Date.parse(backup.exportedAt))).toBe(false);
    expect(backup.entries).toHaveLength(1);
    expect(backup.entries[0]?.note).toBe('导出测试');
    expect(backup.catalog.categories).toHaveLength(15);
    expect(backup.catalog.accounts).toHaveLength(5);
  });

  it('导入有效备份会整体替换记录和目录', async () => {
    const backup = await createSourceBackup();
    const { engine } = await setup();
    await engine.saveEntry({ ledgerId: DEFAULT_LEDGER_ID, draft: expenseDraft({ note: '旧记录', occurredAt: localIso(2026, 1, 1) }) });

    const result = await engine.importBackup(DEFAULT_LEDGER_ID, backup);
    expect(result).toMatchObject({ entryCount: 2, categoryCount: 16, accountCount: 5 });
    expect(result.catalog.categories.some((category) => category.name === '宠物')).toBe(true);

    const january = await engine.listMonth({ ledgerId: DEFAULT_LEDGER_ID, month: '2026-01' });
    expect(january.entries).toHaveLength(0);
    const february = await engine.listMonth({ ledgerId: DEFAULT_LEDGER_ID, month: '2026-02' });
    expect(february.entries.map((entry) => entry.note).sort()).toEqual(['备份咖啡', '备份工资']);
    expect(february.summary).toMatchObject({ expenseCents: 1800, incomeCents: 88_000 });
    expect(await engine.getStats(DEFAULT_LEDGER_ID, '2026-01')).toMatchObject({ entryCount: 0 });
  });

  it('导入结构无效的备份会拒绝且不破坏现有数据', async () => {
    const valid = await createSourceBackup();
    const { engine } = await setup();
    await engine.saveEntry({ ledgerId: DEFAULT_LEDGER_ID, draft: expenseDraft({ note: '保留记录', occurredAt: localIso(2026, 3, 5) }) });

    const cases: Array<[string, (backup: BackupPayload) => void]> = [
      ['错误的 app', (backup) => ((backup as { app: string }).app = 'other')],
      ['不支持的 schema', (backup) => ((backup as { schema: number }).schema = 3)],
      ['entries 不是数组', (backup) => ((backup as { entries: unknown }).entries = null)],
      ['缺少 accounts', (backup) => delete (backup.catalog as { accounts?: unknown }).accounts],
      [
        '重复的记账 ID',
        (backup) => {
          const first = backup.entries[0];
          if (first) backup.entries.push({ ...first });
        },
      ],
      [
        '重复的分类 ID',
        (backup) => {
          const first = backup.catalog.categories[0];
          if (first) backup.catalog.categories.push({ ...first });
        },
      ],
      [
        '小数金额',
        (backup) => {
          const first = backup.entries[0];
          if (first) first.amountCents = 12.5;
        },
      ],
      [
        '非正金额',
        (backup) => {
          const first = backup.entries[0];
          if (first) first.amountCents = 0;
        },
      ],
      [
        '无效日期',
        (backup) => {
          const first = backup.entries[0];
          if (first) first.occurredAt = 'not-a-date';
        },
      ],
      [
        '未知分类引用',
        (backup) => {
          const first = backup.entries[0];
          if (first) first.categoryId = 'missing';
        },
      ],
      [
        '分类与收支类型不匹配',
        (backup) => {
          const first = backup.entries[0];
          if (first) first.categoryId = 'cat_salary';
        },
      ],
      [
        '未知账户引用',
        (backup) => {
          const first = backup.entries[0];
          if (first) first.accountId = 'missing';
        },
      ],
      [
        '备注超长',
        (backup) => {
          const first = backup.entries[0];
          if (first) first.note = 'x'.repeat(121);
        },
      ],
    ];

    for (const [label, mutate] of cases) {
      const candidate = structuredClone(valid);
      mutate(candidate);
      try {
        await engine.importBackup(DEFAULT_LEDGER_ID, candidate);
        throw new Error(`应拒绝：${label}`);
      } catch (error) {
        expect(error, label).toMatchObject({ code: 'IMPORT_INVALID' });
      }
    }
    const kept = await engine.listMonth({ ledgerId: DEFAULT_LEDGER_ID, month: '2026-03' });
    expect(kept.entries).toHaveLength(1);
    expect(kept.entries[0]?.note).toBe('保留记录');
  });

  it('加密状态下导入保持加密并重新加密记录与目录', async () => {
    const backup = await createSourceBackup();
    const { engine, dbName } = await setup();
    await engine.enableEncryption('secret');

    const result = await engine.importBackup(DEFAULT_LEDGER_ID, backup);
    expect(result.entryCount).toBe(2);
    const records = await rawGetAll<RawEntryRecord>(dbName, 'entries');
    expect(records).toHaveLength(2);
    expect(records.every((record) => record.payload.encrypted)).toBe(true);
    expect(records.every((record) => /^[0-9a-f]{64}$/.test(record.monthTag))).toBe(true);
    expect(await rawGet(dbName, 'kv', 'crypto')).toBeDefined();
    const catalog = await rawGet<{ key: string; payload: { encrypted: boolean } }>(dbName, 'kv', 'catalog:' + DEFAULT_LEDGER_ID);
    expect(catalog?.payload.encrypted).toBe(true);

    const february = await engine.listMonth({ ledgerId: DEFAULT_LEDGER_ID, month: '2026-02' });
    expect(february.entries.map((entry) => entry.note).sort()).toEqual(['备份咖啡', '备份工资']);

    await engine.lock();
    const unlocked = await engine.unlock('secret');
    expect(unlocked.status).toBe('ready');
    expect((await engine.listMonth({ ledgerId: DEFAULT_LEDGER_ID, month: '2026-02' })).entries).toHaveLength(2);

    const disabled = await engine.disableEncryption('secret');
    expect(disabled.crypto.enabled).toBe(false);
    const plainRecords = await rawGetAll<RawEntryRecord>(dbName, 'entries');
    expect(plainRecords.every((record) => !record.payload.encrypted)).toBe(true);
    expect((await engine.listMonth({ ledgerId: DEFAULT_LEDGER_ID, month: '2026-02' })).entries).toHaveLength(2);
  });

  it('锁定状态下拒绝导入', async () => {
    const backup = await createSourceBackup();
    const { engine } = await setup();
    await engine.enableEncryption('secret');
    await engine.lock();
    await expect(engine.importBackup(DEFAULT_LEDGER_ID, backup)).rejects.toMatchObject({ code: 'LOCKED' });
  });

  it('导入的归档分类仍可解析历史记录', async () => {
    const { engine: source } = await setup();
    await source.saveEntry({ ledgerId: DEFAULT_LEDGER_ID, draft: expenseDraft({ note: '归档分类记录', occurredAt: localIso(2026, 2, 3) }) });
    await source.updateCategory(DEFAULT_LEDGER_ID, 'cat_food', { archived: true });
    const backup = await source.exportBackup(DEFAULT_LEDGER_ID);
    expect(backup.catalog.categories.find((category) => category.id === 'cat_food')?.archived).toBe(true);

    const { engine: target } = await setup();
    await target.importBackup(DEFAULT_LEDGER_ID, backup);
    const month = await target.listMonth({ ledgerId: DEFAULT_LEDGER_ID, month: '2026-02' });
    expect(month.entries).toHaveLength(1);
    expect((await target.getStats(DEFAULT_LEDGER_ID, '2026-02')).expenseCategories[0]?.name).toBe('餐饮');
    await expect(
      target.saveEntry({ ledgerId: DEFAULT_LEDGER_ID, draft: expenseDraft({ categoryId: 'cat_food', occurredAt: localIso(2026, 2, 4) }) }),
    ).rejects.toMatchObject({ code: 'VALIDATION', message: '分类已归档' });
  });
});
