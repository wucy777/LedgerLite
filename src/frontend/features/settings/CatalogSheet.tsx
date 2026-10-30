import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import { createPortal } from 'react-dom';
import type { Account, Catalog, Category, EntryType, IconName } from '@shared/types';
import { getLedgerClient } from '../../api/client';
import { CategoryGlyph } from '../../components/CategoryGlyph';
import { Icon } from '../../components/Icon';
import { useToast } from '../../components/ToastProvider';
import { ACCOUNT_ICONS, CATEGORY_PALETTE, ICON_LABELS, colorLabel, iconsForCategory } from './catalogOptions';
import { Dialog } from './Dialog';
import { friendlyError } from './errors';
import { useDismissTransition, useOverlayLayer } from './overlay';

export type CatalogTab = 'categories' | 'accounts';

type CatalogFormState =
  | {
      kind: 'category';
      id: string | null;
      type: EntryType;
      name: string;
      icon: IconName;
      color: string;
    }
  | {
      kind: 'account';
      id: string | null;
      name: string;
      icon: IconName;
      color: string;
    };

type ArchiveTarget =
  | { kind: 'category'; item: Category }
  | { kind: 'account'; item: Account };

interface CatalogSheetProps {
  initialTab: CatalogTab;
  catalog: Catalog;
  onCatalogChange: (catalog: Catalog) => void;
  onClose: () => void;
}

function sortByOrder<T extends { sort: number }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => a.sort - b.sort);
}

function categoriesOf(catalog: Catalog, type: EntryType, archived: boolean): Category[] {
  return sortByOrder(catalog.categories.filter((category) => category.type === type && category.archived === archived));
}

function accountsOf(catalog: Catalog, archived: boolean): Account[] {
  return sortByOrder(catalog.accounts.filter((account) => account.archived === archived));
}

export function CatalogSheet({ initialTab, catalog, onCatalogChange, onClose }: CatalogSheetProps) {
  const client = useMemo(() => getLedgerClient(), []);
  const { showToast } = useToast();
  const panelRef = useRef<HTMLDivElement>(null);
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const [tab, setTab] = useState<CatalogTab>(initialTab);
  const [form, setForm] = useState<CatalogFormState | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<ArchiveTarget | null>(null);
  const [archiveError, setArchiveError] = useState('');
  const [archiving, setArchiving] = useState(false);
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const { closing, requestClose } = useDismissTransition(onClose);
  const previousFormRef = useRef(false);

  const dismiss = useCallback(() => {
    if (form) {
      setForm(null);
      return;
    }
    requestClose();
  }, [form, requestClose]);

  useOverlayLayer(panelRef, dismiss);

  useEffect(() => {
    if (previousFormRef.current && form === null) {
      addButtonRef.current?.focus({ preventScroll: true });
    }
    previousFormRef.current = form !== null;
  }, [form]);

  const expenseActive = categoriesOf(catalog, 'expense', false);
  const incomeActive = categoriesOf(catalog, 'income', false);
  const archivedCategories = sortByOrder(catalog.categories.filter((category) => category.archived));
  const activeAccounts = accountsOf(catalog, false);
  const archivedAccounts = accountsOf(catalog, true);

  function startCreate(nextTab: CatalogTab) {
    if (nextTab === 'categories') {
      setForm({
        kind: 'category',
        id: null,
        type: 'expense',
        name: '',
        icon: 'other',
        color: CATEGORY_PALETTE[0] ?? '#d96f52',
      });
      return;
    }
    setForm({
      kind: 'account',
      id: null,
      name: '',
      icon: 'wallet',
      color: CATEGORY_PALETTE[0] ?? '#d96f52',
    });
  }

  function startEditCategory(category: Category) {
    setForm({
      kind: 'category',
      id: category.id,
      type: category.type,
      name: category.name,
      icon: category.icon,
      color: category.color,
    });
  }

  function startEditAccount(account: Account) {
    setForm({
      kind: 'account',
      id: account.id,
      name: account.name,
      icon: account.icon,
      color: account.color,
    });
  }

  function handleFormSaved(nextCatalog: Catalog, message: string) {
    onCatalogChange(nextCatalog);
    showToast(message, 'success');
    setForm(null);
  }

  async function handleRestore(kind: 'category' | 'account', item: Category | Account) {
    if (rowBusy) return;
    setRowBusy(item.id);
    try {
      const next =
        kind === 'category'
          ? await client.call('updateCategory', { id: item.id, patch: { archived: false } })
          : await client.call('updateAccount', { id: item.id, patch: { archived: false } });
      onCatalogChange(next);
      showToast(`已恢复${kind === 'category' ? '分类' : '账户'}“${item.name}”`, 'success');
    } catch (reason) {
      showToast(friendlyError(reason, '恢复失败，请重试'), 'error');
    } finally {
      setRowBusy(null);
    }
  }

  function requestArchive(target: ArchiveTarget) {
    setArchiveError('');
    setArchiveTarget(target);
  }

  function closeArchiveDialog() {
    setArchiveTarget(null);
    setArchiveError('');
  }

  async function handleArchive() {
    const target = archiveTarget;
    if (!target || archiving) return;
    const label = target.kind === 'category' ? '分类' : '账户';
    setArchiving(true);
    setArchiveError('');
    try {
      const next =
        target.kind === 'category'
          ? await client.call('updateCategory', { id: target.item.id, patch: { archived: true } })
          : await client.call('updateAccount', { id: target.item.id, patch: { archived: true } });
      onCatalogChange(next);
      showToast(`已归档${label}“${target.item.name}”`, 'success');
      closeArchiveDialog();
    } catch (reason) {
      setArchiveError(friendlyError(reason, '归档失败，请重试'));
    } finally {
      setArchiving(false);
    }
  }

  function renderCategoryItem(item: Category, activeCount: number, archived: boolean) {
    const canArchive = archived || activeCount > 1;
    return (
      <li key={item.id} className={`settings-item${archived ? ' is-archived' : ''}`}>
        <CategoryGlyph category={item} size="sm" />
        <span className="settings-item__copy">
          <span className="settings-item__name">{item.name}</span>
          <span className="settings-item__meta">
            {archived ? '已归档' : item.preset ? '预设分类' : '自定义分类'}
          </span>
        </span>
        <span className="settings-item__actions">
          <button
            type="button"
            className="settings-icon-button"
            aria-label={`编辑分类 ${item.name}`}
            onClick={() => startEditCategory(item)}
          >
            <Icon name="edit" size={16} />
          </button>
          {archived ? (
            <button
              type="button"
              className="settings-icon-button"
              aria-label={`恢复分类 ${item.name}`}
              disabled={rowBusy === item.id}
              onClick={() => void handleRestore('category', item)}
            >
              <Icon name="refresh" size={16} className={rowBusy === item.id ? 'spin' : undefined} />
            </button>
          ) : (
            <button
              type="button"
              className="settings-icon-button"
              aria-label={`归档分类 ${item.name}`}
              title={canArchive ? undefined : '至少保留一个可用分类'}
              disabled={!canArchive}
              onClick={() => requestArchive({ kind: 'category', item })}
            >
              <Icon name="archive" size={16} />
            </button>
          )}
        </span>
      </li>
    );
  }

  function renderAccountItem(item: Account, activeCount: number, archived: boolean) {
    const canArchive = archived || activeCount > 1;
    return (
      <li key={item.id} className={`settings-item${archived ? ' is-archived' : ''}`}>
        <CategoryGlyph category={item} size="sm" />
        <span className="settings-item__copy">
          <span className="settings-item__name">{item.name}</span>
          <span className="settings-item__meta">{archived ? '已归档' : item.preset ? '预设账户' : '自定义账户'}</span>
        </span>
        <span className="settings-item__actions">
          <button
            type="button"
            className="settings-icon-button"
            aria-label={`编辑账户 ${item.name}`}
            onClick={() => startEditAccount(item)}
          >
            <Icon name="edit" size={16} />
          </button>
          {archived ? (
            <button
              type="button"
              className="settings-icon-button"
              aria-label={`恢复账户 ${item.name}`}
              disabled={rowBusy === item.id}
              onClick={() => void handleRestore('account', item)}
            >
              <Icon name="refresh" size={16} className={rowBusy === item.id ? 'spin' : undefined} />
            </button>
          ) : (
            <button
              type="button"
              className="settings-icon-button"
              aria-label={`归档账户 ${item.name}`}
              title={canArchive ? undefined : '至少保留一个可用账户'}
              disabled={!canArchive}
              onClick={() => requestArchive({ kind: 'account', item })}
            >
              <Icon name="archive" size={16} />
            </button>
          )}
        </span>
      </li>
    );
  }

  const archiveLabel = archiveTarget?.kind === 'account' ? '账户' : '分类';

  return createPortal(
    <>
      <div
        className={`settings-overlay settings-overlay--sheet${closing ? ' is-closing' : ''}`}
        data-settings-overlay="sheet"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) dismiss();
        }}
      >
        <div
          ref={panelRef}
          className="settings-sheet"
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          tabIndex={-1}
        >
          <div className="settings-sheet__grabber" aria-hidden="true" />
          <header className="settings-sheet__head">
            {form ? (
              <button
                type="button"
                className="settings-sheet__back"
                aria-label="返回列表"
                onClick={() => setForm(null)}
              >
                <Icon name="chevron-left" size={18} />
              </button>
            ) : (
              <span className="settings-sheet__icon" aria-hidden="true">
                <Icon name={tab === 'categories' ? 'shopping' : 'wallet'} size={18} />
              </span>
            )}
            <div className="settings-sheet__titles">
              <p className="settings-sheet__eyebrow">{form ? '分类与账户' : '账本结构'}</p>
              <h2 id={titleId}>
                {form ? `${form.id ? '编辑' : '新增'}${form.kind === 'category' ? '分类' : '账户'}` : '分类与账户'}
              </h2>
            </div>
            <button type="button" className="settings-sheet__close" aria-label="关闭" onClick={requestClose}>
              <Icon name="close" size={18} />
            </button>
          </header>

          {form ? (
            <div className="settings-sheet__formarea">
              <CatalogItemForm
                key={form.id ?? `new-${form.kind}`}
                state={form}
                onCancel={() => setForm(null)}
                onSaved={handleFormSaved}
              />
            </div>
          ) : (
            <>
              <div className="settings-sheet__tabs" role="tablist" aria-label="分类与账户">
                <button
                  id="settings-tab-categories"
                  type="button"
                  role="tab"
                  aria-selected={tab === 'categories'}
                  aria-controls="settings-sheet-panel"
                  className={tab === 'categories' ? 'is-active' : undefined}
                  data-autofocus={initialTab === 'categories' ? true : undefined}
                  onClick={() => setTab('categories')}
                >
                  分类
                </button>
                <button
                  id="settings-tab-accounts"
                  type="button"
                  role="tab"
                  aria-selected={tab === 'accounts'}
                  aria-controls="settings-sheet-panel"
                  className={tab === 'accounts' ? 'is-active' : undefined}
                  data-autofocus={initialTab === 'accounts' ? true : undefined}
                  onClick={() => setTab('accounts')}
                >
                  账户
                </button>
              </div>

              <div
                className="settings-sheet__content"
                id="settings-sheet-panel"
                role="tabpanel"
                aria-labelledby={tab === 'categories' ? 'settings-tab-categories' : 'settings-tab-accounts'}
              >
                {tab === 'categories' ? (
                  <>
                    <div className="settings-group">
                      <div className="settings-group__head">
                        <span>支出分类</span>
                        <span className="num">{expenseActive.length}</span>
                      </div>
                      {expenseActive.length > 0 ? (
                        <ul className="settings-items">
                          {expenseActive.map((item) => renderCategoryItem(item, expenseActive.length, false))}
                        </ul>
                      ) : (
                        <p className="settings-empty">暂无支出分类，可在下方新增。</p>
                      )}
                    </div>
                    <div className="settings-group">
                      <div className="settings-group__head">
                        <span>收入分类</span>
                        <span className="num">{incomeActive.length}</span>
                      </div>
                      {incomeActive.length > 0 ? (
                        <ul className="settings-items">
                          {incomeActive.map((item) => renderCategoryItem(item, incomeActive.length, false))}
                        </ul>
                      ) : (
                        <p className="settings-empty">暂无收入分类，可在下方新增。</p>
                      )}
                    </div>
                    {archivedCategories.length > 0 ? (
                      <div className="settings-group settings-group--archived">
                        <div className="settings-group__head">
                          <span>已归档</span>
                          <span className="num">{archivedCategories.length}</span>
                        </div>
                        <ul className="settings-items">
                          {archivedCategories.map((item) => renderCategoryItem(item, 0, true))}
                        </ul>
                      </div>
                    ) : null}
                    <p className="settings-sheet__hint">
                      <Icon name="info" size={13} />
                      归档不会删除历史记录；每个类型至少保留一个可用分类。
                    </p>
                  </>
                ) : (
                  <>
                    <div className="settings-group">
                      <div className="settings-group__head">
                        <span>可用账户</span>
                        <span className="num">{activeAccounts.length}</span>
                      </div>
                      {activeAccounts.length > 0 ? (
                        <ul className="settings-items">
                          {activeAccounts.map((item) => renderAccountItem(item, activeAccounts.length, false))}
                        </ul>
                      ) : (
                        <p className="settings-empty">暂无可用账户，可在下方新增。</p>
                      )}
                    </div>
                    {archivedAccounts.length > 0 ? (
                      <div className="settings-group settings-group--archived">
                        <div className="settings-group__head">
                          <span>已归档</span>
                          <span className="num">{archivedAccounts.length}</span>
                        </div>
                        <ul className="settings-items">
                          {archivedAccounts.map((item) => renderAccountItem(item, 0, true))}
                        </ul>
                      </div>
                    ) : null}
                    <p className="settings-sheet__hint">
                      <Icon name="info" size={13} />
                      归档不会删除历史记录；至少保留一个可用账户。
                    </p>
                  </>
                )}
              </div>

              <div className="settings-sheet__foot">
                <button
                  ref={addButtonRef}
                  type="button"
                  className="primary-button"
                  onClick={() => startCreate(tab)}
                >
                  <Icon name="plus" size={17} />
                  新增{tab === 'categories' ? '分类' : '账户'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {archiveTarget ? (
        <Dialog
          title={`归档${archiveLabel}“${archiveTarget.item.name}”`}
          eyebrow="账本结构"
          icon="archive"
          dismissOnBackdrop={!archiving}
          onClose={closeArchiveDialog}
          footer={
            <>
              <button
                type="button"
                className="secondary-button"
                onClick={closeArchiveDialog}
                disabled={archiving}
                data-autofocus
              >
                取消
              </button>
              <button type="button" className="primary-button" onClick={() => void handleArchive()} disabled={archiving}>
                {archiving ? (
                  <>
                    <Icon name="refresh" size={16} className="spin" />
                    正在归档
                  </>
                ) : (
                  '确认归档'
                )}
              </button>
            </>
          }
        >
          <p className="settings-dialog__text">
            归档后，新增记账时不再显示该{archiveLabel}；已有记录仍会保留，可随时恢复。
          </p>
          {archiveError ? (
            <p className="settings-field__error" role="alert">
              {archiveError}
            </p>
          ) : null}
        </Dialog>
      ) : null}
    </>,
    document.body,
  );
}

interface CatalogItemFormProps {
  state: CatalogFormState;
  onCancel: () => void;
  onSaved: (catalog: Catalog, message: string) => void;
}

function CatalogItemForm({ state, onCancel, onSaved }: CatalogItemFormProps) {
  const client = useMemo(() => getLedgerClient(), []);
  const nameId = useId();
  const [name, setName] = useState(state.name);
  const [type, setType] = useState<EntryType>(state.kind === 'category' ? state.type : 'expense');
  const [icon, setIcon] = useState<IconName>(state.icon);
  const [color, setColor] = useState(state.color);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const iconSet = state.kind === 'category' ? iconsForCategory(type) : ACCOUNT_ICONS;
  const palette = useMemo(
    () => (CATEGORY_PALETTE.includes(color) ? CATEGORY_PALETTE : [color, ...CATEGORY_PALETTE]),
    [color],
  );
  const isEditing = state.id !== null;
  const subject = state.kind === 'category' ? '分类' : '账户';

  function handleTypeChange(nextType: EntryType) {
    setType(nextType);
    const nextIcons = iconsForCategory(nextType);
    if (!nextIcons.includes(icon)) setIcon(nextIcons[nextIcons.length - 1] ?? 'other');
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setError('请输入名称');
      return;
    }
    if (Array.from(trimmed).length > 12) {
      setError('名称不能超过 12 个字符');
      return;
    }
    setBusy(true);
    setError('');
    try {
      if (state.kind === 'category') {
        if (state.id) {
          const next = await client.call('updateCategory', {
            id: state.id,
            patch: { name: trimmed, icon, color },
          });
          onSaved(next, '分类已更新');
        } else {
          const next = await client.call('addCategory', { name: trimmed, type, icon, color });
          onSaved(next, '已新增分类');
        }
      } else if (state.id) {
        const next = await client.call('updateAccount', {
          id: state.id,
          patch: { name: trimmed, icon, color },
        });
        onSaved(next, '账户已更新');
      } else {
        const next = await client.call('addAccount', { name: trimmed, icon, color });
        onSaved(next, '已新增账户');
      }
    } catch (reason) {
      setError(friendlyError(reason, '保存失败，请重试'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="settings-form" onSubmit={handleSubmit}>
      <div className="settings-form__preview">
        <CategoryGlyph category={{ name: name.trim() || '未命名', icon, color }} size="lg" />
        <div className="settings-form__preview-copy">
          <span className="settings-form__preview-name">{name.trim() || '未命名'}</span>
          <span className="settings-form__preview-meta">
            {state.kind === 'category' ? (type === 'expense' ? '支出分类' : '收入分类') : '账户'}
          </span>
        </div>
      </div>

      <div className="settings-field">
        <label className="settings-field__label" htmlFor={nameId}>
          名称
        </label>
        <span className={`settings-input${error && !name.trim() ? ' has-error' : ''}`}>
          <Icon name={state.kind === 'category' ? 'edit' : 'wallet'} size={16} />
          <input
            id={nameId}
            type="text"
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              if (error) setError('');
            }}
            placeholder={state.kind === 'category' ? '例如：咖啡' : '例如：零钱'}
            maxLength={12}
            autoComplete="off"
            autoFocus
          />
          <span className="settings-input__count">{Array.from(name).length}/12</span>
        </span>
      </div>

      {state.kind === 'category' && !isEditing ? (
        <fieldset className="settings-form__fieldset">
          <legend className="settings-field__label">类型</legend>
          <div className="settings-segment" role="group" aria-label="分类类型">
            <button
              type="button"
              className={type === 'expense' ? 'is-active' : undefined}
              aria-pressed={type === 'expense'}
              onClick={() => handleTypeChange('expense')}
            >
              支出
            </button>
            <button
              type="button"
              className={type === 'income' ? 'is-active' : undefined}
              aria-pressed={type === 'income'}
              onClick={() => handleTypeChange('income')}
            >
              收入
            </button>
          </div>
        </fieldset>
      ) : null}

      <fieldset className="settings-form__fieldset">
        <legend className="settings-field__label">图标</legend>
        <div className="settings-icon-grid">
          {iconSet.map((option) => (
            <button
              key={option}
              type="button"
              className={`settings-icon-choice${icon === option ? ' is-selected' : ''}`}
              aria-label={ICON_LABELS[option] ?? option}
              aria-pressed={icon === option}
              onClick={() => setIcon(option)}
            >
              <Icon name={option} size={20} />
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="settings-form__fieldset">
        <legend className="settings-field__label">颜色</legend>
        <div className="settings-color-grid">
          {palette.map((swatch) => (
            <button
              key={swatch}
              type="button"
              className={`settings-color-choice${color === swatch ? ' is-selected' : ''}`}
              style={{ backgroundColor: swatch }}
              aria-label={colorLabel(swatch)}
              aria-pressed={color === swatch}
              onClick={() => setColor(swatch)}
            />
          ))}
        </div>
      </fieldset>

      {error ? (
        <p className="settings-field__error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="settings-form__actions">
        <button type="button" className="secondary-button" onClick={onCancel} disabled={busy}>
          取消
        </button>
        <button type="submit" className="primary-button" disabled={busy}>
          {busy ? (
            <>
              <Icon name="refresh" size={16} className="spin" />
              保存中
            </>
          ) : (
            `保存${subject}`
          )}
        </button>
      </div>
    </form>
  );
}
