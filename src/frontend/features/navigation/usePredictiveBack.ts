import { useCallback, useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { getTopBackElement } from '../settings/overlay';

const EDGE_WIDTH = 22;
const COMMIT_RATIO = 0.32;
const MIN_TRAVEL = 160;
const MAX_TRAVEL_RATIO = 0.42;
const SETTLE_MS = 200;

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
  __ledgerBackStart?: () => void;
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

/**
 * Predictive back, following Android's own gesture model.
 *
 * On Android the system owns the edge swipe and streams its progress through
 * `OnBackPressedCallback`; `MainActivity` forwards it to the small
 * `__ledgerBack*` bridge below. On the web an equivalent pointer gesture on the
 * left edge produces the same calls.
 *
 * Progress is written straight to the DOM — one custom property plus two
 * classes — so dragging never re-renders React. The property lives on `<html>`
 * and inherits into portalled overlays, which lets a sheet preview its own
 * dismissal while the page-level card lift stays a separate class.
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
  const activeRef = useRef(false);
  const previewTarget = useRef<HTMLElement | null>(null);

  const paint = useCallback((progress: number, gesturing: boolean) => {
    const root = document.documentElement;
    if (gesturing) root.style.setProperty('--back-progress', progress.toFixed(4));
    else root.style.removeProperty('--back-progress');
    root.classList.toggle('is-back-gesturing', gesturing);
    root.classList.toggle('is-page-preview', gesturing && pagePreviewRef.current);
  }, []);

  const clearPreviewTarget = useCallback(() => {
    const target = previewTarget.current;
    if (target) {
      target.classList.remove('is-back-preview');
      // The entrance animation is restored so the sheet can animate out normally.
      target.parentElement?.classList.remove('is-back-root');
    }
    previewTarget.current = null;
  }, []);

  const clearSettle = useCallback(() => {
    if (settleTimer.current === null) return;
    window.clearTimeout(settleTimer.current);
    settleTimer.current = null;
  }, []);

  const begin = useCallback(() => {
    if (!previewRef.current) return;
    clearSettle();
    clearPreviewTarget();
    // Overlays preview their own dismissal; only a page-level back lifts the card.
    if (!pagePreviewRef.current) {
      const element = getTopBackElement();
      if (element) {
        element.classList.add('is-back-preview');
        // The panel's container owns the scrim, which fades out with the gesture.
        element.parentElement?.classList.add('is-back-root');
        previewTarget.current = element;
      }
    }
    activeRef.current = true;
    setActive(true);
  }, [clearPreviewTarget, clearSettle]);

  const update = useCallback(
    (progress: number) => {
      if (!previewRef.current) return;
      paint(progress, true);
      const nextArmed = progress >= COMMIT_RATIO;
      setArmed((current) => (current === nextArmed ? current : nextArmed));
    },
    [paint],
  );

  const finish = useCallback(
    (commit: boolean) => {
      const wasActive = activeRef.current;
      activeRef.current = false;
      setArmed(false);
      paint(0, false);
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
    [clearPreviewTarget, clearSettle, paint],
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
