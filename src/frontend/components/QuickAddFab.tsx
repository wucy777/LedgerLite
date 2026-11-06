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
  /** Where the button sat when the drag began, in viewport coordinates. */
  originLeft: number;
  originTop: number;
  left: number;
  top: number;
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
 * Press-and-drag quick-add control. It follows the finger into the navigation
 * bar, highlights the bar as a drop target, and docks into its right slot.
 * The navigation reserves space for the button while it is docked.
 */
export function QuickAddFab({ docked, onDockChange, onAdd }: QuickAddFabProps) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const suppressClickRef = useRef(false);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [dropTarget, setDropTarget] = useState(false);

  const setDropTargetClass = (active: boolean) => {
    findTabbar()?.classList.toggle('is-fab-drop-target', active);
  };

  useLayoutEffect(() => {
    const nav = findTabbar();
    setPosition(docked && nav ? dockedPosition(nav) : floatingPosition(nav));
  }, []);

  useEffect(() => {
    return () => setDropTargetClass(false);
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
    const rect = button.getBoundingClientRect();
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
      wasDocked: docked,
      originLeft: rect.left,
      originTop: rect.top,
      left: rect.left,
      top: rect.top,
    };
    suppressClickRef.current = false;
    button.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const button = buttonRef.current;
    if (!button) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;

    if (!drag.moved) {
      drag.moved = true;
      setDragging(true);
      suppressClickRef.current = true;
      if (drag.wasDocked) onDockChange(false);
    }

    event.preventDefault();
    // Written straight to the element: going through state would re-render the
    // tree on every pointermove, which is exactly what makes a drag trail a
    // 120 Hz finger.
    const left = clamp(event.clientX - FLOAT_SIZE / 2, 8, window.innerWidth - FLOAT_SIZE - 8);
    const top = clamp(event.clientY - FLOAT_SIZE / 2, 8, window.innerHeight - FLOAT_SIZE - 8);
    drag.left = left;
    drag.top = top;
    button.style.transform = `translate3d(${left - drag.originLeft}px, ${top - drag.originTop}px, 0)`;

    const navRect = findTabbar()?.getBoundingClientRect();
    const shouldHighlight =
      !!navRect &&
      event.clientX >= navRect.left - 12 &&
      event.clientX <= navRect.right + 12 &&
      event.clientY >= navRect.top - 12;
    if (shouldHighlight !== dropTarget) {
      setDropTarget(shouldHighlight);
      setDropTargetClass(shouldHighlight);
    }
  };

  const finishDrag = (event: ReactPointerEvent<HTMLButtonElement>, canceled: boolean) => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    const button = buttonRef.current;
    // The drag moved the button with a transform; drop it before committing the
    // final position so the element never jumps twice.
    if (button) button.style.transform = '';
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
      event.clientX >= navRect.left - 12 &&
      event.clientX <= navRect.right + 12 &&
      event.clientY >= navRect.top - 12;

    if (shouldDock && nav) {
      onDockChange(true);
      setPosition(dockedPosition(nav));
    } else {
      // `drag` holds the last painted position, so no state has to be read back.
      setPosition({
        left: clamp(drag.left, 8, window.innerWidth - FLOAT_SIZE - 8),
        top: clamp(drag.top, 8, window.innerHeight - FLOAT_SIZE - 8),
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

  return (
    <button
      ref={buttonRef}
      type="button"
      className={`quick-add${docked ? ' is-docked' : ''}${dragging ? ' is-dragging' : ''}`}
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
  );
}
