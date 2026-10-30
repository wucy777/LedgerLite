import { useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon, type UIIconName } from '../../components/Icon';
import { useDismissTransition, useOverlayLayer } from './overlay';

export interface DialogProps {
  title: string;
  eyebrow?: string;
  icon?: UIIconName;
  tone?: 'default' | 'danger';
  size?: 'sm' | 'md';
  children?: ReactNode;
  footer?: ReactNode;
  dismissOnBackdrop?: boolean;
  onClose: () => void;
}

export function Dialog({
  title,
  eyebrow,
  icon,
  tone = 'default',
  size = 'sm',
  children,
  footer,
  dismissOnBackdrop = true,
  onClose,
}: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const bodyId = useId();
  const { closing, requestClose } = useDismissTransition(onClose);
  useOverlayLayer(panelRef, requestClose);

  return createPortal(
    <div
      className={`settings-overlay settings-overlay--dialog${closing ? ' is-closing' : ''}`}
      data-settings-overlay="dialog"
      onMouseDown={(event) => {
        if (dismissOnBackdrop && event.target === event.currentTarget) requestClose();
      }}
    >
      <div
        ref={panelRef}
        className={`settings-dialog settings-dialog--${size}${tone === 'danger' ? ' settings-dialog--danger' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        tabIndex={-1}
      >
        <header className="settings-dialog__head">
          <span className="settings-dialog__icon" aria-hidden="true">
            <Icon name={icon ?? (tone === 'danger' ? 'alert' : 'info')} size={19} />
          </span>
          <div className="settings-dialog__titles">
            {eyebrow ? <p className="settings-dialog__eyebrow">{eyebrow}</p> : null}
            <h2 id={titleId}>{title}</h2>
          </div>
          <button type="button" className="settings-dialog__close" aria-label="关闭对话框" onClick={requestClose}>
            <Icon name="close" size={17} />
          </button>
        </header>
        <div className="settings-dialog__body" id={bodyId}>
          {children}
        </div>
        {footer ? <footer className="settings-dialog__footer">{footer}</footer> : null}
      </div>
    </div>,
    document.body,
  );
}
