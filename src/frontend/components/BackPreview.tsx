import { Icon, type UIIconName } from './Icon';
import '../styles/back-preview.css';

export interface BackPreviewState {
  label: string;
  icon?: UIIconName;
}

interface BackPreviewProps {
  preview: BackPreviewState | null;
}

/** A short destination preview shown before the system back action runs. */
export function BackPreview({ preview }: BackPreviewProps) {
  if (!preview) return null;
  return (
    <div className="back-preview" role="status" aria-live="polite">
      <span className="back-preview__icon" aria-hidden="true">
        <Icon name={preview.icon ?? 'chevron-left'} size={15} />
      </span>
      <span>{preview.label}</span>
    </div>
  );
}
