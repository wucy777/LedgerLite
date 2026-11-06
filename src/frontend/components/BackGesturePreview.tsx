import { Icon, type UIIconName } from './Icon';
import '../styles/back-gesture.css';

interface BackGesturePreviewProps {
  label: string;
  detail: string;
  icon?: UIIconName;
  armed: boolean;
}

/**
 * Destination screen revealed behind the current page while the edge-swipe
 * gesture is in progress. It mirrors Android's predictive back: the panel
 * follows the finger through `--back-progress`, the current page shrinks into a
 * card on top, and a cancelled gesture retracts everything again.
 */
export function BackGesturePreview({ label, detail, icon = 'chevron-left', armed }: BackGesturePreviewProps) {
  return (
    <div className="back-gesture" aria-hidden="true">
      <div className="back-gesture__panel">
        <span className="back-gesture__eyebrow">返回</span>
        <span className="back-gesture__label">
          <Icon name={icon} size={20} />
          {label}
        </span>
        <span className="back-gesture__detail">{detail}</span>
        <span className={`back-gesture__hint${armed ? ' is-armed' : ''}`}>
          {armed ? '松手返回' : '继续滑动'}
        </span>
      </div>
    </div>
  );
}
