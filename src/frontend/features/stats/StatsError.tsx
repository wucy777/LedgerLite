import { Icon } from '../../components/Icon';

interface StatsErrorProps {
  message: string | null;
  onRetry: () => void;
}

export function StatsError({ message, onRetry }: StatsErrorProps) {
  return (
    <div className="stats-error" role="alert">
      <span className="stats-error__icon">
        <Icon name="alert" size={22} />
      </span>
      <h2 className="stats-error__title">统计没能载入</h2>
      <p className="stats-error__message">{message ?? '本地数据服务暂时不可用，请稍后再试。'}</p>
      <button type="button" className="stats-retry" onClick={onRetry}>
        <Icon name="refresh" size={15} />
        重新加载
      </button>
    </div>
  );
}
