import { useCallback } from 'react';
import { getLedgerClient } from '../api/client';
import { MonthSwitcher } from '../components/MonthSwitcher';
import { CategoryBreakdown } from '../features/stats/CategoryBreakdown';
import { DailyExpenseChart } from '../features/stats/DailyExpenseChart';
import { StatsEmpty } from '../features/stats/StatsEmpty';
import { StatsError } from '../features/stats/StatsError';
import { StatsSkeleton } from '../features/stats/StatsSkeleton';
import { StatsKpis, StatsSummary } from '../features/stats/StatsSummary';
import { useAsyncResource } from '../hooks/useAsyncResource';
import type { StatsPageProps } from '../types/page-props';
import '../styles/stats.css';

export function StatsPage({ ledgerId, month, revision, onMonthChange }: StatsPageProps) {
  const client = getLedgerClient();
  const load = useCallback(() => client.call('getStats', { ledgerId, month }), [client, ledgerId, month]);
  const { data, status, error, reload } = useAsyncResource(load, [ledgerId, month, revision]);
  const stats = data !== null && data.month === month && data.ledgerId === ledgerId ? data : null;
  const refreshing = status === 'loading' && stats !== null;

  return (
    <div className="stats-page">
      <header className="stats-head">
        <div className="stats-head__copy">
          <p className="stats-head__eyebrow">月度分析</p>
          <h1 className="stats-head__title">统计</h1>
        </div>
        <div className="stats-head__aside">
          <MonthSwitcher month={month} onChange={onMonthChange} />
        </div>
      </header>

      {stats ? (
        <>
          {status === 'error' ? (
            <div className="stats-banner" role="status">
              <span className="stats-banner__text">
                {error ?? '统计数据刷新失败'}，当前显示上次结果。
              </span>
              <button type="button" className="stats-banner__retry" onClick={reload}>
                重试
              </button>
            </div>
          ) : null}

          <div className="stats-body" aria-busy={refreshing || undefined}>
            {stats.entryCount === 0 ? (
              <StatsEmpty month={stats.month} />
            ) : (
              <>
                <div className="stats-overview">
                  <StatsSummary stats={stats} />
                  <StatsKpis stats={stats} />
                </div>

                <div className="stats-main">
                  <DailyExpenseChart key={`chart-${stats.month}`} stats={stats} />
                  <CategoryBreakdown key={`categories-${stats.month}`} stats={stats} />
                </div>

                <p className="stats-footnote">按记录的发生时间归入月份 · 金额单位：人民币元 · 数据仅保存在本机</p>
              </>
            )}
          </div>
        </>
      ) : status === 'error' ? (
        <StatsError message={error} onRetry={reload} />
      ) : (
        <StatsSkeleton />
      )}
    </div>
  );
}
