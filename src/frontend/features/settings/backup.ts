import { formatTime, localDateKey } from '@shared/date';
import { formatCents } from '@shared/money';
import { ENCRYPTED_BACKUP_SCHEMA, type BackupPayload } from '@shared/types';
import { isRecord } from '@shared/validation';

const MAX_BACKUP_BYTES = 32 * 1024 * 1024;

export type ExportOutcome = 'downloaded' | 'shared';

function downloadInBrowser(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('无法读取导出数据'));
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const comma = result.indexOf(',');
      if (comma === -1) {
        reject(new Error('无法读取导出数据'));
        return;
      }
      resolve(result.slice(comma + 1));
    };
    reader.readAsDataURL(blob);
  });
}

/**
 * Uses the native share sheet inside the Android shell because WebView does not expose
 * a downloads UI for anchor/blob downloads. The browser build keeps a normal file download.
 */
export async function saveExportFile(blob: Blob, filename: string): Promise<ExportOutcome> {
  const { Capacitor } = await import('@capacitor/core');
  if (!Capacitor.isNativePlatform()) {
    downloadInBrowser(blob, filename);
    return 'downloaded';
  }

  try {
    const { Directory, Filesystem } = await import('@capacitor/filesystem');
    const { Share } = await import('@capacitor/share');
    const data = await blobToBase64(blob);
    const file = await Filesystem.writeFile({
      path: `exports/${filename}`,
      data,
      directory: Directory.Cache,
      recursive: true,
    });
    await Share.share({
      title: filename,
      dialogTitle: '保存或分享导出文件',
      files: [file.uri],
    });
    return 'shared';
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    throw new Error(message ? `无法导出文件：${message}` : '无法导出文件，请重试');
  }
}

export function backupFileName(now = new Date()): string {
  return `ledgerlite-backup-${localDateKey(now).replaceAll('-', '')}.json`;
}

export function encryptedBackupFileName(now = new Date()): string {
  return `ledgerlite-encrypted-backup-${localDateKey(now).replaceAll('-', '')}.json`;
}

export function csvFileName(now = new Date()): string {
  return `ledgerlite-${localDateKey(now).slice(0, 7).replace('-', '')}.csv`;
}

function csvCell(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replaceAll('"', '""')}"`;
  return value;
}

/** RFC 4180 style CSV with a UTF-8 BOM so spreadsheet apps detect the encoding. */
export function buildCsv(payload: BackupPayload): string {
  const categoryNames = new Map(payload.catalog.categories.map((category) => [category.id, category.name]));
  const accountNames = new Map(payload.catalog.accounts.map((account) => [account.id, account.name]));
  const rows: string[][] = [['日期时间', '类型', '金额', '分类', '账户', '备注']];
  for (const entry of payload.entries) {
    rows.push([
      `${localDateKey(entry.occurredAt)} ${formatTime(entry.occurredAt)}`,
      entry.type === 'expense' ? '支出' : '收入',
      formatCents(entry.amountCents),
      categoryNames.get(entry.categoryId) ?? '未分类',
      accountNames.get(entry.accountId) ?? '未知账户',
      entry.note,
    ]);
  }
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

export interface BackupPreview {
  backup: unknown;
  encrypted: boolean;
  entryCount: number;
  categoryCount: number;
  accountCount: number;
  exportedAt: string | null;
  version: string | null;
}

function isEncryptedBackup(value: Record<string, unknown>): boolean {
  if (value.app !== 'ledgerlite') throw new Error('不是简账备份文件');
  if (value.kind !== 'encrypted-backup') return false;
  if (value.schema !== ENCRYPTED_BACKUP_SCHEMA) throw new Error('不支持的加密备份版本');
  if (!isRecord(value.kdf) || value.kdf.name !== 'PBKDF2-SHA256') {
    throw new Error('加密备份参数无效');
  }
  if (typeof value.kdf.iterations !== 'number' || typeof value.kdf.salt !== 'string') {
    throw new Error('加密备份参数无效');
  }
  if (
    !isRecord(value.verifier) ||
    typeof value.verifier.iv !== 'string' ||
    typeof value.verifier.data !== 'string'
  ) {
    throw new Error('加密备份校验信息无效');
  }
  if (
    !isRecord(value.cipher) ||
    typeof value.cipher.iv !== 'string' ||
    typeof value.cipher.data !== 'string'
  ) {
    throw new Error('加密备份密文无效');
  }
  return true;
}

export async function readBackupFile(file: File): Promise<BackupPreview> {
  if (file.size > MAX_BACKUP_BYTES) {
    throw new Error('备份文件过大，请选择小于 32 MB 的文件');
  }
  let text: string;
  try {
    text = await file.text();
  } catch {
    throw new Error('无法读取所选文件');
  }
  let parsed: unknown;
  try {
    const normalized = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
    parsed = JSON.parse(normalized) as unknown;
  } catch {
    throw new Error('文件不是有效的 JSON');
  }
  if (!isRecord(parsed)) throw new Error('备份数据格式无效');
  const encrypted = isEncryptedBackup(parsed);
  const exportedAt = typeof parsed.exportedAt === 'string' ? parsed.exportedAt : null;
  const version = typeof parsed.version === 'string' ? parsed.version : null;
  if (encrypted) {
    return {
      backup: parsed,
      encrypted: true,
      entryCount: 0,
      categoryCount: 0,
      accountCount: 0,
      exportedAt,
      version,
    };
  }
  if (parsed.schema !== 1 && parsed.schema !== 2) throw new Error('不支持的备份版本');
  if (!Array.isArray(parsed.entries)) throw new Error('备份记录格式无效');
  if (!isRecord(parsed.catalog)) throw new Error('备份中的分类与账户格式无效');
  if (!Array.isArray(parsed.catalog.categories) || !Array.isArray(parsed.catalog.accounts)) {
    throw new Error('备份中的分类与账户格式无效');
  }
  if (parsed.catalog.categories.length === 0) throw new Error('备份中没有分类');
  if (parsed.catalog.accounts.length === 0) throw new Error('备份中没有账户');
  return {
    backup: parsed,
    encrypted: false,
    entryCount: parsed.entries.length,
    categoryCount: parsed.catalog.categories.length,
    accountCount: parsed.catalog.accounts.length,
    exportedAt,
    version,
  };
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'] as const;
  let value = bytes / 1024;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  const rounded = value >= 100 ? String(Math.round(value)) : value.toFixed(1);
  return `${rounded} ${units[index] ?? 'KB'}`;
}

export function formatBackupMoment(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return `${localDateKey(date)} ${formatTime(iso)}`;
}
