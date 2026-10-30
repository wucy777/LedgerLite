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
        aria-label={`${monthLabel(month)}，回到本月`}
        onClick={() => onChange(current)}
      >
        <span>{monthLabel(month)}</span>
        {month !== current ? <span className="month-switcher__back">本月</span> : null}
      </button>
      <button
        type="button"
        className="month-switcher__arrow"
        aria-label="下个月"
        onClick={() => onChange(shiftMonth(month, 1))}
      >
        <Icon name="chevron-right" size={18} />
      </button>
    </div>
  );
}
