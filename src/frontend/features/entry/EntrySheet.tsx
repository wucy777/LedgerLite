import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CSSProperties } from 'react';
import type { Account, Catalog, Category, Entry, EntryDraft, EntryType } from '@shared/types';
import { DEFAULT_ACCOUNT_ID, DEFAULT_CATEGORY_ID } from '@shared/defaults';
import {
  dateAtCurrentTime,
  dateKeyToLocalDate,
  formatFullDate,
  formatTime,
  localDateKey,
} from '@shared/date';
import { applyAmountKey, formatMoney, parseAmountToCents } from '@shared/money';
import { getLedgerClient } from '../../api/client';
import { CategoryGlyph } from '../../components/CategoryGlyph';
import { Icon } from '../../components/Icon';
import { useToast } from '../../components/ToastProvider';
import { activeAccounts, activeCategories, findAccount, findCategory } from '../../utils/catalog';
import { useBackHandler } from '../settings/overlay';
import type { EntrySheetProps } from '../../types/page-props';
import { DateTimePicker } from './DateTimePicker';
import '../../styles/entry-sheet.css';

const STORAGE_PREFIX = 'ledgerlite.ui.';
const EXIT_DURATION = 230;

const TYPES: ReadonlyArray<{ id: EntryType; label: string }> = [
  { id: 'expense', label: '支出' },
  { id: 'income', label: '收入' },
];

const KEYPAD_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'backspace'] as const;

function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(`${STORAGE_PREFIX}${key}`);
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string): void {
  try {
    window.localStorage.setItem(`${STORAGE_PREFIX}${key}`, value);
  } catch {
    /* Storage can be unavailable in private modes; remembering the choice is optional. */
  }
}

function categoriesFor(catalog: Catalog, type: EntryType, entry: Entry | null): Category[] {
  const list = activeCategories(catalog, type);
  if (entry && entry.type === type && !list.some((category) => category.id === entry.categoryId)) {
    return [findCategory(catalog, entry.categoryId), ...list];
  }
  return list;
}

function accountsFor(catalog: Catalog, entry: Entry | null): Account[] {
  const list = activeAccounts(catalog);
  if (entry && !list.some((account) => account.id === entry.accountId)) {
    return [findAccount(catalog, entry.accountId), ...list];
  }
  return list;
}

function initialCategoryId(catalog: Catalog, type: EntryType, entry: Entry | null): string {
  if (entry && entry.type === type) return entry.categoryId;
  const list = activeCategories(catalog, type);
  const stored = readStored(`category.${type}`);
  if (stored && list.some((category) => category.id === stored)) return stored;
  const fallback = DEFAULT_CATEGORY_ID[type];
  if (list.some((category) => category.id === fallback)) return fallback;
  return list[0]?.id ?? '';
}

function initialAccountId(catalog: Catalog, entry: Entry | null): string {
  if (entry) return entry.accountId;
  const list = activeAccounts(catalog);
  const stored = readStored('account');
  if (stored && list.some((account) => account.id === stored)) return stored;
  if (list.some((account) => account.id === DEFAULT_ACCOUNT_ID)) return DEFAULT_ACCOUNT_ID;
  return list[0]?.id ?? '';
}

/** Piecewise integer conversion for pre-filling the keypad; no floating point involved. */
function formatAmountInput(cents: number): string {
  const yuan = Math.floor(cents / 100);
  const fen = cents % 100;
  if (fen === 0) return String(yuan);
  if (fen % 10 === 0) return `${yuan}.${fen / 10}`;
  return `${yuan}.${String(fen).padStart(2, '0')}`;
}

function previousDateKey(dateKey: string): string {
  const date = dateKeyToLocalDate(dateKey);
  if (!date) return dateKey;
  date.setDate(date.getDate() - 1);
  return localDateKey(date);
}

function prefersReducedMotion(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

function describeError(reason: unknown, fallback: string): string {
  return reason instanceof Error && reason.message ? reason.message : fallback;
}

export function EntrySheet({ ledgerId, entry, catalog, onClose, onSaved, onDeleted }: EntrySheetProps) {
  const { showToast } = useToast();
  const client = useMemo(() => getLedgerClient(), []);
  const titleId = useId();
  const amountRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const exitTimer = useRef<number | null>(null);
  const closingRef = useRef(false);
  const busyRef = useRef(false);
  const confirmingDeleteRef = useRef(false);
  const dismissRef = useRef<(after?: () => void) => void>(() => undefined);
  const submitRef = useRef<() => void>(() => undefined);

  const [closing, setClosing] = useState(false);
  const [type, setType] = useState<EntryType>(entry?.type ?? 'expense');
  const [amountText, setAmountText] = useState(() => (entry ? formatAmountInput(entry.amountCents) : ''));
  const [categoryId, setCategoryId] = useState(() =>
    initialCategoryId(catalog, entry?.type ?? 'expense', entry),
  );
  const [accountId, setAccountId] = useState(() => initialAccountId(catalog, entry));
  const [note, setNote] = useState(entry?.note ?? '');
  const [occurredAt, setOccurredAt] = useState(() => entry?.occurredAt ?? new Date().toISOString());
  const [busy, setBusy] = useState<'save' | 'delete' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  const categories = categoriesFor(catalog, type, entry);
  const accounts = accountsFor(catalog, entry);
  const amountCents = parseAmountToCents(amountText);
  const activeDateKey = localDateKey(occurredAt);
  const todayKey = localDateKey(new Date());
  const yesterdayKey = previousDateKey(todayKey);

  busyRef.current = busy !== null;
  confirmingDeleteRef.current = confirmingDelete;

  const dismiss = useCallback(
    (after?: () => void) => {
      if (closingRef.current) return;
      closingRef.current = true;
      setClosing(true);
      const delay = prefersReducedMotion() ? 0 : EXIT_DURATION;
      exitTimer.current = window.setTimeout(() => {
        exitTimer.current = null;
        if (after) after();
        else onClose();
      }, delay);
    },
    [onClose],
  );
  dismissRef.current = dismiss;
  useBackHandler(() => {
    if (busyRef.current) return;
    if (confirmingDeleteRef.current) {
      setConfirmingDelete(false);
      return;
    }
    dismissRef.current();
  }, '关闭记账面板');

  useEffect(() => {
    const body = document.body;
    const alreadyOpen = body.classList.contains('is-sheet-open');
    body.classList.add('is-sheet-open');
    return () => {
      if (!alreadyOpen) body.classList.remove('is-sheet-open');
    };
  }, []);

  useEffect(() => {
    const active = document.activeElement;
    if (
      active instanceof HTMLElement &&
      active !== document.body &&
      !panelRef.current?.contains(active)
    ) {
      previousFocus.current = active;
    }
    amountRef.current?.focus({ preventScroll: true });
    return () => {
      const target = previousFocus.current;
      if (target && target.isConnected) target.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;

      if (event.key === 'Escape') {
        event.preventDefault();
        if (confirmingDeleteRef.current) {
          setConfirmingDelete(false);
          return;
        }
        if (!busyRef.current) dismissRef.current();
        return;
      }

      if (event.key === 'Tab') {
        const panel = panelRef.current;
        if (!panel) return;
        const focusables = Array.from(
          panel.querySelectorAll<HTMLElement>(
            'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
          ),
        );
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (!first || !last) return;
        const active = document.activeElement;
        if (event.shiftKey) {
          if (active === first || !(active instanceof Node) || !panel.contains(active)) {
            event.preventDefault();
            last.focus();
          }
        } else if (active === last || !(active instanceof Node) || !panel.contains(active)) {
          event.preventDefault();
          first.focus();
        }
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault();
        if (!confirmingDeleteRef.current) submitRef.current();
        return;
      }

      if (event.metaKey || event.ctrlKey || event.altKey) return;

      const target = event.target;
      const editable =
        target instanceof HTMLElement &&
        (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
      if (editable) return;

      if (confirmingDeleteRef.current) return;

      if (event.key === 'Backspace' || event.key === '.' || /^\d$/.test(event.key)) {
        event.preventDefault();
        setError(null);
        if (event.key === 'Backspace') {
          setAmountText((current) => applyAmountKey(current, 'backspace'));
        } else {
          setAmountText((current) => applyAmountKey(current, event.key));
        }
        return;
      }

      if (event.key === 'Enter') {
        if (target instanceof HTMLElement && target.closest('button, a, [role="button"]')) return;
        event.preventDefault();
        submitRef.current();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(
    () => () => {
      if (exitTimer.current !== null) {
        window.clearTimeout(exitTimer.current);
        exitTimer.current = null;
      }
    },
    [],
  );

  const changeType = (nextType: EntryType) => {
    if (nextType === type || busy !== null) return;
    setType(nextType);
    setError(null);
    const candidates = categoriesFor(catalog, nextType, entry);
    const stored = readStored(`category.${nextType}`);
    const preferred = entry && entry.type === nextType ? entry.categoryId : stored;
    const nextCategory =
      candidates.find((category) => category.id === preferred) ??
      candidates.find((category) => category.id === DEFAULT_CATEGORY_ID[nextType]) ??
      candidates[0];
    setCategoryId(nextCategory?.id ?? '');
  };

  const selectCategory = (id: string) => {
    setCategoryId(id);
    setError(null);
    writeStored(`category.${type}`, id);
  };

  const selectAccount = (id: string) => {
    setAccountId(id);
    setError(null);
    writeStored('account', id);
  };

  const applyQuickDate = (dateKey: string) => {
    const iso = dateAtCurrentTime(dateKey, new Date(occurredAt));
    if (!iso) return;
    setOccurredAt(iso);
    setError(null);
  };

  const fail = (message: string) => {
    setError(message);
    showToast(message, 'error');
  };

  const handleSave = async () => {
    if (busyRef.current || closingRef.current) return;

    const cents = parseAmountToCents(amountText);
    if (cents === null) {
      fail('请输入大于 0 的金额，最多两位小数');
      amountRef.current?.focus();
      return;
    }
    const category = catalog.categories.find((item) => item.id === categoryId);
    if (!category || category.type !== type) {
      fail('请选择一个分类');
      return;
    }
    const account = catalog.accounts.find((item) => item.id === accountId);
    if (!account) {
      fail('请选择一个账户');
      return;
    }
    const occurred = new Date(occurredAt);
    if (Number.isNaN(occurred.getTime())) {
      fail('日期时间格式无效');
      return;
    }

    const draft: EntryDraft = {
      type,
      amountCents: cents,
      categoryId,
      accountId,
      note: note.trim(),
      occurredAt: occurred.toISOString(),
    };

    setError(null);
    busyRef.current = true;
    setBusy('save');
    try {
      const saved = await client.call('saveEntry', { ledgerId, id: entry?.id, draft });
      writeStored(`category.${type}`, categoryId);
      writeStored('account', accountId);
      dismiss(() => onSaved(saved));
    } catch (reason) {
      const message = describeError(reason, '保存失败，请稍后重试');
      busyRef.current = false;
      setBusy(null);
      fail(message);
    }
  };

  const handleDelete = async () => {
    if (!entry || busyRef.current || closingRef.current) return;
    busyRef.current = true;
    setBusy('delete');
    setError(null);
    try {
      await client.call('deleteEntry', { ledgerId, id: entry.id });
      dismiss(() => onDeleted(entry));
    } catch (reason) {
      const message = describeError(reason, '删除失败，请稍后重试');
      busyRef.current = false;
      setBusy(null);
      fail(message);
    }
  };

  submitRef.current = () => {
    void handleSave();
  };

  const closeIfIdle = () => {
    if (!busyRef.current) dismiss();
  };

  return createPortal(
    <div className={`entry-sheet ${closing ? 'is-closing' : ''}`}>
      <div className="entry-sheet__scrim" aria-hidden="true" onClick={closeIfIdle} />

      <div
        className="entry-sheet__panel"
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={busy !== null}
      >
        <span className="entry-sheet__grabber" aria-hidden="true" />

        <header className="entry-sheet__head">
          <div>
            <p className="entry-sheet__eyebrow">{entry ? 'EDIT ENTRY' : 'QUICK ENTRY'}</p>
            <h2 className="entry-sheet__title" id={titleId}>
              {entry ? '编辑记录' : '记一笔'}
            </h2>
          </div>
          <button
            type="button"
            className="entry-sheet__close"
            aria-label="关闭记账面板"
            onClick={closeIfIdle}
            disabled={busy !== null}
          >
            <Icon name="close" size={19} />
          </button>
        </header>

        <div className="entry-sheet__body">
          <div className="entry-type" role="group" aria-label="收支类型">
            {TYPES.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`entry-type__button is-${item.id} ${type === item.id ? 'is-active' : ''}`}
                aria-pressed={type === item.id}
                onClick={() => changeType(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div
            className="entry-amount"
            ref={amountRef}
            tabIndex={0}
            role="group"
            aria-label={amountText ? `金额 ${amountText} 元` : '金额，等待输入'}
          >
            <span className="entry-amount__currency" aria-hidden="true">
              ¥
            </span>
            <span className={`entry-amount__value num ${amountText ? '' : 'is-empty'}`}>
              {amountText || '0.00'}
            </span>
            <span className="entry-amount__caret" aria-hidden="true" />
          </div>
          <p className="entry-amount__hint">用下方数字键盘，或直接敲击键盘输入</p>
          <span className="sr-only" role="status">
            {amountCents !== null ? `金额 ${formatMoney(amountCents)}` : ''}
          </span>

          <section className="entry-section" aria-label="分类">
            <div className="entry-section__head">
              <h3 className="entry-section__label">分类</h3>
              <span className="entry-section__hint">必填</span>
            </div>
            {categories.length > 0 ? (
              <div className="entry-chips" role="group" aria-label="选择一个分类">
                {categories.map((category) => (
                  <button
                    key={category.id}
                    type="button"
                    className={`entry-chip ${categoryId === category.id ? 'is-selected' : ''}`}
                    style={{ '--chip-color': category.color } as CSSProperties}
                    aria-pressed={categoryId === category.id}
                    onClick={() => selectCategory(category.id)}
                  >
                    <CategoryGlyph category={category} size="sm" />
                    <span>{category.name}</span>
                    {category.archived ? <span className="entry-chip__archived">已归档</span> : null}
                  </button>
                ))}
              </div>
            ) : (
              <p className="entry-chips__empty">暂无可用分类，请先在设置中新增分类。</p>
            )}
          </section>

          <div className="entry-keypad" role="group" aria-label="金额键盘">
            {KEYPAD_KEYS.map((key) => (
              <button
                key={key}
                type="button"
                className={`entry-keypad__key ${key === 'backspace' ? 'entry-keypad__key--action' : ''}`}
                aria-label={key === 'backspace' ? '退格' : key === '.' ? '小数点' : key}
                onClick={() => {
                  setError(null);
                  setAmountText((current) => applyAmountKey(current, key));
                }}
              >
                {key === 'backspace' ? <Icon name="backspace" size={21} /> : key}
              </button>
            ))}
          </div>

          <div className="entry-details">
            <section className="entry-section" aria-label="账户">
              <div className="entry-section__head">
                <h3 className="entry-section__label">账户</h3>
                <span className="entry-section__hint">必填</span>
              </div>
              {accounts.length > 0 ? (
                <div className="entry-chips" role="group" aria-label="选择一个账户">
                  {accounts.map((account) => (
                    <button
                      key={account.id}
                      type="button"
                      className={`entry-chip entry-chip--account ${
                        accountId === account.id ? 'is-selected' : ''
                      }`}
                      style={{ '--chip-color': account.color } as CSSProperties}
                      aria-pressed={accountId === account.id}
                      onClick={() => selectAccount(account.id)}
                    >
                      <Icon name={account.icon} size={17} />
                      <span>{account.name}</span>
                      {account.archived ? <span className="entry-chip__archived">已归档</span> : null}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="entry-chips__empty">暂无可用账户，请先在设置中新增账户。</p>
              )}
            </section>

            <label className="entry-field entry-field--note">
              <span className="entry-field__label">
                备注
                <em>可选</em>
              </span>
              <input
                className="entry-field__input"
                type="text"
                inputMode="text"
                maxLength={120}
                placeholder="例如：和朋友吃面"
                value={note}
                onChange={(event) => {
                  setNote(event.target.value);
                  setError(null);
                }}
              />
            </label>

            <section className="entry-field" aria-label="日期与时间">
              <span className="entry-field__label">
                日期与时间
                <em>默认现在</em>
              </span>
              <div className="entry-date__quick">
                <button
                  type="button"
                  className={`entry-date__chip ${activeDateKey === todayKey ? 'is-active' : ''}`}
                  aria-pressed={activeDateKey === todayKey}
                  onClick={() => applyQuickDate(todayKey)}
                >
                  今天
                </button>
                <button
                  type="button"
                  className={`entry-date__chip ${activeDateKey === yesterdayKey ? 'is-active' : ''}`}
                  aria-pressed={activeDateKey === yesterdayKey}
                  onClick={() => applyQuickDate(yesterdayKey)}
                >
                  昨天
                </button>
                <button
                  type="button"
                  className="entry-date__open"
                  aria-label={`选择日期与时间，当前 ${formatFullDate(activeDateKey)} ${formatTime(occurredAt)}`}
                  onClick={() => setPickerOpen(true)}
                >
                  <Icon name="calendar" size={14} />
                  <span className="entry-date__open-text">
                    {formatFullDate(activeDateKey)} · {formatTime(occurredAt)}
                  </span>
                  <Icon name="chevron-right" size={14} />
                </button>
              </div>
            </section>

            {entry ? (
              <div className="entry-delete">
                {confirmingDelete ? (
                  <div className="entry-delete__confirm" role="group" aria-label="确认删除记录">
                    <p>删除后无法恢复，确定删除这笔记录？</p>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => setConfirmingDelete(false)}
                      disabled={busy !== null}
                    >
                      取消
                    </button>
                    <button
                      type="button"
                      className="danger-button"
                      onClick={() => {
                        void handleDelete();
                      }}
                      disabled={busy !== null}
                    >
                      {busy === 'delete' ? '删除中…' : '确认删除'}
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="entry-delete__trigger"
                    onClick={() => {
                      setConfirmingDelete(true);
                      setError(null);
                    }}
                    disabled={busy !== null}
                  >
                    <Icon name="trash" size={16} />
                    删除这笔
                  </button>
                )}
              </div>
            ) : null}
          </div>
        </div>

        <footer className="entry-sheet__footer">
          {error ? (
            <p className="entry-sheet__error" role="alert">
              <Icon name="alert" size={15} />
              <span>{error}</span>
            </p>
          ) : null}
          <button
            type="button"
            className="primary-button entry-sheet__save"
            aria-label={entry ? '保存修改' : '保存'}
            onClick={() => {
              void handleSave();
            }}
            disabled={busy !== null}
          >
            {busy === 'save' ? (
              <>
                <Icon name="refresh" size={17} className="spin" />
                保存中…
              </>
            ) : (
              <>
                <Icon name="check" size={17} />
                {entry ? '保存修改' : '保存'}
                {amountCents !== null ? ` · ${formatMoney(amountCents)}` : ''}
              </>
            )}
          </button>
          <p className="entry-sheet__hint">Enter 保存 · Esc 关闭</p>
        </footer>
      </div>

      {pickerOpen ? (
        <DateTimePicker
          value={occurredAt}
          onCancel={() => setPickerOpen(false)}
          onConfirm={(next) => {
            setOccurredAt(next);
            setError(null);
            setPickerOpen(false);
          }}
        />
      ) : null}
    </div>,
    document.body,
  );
}
