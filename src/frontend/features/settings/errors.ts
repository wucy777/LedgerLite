import { LedgerError, type ErrorCode } from '@shared/types';

const CODE_MESSAGES: Partial<Record<ErrorCode, string>> = {
  LOCKED: '账本已锁定，请先解锁',
  INVALID_PASSPHRASE: '口令错误，请重新输入',
  NOT_FOUND: '数据已不存在，请刷新后重试',
  CONFLICT: '当前状态已变化，请刷新后重试',
  CRYPTO_UNAVAILABLE: '当前环境不支持本地加密',
  STORAGE_FAILED: '本地存储读写失败，请检查可用空间后重试',
  UNSUPPORTED: '当前版本不支持此操作',
  INTERNAL: '本地数据服务异常，请重试',
};

/** Turns worker/RPC errors into short, neutral Chinese copy. */
export function friendlyError(reason: unknown, fallback: string): string {
  if (reason instanceof LedgerError) {
    if ((reason.code === 'VALIDATION' || reason.code === 'IMPORT_INVALID') && reason.message) {
      return reason.message;
    }
    return CODE_MESSAGES[reason.code] ?? fallback;
  }
  if (reason instanceof Error && reason.message) return reason.message;
  return fallback;
}
