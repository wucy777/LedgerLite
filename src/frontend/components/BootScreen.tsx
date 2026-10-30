import { BrandMark } from './BrandMark';

interface BootScreenProps {
  error?: string | null;
  onRetry?: () => void;
}

export function BootScreen({ error, onRetry }: BootScreenProps) {
  return (
    <div className="boot-screen">
      <div className="boot-screen__glow" aria-hidden="true" />
      <div className="boot-screen__center">
        <div className="boot-screen__mark">
          <BrandMark size={76} />
        </div>
        <div className="boot-screen__name">简账</div>
        <p className="boot-screen__tagline">每一笔，都有迹可循</p>
        {error ? (
          <div className="boot-screen__error" role="alert">
            <p>{error}</p>
            {onRetry ? (
              <button type="button" className="secondary-button" onClick={onRetry}>
                重新尝试
              </button>
            ) : null}
          </div>
        ) : (
          <div className="boot-screen__loader" aria-label="正在加载本地账本">
            <span />
          </div>
        )}
      </div>
    </div>
  );
}
