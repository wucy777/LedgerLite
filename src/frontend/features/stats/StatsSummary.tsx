import { formatMonthDay } from '@shared/date';
import { formatMoney } from '@shared/money';
import type { MonthStats } from '@shared/types';
import { Icon } from '../../components/Icon';

interface StatsSummaryProps {
  stats: MonthStats;
}

export function StatsSummary({ stats }: StatsSummaryProps) {
  const negative = stats.netCents < 0;

  return (
    <section className="stats-summary" aria-label="月度摘要">
      <div className="stats-summary__top">
        <span className="stats-summary__label">本月支出</span>
        <span className="stats-summary__count">{stats.entryCount} 笔记录</span>
      </div>

      <p className="stats-summary__amount num">{formatMoney(stats.expenseCents)}</p>

      <dl className="stats-summary__split">
        <div className="stats-summary__cell">
          <dt className="stats-summary__cell-label">
            <Icon name="arrow-down-left" size={13} />
            收入
          </dt>
          <dd className="stats-summary__cell-value num">{formatMoney(stats.incomeCents)}</dd>
        </div>
        <div className={`stats-summary__cell${negative ? ' is-negative' : ''}`}>
          <dt className="stats-summary__cell-label">
            <Icon name={negative ? 'arrow-down-left' : 'arrow-up-right'} size={13} />
            结余
          </dt>
          <dd className="stats-summary__cell-value num">{formatMoney(stats.netCents, { sign: 'always' })}</dd>
        </div>
      </dl>
    </section>
  );
}

export function StatsKpis({ stats }: StatsSummaryProps) {
  const peak = stats.peakDay;

  return (
    <dl className="stats-kpis" aria-label="月度关键指标">
      <div className="stats-kpi">
        <dt className="stats-kpi__label">日均支出</dt>
        <dd className="stats-kpi__value num">{formatMoney(stats.averageDailyExpenseCents)}</dd>
        <dd className="stats-kpi__hint">按 {stats.daysInMonth} 天摊分</dd>
      </div>
      <div className="stats-kpi">
        <dt className="stats-kpi__label">记账笔数</dt>
        <dd className="stats-kpi__value num">{stats.entryCount}</dd>
        <dd className="stats-kpi__hint">本月全部收支</dd>
      </div>
      <div className="stats-kpi">
        <dt className="stats-kpi__label">活跃天数</dt>
        <dd className="stats-kpi__value num">{stats.activeDays}</dd>
        <dd className="stats-kpi__hint">共 {stats.daysInMonth} 天</dd>
      </div>
      <div className="stats-kpi">
        <dt className="stats-kpi__label">单日最高</dt>
        <dd className="stats-kpi__value num">{peak ? formatMoney(peak.expenseCents) : '—'}</dd>
        <dd className="stats-kpi__hint">{peak ? formatMonthDay(peak.date) : '暂无支出'}</dd>
      </div>
    </dl>
  );
}
