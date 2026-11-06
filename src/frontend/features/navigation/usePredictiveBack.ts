import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { Capacitor } from '@capacitor/core';

const EDGE_WIDTH = 22;
const COMMIT_RATIO = 0.32;
const MIN_TRAVEL = 160;
const MAX_TRAVEL_RATIO = 0.42;
const SETTLE_MS = 200;

interface Options {
  /** Runs when a back gesture commits (system gesture, edge swipe or hardware key). */
  onCommit: () => void;
  /** Whether the current screen has a destination worth previewing. */
  previewEnabled: boolean;
  /** Element that receives `--back-progress` and the `is-back-gesturing` class. */
  targetRef: RefObject<HTMLElement | null>;
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
 * `OnBackAnimationCallback`; `MainActivity` forwards it to the small
 * `__ledgerBack*` bridge below. On the web an equivalent pointer gesture on the
 * left edge produces the same calls. Progress is written straight to the DOM,
 * so dragging never re-renders React.
 */
export function usePredictiveBack({ onCommit, previewEnabled, targetRef }: Options): PredictiveBackState {
  const [active, setActive] = useState(false);
  const [armed, setArmed] = useState(false);
  const commitRef = useRef(onCommit);
  commitRef.current = onCommit;
  const previewRef = useRef(previewEnabled);
  previewRef.current = previewEnabled;
  const settleTimer = useRef<number | null>(null);
  const activeRef = useRef(false);

  const paint = useCallback(
    (progress: number, gesturing: boolean) => {
      const target = targetRef.current;
      if (!target) return;
      target.style.setProperty('--back-progress', progress.toFixed(4));
      target.classList.toggle('is-back-gesturing', gesturing);
    },
    [targetRef],
  );

  const clearSettle = useCallback(() => {
    if (settleTimer.current === null) return;
    window.clearTimeout(settleTimer.current);
    settleTimer.current = null;
  }, []);

  const begin = useCallback(() => {
    if (!previewRef.current) return;
    clearSettle();
    activeRef.current = true;
    setActive(true);
  }, [clearSettle]);

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
    [clearSettle, paint],
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
