import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { getTopBackHandler } from '../settings/overlay';

const EDGE_WIDTH = 22;
const COMMIT_RATIO = 0.32;
const MIN_TRAVEL = 160;
const MAX_TRAVEL_RATIO = 0.42;
const SETTLE_MS = 200;

interface Options {
  /** Runs when the gesture is released past the commit threshold. */
  onCommit: () => void;
  /** Keeps the gesture inert when there is nowhere to go back to. */
  enabled: boolean;
  /** Element that receives `--back-progress` and the `is-back-gesturing` class. */
  targetRef: RefObject<HTMLElement | null>;
}

export interface EdgeBackGesture {
  active: boolean;
  armed: boolean;
}

/**
 * Edge-swipe back gesture that reports live progress, mirroring Android's
 * predictive back: the destination is revealed while the finger moves, the
 * release commits, and sliding back retracts it. Progress is written straight
 * to the DOM so dragging never re-renders React.
 */
export function useEdgeBackGesture({ onCommit, enabled, targetRef }: Options): EdgeBackGesture {
  const [active, setActive] = useState(false);
  const [armed, setArmed] = useState(false);
  const commitRef = useRef(onCommit);
  commitRef.current = onCommit;
  const settleTimer = useRef<number | null>(null);

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

  useEffect(() => {
    if (!enabled) {
      clearSettle();
      paint(0, false);
      setActive(false);
      setArmed(false);
      return;
    }

    let pointerId: number | null = null;
    let startX = 0;
    let startY = 0;
    let travel = 0;
    let engaged = false;
    let armedNow = false;

    const maxTravel = () => Math.max(MIN_TRAVEL, window.innerWidth * MAX_TRAVEL_RATIO);

    const finish = (commit: boolean) => {
      if (pointerId === null) return;
      pointerId = null;
      engaged = false;
      armedNow = false;
      setArmed(false);
      paint(0, false);
      if (commit) {
        setActive(false);
        commitRef.current();
        return;
      }
      // Keep the preview mounted while the panel slides back out.
      clearSettle();
      settleTimer.current = window.setTimeout(() => {
        settleTimer.current = null;
        setActive(false);
      }, SETTLE_MS);
    };

    const handleDown = (event: PointerEvent) => {
      if (pointerId !== null || event.button !== 0) return;
      // Modal layers own back while they are open.
      if (getTopBackHandler()) return;
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
          if (Math.abs(dy) > 16) finish(false);
          return;
        }
        if (Math.abs(dy) > Math.abs(dx) * 1.1) {
          finish(false);
          return;
        }
        engaged = true;
        clearSettle();
        setActive(true);
      }
      travel = Math.max(0, dx);
      const progress = Math.min(1, travel / maxTravel());
      paint(progress, true);
      const nextArmed = progress >= COMMIT_RATIO;
      if (nextArmed !== armedNow) {
        armedNow = nextArmed;
        setArmed(nextArmed);
      }
    };

    const handleUp = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) return;
      finish(travel / maxTravel() >= COMMIT_RATIO);
    };

    const handleCancel = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) return;
      finish(false);
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
      clearSettle();
    };
  }, [clearSettle, enabled, paint]);

  return { active, armed };
}
