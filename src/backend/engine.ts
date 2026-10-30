import { createDefaultCatalog } from '../shared/defaults';
import { daysInMonth, localDateKey, monthKeyOfIso } from '../shared/date';
import { MAX_AMOUNT_CENTS } from '../shared/money';
import {
  APP_VERSION,
  LedgerError,
  type Account,
  type AccountInput,
  type AccountPatch,
  type BackupPayload,
  type Catalog,
  type Category,
  type CategoryInput,
  type CategoryPatch,
  type CategoryTotal,
  type DailyTotal,
  type Entry,
  type EntryFilter,
  type IconName,
  type ImportResult,
  type InitResult,
  type MonthQuery,
  type MonthResult,
  type MonthStats,
  type MonthSummary,
  type SaveEntryInput,
} from '../shared/types';
import {
  assertMonth,
  isRecord,
  normalizeColor,
  normalizeName,
  validateAccountInput,
  validateCategoryInput,
  validateEntryDraft,
} from '../shared/validation';
import {
  CATALOG_AAD,
  SALT_BYTES,
  createVerifier,
  decryptJson,
  deriveKeys,
  encryptJson,
  entryAad,
  hmacHex,
  randomBytes,
  randomHex,
  verifyVerifier,
  type CryptoKeys,
  type EncryptedBlob,
  type Verifier,
} from './crypto';
import { ENTRY_STORE, KV_STORE, LedgerDatabase, MONTH_INDEX } from './db';

const NOTE_MAX_LENGTH = 120;
const NAME_MAX_LENGTH = 12;
const COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

export interface LedgerEngineOptions {
  /** Inject an IDBFactory for tests or for running outside the default global. */
  factory?: IDBFactory;
  dbName?: string;
  now?: () => Date;
  generateId?: () => string;
}

type StoredValue<T> = { encrypted: false; value: T } | ({ encrypted: true } & EncryptedBlob);

interface EntryRecord {
  id: string;
  monthTag: string;
  payload: StoredValue<Entry>;
}

interface CatalogRecord {
  key: 'catalog';
  payload: StoredValue<Catalog>;
}

interface CryptoMetaRecord {
  key: 'crypto';
  salt: ArrayBuffer;
  verifier: Verifier;
}

function defaultGenerateId(): string {
  const webCrypto = globalThis.crypto;
  if (webCrypto && typeof webCrypto.randomUUID === 'function') return webCrypto.randomUUID();
  return randomHex(16);
}

function cloneCatalog(catalog: Catalog): Catalog {
  return {
    categories: catalog.categories.map((category) => ({ ...category })),
    accounts: catalog.accounts.map((account) => ({ ...account })),
  };
}

function summarize(entries: readonly Entry[], month: string): MonthSummary {
  let expenseCents = 0;
  let incomeCents = 0;
  for (const entry of entries) {
    if (entry.type === 'expense') expenseCents += entry.amountCents;
    else incomeCents += entry.amountCents;
  }
  return {
    month,
    expenseCents,
    incomeCents,
    balanceCents: incomeCents - expenseCents,
    entryCount: entries.length,
  };
}

function compareEntriesDesc(a: Entry, b: Entry): number {
  const occurred = Date.parse(b.occurredAt) - Date.parse(a.occurredAt);
  if (occurred !== 0) return occurred;
  return Date.parse(b.createdAt) - Date.parse(a.createdAt);
}

function nextSort(items: readonly { sort: number }[]): number {
  return items.reduce((max, item) => Math.max(max, item.sort), -1) + 1;
}

function buildCategoryTotals(entries: readonly Entry[], catalog: Catalog, totalCents: number): CategoryTotal[] {
  const categories = new Map(catalog.categories.map((category) => [category.id, category]));
  const totals = new Map<string, { amountCents: number; count: number }>();
  for (const entry of entries) {
    const current = totals.get(entry.categoryId) ?? { amountCents: 0, count: 0 };
    current.amountCents += entry.amountCents;
    current.count += 1;
    totals.set(entry.categoryId, current);
  }
  return [...totals.entries()]
    .map(([categoryId, value]) => {
      const category = categories.get(categoryId);
      return {
        categoryId,
        name: category?.name ?? '未分类',
        icon: category?.icon ?? 'other',
        color: category?.color ?? '#8a8e85',
        amountCents: value.amountCents,
        count: value.count,
        share: totalCents > 0 ? value.amountCents / totalCents : 0,
      };
    })
    .sort((a, b) => b.amountCents - a.amountCents || a.name.localeCompare(b.name, 'zh'));
}

function assertPassphrase(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new LedgerError('VALIDATION', '口令不能为空');
  }
  return value;
}

function requireIcon(value: unknown): IconName {
  if (typeof value !== 'string' || value.length === 0) {
    throw new LedgerError('VALIDATION', '图标无效');
  }
  return value as IconName;
}

function invalidImport(message: string): never {
  throw new LedgerError('IMPORT_INVALID', message);
}

function requireImportIcon(value: unknown): IconName {
  if (typeof value !== 'string' || value.length === 0) invalidImport('图标无效');
  return value as IconName;
}

function requireId(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') invalidImport(`${label} ID 无效`);
  return value;
}

function requireText(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== 'string') invalidImport(`${label}格式无效`);
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) invalidImport(`${label}格式无效`);
  return trimmed;
}

function requireColor(value: unknown, label: string): string {
  if (typeof value !== 'string' || !COLOR_PATTERN.test(value)) invalidImport(`${label}无效`);
  return value.toLowerCase();
}

function requireBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') invalidImport(`${label}无效`);
  return value;
}

function requireInteger(value: unknown, label: string, min: number, max = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) {
    invalidImport(`${label}无效`);
  }
  return value as number;
}

function requireIso(value: unknown, label: string): string {
  if (typeof value !== 'string') invalidImport(`${label}无效`);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) invalidImport(`${label}无效`);
  return date.toISOString();
}

function parseBackup(value: unknown): BackupPayload {
  if (!isRecord(value)) invalidImport('备份数据格式无效');
  if (value.app !== 'ledgerlite') invalidImport('不是有效的备份文件');
  if (value.schema !== 1) invalidImport('不支持的备份版本');
  if (typeof value.version !== 'string' || value.version.trim() === '') invalidImport('备份版本信息缺失');
  const exportedAt = requireIso(value.exportedAt, '导出时间');
  if (!Array.isArray(value.entries)) invalidImport('备份记录格式无效');
  if (!isRecord(value.catalog)) invalidImport('备份目录格式无效');
  const rawCategories = value.catalog.categories;
  const rawAccounts = value.catalog.accounts;
  if (!Array.isArray(rawCategories) || !Array.isArray(rawAccounts)) invalidImport('备份目录格式无效');

  const categoryIds = new Set<string>();
  const categories: Category[] = rawCategories.map((item) => {
    if (!isRecord(item)) invalidImport('分类数据格式无效');
    const id = requireId(item.id, '分类');
    if (categoryIds.has(id)) invalidImport('分类 ID 重复');
    categoryIds.add(id);
    if (item.type !== 'expense' && item.type !== 'income') invalidImport('分类类型无效');
    return {
      id,
      name: requireText(item.name, '分类名称', NAME_MAX_LENGTH),
      type: item.type,
      icon: requireImportIcon(item.icon),
      color: requireColor(item.color, '分类颜色'),
      archived: requireBoolean(item.archived, '分类归档状态'),
      preset: requireBoolean(item.preset, '分类预设状态'),
      sort: requireInteger(item.sort, '分类排序', 0),
    };
  });

  const accountIds = new Set<string>();
  const accounts: Account[] = rawAccounts.map((item) => {
    if (!isRecord(item)) invalidImport('账户数据格式无效');
    const id = requireId(item.id, '账户');
    if (accountIds.has(id)) invalidImport('账户 ID 重复');
    accountIds.add(id);
    return {
      id,
      name: requireText(item.name, '账户名称', NAME_MAX_LENGTH),
      icon: requireImportIcon(item.icon),
      color: requireColor(item.color, '账户颜色'),
      archived: requireBoolean(item.archived, '账户归档状态'),
      preset: requireBoolean(item.preset, '账户预设状态'),
      sort: requireInteger(item.sort, '账户排序', 0),
    };
  });

  const categoriesById = new Map(categories.map((category) => [category.id, category]));
  const entriesById = new Set<string>();
  const entries: Entry[] = value.entries.map((item) => {
    if (!isRecord(item)) invalidImport('记账数据格式无效');
    const id = requireId(item.id, '记账');
    if (entriesById.has(id)) invalidImport('记账 ID 重复');
    entriesById.add(id);
    if (item.type !== 'expense' && item.type !== 'income') invalidImport('收支类型无效');
    const amountCents = requireInteger(item.amountCents, '金额', 1, MAX_AMOUNT_CENTS);
    const categoryId = requireId(item.categoryId, '分类引用');
    const category = categoriesById.get(categoryId);
    if (!category) invalidImport('分类引用不存在');
    if (category.type !== item.type) invalidImport('分类与收支类型不匹配');
    const accountId = requireId(item.accountId, '账户引用');
    if (!accountIds.has(accountId)) invalidImport('账户引用不存在');
    if (typeof item.note !== 'string') invalidImport('备注格式无效');
    const note = item.note.trim();
    if (note.length > NOTE_MAX_LENGTH) invalidImport(`备注不能超过 ${NOTE_MAX_LENGTH} 个字符`);
    return {
      id,
      type: item.type,
      amountCents,
      categoryId,
      accountId,
      note,
      occurredAt: requireIso(item.occurredAt, '发生时间'),
      createdAt: requireIso(item.createdAt, '创建时间'),
      updatedAt: requireIso(item.updatedAt, '更新时间'),
    };
  });

  return {
    app: 'ledgerlite',
    schema: 1,
    version: value.version,
    exportedAt,
    entries,
    catalog: { categories, accounts },
  };
}

/**
 * Storage engine behind the worker RPC. It owns the domain rules; the worker file is only a shell.
 * Every crypto computation happens before the transaction that persists its result is opened.
 */
export class LedgerEngine {
  private readonly database: LedgerDatabase;
  private readonly now: () => Date;
  private readonly generateId: () => string;
  private initialized = false;
  private enabled = false;
  private keys: CryptoKeys | null = null;
  private catalog: Catalog | null = null;

  constructor(options: LedgerEngineOptions = {}) {
    const factory =
      options.factory ?? (typeof globalThis.indexedDB === 'undefined' ? undefined : globalThis.indexedDB);
    if (!factory) throw new LedgerError('STORAGE_FAILED', '当前环境不支持本地存储');
    this.database = new LedgerDatabase(factory, options.dbName);
    this.now = options.now ?? (() => new Date());
    this.generateId = options.generateId ?? defaultGenerateId;
  }

  async initialize(): Promise<InitResult> {
    if (this.initialized) return this.currentInitResult();
    await this.database.open();
    const meta = await this.readCryptoMeta();
    if (meta) {
      this.enabled = true;
      this.keys = null;
      this.catalog = null;
    } else {
      this.enabled = false;
      this.keys = null;
      await this.loadCatalog();
    }
    this.initialized = true;
    return this.currentInitResult();
  }

  async unlock(passphrase: string): Promise<InitResult> {
    await this.ensureInitialized();
    if (!this.enabled || this.keys) return this.currentInitResult();
    const meta = await this.readCryptoMeta();
    if (!meta) throw new LedgerError('STORAGE_FAILED', '加密信息缺失');
    const keys = await deriveKeys(assertPassphrase(passphrase), meta.salt);
    if (!(await verifyVerifier(keys, meta.verifier))) {
      throw new LedgerError('INVALID_PASSPHRASE', '口令错误');
    }
    this.keys = keys;
    try {
      await this.loadCatalog();
    } catch (error) {
      this.keys = null;
      this.catalog = null;
      throw error;
    }
    return this.currentInitResult();
  }

  async lock(): Promise<InitResult> {
    if (!this.initialized) return this.initialize();
    if (!this.enabled) return this.currentInitResult();
    this.keys = null;
    this.catalog = null;
    return this.currentInitResult();
  }

  async enableEncryption(passphrase: string): Promise<InitResult> {
    await this.ensureReady();
    if (this.enabled) throw new LedgerError('CONFLICT', '已启用加密');
    const secret = assertPassphrase(passphrase);
    const catalog = this.requireCatalog();
    const entries = await this.loadAllEntries();
    const salt = randomBytes(SALT_BYTES);
    const keys = await deriveKeys(secret, salt);
    const verifier = await createVerifier(keys);
    const [catalogRecord, entryRecords] = await Promise.all([
      this.encodeCatalog(catalog, keys),
      Promise.all(entries.map((entry) => this.encodeEntry(entry, keys))),
    ]);
    const meta: CryptoMetaRecord = { key: 'crypto', salt, verifier };
    await this.database.run([ENTRY_STORE, KV_STORE], 'readwrite', async (tx) => {
      await Promise.all([
        ...entryRecords.map((record) => tx.put(ENTRY_STORE, record)),
        tx.put(KV_STORE, catalogRecord),
        tx.put(KV_STORE, meta),
      ]);
    });
    this.enabled = true;
    this.keys = keys;
    return this.currentInitResult();
  }

  async disableEncryption(passphrase: string): Promise<InitResult> {
    await this.ensureReady();
    if (!this.enabled) throw new LedgerError('CONFLICT', '未启用加密');
    const meta = await this.readCryptoMeta();
    if (!meta) throw new LedgerError('STORAGE_FAILED', '加密信息缺失');
    const keys = await deriveKeys(assertPassphrase(passphrase), meta.salt);
    if (!(await verifyVerifier(keys, meta.verifier))) {
      throw new LedgerError('INVALID_PASSPHRASE', '口令错误');
    }
    const catalog = this.requireCatalog();
    const entries = await this.loadAllEntries();
    const [catalogRecord, entryRecords] = await Promise.all([
      this.encodeCatalog(catalog, null),
      Promise.all(entries.map((entry) => this.encodeEntry(entry, null))),
    ]);
    await this.database.run([ENTRY_STORE, KV_STORE], 'readwrite', async (tx) => {
      await Promise.all([
        ...entryRecords.map((record) => tx.put(ENTRY_STORE, record)),
        tx.put(KV_STORE, catalogRecord),
        tx.delete(KV_STORE, 'crypto'),
      ]);
    });
    this.enabled = false;
    this.keys = null;
    return this.currentInitResult();
  }

  async listMonth(query: MonthQuery): Promise<MonthResult> {
    await this.ensureReady();
    if (!isRecord(query)) throw new LedgerError('VALIDATION', '查询参数无效');
    assertMonth(query.month);
    const filter: EntryFilter = query.type ?? 'all';
    if (filter !== 'all' && filter !== 'expense' && filter !== 'income') {
      throw new LedgerError('VALIDATION', '收支类型无效');
    }
    const catalog = this.requireCatalog();
    const categoryNames = new Map(catalog.categories.map((category) => [category.id, category.name]));
    const accountNames = new Map(catalog.accounts.map((account) => [account.id, account.name]));
    const needle = typeof query.search === 'string' ? query.search.trim().toLowerCase() : '';
    const entries = (await this.loadMonthEntries(query.month))
      .filter((entry) => {
        if (filter !== 'all' && entry.type !== filter) return false;
        if (!needle) return true;
        return (
          entry.note.toLowerCase().includes(needle) ||
          (categoryNames.get(entry.categoryId) ?? '').toLowerCase().includes(needle) ||
          (accountNames.get(entry.accountId) ?? '').toLowerCase().includes(needle)
        );
      })
      .sort(compareEntriesDesc);
    return { month: query.month, entries, summary: summarize(entries, query.month) };
  }

  async getStats(month: string): Promise<MonthStats> {
    await this.ensureReady();
    assertMonth(month);
    const entries = await this.loadMonthEntries(month);
    const catalog = this.requireCatalog();
    const totalDays = daysInMonth(month);
    const daily: DailyTotal[] = [];
    const byDate = new Map<string, DailyTotal>();
    for (let day = 1; day <= totalDays; day += 1) {
      const date = `${month}-${String(day).padStart(2, '0')}`;
      const item: DailyTotal = { date, expenseCents: 0, incomeCents: 0, count: 0 };
      daily.push(item);
      byDate.set(date, item);
    }

    let expenseCents = 0;
    let incomeCents = 0;
    for (const entry of entries) {
      if (entry.type === 'expense') expenseCents += entry.amountCents;
      else incomeCents += entry.amountCents;
      const bucket = byDate.get(localDateKey(entry.occurredAt));
      if (!bucket) continue;
      if (entry.type === 'expense') bucket.expenseCents += entry.amountCents;
      else bucket.incomeCents += entry.amountCents;
      bucket.count += 1;
    }

    const activeDays = daily.filter((item) => item.count > 0).length;
    let peakDay: DailyTotal | null = null;
    for (const item of daily) {
      if (item.expenseCents > 0 && (peakDay === null || item.expenseCents > peakDay.expenseCents)) {
        peakDay = item;
      }
    }

    const expenseEntries = entries.filter((entry) => entry.type === 'expense');
    const incomeEntries = entries.filter((entry) => entry.type === 'income');
    return {
      month,
      expenseCents,
      incomeCents,
      netCents: incomeCents - expenseCents,
      entryCount: entries.length,
      activeDays,
      daysInMonth: totalDays,
      averageDailyExpenseCents: Math.round(expenseCents / totalDays),
      peakDay,
      daily,
      expenseCategories: buildCategoryTotals(expenseEntries, catalog, expenseCents),
      incomeCategories: buildCategoryTotals(incomeEntries, catalog, incomeCents),
    };
  }

  async saveEntry(input: SaveEntryInput): Promise<Entry> {
    await this.ensureReady();
    if (!isRecord(input)) throw new LedgerError('VALIDATION', '记账数据无效');
    const draft = validateEntryDraft(input.draft);
    const catalog = this.requireCatalog();
    const category = catalog.categories.find((item) => item.id === draft.categoryId);
    if (!category) throw new LedgerError('VALIDATION', '分类不存在');
    if (category.type !== draft.type) throw new LedgerError('VALIDATION', '分类与收支类型不匹配');
    const account = catalog.accounts.find((item) => item.id === draft.accountId);
    if (!account) throw new LedgerError('VALIDATION', '账户不存在');

    let existing: Entry | undefined;
    if (input.id !== undefined) {
      const record = await this.database.get<EntryRecord>(ENTRY_STORE, input.id);
      if (!record) throw new LedgerError('NOT_FOUND', '记账不存在');
      existing = await this.decodeEntry(record);
    }
    if (category.archived && existing?.categoryId !== category.id) {
      throw new LedgerError('VALIDATION', '分类已归档');
    }
    if (account.archived && existing?.accountId !== account.id) {
      throw new LedgerError('VALIDATION', '账户已归档');
    }

    const timestamp = this.now().toISOString();
    const entry: Entry = {
      id: existing?.id ?? this.generateId(),
      type: draft.type,
      amountCents: draft.amountCents,
      categoryId: draft.categoryId,
      accountId: draft.accountId,
      note: draft.note,
      occurredAt: draft.occurredAt,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
    };
    const record = await this.encodeEntry(entry, this.enabled ? this.requireKeys() : null);
    await this.database.run([ENTRY_STORE], 'readwrite', (tx) => tx.put(ENTRY_STORE, record));
    return entry;
  }

  async deleteEntry(id: string): Promise<void> {
    await this.ensureReady();
    if (typeof id !== 'string' || !id) throw new LedgerError('VALIDATION', '记账 ID 无效');
    const record = await this.database.get<EntryRecord>(ENTRY_STORE, id);
    if (!record) throw new LedgerError('NOT_FOUND', '记账不存在');
    await this.database.run([ENTRY_STORE], 'readwrite', (tx) => tx.delete(ENTRY_STORE, id));
  }

  async addCategory(input: CategoryInput): Promise<Catalog> {
    await this.ensureReady();
    const validated = validateCategoryInput(input);
    const catalog = this.requireCatalog();
    const next = cloneCatalog(catalog);
    next.categories.push({
      id: `cat_${this.generateId()}`,
      name: validated.name,
      type: validated.type,
      icon: validated.icon,
      color: validated.color,
      archived: false,
      preset: false,
      sort: nextSort(catalog.categories),
    });
    await this.saveCatalog(next);
    return cloneCatalog(next);
  }

  async updateCategory(id: string, patch: CategoryPatch): Promise<Catalog> {
    await this.ensureReady();
    if (!isRecord(patch)) throw new LedgerError('VALIDATION', '参数无效');
    const catalog = this.requireCatalog();
    if (!catalog.categories.some((category) => category.id === id)) {
      throw new LedgerError('NOT_FOUND', '分类不存在');
    }
    const next = cloneCatalog(catalog);
    const target = next.categories.find((category) => category.id === id);
    if (!target) throw new LedgerError('NOT_FOUND', '分类不存在');
    if (patch.name !== undefined) target.name = normalizeName(patch.name);
    if (patch.icon !== undefined) target.icon = requireIcon(patch.icon);
    if (patch.color !== undefined) target.color = normalizeColor(patch.color);
    if (patch.archived !== undefined) {
      if (typeof patch.archived !== 'boolean') throw new LedgerError('VALIDATION', '归档状态无效');
      target.archived = patch.archived;
    }
    await this.saveCatalog(next);
    return cloneCatalog(next);
  }

  async addAccount(input: AccountInput): Promise<Catalog> {
    await this.ensureReady();
    const validated = validateAccountInput(input);
    const catalog = this.requireCatalog();
    const next = cloneCatalog(catalog);
    next.accounts.push({
      id: `acc_${this.generateId()}`,
      name: validated.name,
      icon: validated.icon,
      color: validated.color,
      archived: false,
      preset: false,
      sort: nextSort(catalog.accounts),
    });
    await this.saveCatalog(next);
    return cloneCatalog(next);
  }

  async updateAccount(id: string, patch: AccountPatch): Promise<Catalog> {
    await this.ensureReady();
    if (!isRecord(patch)) throw new LedgerError('VALIDATION', '参数无效');
    const catalog = this.requireCatalog();
    if (!catalog.accounts.some((account) => account.id === id)) {
      throw new LedgerError('NOT_FOUND', '账户不存在');
    }
    const next = cloneCatalog(catalog);
    const target = next.accounts.find((account) => account.id === id);
    if (!target) throw new LedgerError('NOT_FOUND', '账户不存在');
    if (patch.name !== undefined) target.name = normalizeName(patch.name);
    if (patch.icon !== undefined) target.icon = requireIcon(patch.icon);
    if (patch.color !== undefined) target.color = normalizeColor(patch.color);
    if (patch.archived !== undefined) {
      if (typeof patch.archived !== 'boolean') throw new LedgerError('VALIDATION', '归档状态无效');
      target.archived = patch.archived;
    }
    await this.saveCatalog(next);
    return cloneCatalog(next);
  }

  async exportBackup(): Promise<BackupPayload> {
    await this.ensureReady();
    const entries = (await this.loadAllEntries()).sort(
      (a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt) || Date.parse(a.createdAt) - Date.parse(b.createdAt),
    );
    return {
      app: 'ledgerlite',
      schema: 1,
      version: APP_VERSION,
      exportedAt: this.now().toISOString(),
      entries,
      catalog: cloneCatalog(this.requireCatalog()),
    };
  }

  async importBackup(backup: unknown): Promise<ImportResult> {
    await this.ensureReady();
    const payload = parseBackup(backup);
    const keys = this.enabled ? this.requireKeys() : null;
    const [catalogRecord, entryRecords] = await Promise.all([
      this.encodeCatalog(payload.catalog, keys),
      Promise.all(payload.entries.map((entry) => this.encodeEntry(entry, keys))),
    ]);
    await this.database.run([ENTRY_STORE, KV_STORE], 'readwrite', async (tx) => {
      await Promise.all([tx.clear(ENTRY_STORE), tx.delete(KV_STORE, 'catalog')]);
      await Promise.all([
        ...entryRecords.map((record) => tx.put(ENTRY_STORE, record)),
        tx.put(KV_STORE, catalogRecord),
      ]);
    });
    this.catalog = payload.catalog;
    return {
      entryCount: payload.entries.length,
      categoryCount: payload.catalog.categories.length,
      accountCount: payload.catalog.accounts.length,
      catalog: cloneCatalog(payload.catalog),
    };
  }

  async resetAll(): Promise<InitResult> {
    await this.ensureInitialized();
    const catalog = createDefaultCatalog();
    const catalogRecord = await this.encodeCatalog(catalog, null);
    await this.database.run([ENTRY_STORE, KV_STORE], 'readwrite', async (tx) => {
      await Promise.all([tx.clear(ENTRY_STORE), tx.clear(KV_STORE)]);
      await tx.put(KV_STORE, catalogRecord);
    });
    this.enabled = false;
    this.keys = null;
    this.catalog = catalog;
    this.initialized = true;
    return this.currentInitResult();
  }

  async close(): Promise<void> {
    await this.database.close();
    this.initialized = false;
    this.enabled = false;
    this.keys = null;
    this.catalog = null;
  }

  private currentInitResult(): InitResult {
    const status: InitResult['status'] = this.enabled && !this.keys ? 'locked' : 'ready';
    return {
      status,
      crypto: { enabled: this.enabled, unlocked: this.enabled && this.keys !== null },
      catalog: status === 'ready' ? cloneCatalog(this.requireCatalog()) : null,
      version: APP_VERSION,
    };
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) await this.initialize();
  }

  private async ensureReady(): Promise<void> {
    await this.ensureInitialized();
    if (this.enabled && !this.keys) throw new LedgerError('LOCKED', '请先解锁');
  }

  private requireKeys(): CryptoKeys {
    if (!this.keys) throw new LedgerError('LOCKED', '请先解锁');
    return this.keys;
  }

  private requireCatalog(): Catalog {
    if (!this.catalog) throw new LedgerError('INTERNAL', '目录尚未加载');
    return this.catalog;
  }

  private async readCryptoMeta(): Promise<CryptoMetaRecord | undefined> {
    const record = await this.database.get<CryptoMetaRecord>(KV_STORE, 'crypto');
    if (!record || record.key !== 'crypto') return undefined;
    return record;
  }

  private async loadCatalog(): Promise<Catalog> {
    const record = await this.database.get<CatalogRecord>(KV_STORE, 'catalog');
    if (record && record.key === 'catalog') {
      const catalog = await this.decodeValue(record.payload, CATALOG_AAD);
      this.catalog = catalog;
      return catalog;
    }
    const catalog = createDefaultCatalog();
    const stored = await this.encodeCatalog(catalog, this.enabled ? this.requireKeys() : null);
    await this.database.run([KV_STORE], 'readwrite', (tx) => tx.put(KV_STORE, stored));
    this.catalog = catalog;
    return catalog;
  }

  private async saveCatalog(catalog: Catalog): Promise<void> {
    const record = await this.encodeCatalog(catalog, this.enabled ? this.requireKeys() : null);
    await this.database.run([KV_STORE], 'readwrite', (tx) => tx.put(KV_STORE, record));
    this.catalog = catalog;
  }

  private async encodeValue<T>(value: T, aad: string, keys: CryptoKeys | null): Promise<StoredValue<T>> {
    if (!keys) return { encrypted: false, value };
    return { encrypted: true, ...(await encryptJson(keys, value, aad)) };
  }

  private async decodeValue<T>(payload: StoredValue<T>, aad: string): Promise<T> {
    if (!payload.encrypted) return payload.value;
    return decryptJson<T>(this.requireKeys(), payload, aad);
  }

  private async encodeEntry(entry: Entry, keys: CryptoKeys | null): Promise<EntryRecord> {
    const month = monthKeyOfIso(entry.occurredAt);
    const monthTag = keys ? await hmacHex(keys, month) : month;
    return {
      id: entry.id,
      monthTag,
      payload: await this.encodeValue(entry, entryAad(entry.id, monthTag), keys),
    };
  }

  private async decodeEntry(record: EntryRecord): Promise<Entry> {
    return this.decodeValue(record.payload, entryAad(record.id, record.monthTag));
  }

  private async encodeCatalog(catalog: Catalog, keys: CryptoKeys | null): Promise<CatalogRecord> {
    return { key: 'catalog', payload: await this.encodeValue(catalog, CATALOG_AAD, keys) };
  }

  private async loadAllEntries(): Promise<Entry[]> {
    const records = await this.database.getAll<EntryRecord>(ENTRY_STORE);
    return Promise.all(records.map((record) => this.decodeEntry(record)));
  }

  private async loadMonthEntries(month: string): Promise<Entry[]> {
    const monthTag = this.enabled ? await hmacHex(this.requireKeys(), month) : month;
    const records = await this.database.getAllByIndex<EntryRecord>(ENTRY_STORE, MONTH_INDEX, monthTag);
    return Promise.all(records.map((record) => this.decodeEntry(record)));
  }
}
