import { LedgerError, type AccountInput, type CategoryInput, type EntryDraft, type EntryType } from './types';
import { isMonthKey } from './date';
import { MAX_AMOUNT_CENTS } from './money';

const NOTE_MAX_LENGTH = 120;
const NAME_MAX_LENGTH = 12;
const COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

function fail(message: string): never {
  throw new LedgerError('VALIDATION', message);
}

export function assertMonth(month: unknown): asserts month is string {
  if (typeof month !== 'string' || !isMonthKey(month)) fail('月份格式无效');
}

export function normalizeNote(note: unknown): string {
  if (note === undefined || note === null) return '';
  if (typeof note !== 'string') fail('备注格式无效');
  const trimmed = note.trim();
  if (trimmed.length > NOTE_MAX_LENGTH) fail(`备注不能超过 ${NOTE_MAX_LENGTH} 个字符`);
  return trimmed;
}

export function normalizeName(name: unknown): string {
  if (typeof name !== 'string') fail('名称格式无效');
  const trimmed = name.trim();
  if (!trimmed) fail('名称不能为空');
  if (trimmed.length > NAME_MAX_LENGTH) fail(`名称不能超过 ${NAME_MAX_LENGTH} 个字符`);
  return trimmed;
}

export function normalizeColor(color: unknown, fallback = '#8a8e85'): string {
  if (typeof color !== 'string' || !COLOR_PATTERN.test(color)) return fallback;
  return color.toLowerCase();
}

export function assertIsoDate(value: unknown): asserts value is string {
  if (typeof value !== 'string') fail('日期格式无效');
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) fail('日期格式无效');
}

export function validateEntryDraft(draft: EntryDraft): EntryDraft {
  if (!draft || typeof draft !== 'object') fail('记账数据无效');
  if (draft.type !== 'expense' && draft.type !== 'income') fail('收支类型无效');
  if (!Number.isSafeInteger(draft.amountCents) || draft.amountCents <= 0 || draft.amountCents > MAX_AMOUNT_CENTS) {
    fail('金额需大于 0 且不超过 99,999,999.99');
  }
  if (typeof draft.categoryId !== 'string' || !draft.categoryId) fail('请选择分类');
  if (typeof draft.accountId !== 'string' || !draft.accountId) fail('请选择账户');
  assertIsoDate(draft.occurredAt);
  return {
    type: draft.type,
    amountCents: draft.amountCents,
    categoryId: draft.categoryId,
    accountId: draft.accountId,
    note: normalizeNote(draft.note),
    occurredAt: new Date(draft.occurredAt).toISOString(),
  };
}

export function validateEntryType(value: unknown): EntryType {
  if (value !== 'expense' && value !== 'income') fail('收支类型无效');
  return value;
}

export function validateCategoryInput(input: CategoryInput): CategoryInput {
  return {
    name: normalizeName(input?.name),
    type: validateEntryType(input?.type),
    icon: typeof input?.icon === 'string' ? input.icon : 'other',
    color: normalizeColor(input?.color),
  };
}

export function validateAccountInput(input: AccountInput): AccountInput {
  return {
    name: normalizeName(input?.name),
    icon: typeof input?.icon === 'string' ? input.icon : 'wallet',
    color: normalizeColor(input?.color),
  };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
