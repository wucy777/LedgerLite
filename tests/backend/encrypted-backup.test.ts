import { afterEach, describe, expect, it } from 'vitest';
import { LedgerEngine } from '../../src/backend/engine';
import {
  DEFAULT_LEDGER_ID,
  createEngine,
  deleteDatabase,
  expenseDraft,
  localIso,
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

describe('加密备份', () => {
  it('导出不暴露明文，正确口令可恢复，错误口令被拒绝', async () => {
    const { engine: source } = await setup();
    await source.saveEntry({
      ledgerId: DEFAULT_LEDGER_ID,
      draft: expenseDraft({ note: '加密备份午餐', amountCents: 4321, occurredAt: localIso(2026, 5, 2) }),
    });
    await source.enableEncryption('backup-pass-123');

    const envelope = await source.exportEncryptedBackup(DEFAULT_LEDGER_ID);
    expect(envelope).toMatchObject({
      app: 'ledgerlite',
      kind: 'encrypted-backup',
      schema: 1,
      kdf: { name: 'PBKDF2-SHA256', iterations: 310_000 },
    });
    expect(envelope.kdf.salt.length).toBeGreaterThan(10);
    expect(envelope.cipher.iv.length).toBeGreaterThan(10);
    expect(envelope.cipher.data.length).toBeGreaterThan(10);
    const serialized = JSON.stringify(envelope);
    expect(serialized).not.toContain('加密备份午餐');
    expect(serialized).not.toContain('默认账本');
    expect(serialized).not.toContain('餐饮');

    const { engine: target } = await setup();
    await expect(
      target.importEncryptedBackup(DEFAULT_LEDGER_ID, 'wrong-pass', envelope),
    ).rejects.toMatchObject({ code: 'INVALID_PASSPHRASE' });
    const result = await target.importEncryptedBackup(DEFAULT_LEDGER_ID, 'backup-pass-123', envelope);
    expect(result.entryCount).toBe(1);
    const month = await target.listMonth({ ledgerId: DEFAULT_LEDGER_ID, month: '2026-05' });
    expect(month.entries[0]?.note).toBe('加密备份午餐');
    expect(month.entries[0]?.amountCents).toBe(4321);
  });

  it('导入到已加密目标账本时使用目标口令重新加密', async () => {
    const { engine: source } = await setup();
    await saveExpense(source, DEFAULT_LEDGER_ID, { note: '跨口令恢复' });
    await source.enableEncryption('source-pass-123');
    const envelope = await source.exportEncryptedBackup(DEFAULT_LEDGER_ID);

    const { engine: target } = await setup();
    await target.enableEncryption('target-pass-456');
    await target.importEncryptedBackup(DEFAULT_LEDGER_ID, 'source-pass-123', envelope);
    await target.lock();
    const unlocked = await target.unlock('target-pass-456');
    expect(unlocked.status).toBe('ready');
    const month = await target.listMonth({ ledgerId: DEFAULT_LEDGER_ID, month: '2026-03' });
    expect(month.entries[0]?.note).toBe('跨口令恢复');
  });

  it('加密备份可导入为新账本并保留目标账本原记录', async () => {
    const { engine: source } = await setup();
    await saveExpense(source, DEFAULT_LEDGER_ID, { note: '新账本中的加密记录' });
    await source.enableEncryption('source-pass-123');
    const envelope = await source.exportEncryptedBackup(DEFAULT_LEDGER_ID);

    const { engine: target } = await setup();
    const kept = await saveExpense(target, DEFAULT_LEDGER_ID, { note: '目标原记录' });
    await target.enableEncryption('target-pass-456');

    const result = await target.importEncryptedBackupAsLedger(
      'source-pass-123',
      envelope,
      '加密恢复账本',
    );
    expect(result.ledger.name).toBe('加密恢复账本');
    expect(result.ledgers).toHaveLength(2);
    expect(result.entryCount).toBe(1);

    const keptMonth = await target.listMonth({ ledgerId: DEFAULT_LEDGER_ID, month: '2026-03' });
    expect(keptMonth.entries.map((entry) => entry.id)).toEqual([kept.id]);
    const imported = await target.listMonth({ ledgerId: result.ledger.id, month: '2026-03' });
    expect(imported.entries[0]?.note).toBe('新账本中的加密记录');
    expect(imported.entries[0]?.id).not.toBe(kept.id);
  });

  it('未启用本地加密时拒绝导出加密备份', async () => {
    const { engine } = await setup();
    await expect(engine.exportEncryptedBackup(DEFAULT_LEDGER_ID)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });
});
