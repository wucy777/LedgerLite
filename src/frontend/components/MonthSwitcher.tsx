import { currentMonthKey, monthLabel, shiftMonth } from '@shared/date';
import { Icon } from './Icon';

interface MonthSwitcherProps {
  month: string;
  onChange: (month: string) => void;
  tone?: 'default' | 'dark';
  align?: 'left' | 'center';
}

export function MonthSwitcher({ month, onChange, tone = 'default', align = 'left' }: MonthSwitcherProps) {
  const current = currentMonthKey();
  const isCurrent = month === current;
  return (
    <div className={`month-switcher month-switcher--${tone} month-switcher--${align}`}>
      <button
        type="button"
        className="month-switcher__arrow"
        aria-label="上个月"
        onClick={() => onChange(shiftMonth(month, -1))}
      >
        <Icon name="chevron-left" size={18} />
      </button>
      <button
        type="button"
        className="month-switcher__label"
        aria-label={isCurrent ? `${monthLabel(month)}，当前月份` : `${monthLabel(month)}，回到本月`}
        onClick={() => onChange(current)}
      >
        <span className="month-switcher__month">{monthLabel(month)}</span>
        {isCurrent ? <span className="month-switcher__current">本月</span> : null}
      </button>
      <button
        type="button"
        className="month-switcher__arrow"
        aria-label="下个月"
        onClick={() => onChange(shiftMonth(month, 1))}
      >
        <Icon name="chevron-right" size={18} />
      </button>
      {isCurrent ? null : (
        <button
          type="button"
          className="month-switcher__today"
          aria-label="回到本月"
          title="回到本月"
          onClick={() => onChange(current)}
        >
          <Icon name="refresh" size={13} />
          <span className="month-switcher__today-text">回本月</span>
        </button>
      )}
    </div>
  );
}
