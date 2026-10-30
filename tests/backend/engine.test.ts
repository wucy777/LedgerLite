import { afterEach, describe, expect, it } from 'vitest';
import { LedgerEngine, type LedgerEngineOptions } from '../../src/backend/engine';
import { deleteDatabase, expenseDraft, incomeDraft, localIso, tickClock } from './helpers';

const engines: LedgerEngine[] = [];
const dbNames = new Set<string>();
let sequence = 0;

async function setupEngine(options: LedgerEngineOptions = {}): Promise<LedgerEngine> {
  const dbName = `ledgerlite-engine-${Date.now()}-${sequence}`;
  sequence += 1;
  const engine = new LedgerEngine({ factory: indexedDB, dbName, ...options });
  engines.push(engine);
  dbNames.add(dbName);
  const init = await engine.initialize();
  expect(init.status).toBe('ready');
  return engine;
}

afterEach(async () => {
  for (const engine of engines) await engine.close();
  engines.length = 0;
  for (const name of dbNames) await deleteDatabase(name);
  dbNames.clear();
});

describe('LedgerEngine 基础', () => {
  it('初始化返回默认目录与未加密状态', async () => {
    const engine = await setupEngine();
    const result = await engine.initialize();
    expect(result.status).toBe('ready');
    expect(result.crypto).toEqual({ enabled: false, unlocked: false });
    expect(result.catalog?.categories).toHaveLength(15);
    expect(result.catalog?.accounts).toHaveLength(5);
    expect(result.catalog?.categories.every((category) => category.preset)).toBe(true);
    expect(result.version).toMatch(/^0\.1\.0/);
  });

  it('创建、更新、删除记账记录', async () => {
    const engine = await setupEngine({ now: tickClock() });
    const created = await engine.saveEntry({
      draft: expenseDraft({ note: '  lunch  ', amountCents: 1234, occurredAt: localIso(2026, 3, 5, 12) }),
    });
    expect(created.note).toBe('lunch');
    expect(created.amountCents).toBe(1234);
    expect(created.createdAt).toBe('2026-03-01T08:00:00.000Z');
    expect(created.updatedAt).toBe(created.createdAt);
    expect(created.id).toBeTruthy();

    const updated = await engine.saveEntry({
      id: created.id,
      draft: expenseDraft({ note: 'dinner', amountCents: 2000, occurredAt: created.occurredAt }),
    });
    expect(updated.id).toBe(created.id);
    expect(updated.createdAt).toBe(created.createdAt);
    expect(updated.updatedAt > created.updatedAt).toBe(true);
    expect(updated.note).toBe('dinner');

    const month = await engine.listMonth({ month: '2026-03' });
    expect(month.entries).toHaveLength(1);
    expect(month.entries[0]?.amountCents).toBe(2000);
    expect(month.summary).toEqual({
      month: '2026-03',
      expenseCents: 2000,
      incomeCents: 0,
      balanceCents: -2000,
      entryCount: 1,
    });

    await engine.deleteEntry(created.id);
    expect((await engine.listMonth({ month: '2026-03' })).entries).toHaveLength(0);
    await expect(engine.deleteEntry(created.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('listMonth 按时间倒序并支持类型过滤与中文/英文搜索', async () => {
    const engine = await setupEngine();
    const catalog = await engine.addAccount({ name: '招商银行', icon: 'bank', color: '#123456' });
    const bank = catalog.accounts.find((account) => account.name === '招商银行');
    expect(bank).toBeDefined();

    const coffee = await engine.saveEntry({
      draft: expenseDraft({ note: 'Coffee with Bob', occurredAt: localIso(2026, 3, 2, 9) }),
    });
    const taxi = await engine.saveEntry({
      draft: expenseDraft({
        note: '打车去公司',
        categoryId: 'cat_transport',
        accountId: bank?.id ?? '',
        occurredAt: localIso(2026, 3, 3, 10),
      }),
    });
    const salary = await engine.saveEntry({
      draft: incomeDraft({ note: '三月工资', occurredAt: localIso(2026, 3, 3, 9) }),
    });
    const breakfast = await engine.saveEntry({
      draft: expenseDraft({ note: '早餐', occurredAt: localIso(2026, 3, 3, 11) }),
    });

    const all = await engine.listMonth({ month: '2026-03' });
    expect(all.entries.map((entry) => entry.id)).toEqual([breakfast.id, taxi.id, salary.id, coffee.id]);
    expect(all.summary.expenseCents).toBe(3000);
    expect(all.summary.incomeCents).toBe(100_000);

    expect((await engine.listMonth({ month: '2026-03', search: 'coffee' })).entries.map((entry) => entry.id)).toEqual([
      coffee.id,
    ]);
    expect((await engine.listMonth({ month: '2026-03', search: 'COFFEE' })).entries).toHaveLength(1);
    expect((await engine.listMonth({ month: '2026-03', search: '餐饮' })).entries).toHaveLength(2);
    expect((await engine.listMonth({ month: '2026-03', search: '招商' })).entries.map((entry) => entry.id)).toEqual([
      taxi.id,
    ]);
    expect((await engine.listMonth({ month: '2026-03', search: ' 打车 ' })).entries).toHaveLength(1);
    expect((await engine.listMonth({ month: '2026-03', search: '不存在' })).entries).toHaveLength(0);

    const incomes = await engine.listMonth({ month: '2026-03', type: 'income' });
    expect(incomes.entries.map((entry) => entry.id)).toEqual([salary.id]);
    expect(incomes.summary).toMatchObject({ expenseCents: 0, incomeCents: 100_000, entryCount: 1 });
    expect((await engine.listMonth({ month: '2026-03', type: 'expense' })).entries).toHaveLength(3);
  });

  it('getStats 覆盖当月每一天并计算分类占比、活跃天数、日均与峰值日', async () => {
    const engine = await setupEngine();
    const empty = await engine.getStats('2026-03');
    expect(empty.daily).toHaveLength(31);
    expect(empty.daily.every((day) => day.expenseCents === 0 && day.incomeCents === 0 && day.count === 0)).toBe(true);
    expect(empty.activeDays).toBe(0);
    expect(empty.averageDailyExpenseCents).toBe(0);
    expect(empty.peakDay).toBeNull();
    expect(empty.expenseCategories).toEqual([]);
    expect(empty.incomeCategories).toEqual([]);

    await engine.saveEntry({
      draft: expenseDraft({ amountCents: 1000, occurredAt: localIso(2026, 3, 1, 8) }),
    });
    await engine.saveEntry({
      draft: expenseDraft({ amountCents: 2500, categoryId: 'cat_transport', occurredAt: localIso(2026, 3, 2, 9) }),
    });
    await engine.saveEntry({
      draft: expenseDraft({ amountCents: 500, occurredAt: localIso(2026, 3, 2, 18) }),
    });
    await engine.saveEntry({
      draft: incomeDraft({ amountCents: 100_000, occurredAt: localIso(2026, 3, 5, 10) }),
    });
    await engine.saveEntry({
      draft: expenseDraft({ amountCents: 100, categoryId: 'cat_other', occurredAt: localIso(2026, 3, 31, 23) }),
    });

    const stats = await engine.getStats('2026-03');
    expect(stats.daysInMonth).toBe(31);
    expect(stats.daily).toHaveLength(31);
    expect(stats.daily[0]).toEqual({ date: '2026-03-01', expenseCents: 1000, incomeCents: 0, count: 1 });
    expect(stats.daily[1]).toEqual({ date: '2026-03-02', expenseCents: 3000, incomeCents: 0, count: 2 });
    expect(stats.daily[4]).toEqual({ date: '2026-03-05', expenseCents: 0, incomeCents: 100_000, count: 1 });
    expect(stats.daily[30]).toEqual({ date: '2026-03-31', expenseCents: 100, incomeCents: 0, count: 1 });
    expect(stats.expenseCents).toBe(4100);
    expect(stats.incomeCents).toBe(100_000);
    expect(stats.netCents).toBe(95_900);
    expect(stats.entryCount).toBe(5);
    expect(stats.activeDays).toBe(4);
    expect(stats.averageDailyExpenseCents).toBe(132);
    expect(stats.peakDay).toEqual({ date: '2026-03-02', expenseCents: 3000, incomeCents: 0, count: 2 });
    expect(stats.expenseCategories.map((item) => item.name)).toEqual(['交通', '餐饮', '其他']);
    expect(stats.expenseCategories.map((item) => item.amountCents)).toEqual([2500, 1500, 100]);
    expect(stats.expenseCategories[0]?.share).toBeCloseTo(2500 / 4100);
    expect(stats.incomeCategories).toHaveLength(1);
    expect(stats.incomeCategories[0]).toMatchObject({ name: '工资', amountCents: 100_000, share: 1 });
  });

  it('分类与账户软归档后仍可解析历史记录', async () => {
    const engine = await setupEngine();
    const entry = await engine.saveEntry({
      draft: expenseDraft({ note: '历史午餐', occurredAt: localIso(2026, 3, 5) }),
    });

    const archived = await engine.updateCategory('cat_food', { archived: true });
    expect(archived.categories.find((category) => category.id === 'cat_food')?.archived).toBe(true);
    expect((await engine.listMonth({ month: '2026-03', search: '餐饮' })).entries[0]?.id).toBe(entry.id);
    expect((await engine.getStats('2026-03')).expenseCategories[0]).toMatchObject({
      name: '餐饮',
      amountCents: 1000,
    });
    await expect(
      engine.saveEntry({ draft: expenseDraft({ categoryId: 'cat_food', occurredAt: localIso(2026, 3, 6) }) }),
    ).rejects.toMatchObject({ code: 'VALIDATION', message: '分类已归档' });

    const edited = await engine.saveEntry({
      id: entry.id,
      draft: expenseDraft({ note: '备注更新', occurredAt: entry.occurredAt }),
    });
    expect(edited.note).toBe('备注更新');

    const withAccount = await engine.addAccount({ name: '测试卡', icon: 'card', color: '#abcdef' });
    const card = withAccount.accounts.find((account) => account.name === '测试卡');
    expect(card).toBeDefined();
    const accountEntry = await engine.saveEntry({
      draft: expenseDraft({
        categoryId: 'cat_transport',
        accountId: card?.id ?? '',
        occurredAt: localIso(2026, 3, 7),
      }),
    });
    await engine.updateAccount(card?.id ?? '', { archived: true });
    expect((await engine.listMonth({ month: '2026-03' })).entries.some((item) => item.id === accountEntry.id)).toBe(true);
    await expect(
      engine.saveEntry({
        draft: expenseDraft({
          categoryId: 'cat_transport',
          accountId: card?.id ?? '',
          occurredAt: localIso(2026, 3, 8),
        }),
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION', message: '账户已归档' });
  });

  it('分类与账户的增改校验', async () => {
    const engine = await setupEngine();
    const catalog = await engine.addCategory({ name: ' 宠物 ', type: 'expense', icon: 'other', color: '#123ABC' });
    const pet = catalog.categories.find((category) => category.name === '宠物');
    expect(pet).toMatchObject({ type: 'expense', archived: false, preset: false, color: '#123abc' });
    expect(catalog.categories).toHaveLength(16);

    const renamed = await engine.updateCategory(pet?.id ?? '', { name: '萌宠', icon: 'fun', color: '#ff0000' });
    expect(renamed.categories.find((category) => category.id === pet?.id)).toMatchObject({
      name: '萌宠',
      icon: 'fun',
      color: '#ff0000',
    });

    await expect(engine.updateCategory('missing', { name: 'x' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(engine.updateAccount('missing', { name: 'x' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      engine.addCategory({ name: '', type: 'expense', icon: 'other', color: '#123456' }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('保存记账时严格校验金额、分类、账户与日期', async () => {
    const engine = await setupEngine();
    await expect(engine.saveEntry({ draft: expenseDraft({ amountCents: 0 }) })).rejects.toMatchObject({
      code: 'VALIDATION',
    });
    await expect(engine.saveEntry({ draft: expenseDraft({ categoryId: 'missing' }) })).rejects.toMatchObject({
      code: 'VALIDATION',
      message: '分类不存在',
    });
    await expect(
      engine.saveEntry({ draft: expenseDraft({ categoryId: 'cat_salary' }) }),
    ).rejects.toMatchObject({ code: 'VALIDATION', message: '分类与收支类型不匹配' });
    await expect(engine.saveEntry({ draft: expenseDraft({ accountId: 'missing' }) })).rejects.toMatchObject({
      code: 'VALIDATION',
      message: '账户不存在',
    });
    await expect(
      engine.saveEntry({ draft: expenseDraft({ occurredAt: 'not-a-date' }) }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('resetAll 清空数据并恢复未加密的默认目录', async () => {
    const engine = await setupEngine();
    await engine.saveEntry({ draft: expenseDraft({ occurredAt: localIso(2026, 3, 5) }) });
    await engine.addCategory({ name: '临时', type: 'expense', icon: 'other', color: '#111111' });

    const result = await engine.resetAll();
    expect(result.status).toBe('ready');
    expect(result.crypto).toEqual({ enabled: false, unlocked: false });
    expect(result.catalog?.categories).toHaveLength(15);
    expect(result.catalog?.accounts).toHaveLength(5);
    expect((await engine.listMonth({ month: '2026-03' })).entries).toHaveLength(0);
    expect((await engine.getStats('2026-03')).entryCount).toBe(0);
  });
});
