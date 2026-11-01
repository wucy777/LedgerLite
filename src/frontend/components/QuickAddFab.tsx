import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { Icon } from './Icon';
import '../styles/quick-add.css';

interface QuickAddFabProps {
  docked: boolean;
  onDockChange: (docked: boolean) => void;
  onAdd: () => void;
}

interface DragState {
  pointerId: number;
  startX: number;
  startY: number;
  moved: boolean;
  wasDocked: boolean;
}

const SIZE = 56;
const EDGE = 18;
const NAV_GAP = 12;
const DOCK_FROM_RIGHT = 48;
const DOCK_ABOVE_NAV = 24;
const NECK_WIDTH = 104;
const NECK_HEIGHT = 40;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function findTabbar(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.tabbar');
}

function floatingPosition(nav: HTMLElement | null): { left: number; top: number } {
  const navRect = nav?.getBoundingClientRect();
  const top = navRect ? navRect.top - NAV_GAP - SIZE : window.innerHeight - 160;
  return {
    left: Math.max(8, window.innerWidth - EDGE - SIZE),
    top: Math.max(12, top),
  };
}

function dockedPosition(nav: HTMLElement): { left: number; top: number } {
  const rect = nav.getBoundingClientRect();
  return {
    left: rect.right - DOCK_FROM_RIGHT - SIZE / 2,
    top: rect.top - DOCK_ABOVE_NAV,
  };
}

/**
 * Press-and-drag quick-add control. It follows the finger into the navigation
 * bar and docks into a rounded fusion neck cut into the top edge of the bar.
 */
export function QuickAddFab({ docked, onDockChange, onAdd }: QuickAddFabProps) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const suppressClickRef = useRef(false);
  const animationTimerRef = useRef<number | null>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [animation, setAnimation] = useState<'dock' | 'undock' | null>(null);

  const playAnimation = (kind: 'dock' | 'undock') => {
    setAnimation(kind);
    if (animationTimerRef.current !== null) window.clearTimeout(animationTimerRef.current);
    animationTimerRef.current = window.setTimeout(() => setAnimation(null), 360);
  };

  useLayoutEffect(() => {
    const nav = findTabbar();
    setPosition(docked && nav ? dockedPosition(nav) : floatingPosition(nav));
  }, []);

  useEffect(() => {
    return () => {
      if (animationTimerRef.current !== null) window.clearTimeout(animationTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const handleResize = () => {
      if (dragRef.current) return;
      const nav = findTabbar();
      if (!nav) return;
      setPosition(docked ? dockedPosition(nav) : floatingPosition(nav));
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [docked]);

  const handlePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const button = buttonRef.current;
    if (!button) return;
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
      wasDocked: docked,
    };
    suppressClickRef.current = false;
    button.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;

    if (!drag.moved) {
      drag.moved = true;
      setDragging(true);
      suppressClickRef.current = true;
      if (drag.wasDocked) {
        onDockChange(false);
        playAnimation('undock');
      }
    }

    event.preventDefault();
    if (event.cancelable) event.preventDefault();
    setPosition({
      left: clamp(event.clientX - SIZE / 2, 8, window.innerWidth - SIZE - 8),
      top: clamp(event.clientY - SIZE / 2, 8, window.innerHeight - SIZE - 8),
    });
  };

  const finishDrag = (event: ReactPointerEvent<HTMLButtonElement>, canceled: boolean) => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    if (!drag.moved) {
      setDragging(false);
      return;
    }

    setDragging(false);
    const nav = findTabbar();
    const navRect = nav?.getBoundingClientRect();
    const shouldDock =
      !canceled &&
      !!nav &&
      !!navRect &&
      event.clientX >= navRect.left - 16 &&
      event.clientX <= navRect.right + 16 &&
      event.clientY >= navRect.top - 28;

    if (shouldDock && nav) {
      onDockChange(true);
      setPosition(dockedPosition(nav));
      playAnimation('dock');
    } else {
      setPosition((current) => {
        if (!current) return current;
        return {
          left: clamp(current.left, 8, window.innerWidth - SIZE - 8),
          top: clamp(current.top, 8, window.innerHeight - SIZE - 8),
        };
      });
    }
    window.setTimeout(() => {
      suppressClickRef.current = false;
    }, 80);
  };

  const handleClick = () => {
    if (suppressClickRef.current) return;
    onAdd();
  };

  const nav = findTabbar();
  const navRect = nav?.getBoundingClientRect();
  const neck =
    navRect && (docked || animation)
      ? {
          left: navRect.right - DOCK_FROM_RIGHT - NECK_WIDTH / 2,
          top: navRect.top - NECK_HEIGHT + 2,
        }
      : null;

  return (
    <>
      {neck ? (
        <svg
          className={`quick-add__neck${animation ? ` is-${animation}ing` : ''}`}
          style={{ left: neck.left, top: neck.top }}
          width={NECK_WIDTH}
          height={NECK_HEIGHT}
          viewBox={`0 0 ${NECK_WIDTH} ${NECK_HEIGHT}`}
          aria-hidden="true"
        >
          <path
            className="quick-add__neck-fill"
            d="M4 40 C 18 40 16 27 30 18 C 38 12 45 9 52 9 C 59 9 66 12 74 18 C 88 27 86 40 100 40 Z"
          />
          <path
            className="quick-add__neck-line"
            d="M4 40 C 18 40 16 27 30 18 C 38 12 45 9 52 9 C 59 9 66 12 74 18 C 88 27 86 40 100 40"
          />
        </svg>
      ) : null}
      <button
        ref={buttonRef}
        type="button"
        className={`quick-add${docked ? ' is-docked' : ''}${dragging ? ' is-dragging' : ''}${
          animation ? ` is-${animation}ing` : ''
        }`}
        style={position ? { left: position.left, top: position.top, width: SIZE, height: SIZE } : undefined}
        aria-label="记一笔，按住可拖动，拖到底部导航栏可入栏"
        title="记一笔 · 按住拖动"
        onClick={handleClick}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={(event) => finishDrag(event, false)}
        onPointerCancel={(event) => finishDrag(event, true)}
      >
        <Icon name="plus" size={23} strokeWidth={2.1} />
      </button>
    </>
  );
}
