import { describe, expect, it } from 'vitest';
import type { BackupPayload } from '../../src/shared/types';
import {
  backupFileName,
  buildCsv,
  csvFileName,
  encryptedBackupFileName,
  formatBackupMoment,
  formatBytes,
  readBackupFile,
} from '../../src/frontend/features/settings/backup';

const payload: BackupPayload = {
  app: 'ledgerlite',
  schema: 1,
  version: '0.1.0-beta',
  exportedAt: '2026-10-30T10:00:00.000Z',
  entries: [
    {
      id: 'e1',
      type: 'expense',
      amountCents: 1830,
      categoryId: 'cat_food',
      accountId: 'acc_wechat',
      note: '牛肉面, 加蛋',
      occurredAt: new Date(2026, 9, 30, 12, 15).toISOString(),
      createdAt: '2026-10-30T04:15:00.000Z',
      updatedAt: '2026-10-30T04:15:00.000Z',
    },
  ],
  catalog: {
    categories: [
      {
        id: 'cat_food',
        name: '餐饮',
        type: 'expense',
        icon: 'food',
        color: '#d96f52',
        archived: false,
        preset: true,
        sort: 0,
      },
    ],
    accounts: [
      {
        id: 'acc_wechat',
        name: '微信',
        icon: 'wechat',
        color: '#3f9e63',
        archived: false,
        preset: true,
        sort: 0,
      },
    ],
  },
};

describe('backup helpers', () => {
  it('builds RFC 4180 CSV with BOM and escaped fields', () => {
    const csv = buildCsv(payload);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain('日期时间,类型,金额,分类,账户,备注');
    expect(csv).toContain('"牛肉面, 加蛋"');
    expect(csv.endsWith('\r\n')).toBe(true);
  });

  it('derives stable file names', () => {
    const now = new Date(2026, 9, 30, 12);
    expect(backupFileName(now)).toBe('ledgerlite-backup-20261030.json');
    expect(encryptedBackupFileName(now)).toBe('ledgerlite-encrypted-backup-20261030.json');
    expect(csvFileName(now)).toBe('ledgerlite-202610.csv');
  });

  it('formats storage sizes and export moments', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(10 * 1024 * 1024)).toBe('10.0 MB');
    expect(formatBytes(Number.NaN)).toBe('');
    expect(formatBackupMoment('2026-10-30T10:00:00.000Z')).toMatch(/^2026-10-30 \d{2}:\d{2}$/);
    expect(formatBackupMoment('bad-date')).toBe('');
  });

  it('validates backup files before preview', async () => {
    const file = new File([JSON.stringify(payload)], 'backup.json', { type: 'application/json' });
    const preview = await readBackupFile(file);
    expect(preview.entryCount).toBe(1);
    expect(preview.categoryCount).toBe(1);
    expect(preview.accountCount).toBe(1);
    expect(preview.version).toBe('0.1.0-beta');

    const wrongApp = new File([JSON.stringify({ ...payload, app: 'other' })], 'wallet.json');
    await expect(readBackupFile(wrongApp)).rejects.toThrow('不是简账备份文件');
    const malformed = new File(['not json'], 'broken.json');
    await expect(readBackupFile(malformed)).rejects.toThrow('文件不是有效的 JSON');

    const encryptedPreview = await readBackupFile(
      new File(
        [
          JSON.stringify({
            app: 'ledgerlite',
            kind: 'encrypted-backup',
            schema: 1,
            version: '0.1.0-beta',
            exportedAt: '2026-10-30T10:00:00.000Z',
            kdf: { name: 'PBKDF2-SHA256', iterations: 310_000, salt: 'c2FsdA==' },
            verifier: { iv: 'aXY=', data: 'ZGF0YQ==' },
            cipher: { iv: 'aXY=', data: 'ZGF0YQ==' },
          }),
        ],
        'encrypted.json',
      ),
    );
    expect(encryptedPreview.encrypted).toBe(true);
    expect(encryptedPreview.entryCount).toBe(0);
  });
});
