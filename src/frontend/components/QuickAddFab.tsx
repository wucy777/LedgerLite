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

const FLOAT_SIZE = 56;
const DOCK_SIZE = 44;
const EDGE = 18;
const NAV_GAP = 12;
const DOCK_RIGHT = 10;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function findTabbar(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.tabbar');
}

function floatingPosition(nav: HTMLElement | null): { left: number; top: number } {
  const navRect = nav?.getBoundingClientRect();
  const top = navRect ? navRect.top - NAV_GAP - FLOAT_SIZE : window.innerHeight - 160;
  return {
    left: Math.max(8, window.innerWidth - EDGE - FLOAT_SIZE),
    top: Math.max(12, top),
  };
}

function dockedPosition(nav: HTMLElement): { left: number; top: number } {
  const rect = nav.getBoundingClientRect();
  return {
    left: rect.right - DOCK_RIGHT - DOCK_SIZE,
    top: rect.top + (rect.height - DOCK_SIZE) / 2,
  };
}

/**
 * A press-and-drag quick-add control. It starts floating above the bottom
 * navigation and docks into its right edge when dropped on the bar. No long
 * press is required: the drag threshold is only a few pixels.
 */
export function QuickAddFab({ docked, onDockChange, onAdd }: QuickAddFabProps) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const suppressClickRef = useRef(false);
  const animationTimerRef = useRef<number | null>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [dropTarget, setDropTarget] = useState(false);
  const [animation, setAnimation] = useState<'dock' | 'undock' | null>(null);

  const setDropTargetClass = (active: boolean) => {
    findTabbar()?.classList.toggle('is-fab-drop-target', active);
  };

  const playAnimation = (kind: 'dock' | 'undock') => {
    const nav = findTabbar();
    nav?.classList.remove('is-fab-docking', 'is-fab-undocking');
    nav?.classList.add(kind === 'dock' ? 'is-fab-docking' : 'is-fab-undocking');
    setAnimation(kind);
    if (animationTimerRef.current !== null) window.clearTimeout(animationTimerRef.current);
    animationTimerRef.current = window.setTimeout(() => {
      nav?.classList.remove('is-fab-docking', 'is-fab-undocking');
      setAnimation(null);
    }, 360);
  };

  useLayoutEffect(() => {
    const nav = findTabbar();
    setPosition(docked && nav ? dockedPosition(nav) : floatingPosition(nav));
  }, []);

  useEffect(() => {
    return () => {
      setDropTargetClass(false);
      findTabbar()?.classList.remove('is-fab-docking', 'is-fab-undocking');
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
    const nav = findTabbar();
    const navRect = nav?.getBoundingClientRect();
    const next = {
      left: clamp(event.clientX - FLOAT_SIZE / 2, 8, window.innerWidth - FLOAT_SIZE - 8),
      top: clamp(event.clientY - FLOAT_SIZE / 2, 8, window.innerHeight - FLOAT_SIZE - 8),
    };
    setPosition(next);

    const shouldHighlight =
      !!navRect &&
      event.clientX >= navRect.left - 16 &&
      event.clientX <= navRect.right + 16 &&
      event.clientY >= navRect.top - 28;
    if (shouldHighlight !== dropTarget) {
      setDropTarget(shouldHighlight);
      setDropTargetClass(shouldHighlight);
    }
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
          left: clamp(current.left, 8, window.innerWidth - FLOAT_SIZE - 8),
          top: clamp(current.top, 8, window.innerHeight - FLOAT_SIZE - 8),
        };
      });
    }
    setDropTarget(false);
    setDropTargetClass(false);
    window.setTimeout(() => {
      suppressClickRef.current = false;
    }, 80);
  };

  const handleClick = () => {
    if (suppressClickRef.current) return;
    onAdd();
  };

  const size = docked ? DOCK_SIZE : FLOAT_SIZE;
  const nav = findTabbar();
  const navRect = nav?.getBoundingClientRect();
  const showMembrane = Boolean(position && navRect && (dropTarget || animation));

  return (
    <>
      <svg className="quick-add__filter-defs" aria-hidden="true" focusable="false">
        <defs>
          <filter id="quick-add-goo" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="5" result="blur" />
            <feColorMatrix
              in="blur"
              mode="matrix"
              values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 18 -7"
              result="goo"
            />
          </filter>
        </defs>
      </svg>
      {showMembrane && position && navRect ? (
        <div className="quick-add__goo" aria-hidden="true">
          <span
            className="quick-add__goo-nav"
            style={{
              left: navRect.left,
              top: navRect.top,
              width: navRect.width,
              height: navRect.height,
            }}
          />
          <span
            className="quick-add__goo-fab"
            style={{
              left: position.left - 16,
              top: position.top - 16,
              width: size + 32,
              height: size + 32,
              borderRadius: docked ? 30 : '50%',
            }}
          />
        </div>
      ) : null}
      <button
        ref={buttonRef}
        type="button"
        className={`quick-add${docked ? ' is-docked' : ''}${dragging ? ' is-dragging' : ''}${
          dropTarget ? ' is-near-dock' : ''
        }${animation ? ` is-${animation}ing` : ''}`}
        style={position ? { left: position.left, top: position.top, width: size, height: size } : undefined}
        aria-label="记一笔，按住可拖动，拖到底部导航栏可入栏"
        title="记一笔 · 按住拖动"
        onClick={handleClick}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={(event) => finishDrag(event, false)}
        onPointerCancel={(event) => finishDrag(event, true)}
      >
        <Icon name="plus" size={docked ? 21 : 23} strokeWidth={2.1} />
      </button>
    </>
  );
}
