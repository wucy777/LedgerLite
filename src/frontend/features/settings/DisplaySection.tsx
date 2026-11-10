import { Icon } from '../../components/Icon';
import { useHighRefreshPreference } from './display-mode';

/** Display preference section: high refresh rate motion profile. */
export function DisplaySection() {
  const { enabled, supported, toggle } = useHighRefreshPreference();

  return (
    <section className="settings-section" aria-labelledby="settings-display-heading">
      <div className="settings-section__head">
        <h2 id="settings-display-heading">显示</h2>
        <span>动画与刷新率</span>
      </div>
      <div className="settings-card settings-rows">
        <div className="settings-row">
          <span className="settings-row__icon">
            <Icon name="zap" size={17} />
          </span>
          <div className="settings-row__copy">
            <span className="settings-row__title">高刷新率</span>
            <span className="settings-row__desc">
              {supported
                ? '请求屏幕最高刷新率，并改用更短、无回弹的动效与更轻的毛玻璃，滑动更跟手。'
                : '当前环境无法切换刷新率，开关仅缩短动画时长。'}
            </span>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            aria-label="高刷新率"
            className={`settings-switch${enabled ? ' is-on' : ''}`}
            onClick={toggle}
          >
            <span className="settings-switch__thumb" />
          </button>
        </div>
      </div>
    </section>
  );
}
