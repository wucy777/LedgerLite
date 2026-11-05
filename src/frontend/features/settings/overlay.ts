import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

const overlayStack: symbol[] = [];
const backHandlers: BackHandlerEntry[] = [];
let bodyLockCount = 0;

export interface BackHandlerEntry {
  id: symbol;
  label: string;
  handler: () => void;
}

/** Registers the currently mounted layer in the app-wide back stack. */
export function useBackHandler(handler: () => void, label = '返回'): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const entry: BackHandlerEntry = {
      id: Symbol('back-handler'),
      label,
      handler: () => handlerRef.current(),
    };
    backHandlers.push(entry);
    return () => {
      const index = backHandlers.indexOf(entry);
      if (index !== -1) backHandlers.splice(index, 1);
    };
  }, [label]);
}

export function getTopBackHandler(): BackHandlerEntry | null {
  return backHandlers[backHandlers.length - 1] ?? null;
}

/** Runs the top handler. Returns false when the app itself should handle back. */
export function runTopBackHandler(): boolean {
  const top = getTopBackHandler();
  if (!top) return false;
  top.handler();
  return true;
}

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function focusableWithin(root: HTMLElement | null): HTMLElement[] {
  if (!root) return [];
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) => element.getClientRects().length > 0,
  );
}

/**
 * Shared behavior for modal layers: topmost-only Escape handling, a focus trap,
 * body scroll lock (reference counted for stacked layers) and focus restore.
 */
export function useOverlayLayer(
  containerRef: RefObject<HTMLElement | null>,
  onDismiss: () => void,
): void {
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;
  useBackHandler(() => dismissRef.current(), '关闭当前面板');

  useEffect(() => {
    const layerId = Symbol('settings-overlay');
    overlayStack.push(layerId);
    bodyLockCount += 1;
    document.body.classList.add('is-sheet-open');
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const container = containerRef.current;
    const focusTimer = window.setTimeout(() => {
      const preferred = container?.querySelector<HTMLElement>('[data-autofocus]');
      const target = preferred ?? focusableWithin(container)[0] ?? container;
      target?.focus({ preventScroll: true });
    }, 0);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      if (overlayStack[overlayStack.length - 1] !== layerId) return;
      // A modal layer owns the keyboard while it is open: keep shortcuts from reaching the page.
      event.stopPropagation();
      if (event.key === 'Escape') {
        event.preventDefault();
        dismissRef.current();
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
        if (active === first || !container.contains(active)) {
          event.preventDefault();
          last.focus();
        }
      } else if (active === last || !container.contains(active)) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener('keydown', handleKeyDown, true);
      const index = overlayStack.indexOf(layerId);
      if (index !== -1) overlayStack.splice(index, 1);
      bodyLockCount = Math.max(0, bodyLockCount - 1);
      if (bodyLockCount === 0) document.body.classList.remove('is-sheet-open');
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, [containerRef]);
}

export interface DismissTransition {
  closing: boolean;
  requestClose: () => void;
}

/** Delays unmount until the exit animation has played. */
export function useDismissTransition(onClose: () => void, duration = 180): DismissTransition {
  const [closing, setClosing] = useState(false);
  const timerRef = useRef<number | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  const requestClose = useCallback(() => {
    if (timerRef.current !== null) return;
    const reduceMotion =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) {
      closeRef.current();
      return;
    }
    setClosing(true);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      closeRef.current();
    }, duration);
  }, [duration]);

  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    },
    [],
  );

  return { closing, requestClose };
}
