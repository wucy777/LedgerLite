import {
  createDefaultCatalog,
  createDefaultLedger,
  LEDGER_COLORS,
} from '../shared/defaults';
import { daysInMonth, localDateKey, monthKeyOfIso } from '../shared/date';
import { compareEntryRecency } from '../shared/entry-order';
import { MAX_AMOUNT_CENTS } from '../shared/money';
import {
  APP_VERSION,
  ENCRYPTED_BACKUP_SCHEMA,
  LedgerError,
  type Account,
  type AccountInput,
  type AccountPatch,
  type BackupPayload,
  type Catalog,
  type EncryptedBackupPayload,
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
  type Ledger,
  type LedgerData,
  type LedgerOverview,
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
  ENCRYPTED_BACKUP_AAD,
  IV_BYTES,
  PBKDF2_ITERATIONS,
  SALT_BYTES,
  base64ToBytes,
  bytesToBase64,
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
import {
  ENTRY_STORE,
  KV_STORE,
  LEDGER_INDEX,
  LEDGER_MONTH_INDEX,
  LEDGER_STORE,
  LedgerDatabase,
  catalogKey,
} from './db';

const NOTE_MAX_LENGTH = 120;
const NAME_MAX_LENGTH = 12;
const LEDGER_NAME_MAX_LENGTH = 20;
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
  ledgerId: string;
  monthTag: string;
  payload: StoredValue<Entry>;
}

interface CatalogRecord {
  key: string;
  payload: StoredValue<Catalog>;
}

interface CryptoMetaRecord {
  key: 'crypto';
  salt: ArrayBuffer;
  verifier: Verifier;
}

interface DecodedEntry {
  ledgerId: string;
  entry: Entry;
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

function cloneLedger(ledger: Ledger): Ledger {
  return { ...ledger };
}

function sortLedgers(ledgers: readonly Ledger[]): Ledger[] {
  return [...ledgers].sort((a, b) => {
    if (a.sort !== b.sort) return a.sort - b.sort;
    const created = Date.parse(a.createdAt) - Date.parse(b.createdAt);
    if (created !== 0) return created;
    return a.id.localeCompare(b.id);
  });
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

function requireLedgerId(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new LedgerError('VALIDATION', '账本 ID 无效');
  }
  return value;
}

/** Ledger names are slightly longer than catalog names because the UI budgets 20 characters. */
function normalizeLedgerName(value: unknown): string {
  if (typeof value !== 'string') throw new LedgerError('VALIDATION', '账本名称格式无效');
  const trimmed = value.trim();
  if (!trimmed) throw new LedgerError('VALIDATION', '名称不能为空');
  if (Array.from(trimmed).length > LEDGER_NAME_MAX_LENGTH) {
    throw new LedgerError('VALIDATION', `名称不能超过 ${LEDGER_NAME_MAX_LENGTH} 个字符`);
  }
  return trimmed;
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

function requireImportLedgerName(value: unknown): string {
  if (typeof value !== 'string') invalidImport('账本名称格式无效');
  const trimmed = value.trim();
  if (!trimmed || Array.from(trimmed).length > LEDGER_NAME_MAX_LENGTH) invalidImport('账本名称格式无效');
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

function requireEncryptedBlock(value: unknown, label: string): { iv: string; data: string } {
  if (!isRecord(value) || typeof value.iv !== 'string' || typeof value.data !== 'string') {
    invalidImport(`${label}格式无效`);
  }
  if (base64ToBytes(value.iv).byteLength !== IV_BYTES) invalidImport(`${label} IV 无效`);
  if (base64ToBytes(value.data).byteLength === 0) invalidImport(`${label}数据无效`);
  return { iv: value.iv, data: value.data };
}

function parseEncryptedBackup(value: unknown): EncryptedBackupPayload {
  if (!isRecord(value)) invalidImport('备份数据格式无效');
  if (value.app !== 'ledgerlite' || value.kind !== 'encrypted-backup') {
    invalidImport('不是有效的加密备份文件');
  }
  if (value.schema !== ENCRYPTED_BACKUP_SCHEMA) invalidImport('不支持的加密备份版本');
  if (typeof value.version !== 'string' || value.version.trim() === '') invalidImport('备份版本信息缺失');
  const exportedAt = requireIso(value.exportedAt, '导出时间');
  if (!isRecord(value.kdf) || value.kdf.name !== 'PBKDF2-SHA256') invalidImport('备份密钥参数无效');
  if (value.kdf.iterations !== PBKDF2_ITERATIONS) invalidImport('不支持的备份密钥参数');
  if (typeof value.kdf.salt !== 'string') invalidImport('备份密钥参数无效');
  if (base64ToBytes(value.kdf.salt).byteLength !== SALT_BYTES) invalidImport('备份密钥盐值无效');
  return {
    app: 'ledgerlite',
    kind: 'encrypted-backup',
    schema: ENCRYPTED_BACKUP_SCHEMA,
    version: value.version,
    exportedAt,
    kdf: {
      name: 'PBKDF2-SHA256',
      iterations: PBKDF2_ITERATIONS,
      salt: value.kdf.salt,
    },
    verifier: requireEncryptedBlock(value.verifier, '口令验证数据'),
    cipher: requireEncryptedBlock(value.cipher, '备份密文'),
  };
}

function parseBackup(value: unknown): BackupPayload {
  if (!isRecord(value)) invalidImport('备份数据格式无效');
  if (value.app !== 'ledgerlite') invalidImport('不是有效的备份文件');
  const rawSchema = value.schema;
  if (rawSchema !== 1 && rawSchema !== 2) invalidImport('不支持的备份版本');
  if (typeof value.version !== 'string' || value.version.trim() === '') invalidImport('备份版本信息缺失');
  const exportedAt = requireIso(value.exportedAt, '导出时间');
  let ledgerName: string | undefined;
  if (value.ledgerName !== undefined) {
    ledgerName = requireImportLedgerName(value.ledgerName);
  }
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
    schema: rawSchema,
    version: value.version,
    exportedAt,
    ledgerName,
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
  private ledgers: Ledger[] = [];
  private catalogs = new Map<string, Catalog>();
  private activeLedgerId: string | null = null;

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
    this.resetCaches();
    if (meta) {
      this.enabled = true;
      this.keys = null;
    } else {
      this.enabled = false;
      this.keys = null;
      await this.loadReadyState();
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
      await this.loadReadyState();
    } catch (error) {
      this.keys = null;
      this.resetCaches();
      throw error;
    }
    return this.currentInitResult();
  }

  async lock(): Promise<InitResult> {
    if (!this.initialized) return this.initialize();
    if (!this.enabled) return this.currentInitResult();
    this.keys = null;
    this.resetCaches();
    return this.currentInitResult();
  }

  async enableEncryption(passphrase: string): Promise<InitResult> {
    await this.ensureReady();
    if (this.enabled) throw new LedgerError('CONFLICT', '已启用加密');
    const secret = assertPassphrase(passphrase);
    const ledgers = [...this.ledgers];
    const catalogs = await Promise.all(ledgers.map((ledger) => this.getCatalog(ledger.id)));
    const entries = await this.loadEntries();
    const salt = randomBytes(SALT_BYTES);
    const keys = await deriveKeys(secret, salt);
    const verifier = await createVerifier(keys);
    const [catalogRecords, entryRecords] = await Promise.all([
      Promise.all(ledgers.map((ledger, index) => this.encodeCatalog(ledger.id, catalogs[index] as Catalog, keys))),
      Promise.all(entries.map(({ ledgerId, entry }) => this.encodeEntry(ledgerId, entry, keys))),
    ]);
    const meta: CryptoMetaRecord = { key: 'crypto', salt, verifier };
    await this.database.run([ENTRY_STORE, KV_STORE], 'readwrite', async (tx) => {
      await Promise.all([
        ...entryRecords.map((record) => tx.put(ENTRY_STORE, record)),
        ...catalogRecords.map((record) => tx.put(KV_STORE, record)),
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
    const ledgers = [...this.ledgers];
    const catalogs = await Promise.all(ledgers.map((ledger) => this.getCatalog(ledger.id)));
    const entries = await this.loadEntries();
    const [catalogRecords, entryRecords] = await Promise.all([
      Promise.all(ledgers.map((ledger, index) => this.encodeCatalog(ledger.id, catalogs[index] as Catalog, null))),
      Promise.all(entries.map(({ ledgerId, entry }) => this.encodeEntry(ledgerId, entry, null))),
    ]);
    await this.database.run([ENTRY_STORE, KV_STORE], 'readwrite', async (tx) => {
      await Promise.all([
        ...entryRecords.map((record) => tx.put(ENTRY_STORE, record)),
        ...catalogRecords.map((record) => tx.put(KV_STORE, record)),
        tx.delete(KV_STORE, 'crypto'),
      ]);
    });
    this.enabled = false;
    this.keys = null;
    return this.currentInitResult();
  }

  async openLedger(ledgerId: string): Promise<LedgerData> {
    await this.ensureReady();
    const ledger = this.requireLedger(ledgerId);
    const catalog = await this.getCatalog(ledger.id);
    this.activeLedgerId = ledger.id;
    return { ledger: cloneLedger(ledger), catalog: cloneCatalog(catalog) };
  }

  async createLedger(name: string): Promise<InitResult & { ledger: Ledger; catalog: Catalog }> {
    await this.ensureReady();
    const cleanName = normalizeLedgerName(name);
    await this.ensureLedgerList();
    const timestamp = this.now().toISOString();
    const ledger: Ledger = {
      id: `ledger_${this.generateId()}`,
      name: cleanName,
      color: LEDGER_COLORS[this.ledgers.length % LEDGER_COLORS.length] ?? LEDGER_COLORS[0],
      createdAt: timestamp,
      updatedAt: timestamp,
      sort: nextSort(this.ledgers),
    };
    const catalog = createDefaultCatalog();
    const record = await this.encodeCatalog(ledger.id, catalog, this.enabled ? this.requireKeys() : null);
    await this.database.run([LEDGER_STORE, KV_STORE], 'readwrite', async (tx) => {
      await tx.put(LEDGER_STORE, ledger);
      await tx.put(KV_STORE, record);
    });
    this.ledgers = sortLedgers([...this.ledgers, ledger]);
    this.catalogs.set(ledger.id, catalog);
    this.activeLedgerId = ledger.id;
    return { ...this.currentInitResult(), ledger: cloneLedger(ledger), catalog: cloneCatalog(catalog) };
  }

  async updateLedger(id: string, name: string): Promise<Ledger> {
    await this.ensureReady();
    const ledger = this.requireLedger(id);
    const cleanName = normalizeLedgerName(name);
    const updated: Ledger = { ...ledger, name: cleanName, updatedAt: this.now().toISOString() };
    await this.database.run([LEDGER_STORE], 'readwrite', (tx) => tx.put(LEDGER_STORE, updated));
    this.ledgers = this.ledgers.map((item) => (item.id === updated.id ? updated : item));
    return cloneLedger(updated);
  }

  async deleteLedger(id: string): Promise<{ ledgers: Ledger[] }> {
    await this.ensureReady();
    const ledger = this.requireLedger(id);
    if (this.ledgers.length <= 1) throw new LedgerError('CONFLICT', '至少保留一个账本');
    await this.database.run([ENTRY_STORE, KV_STORE, LEDGER_STORE], 'readwrite', async (tx) => {
      const keys = await tx.getAllKeysByIndex(ENTRY_STORE, LEDGER_INDEX, ledger.id);
      await Promise.all(keys.map((key) => tx.delete(ENTRY_STORE, key)));
      await tx.delete(KV_STORE, catalogKey(ledger.id));
      await tx.delete(LEDGER_STORE, ledger.id);
    });
    this.ledgers = this.ledgers.filter((item) => item.id !== ledger.id);
    this.catalogs.delete(ledger.id);
    if (this.activeLedgerId === ledger.id) {
      const next = this.ledgers[0] ?? null;
      this.activeLedgerId = next?.id ?? null;
      if (next) await this.getCatalog(next.id);
    }
    return { ledgers: this.ledgers.map(cloneLedger) };
  }

  async listMonth(query: MonthQuery): Promise<MonthResult> {
    await this.ensureReady();
    if (!isRecord(query)) throw new LedgerError('VALIDATION', '查询参数无效');
    assertMonth(query.month);
    const ledger = this.requireLedger(query.ledgerId);
    const filter: EntryFilter = query.type ?? 'all';
    if (filter !== 'all' && filter !== 'expense' && filter !== 'income') {
      throw new LedgerError('VALIDATION', '收支类型无效');
    }
    const catalog = await this.getCatalog(ledger.id);
    const categoryNames = new Map(catalog.categories.map((category) => [category.id, category.name]));
    const accountNames = new Map(catalog.accounts.map((account) => [account.id, account.name]));
    const needle = typeof query.search === 'string' ? query.search.trim().toLowerCase() : '';
    const entries = (await this.loadMonthEntries(ledger.id, query.month))
      .filter((entry) => {
        if (filter !== 'all' && entry.type !== filter) return false;
        if (!needle) return true;
        return (
          entry.note.toLowerCase().includes(needle) ||
          (categoryNames.get(entry.categoryId) ?? '').toLowerCase().includes(needle) ||
          (accountNames.get(entry.accountId) ?? '').toLowerCase().includes(needle)
        );
      })
      .sort(compareEntryRecency);
    return {
      ledgerId: ledger.id,
      month: query.month,
      entries,
      summary: summarize(entries, query.month),
    };
  }

  async getLedgerOverview(ledgerId: string): Promise<LedgerOverview> {
    await this.ensureReady();
    const ledger = this.requireLedger(ledgerId);
    const entries = (await this.loadEntries(ledger.id))
      .map(({ entry }) => entry)
      .sort(compareEntryRecency);
    let expenseCents = 0;
    let incomeCents = 0;
    for (const entry of entries) {
      if (entry.type === 'expense') expenseCents += entry.amountCents;
      else incomeCents += entry.amountCents;
    }
    return {
      ledgerId: ledger.id,
      entries,
      expenseCents,
      incomeCents,
      totalCents: expenseCents + incomeCents,
      netCents: incomeCents - expenseCents,
      entryCount: entries.length,
    };
  }

  async getStats(ledgerId: string, month: string): Promise<MonthStats> {
    await this.ensureReady();
    assertMonth(month);
    const ledger = this.requireLedger(ledgerId);
    const entries = await this.loadMonthEntries(ledger.id, month);
    const catalog = await this.getCatalog(ledger.id);
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
      ledgerId: ledger.id,
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
    const ledger = this.requireLedger(input.ledgerId);
    const draft = validateEntryDraft(input.draft);
    const catalog = await this.getCatalog(ledger.id);
    const category = catalog.categories.find((item) => item.id === draft.categoryId);
    if (!category) throw new LedgerError('VALIDATION', '分类不存在');
    if (category.type !== draft.type) throw new LedgerError('VALIDATION', '分类与收支类型不匹配');
    const account = catalog.accounts.find((item) => item.id === draft.accountId);
    if (!account) throw new LedgerError('VALIDATION', '账户不存在');

    let existing: Entry | undefined;
    if (input.id !== undefined) {
      if (typeof input.id !== 'string' || !input.id) throw new LedgerError('VALIDATION', '记账 ID 无效');
      const record = await this.database.get<EntryRecord>(ENTRY_STORE, input.id);
      if (!record || record.ledgerId !== ledger.id) throw new LedgerError('NOT_FOUND', '记账不存在');
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
    const record = await this.encodeEntry(ledger.id, entry, this.enabled ? this.requireKeys() : null);
    await this.database.run([ENTRY_STORE], 'readwrite', (tx) => tx.put(ENTRY_STORE, record));
    return entry;
  }

  async deleteEntry(ledgerId: string, id: string): Promise<void> {
    await this.ensureReady();
    const ledger = this.requireLedger(ledgerId);
    if (typeof id !== 'string' || !id) throw new LedgerError('VALIDATION', '记账 ID 无效');
    const record = await this.database.get<EntryRecord>(ENTRY_STORE, id);
    if (!record || record.ledgerId !== ledger.id) throw new LedgerError('NOT_FOUND', '记账不存在');
    await this.database.run([ENTRY_STORE], 'readwrite', (tx) => tx.delete(ENTRY_STORE, id));
  }

  async addCategory(ledgerId: string, input: CategoryInput): Promise<Catalog> {
    await this.ensureReady();
    const ledger = this.requireLedger(ledgerId);
    const validated = validateCategoryInput(input);
    const catalog = await this.getCatalog(ledger.id);
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
    await this.saveCatalog(ledger.id, next);
    return cloneCatalog(next);
  }

  async updateCategory(ledgerId: string, id: string, patch: CategoryPatch): Promise<Catalog> {
    await this.ensureReady();
    const ledger = this.requireLedger(ledgerId);
    if (!isRecord(patch)) throw new LedgerError('VALIDATION', '参数无效');
    const catalog = await this.getCatalog(ledger.id);
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
    await this.saveCatalog(ledger.id, next);
    return cloneCatalog(next);
  }

  async addAccount(ledgerId: string, input: AccountInput): Promise<Catalog> {
    await this.ensureReady();
    const ledger = this.requireLedger(ledgerId);
    const validated = validateAccountInput(input);
    const catalog = await this.getCatalog(ledger.id);
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
    await this.saveCatalog(ledger.id, next);
    return cloneCatalog(next);
  }

  async updateAccount(ledgerId: string, id: string, patch: AccountPatch): Promise<Catalog> {
    await this.ensureReady();
    const ledger = this.requireLedger(ledgerId);
    if (!isRecord(patch)) throw new LedgerError('VALIDATION', '参数无效');
    const catalog = await this.getCatalog(ledger.id);
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
    await this.saveCatalog(ledger.id, next);
    return cloneCatalog(next);
  }

  async exportBackup(ledgerId: string): Promise<BackupPayload> {
    await this.ensureReady();
    const ledger = this.requireLedger(ledgerId);
    const catalog = await this.getCatalog(ledger.id);
    const entries = (await this.loadEntries(ledger.id))
      .map(({ entry }) => entry)
      .sort(
        (a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt) || Date.parse(a.createdAt) - Date.parse(b.createdAt),
      );
    return {
      app: 'ledgerlite',
      schema: 2,
      version: APP_VERSION,
      exportedAt: this.now().toISOString(),
      ledgerName: ledger.name,
      entries,
      catalog: cloneCatalog(catalog),
    };
  }

  async exportEncryptedBackup(ledgerId: string): Promise<EncryptedBackupPayload> {
    await this.ensureReady();
    if (!this.enabled || !this.keys) throw new LedgerError('CONFLICT', '请先启用本地加密');
    const meta = await this.readCryptoMeta();
    if (!meta) throw new LedgerError('STORAGE_FAILED', '加密信息缺失');
    const backup = await this.exportBackup(ledgerId);
    const cipher = await encryptJson(this.keys, backup, ENCRYPTED_BACKUP_AAD);
    return {
      app: 'ledgerlite',
      kind: 'encrypted-backup',
      schema: ENCRYPTED_BACKUP_SCHEMA,
      version: APP_VERSION,
      exportedAt: backup.exportedAt,
      kdf: {
        name: 'PBKDF2-SHA256',
        iterations: PBKDF2_ITERATIONS,
        salt: bytesToBase64(meta.salt),
      },
      verifier: {
        iv: bytesToBase64(meta.verifier.iv),
        data: bytesToBase64(meta.verifier.data),
      },
      cipher: {
        iv: bytesToBase64(cipher.iv),
        data: bytesToBase64(cipher.data),
      },
    };
  }

  async importEncryptedBackup(
    ledgerId: string,
    passphrase: string,
    backup: unknown,
  ): Promise<ImportResult> {
    await this.ensureReady();
    this.requireLedger(ledgerId);
    const envelope = parseEncryptedBackup(backup);
    const salt = base64ToBytes(envelope.kdf.salt);
    const keys = await deriveKeys(assertPassphrase(passphrase), salt);
    const verifier: Verifier = {
      iv: base64ToBytes(envelope.verifier.iv),
      data: base64ToBytes(envelope.verifier.data),
    };
    if (!(await verifyVerifier(keys, verifier))) {
      throw new LedgerError('INVALID_PASSPHRASE', '口令错误或备份已损坏');
    }
    const payload = await decryptJson<BackupPayload>(
      keys,
      {
        iv: base64ToBytes(envelope.cipher.iv),
        data: base64ToBytes(envelope.cipher.data),
      },
      ENCRYPTED_BACKUP_AAD,
    );
    return this.importBackup(ledgerId, payload);
  }

  async importBackup(ledgerId: string, backup: unknown): Promise<ImportResult> {
    await this.ensureReady();
    const ledger = this.requireLedger(ledgerId);
    const payload = parseBackup(backup);
    const keys = this.enabled ? this.requireKeys() : null;
    const [catalogRecord, entryRecords] = await Promise.all([
      this.encodeCatalog(ledger.id, payload.catalog, keys),
      Promise.all(payload.entries.map((entry) => this.encodeEntry(ledger.id, entry, keys))),
    ]);
    await this.database.run([ENTRY_STORE, KV_STORE], 'readwrite', async (tx) => {
      const keys = await tx.getAllKeysByIndex(ENTRY_STORE, LEDGER_INDEX, ledger.id);
      await Promise.all(keys.map((key) => tx.delete(ENTRY_STORE, key)));
      await Promise.all([
        ...entryRecords.map((record) => tx.put(ENTRY_STORE, record)),
        tx.put(KV_STORE, catalogRecord),
      ]);
    });
    this.catalogs.set(ledger.id, cloneCatalog(payload.catalog));
    return {
      entryCount: payload.entries.length,
      categoryCount: payload.catalog.categories.length,
      accountCount: payload.catalog.accounts.length,
      catalog: cloneCatalog(payload.catalog),
    };
  }

  async resetAll(): Promise<InitResult> {
    await this.ensureInitialized();
    const ledger = createDefaultLedger(this.now(), 0);
    const catalog = createDefaultCatalog();
    const catalogRecord = await this.encodeCatalog(ledger.id, catalog, null);
    await this.database.run([ENTRY_STORE, KV_STORE, LEDGER_STORE], 'readwrite', async (tx) => {
      await Promise.all([tx.clear(ENTRY_STORE), tx.clear(KV_STORE), tx.clear(LEDGER_STORE)]);
      await tx.put(LEDGER_STORE, ledger);
      await tx.put(KV_STORE, catalogRecord);
    });
    this.enabled = false;
    this.keys = null;
    this.ledgers = [ledger];
    this.catalogs.clear();
    this.catalogs.set(ledger.id, catalog);
    this.activeLedgerId = ledger.id;
    this.initialized = true;
    return this.currentInitResult();
  }

  async close(): Promise<void> {
    await this.database.close();
    this.initialized = false;
    this.enabled = false;
    this.keys = null;
    this.resetCaches();
  }

  private currentInitResult(): InitResult {
    if (this.enabled && !this.keys) {
      return {
        status: 'locked',
        crypto: { enabled: true, unlocked: false },
        ledgers: [],
        ledger: null,
        catalog: null,
        version: APP_VERSION,
      };
    }
    const ledger = this.activeLedger();
    const catalog = ledger ? (this.catalogs.get(ledger.id) ?? null) : null;
    return {
      status: 'ready',
      crypto: { enabled: this.enabled, unlocked: this.keys !== null },
      ledgers: this.ledgers.map(cloneLedger),
      ledger: ledger ? cloneLedger(ledger) : null,
      catalog: catalog ? cloneCatalog(catalog) : null,
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

  private requireLedger(ledgerId: unknown): Ledger {
    const id = requireLedgerId(ledgerId);
    const ledger = this.ledgers.find((item) => item.id === id);
    if (!ledger) throw new LedgerError('NOT_FOUND', '账本不存在');
    return ledger;
  }

  private activeLedger(): Ledger | null {
    if (this.activeLedgerId) {
      const active = this.ledgers.find((ledger) => ledger.id === this.activeLedgerId);
      if (active) return active;
    }
    return this.ledgers[0] ?? null;
  }

  private resetCaches(): void {
    this.ledgers = [];
    this.catalogs.clear();
    this.activeLedgerId = null;
  }

  private async loadReadyState(): Promise<void> {
    await this.ensureLedgerList();
    const first = this.ledgers[0] ?? null;
    this.activeLedgerId = first?.id ?? null;
    if (first) await this.getCatalog(first.id);
  }

  private async ensureLedgerList(): Promise<Ledger[]> {
    if (this.ledgers.length > 0) return this.ledgers;
    const stored = sortLedgers(await this.database.getAll<Ledger>(LEDGER_STORE));
    if (stored.length > 0) {
      this.ledgers = stored;
      return stored;
    }
    const created = createDefaultLedger(this.now(), 0);
    await this.database.run([LEDGER_STORE], 'readwrite', (tx) => tx.put(LEDGER_STORE, created));
    this.ledgers = [created];
    return this.ledgers;
  }

  private async readCryptoMeta(): Promise<CryptoMetaRecord | undefined> {
    const record = await this.database.get<CryptoMetaRecord>(KV_STORE, 'crypto');
    if (!record || record.key !== 'crypto') return undefined;
    return record;
  }

  private async getCatalog(ledgerId: string): Promise<Catalog> {
    const cached = this.catalogs.get(ledgerId);
    if (cached) return cached;
    const key = catalogKey(ledgerId);
    const record = await this.database.get<CatalogRecord>(KV_STORE, key);
    if (record && record.key === key) {
      const catalog = await this.decodeValue(record.payload, CATALOG_AAD);
      this.catalogs.set(ledgerId, catalog);
      return catalog;
    }
    const catalog = createDefaultCatalog();
    await this.saveCatalog(ledgerId, catalog);
    return catalog;
  }

  private async saveCatalog(ledgerId: string, catalog: Catalog): Promise<void> {
    const record = await this.encodeCatalog(ledgerId, catalog, this.enabled ? this.requireKeys() : null);
    await this.database.run([KV_STORE], 'readwrite', (tx) => tx.put(KV_STORE, record));
    this.catalogs.set(ledgerId, catalog);
  }

  private async encodeValue<T>(value: T, aad: string, keys: CryptoKeys | null): Promise<StoredValue<T>> {
    if (!keys) return { encrypted: false, value };
    return { encrypted: true, ...(await encryptJson(keys, value, aad)) };
  }

  private async decodeValue<T>(payload: StoredValue<T>, aad: string): Promise<T> {
    if (!payload.encrypted) return payload.value;
    return decryptJson<T>(this.requireKeys(), payload, aad);
  }

  private async encodeEntry(ledgerId: string, entry: Entry, keys: CryptoKeys | null): Promise<EntryRecord> {
    const month = monthKeyOfIso(entry.occurredAt);
    const monthTag = keys ? await hmacHex(keys, month) : month;
    return {
      id: entry.id,
      ledgerId,
      monthTag,
      payload: await this.encodeValue(entry, entryAad(entry.id, monthTag), keys),
    };
  }

  private async decodeEntry(record: EntryRecord): Promise<Entry> {
    return this.decodeValue(record.payload, entryAad(record.id, record.monthTag));
  }

  private async encodeCatalog(ledgerId: string, catalog: Catalog, keys: CryptoKeys | null): Promise<CatalogRecord> {
    return { key: catalogKey(ledgerId), payload: await this.encodeValue(catalog, CATALOG_AAD, keys) };
  }

  private async loadEntries(ledgerId?: string): Promise<DecodedEntry[]> {
    const records = ledgerId
      ? await this.database.getAllByIndex<EntryRecord>(ENTRY_STORE, LEDGER_INDEX, ledgerId)
      : await this.database.getAll<EntryRecord>(ENTRY_STORE);
    return Promise.all(
      records.map(async (record) => ({ ledgerId: record.ledgerId, entry: await this.decodeEntry(record) })),
    );
  }

  private async loadMonthEntries(ledgerId: string, month: string): Promise<Entry[]> {
    const monthTag = this.enabled ? await hmacHex(this.requireKeys(), month) : month;
    const records = await this.database.getAllByIndex<EntryRecord>(
      ENTRY_STORE,
      LEDGER_MONTH_INDEX,
      IDBKeyRange.only([ledgerId, monthTag]),
    );
    return Promise.all(records.map((record) => this.decodeEntry(record)));
  }
}
