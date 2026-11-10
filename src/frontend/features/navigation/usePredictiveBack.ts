import { useCallback, useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { getTopBackElement } from '../settings/overlay';

const EDGE_WIDTH = 22;
const COMMIT_RATIO = 0.32;
const MIN_TRAVEL = 160;
const MAX_TRAVEL_RATIO = 0.42;
const SETTLE_MS = 200;
/** Length of the slide-out that finishes a committed overlay gesture. */
const LEAVE_MS = 190;
/** Grace period after asking the layer to dismiss, before clearing gesture state. */
const LEAVE_CLEANUP_MS = 300;

type LeaveMode = 'down' | 'right' | 'left';

interface Options {
  /** Runs when a back gesture commits (system gesture, edge swipe or hardware key). */
  onCommit: () => void;
  /** Whether a back gesture can be previewed right now. */
  previewEnabled: boolean;
  /** Whether the preview is the page sliding away (instead of an overlay closing). */
  pagePreview: boolean;
}

export interface PredictiveBackState {
  active: boolean;
  armed: boolean;
}

interface BackBridge {
  /** dge is Android's swipe edge: 0 = left, 1 = right. */
  __ledgerBackStart?: (edge?: number) => void;
  __ledgerBackProgress?: (progress: number) => void;
  __ledgerBackCancel?: () => void;
  /** Returns true when JS handled the back navigation. */
  __ledgerBack?: () => boolean;
}

function isNativePlatform(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

/** Bottom sheets peel downwards; centred panels follow the finger sideways. */
function modeFor(element: HTMLElement, edge: number | undefined): LeaveMode {
  if (element.matches('.entry-sheet__panel, .settings-sheet, .ledger-picker-sheet')) return 'down';
  return edge === 1 ? 'left' : 'right';
}

/**
 * Predictive back, following Android's own gesture model.
 *
 * On Android the system owns the edge swipe and streams its progress through
 * `OnBackPressedCallback`; `MainActivity` forwards it to the small
 * `__ledgerBack*` bridge below. On the web an equivalent pointer gesture on the
 * left edge produces the same calls.
 *
 * Everything is written straight to the DOM — one custom property on `<html>`
 * for the page-level preview, `--sheet-progress` plus `translate`/`scale` on the
 * panel that owns back. Inline styles, not classes: React re-renders the sheet
 * (e.g. when it starts closing) and would wipe a class added from outside.
 */
export function usePredictiveBack({ onCommit, previewEnabled, pagePreview }: Options): PredictiveBackState {
  const [active, setActive] = useState(false);
  const [armed, setArmed] = useState(false);
  const commitRef = useRef(onCommit);
  commitRef.current = onCommit;
  const previewRef = useRef(previewEnabled);
  previewRef.current = previewEnabled;
  const pagePreviewRef = useRef(pagePreview);
  pagePreviewRef.current = pagePreview;
  const settleTimer = useRef<number | null>(null);
  const leaveTimer = useRef<number | null>(null);
  const activeRef = useRef(false);
  const previewTarget = useRef<HTMLElement | null>(null);
  const previewMode = useRef<LeaveMode>('down');

  const paintPage = useCallback((progress: number, gesturing: boolean) => {
    const root = document.documentElement;
    if (gesturing) root.style.setProperty('--back-progress', progress.toFixed(4));
    else root.style.removeProperty('--back-progress');
    root.classList.toggle('is-back-gesturing', gesturing);
    root.classList.toggle('is-page-preview', gesturing && pagePreviewRef.current);
  }, []);

  const paintSheet = useCallback((progress: number) => {
    const panel = previewTarget.current;
    if (!panel) return;
    panel.style.transition = 'none';
    if (previewMode.current === 'down') {
      panel.style.translate = `0 ${(progress * 34).toFixed(2)}%`;
      panel.style.scale = (1 - progress * 0.04).toFixed(4);
    } else {
      const direction = previewMode.current === 'left' ? -1 : 1;
      panel.style.translate = `${(direction * progress * 26).toFixed(2)}% 0`;
      panel.style.scale = (1 - progress * 0.06).toFixed(4);
    }
    // The scrim (or the overlay itself, when it doubles as the backdrop) fades
    // through a property the stylesheet already reads, so no class is involved.
    panel.parentElement?.style.setProperty('--sheet-progress', progress.toFixed(4));
  }, []);

  const clearPreviewTarget = useCallback(() => {
    const panel = previewTarget.current;
    if (panel) {
      panel.style.translate = '';
      panel.style.scale = '';
      panel.style.transition = '';
      panel.style.opacity = '';
      panel.style.animation = '';
      const parent = panel.parentElement;
      if (parent) {
        parent.style.removeProperty('--sheet-progress');
        parent.style.opacity = '';
        parent.style.background = '';
        parent.style.backdropFilter = '';
        parent.style.transition = '';
        parent.style.animation = '';
        const scrim = parent.querySelector<HTMLElement>('.entry-sheet__scrim, .date-picker__scrim');
        if (scrim) {
          scrim.style.opacity = '';
          scrim.style.transition = '';
        }
      }
    }
    previewTarget.current = null;
  }, []);

  const clearSettle = useCallback(() => {
    if (settleTimer.current !== null) {
      window.clearTimeout(settleTimer.current);
      settleTimer.current = null;
    }
    if (leaveTimer.current !== null) {
      window.clearTimeout(leaveTimer.current);
      leaveTimer.current = null;
    }
  }, []);

  const begin = useCallback((edge?: number) => {
    if (!previewRef.current || leaveTimer.current !== null) return;
    clearSettle();
    clearPreviewTarget();
    // Overlays preview their own dismissal; only a page-level back lifts the card.
    if (!pagePreviewRef.current) {
      const element = getTopBackElement();
      if (element) {
        previewMode.current = modeFor(element, edge);
        previewTarget.current = element;
        element.parentElement?.style.setProperty('--sheet-progress', '0');
      }
    }
    activeRef.current = true;
    setActive(true);
  }, [clearPreviewTarget, clearSettle]);

  const update = useCallback(
    (progress: number) => {
      if (!previewRef.current) return;
      paintPage(progress, true);
      paintSheet(progress);
      const nextArmed = progress >= COMMIT_RATIO;
      setArmed((current) => (current === nextArmed ? current : nextArmed));
    },
    [paintPage, paintSheet],
  );

  const finish = useCallback(
    (commit: boolean) => {
      const wasActive = activeRef.current;
      activeRef.current = false;
      setArmed(false);
      const panel = previewTarget.current;

      // A page-level preview only decorates the drag. Drop it before the layer
      // dismisses, otherwise it stays mounted for the frames between the layer
      // unmounting and the timers firing — that is the green flash after a
      // committed back gesture.
      if (commit && pagePreviewRef.current) {
        clearSettle();
        paintPage(0, false);
        setActive(false);
        commitRef.current();
        return;
      }

      // Committing an overlay gesture: finish the peel-out from where the finger
      // left it, then dismiss the layer. Snapping back to the resting size for a
      // frame is what produced the "ghost at half size, full sheet flashes, then
      // gone" artefact.
      if (commit && panel && !pagePreviewRef.current) {
        clearSettle();
        const parent = panel.parentElement;
        panel.style.animation = 'none';
        parent && (parent.style.animation = 'none');
        // Force a style flush so the transition starts from the dragged value.
        void panel.offsetWidth;
        panel.style.transition = 'translate 190ms cubic-bezier(0.4, 0, 0.2, 1), opacity 190ms linear';
        panel.style.translate =
          previewMode.current === 'down' ? '0 100%' : previewMode.current === 'left' ? '-110% 0' : '110% 0';
        panel.style.opacity = '0';
        if (parent) {
          parent.style.setProperty('--sheet-progress', '1');
          const scrim = parent.querySelector<HTMLElement>('.entry-sheet__scrim, .date-picker__scrim');
          if (scrim) {
            scrim.style.transition = 'opacity 190ms linear';
            scrim.style.opacity = '0';
          } else {
            parent.style.transition = 'background-color 190ms linear';
            parent.style.background = 'transparent';
            parent.style.backdropFilter = 'none';
          }
        }
        leaveTimer.current = window.setTimeout(() => {
          leaveTimer.current = null;
          commitRef.current();
          // The layer unmounts itself; clean up once it is gone.
          settleTimer.current = window.setTimeout(() => {
            settleTimer.current = null;
            clearPreviewTarget();
            paintPage(0, false);
            setActive(false);
          }, LEAVE_CLEANUP_MS);
        }, LEAVE_MS);
        return;
      }

      paintPage(0, false);
      clearPreviewTarget();
      if (wasActive) {
        if (commit) setActive(false);
        else {
          // Keep the preview mounted while the card settles back into place.
          clearSettle();
          settleTimer.current = window.setTimeout(() => {
            settleTimer.current = null;
            setActive(false);
          }, SETTLE_MS);
        }
      }
      if (commit) commitRef.current();
    },
    [clearPreviewTarget, clearSettle, paintPage],
  );

  // Bridge consumed by MainActivity: the native back callback drives the same
  // preview states the web pointer fallback drives.
  useEffect(() => {
    const bridge = window as unknown as BackBridge;
    bridge.__ledgerBackStart = begin;
    bridge.__ledgerBackProgress = update;
    bridge.__ledgerBackCancel = () => finish(false);
    bridge.__ledgerBack = () => {
      finish(true);
      return true;
    };
    return () => {
      delete bridge.__ledgerBackStart;
      delete bridge.__ledgerBackProgress;
      delete bridge.__ledgerBackCancel;
      delete bridge.__ledgerBack;
      clearSettle();
    };
  }, [begin, clearSettle, finish, update]);

  // Web: emulate the system gesture with pointer events on the left edge.
  useEffect(() => {
    if (isNativePlatform()) return;

    let pointerId: number | null = null;
    let startX = 0;
    let startY = 0;
    let travel = 0;
    let engaged = false;

    const maxTravel = () => Math.max(MIN_TRAVEL, window.innerWidth * MAX_TRAVEL_RATIO);

    const endPointer = (commit: boolean) => {
      if (pointerId === null) return;
      pointerId = null;
      engaged = false;
      finish(commit);
    };

    const handleDown = (event: PointerEvent) => {
      if (!previewRef.current || pointerId !== null || event.button !== 0) return;
      if (event.clientX > EDGE_WIDTH) return;
      pointerId = event.pointerId;
      startX = event.clientX;
      startY = event.clientY;
      travel = 0;
      engaged = false;
    };

    const handleMove = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) return;
      const dx = event.clientX - startX;
      const dy = event.clientY - startY;
      if (!engaged) {
        if (dx < 8) {
          if (Math.abs(dy) > 16) endPointer(false);
          return;
        }
        if (Math.abs(dy) > Math.abs(dx) * 1.1) {
          endPointer(false);
          return;
        }
        engaged = true;
        begin();
      }
      travel = Math.max(0, dx);
      update(Math.min(1, travel / maxTravel()));
    };

    const handleUp = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) return;
      endPointer(travel / maxTravel() >= COMMIT_RATIO);
    };

    const handleCancel = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) return;
      endPointer(false);
    };

    document.addEventListener('pointerdown', handleDown, true);
    document.addEventListener('pointermove', handleMove, { capture: true, passive: true });
    document.addEventListener('pointerup', handleUp, true);
    document.addEventListener('pointercancel', handleCancel, true);

    return () => {
      document.removeEventListener('pointerdown', handleDown, true);
      document.removeEventListener('pointermove', handleMove, true);
      document.removeEventListener('pointerup', handleUp, true);
      document.removeEventListener('pointercancel', handleCancel, true);
    };
  }, [begin, finish, update]);

  return { active, armed };
}