import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
} from 'react';
import { createPortal } from 'react-dom';
import type { Ledger } from '@shared/types';
import { Icon } from '../../components/Icon';
import '../../styles/ledger-switcher.css';

export interface LedgerTriggerProps {
  ledger: Ledger;
  ledgerCount: number;
  onOpen: () => void;
}

/**
 * Compact "current ledger" entry point. It is intentionally width-flexible so
 * it can sit in the 390px mobile header as well as the desktop side rail.
 */
export function LedgerTrigger({ ledger, ledgerCount, onOpen }: LedgerTriggerProps) {
  const countLabel = `${ledgerCount} 个账本`;

  return (
    <button
      type="button"
      className="ledger-picker-trigger"
      aria-haspopup="dialog"
      aria-label={`当前账本：${ledger.name}，共 ${countLabel}。打开账本切换器`}
      title={`${ledger.name} · ${countLabel}`}
      onClick={onOpen}
    >
      <span
        className="ledger-picker-trigger__dot"
        style={{ '--ledger-color': ledger.color } as CSSProperties}
        aria-hidden="true"
      />
      <span className="ledger-picker-trigger__name">{ledger.name}</span>
      {ledgerCount > 1 ? (
        <span className="ledger-picker-trigger__count" aria-hidden="true">
          {ledgerCount}
        </span>
      ) : null}
      <Icon name="chevron-down" size={14} className="ledger-picker-trigger__chevron" />
    </button>
  );
}

export interface LedgerSheetProps {
  ledgers: Ledger[];
  activeLedgerId: string;
  onClose: () => void;
  onSelect: (ledger: Ledger) => Promise<void>;
  onCreate: (name: string) => Promise<void>;
  onRename: (ledger: Ledger, name: string) => Promise<void>;
  onDelete: (ledger: Ledger) => Promise<void>;
}

const EXIT_DURATION = 220;
const MAX_NAME_LENGTH = 20;

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

let bodyLockCount = 0;

type BusyState =
  | { kind: 'select'; ledgerId: string }
  | { kind: 'create' }
  | { kind: 'rename'; ledgerId: string }
  | { kind: 'delete'; ledgerId: string };

type EditorState = { mode: 'create' } | { mode: 'rename'; ledger: Ledger };

function focusableWithin(root: HTMLElement | null): HTMLElement[] {
  if (!root) return [];
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) => element.getClientRects().length > 0,
  );
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

function characterCount(value: string): number {
  return Array.from(value).length;
}

/**
 * Bottom sheet (centered modal on desktop) for switching between ledgers and
 * managing them. Async work is delegated to the parent through the callbacks;
 * the sheet only owns presentation, transient form state and failure display.
 */
export function LedgerSheet({
  ledgers,
  activeLedgerId,
  onClose,
  onSelect,
  onCreate,
  onRename,
  onDelete,
}: LedgerSheetProps) {
  const titleId = useId();
  const descriptionId = useId();
  const hintId = useId();
  const inputId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const createButtonRef = useRef<HTMLButtonElement>(null);
  const closeTimerRef = useRef<number | null>(null);
  const closingRef = useRef(false);
  const busyRef = useRef(false);
  const editorRef = useRef<EditorState | null>(null);
  const deleteRef = useRef<Ledger | null>(null);
  const onCloseRef = useRef(onClose);
  const editorWasOpenRef = useRef(false);

  onCloseRef.current = onClose;

  const [closing, setClosing] = useState(false);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [draftName, setDraftName] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<Ledger | null>(null);
  const [busy, setBusy] = useState<BusyState | null>(null);
  const [error, setError] = useState<string | null>(null);

  editorRef.current = editor;
  deleteRef.current = deleteTarget;
  busyRef.current = busy !== null;

  const requestClose = useCallback(() => {
    if (closingRef.current || busyRef.current) return;
    closingRef.current = true;

    if (prefersReducedMotion()) {
      onCloseRef.current();
      return;
    }

    setClosing(true);
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      onCloseRef.current();
    }, EXIT_DURATION);
  }, []);

  const handleDismiss = useCallback(() => {
    if (busyRef.current) return;
    if (editorRef.current) {
      setEditor(null);
      setError(null);
      return;
    }
    if (deleteRef.current) {
      setDeleteTarget(null);
      setError(null);
      return;
    }
    requestClose();
  }, [requestClose]);

  useEffect(() => {
    const body = document.body;
    bodyLockCount += 1;
    body.classList.add('is-sheet-open');
    return () => {
      bodyLockCount = Math.max(0, bodyLockCount - 1);
      if (bodyLockCount === 0) body.classList.remove('is-sheet-open');
    };
  }, []);

  useEffect(() => {
    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const container = panelRef.current;

    const focusTimer = window.setTimeout(() => {
      const preferred = container?.querySelector<HTMLElement>('[data-autofocus]');
      const target = preferred ?? focusableWithin(container)[0] ?? container;
      target?.focus({ preventScroll: true });
    }, 0);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;

      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        handleDismiss();
        return;
      }

      if (event.key !== 'Tab' || !container) return;

      const focusable = focusableWithin(container);
      if (focusable.length === 0) {
        event.preventDefault();
        container.focus({ preventScroll: true });
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;

      const active = document.activeElement;
      if (event.shiftKey) {
        if (active === first || !(active instanceof Node) || !container.contains(active)) {
          event.preventDefault();
          last.focus();
        }
      } else if (active === last || !(active instanceof Node) || !container.contains(active)) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener('keydown', handleKeyDown, true);
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, [handleDismiss]);

  useEffect(
    () => () => {
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
    },
    [],
  );

  useEffect(() => {
    if (!editor) return;
    const focusTimer = window.setTimeout(() => {
      inputRef.current?.focus({ preventScroll: true });
      if (editor.mode === 'rename') inputRef.current?.select();
    }, 0);
    return () => window.clearTimeout(focusTimer);
  }, [editor]);

  useEffect(() => {
    if (editorWasOpenRef.current && editor === null) {
      createButtonRef.current?.focus({ preventScroll: true });
    }
    editorWasOpenRef.current = editor !== null;
  }, [editor]);

  useEffect(() => {
    if (deleteTarget && !ledgers.some((ledger) => ledger.id === deleteTarget.id)) {
      setDeleteTarget(null);
    }
  }, [deleteTarget, ledgers]);

  const openCreate = () => {
    if (busyRef.current) return;
    setError(null);
    setDraftName('');
    setEditor({ mode: 'create' });
  };

  const openRename = (ledger: Ledger) => {
    if (busyRef.current) return;
    setError(null);
    setDraftName(ledger.name);
    setEditor({ mode: 'rename', ledger });
  };

  const closeEditor = () => {
    if (busyRef.current) return;
    setEditor(null);
    setError(null);
  };

  const handleSelect = async (ledger: Ledger) => {
    if (busyRef.current || closingRef.current) return;
    if (ledger.id === activeLedgerId) {
      requestClose();
      return;
    }

    setError(null);
    busyRef.current = true;
    setBusy({ kind: 'select', ledgerId: ledger.id });
    try {
      await onSelect(ledger);
      busyRef.current = false;
      setBusy(null);
      requestClose();
    } catch (reason) {
      busyRef.current = false;
      setBusy(null);
      setError(describeError(reason, '切换账本失败，请重试'));
    }
  };

  const handleEditorSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const currentEditor = editorRef.current;
    if (!currentEditor || busyRef.current || closingRef.current) return;

    const trimmed = draftName.trim();
    const length = characterCount(trimmed);
    if (length === 0) {
      setError('请输入账本名称');
      inputRef.current?.focus({ preventScroll: true });
      return;
    }
    if (length > MAX_NAME_LENGTH) {
      setError(`账本名称不能超过 ${MAX_NAME_LENGTH} 个字符`);
      inputRef.current?.focus({ preventScroll: true });
      return;
    }

    setError(null);
    busyRef.current = true;
    setBusy(
      currentEditor.mode === 'create'
        ? { kind: 'create' }
        : { kind: 'rename', ledgerId: currentEditor.ledger.id },
    );
    try {
      if (currentEditor.mode === 'create') {
        await onCreate(trimmed);
      } else {
        await onRename(currentEditor.ledger, trimmed);
      }
      setEditor(null);
      setDraftName('');
    } catch (reason) {
      setError(
        describeError(
          reason,
          currentEditor.mode === 'create' ? '新建账本失败，请重试' : '重命名账本失败，请重试',
        ),
      );
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  };

  const requestDelete = (ledger: Ledger) => {
    if (busyRef.current || ledgers.length <= 1) return;
    setError(null);
    setDeleteTarget(ledger);
  };

  const cancelDelete = () => {
    if (busyRef.current) return;
    setDeleteTarget(null);
    setError(null);
  };

  const handleDelete = async () => {
    const target = deleteRef.current;
    if (!target || busyRef.current || ledgers.length <= 1) return;

    setError(null);
    busyRef.current = true;
    setBusy({ kind: 'delete', ledgerId: target.id });
    try {
      await onDelete(target);
      setDeleteTarget(null);
    } catch (reason) {
      setError(describeError(reason, '删除账本失败，请重试'));
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  };

  const trimmedDraftName = draftName.trim();
  const draftLength = characterCount(trimmedDraftName);
  const draftTooLong = draftLength > MAX_NAME_LENGTH;
  const sheetBusy = busy !== null;

  return createPortal(
    <div
      className={`ledger-picker-overlay${closing ? ' is-closing' : ''}`}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) handleDismiss();
      }}
    >
      <div
        ref={panelRef}
        className="ledger-picker-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        aria-busy={sheetBusy}
        tabIndex={-1}
      >
        <span className="ledger-picker-grabber" aria-hidden="true" />

        <header className="ledger-picker-head">
          {editor ? (
            <button
              type="button"
              className="ledger-picker-head__back"
              aria-label="返回账本列表"
              onClick={closeEditor}
              disabled={sheetBusy}
            >
              <Icon name="chevron-left" size={18} />
            </button>
          ) : (
            <span className="ledger-picker-head__mark" aria-hidden="true">
              <Icon name="ledger" size={19} />
            </span>
          )}
          <div className="ledger-picker-head__titles">
            <p className="ledger-picker-head__eyebrow">{editor ? 'LEDGER DETAILS' : 'LEDGERS'}</p>
            <h2 id={titleId}>
              {editor ? (editor.mode === 'create' ? '新建账本' : '重命名账本') : '切换账本'}
            </h2>
          </div>
          <button
            type="button"
            className="ledger-picker-head__close"
            aria-label="关闭账本切换器"
            onClick={requestClose}
            disabled={sheetBusy}
          >
            <Icon name="close" size={18} />
          </button>
        </header>

        <p className="ledger-picker-sub" id={descriptionId}>
          {editor
            ? '给账本一个清晰的名字，方便记账时快速辨认。'
            : '每个账本独立记录收支，数据始终保存在本机。'}
        </p>

        <div className="ledger-picker-body">
          {error ? (
            <p className="ledger-picker-alert" role="alert">
              <Icon name="alert" size={15} />
              <span>{error}</span>
            </p>
          ) : null}

          {editor ? (
            <form className="ledger-picker-form" onSubmit={(event) => void handleEditorSubmit(event)}>
              <div className="ledger-picker-form__preview">
                <span
                  className="ledger-picker-form__preview-dot"
                  style={
                    {
                      '--ledger-color':
                        editor.mode === 'rename' ? editor.ledger.color : 'var(--accent)',
                    } as CSSProperties
                  }
                  aria-hidden="true"
                />
                <span className="ledger-picker-form__preview-copy">
                  <span className="ledger-picker-form__preview-name">
                    {trimmedDraftName || '未命名账本'}
                  </span>
                  <span className="ledger-picker-form__preview-meta">
                    {editor.mode === 'create' ? '新账本 · 独立记录' : '重命名后保留全部记录'}
                  </span>
                </span>
              </div>

              <div className="ledger-picker-field">
                <label className="ledger-picker-field__label" htmlFor={inputId}>
                  <span>账本名称</span>
                  <span
                    className={`ledger-picker-field__count${draftTooLong ? ' is-over' : ''}`}
                    aria-hidden="true"
                  >
                    {draftLength}/{MAX_NAME_LENGTH}
                  </span>
                </label>
                <span className={`ledger-picker-input${draftTooLong ? ' is-invalid' : ''}`}>
                  <Icon name="edit" size={16} />
                  <input
                    id={inputId}
                    ref={inputRef}
                    type="text"
                    value={draftName}
                    placeholder="例如：家庭账本"
                    autoComplete="off"
                    spellCheck={false}
                    aria-invalid={draftTooLong || undefined}
                    aria-describedby={hintId}
                    onChange={(event) => {
                      setDraftName(event.target.value);
                      if (error) setError(null);
                    }}
                  />
                </span>
                <p className="ledger-picker-field__hint" id={hintId}>
                  1–{MAX_NAME_LENGTH} 个字符，支持中文、字母与表情。
                </p>
              </div>

              <div className="ledger-picker-form__actions">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={closeEditor}
                  disabled={sheetBusy}
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="primary-button"
                  disabled={sheetBusy || draftLength === 0 || draftTooLong}
                >
                  {busy?.kind === 'create' || busy?.kind === 'rename' ? (
                    <>
                      <Icon name="refresh" size={16} className="spin" />
                      {editor.mode === 'create' ? '创建中…' : '保存中…'}
                    </>
                  ) : editor.mode === 'create' ? (
                    '创建账本'
                  ) : (
                    '保存名称'
                  )}
                </button>
              </div>
            </form>
          ) : (
            <>
              <div className="ledger-picker-listhead">
                <span>全部账本</span>
                <span className="num">{ledgers.length}</span>
              </div>

              {ledgers.length === 0 ? (
                <p className="ledger-picker-empty">还没有账本，先新建一个开始记账。</p>
              ) : (
                <ul className="ledger-picker-list">
                  {ledgers.map((ledger) => {
                    const isActive = ledger.id === activeLedgerId;
                    const isSelecting = busy?.kind === 'select' && busy.ledgerId === ledger.id;
                    const isDeleting = busy?.kind === 'delete' && busy.ledgerId === ledger.id;
                    const canDelete = ledgers.length > 1;

                    return (
                      <li
                        key={ledger.id}
                        className={`ledger-picker-item${isActive ? ' is-active' : ''}`}
                        style={{ '--ledger-color': ledger.color } as CSSProperties}
                      >
                        <div className="ledger-picker-item__row">
                          <button
                            type="button"
                            className="ledger-picker-item__main"
                            aria-current={isActive ? 'true' : undefined}
                            data-autofocus={isActive ? true : undefined}
                            disabled={sheetBusy}
                            onClick={() => void handleSelect(ledger)}
                          >
                            <span className="ledger-picker-item__dot" aria-hidden="true" />
                            <span className="ledger-picker-item__name">{ledger.name}</span>
                            {isActive ? (
                              <span className="ledger-picker-item__current">
                                <Icon name="check" size={12} />
                                当前
                              </span>
                            ) : null}
                            {isSelecting ? (
                              <Icon
                                name="refresh"
                                size={15}
                                className="spin ledger-picker-item__spinner"
                                label="正在切换账本"
                              />
                            ) : null}
                          </button>

                          <span className="ledger-picker-item__actions">
                            <button
                              type="button"
                              className="ledger-picker-item__action"
                              aria-label={`重命名账本 ${ledger.name}`}
                              title="重命名"
                              disabled={sheetBusy}
                              onClick={() => openRename(ledger)}
                            >
                              <Icon name="edit" size={16} />
                            </button>
                            <button
                              type="button"
                              className="ledger-picker-item__action ledger-picker-item__action--danger"
                              aria-label={`删除账本 ${ledger.name}`}
                              title={canDelete ? '删除账本' : '最后一个账本不能删除'}
                              disabled={sheetBusy || !canDelete}
                              onClick={() => requestDelete(ledger)}
                            >
                              <Icon name="trash" size={16} />
                            </button>
                          </span>
                        </div>

                        {deleteTarget?.id === ledger.id ? (
                          <div
                            className="ledger-picker-confirm"
                            role="group"
                            aria-label={`确认删除账本 ${ledger.name}`}
                          >
                            <p className="ledger-picker-confirm__text">
                              删除「{ledger.name}」后，其中的全部记录会一并移除，且无法恢复。
                            </p>
                            <div className="ledger-picker-confirm__actions">
                              <button
                                type="button"
                                className="secondary-button"
                                onClick={cancelDelete}
                                disabled={sheetBusy}
                              >
                                取消
                              </button>
                              <button
                                type="button"
                                className="danger-button"
                                onClick={() => void handleDelete()}
                                disabled={sheetBusy}
                              >
                                {isDeleting ? (
                                  <>
                                    <Icon name="refresh" size={15} className="spin" />
                                    删除中…
                                  </>
                                ) : (
                                  '确认删除'
                                )}
                              </button>
                            </div>
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              )}

              <p className="ledger-picker-note">
                <Icon name="info" size={13} />
                <span>
                  {ledgers.length <= 1
                    ? '至少需要保留一个账本；当前账本是唯一账本，无法删除。'
                    : '最后一个账本无法删除；删除其他账本会一并移除其中的记录。'}
                </span>
              </p>
            </>
          )}
        </div>

        {editor ? null : (
          <footer className="ledger-picker-foot">
            <button
              ref={createButtonRef}
              type="button"
              className="primary-button ledger-picker-create"
              onClick={openCreate}
              disabled={sheetBusy}
            >
              <Icon name="plus" size={17} />
              新建账本
            </button>
          </footer>
        )}
      </div>
    </div>,
    document.body,
  );
}
