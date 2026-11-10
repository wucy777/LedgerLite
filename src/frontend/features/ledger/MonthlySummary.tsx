import type { MonthSummary } from '@shared/types';
import { daysInMonth, monthLabel, parseMonthKey } from '@shared/date';
import { formatCents, formatMoney } from '@shared/money';

interface MonthlySummaryProps {
  summary: MonthSummary;
  activeDays: number;
}

/** The month's visual anchor: a deep-green, paper-edged summary card. */
export function MonthlySummary({ summary, activeDays }: MonthlySummaryProps) {
  const { year, monthIndex } = parseMonthKey(summary.month);
  const monthDays = daysInMonth(summary.month);

  return (
    <section className="ledger-hero" aria-label={`${monthLabel(summary.month)}月度摘要`}>
      <div className="ledger-hero__top">
        <div className="ledger-hero__lead">
          <p className="ledger-hero__eyebrow">本月支出</p>
          <p className="ledger-hero__amount num">
            <span className="ledger-hero__currency" aria-hidden="true">
              ¥
            </span>
            {formatCents(summary.expenseCents)}
          </p>
        </div>
        <div className="ledger-hero__stamp" aria-hidden="true">
          <span className="ledger-hero__stamp-month">{String(monthIndex + 1).padStart(2, '0')}</span>
          <span className="ledger-hero__stamp-year">{year}</span>
        </div>
      </div>

      <dl className="ledger-hero__stats">
        <div className="ledger-hero__stat">
          <dt>收入</dt>
          <dd className="num">{formatMoney(summary.incomeCents, { sign: 'always' })}</dd>
        </div>
        <div className="ledger-hero__stat">
          <dt>结余</dt>
          <dd className={`num ${summary.balanceCents < 0 ? 'is-negative' : ''}`}>
            {formatMoney(summary.balanceCents, { sign: 'always' })}
          </dd>
        </div>
      </dl>

      <p className="ledger-hero__foot">
        <span>
          共 <strong>{summary.entryCount}</strong> 笔
        </span>
        <span className="ledger-hero__dot" aria-hidden="true" />
        <span>
          本月 {activeDays} / {monthDays} 天有记录
        </span>
      </p>
    </section>
  );
}
