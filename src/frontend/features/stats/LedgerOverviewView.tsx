import { useCallback, useMemo } from 'react';
import type { CSSProperties } from 'react';
import type { Catalog, Entry, LedgerOverview } from '@shared/types';
import { formatFullDate, formatTime, localDateKey, weekdayLabel } from '@shared/date';
import { formatEntryAmount, formatMoney } from '@shared/money';
import { getLedgerClient } from '../../api/client';
import { CategoryGlyph } from '../../components/CategoryGlyph';
import { Icon } from '../../components/Icon';
import { useAsyncResource } from '../../hooks/useAsyncResource';
import { findAccount, findCategory } from '../../utils/catalog';
import { StatsError } from './StatsError';
import { StatsSkeleton } from './StatsSkeleton';

interface LedgerOverviewViewProps {
  overview: LedgerOverview;
  catalog: Catalog;
}

interface LedgerOverviewPanelProps {
  ledgerId: string;
  revision: number;
  catalog: Catalog;
}

/** Lazily fetches the ledger-wide view only while that tab is open. */
export function LedgerOverviewPanel({ ledgerId, revision, catalog }: LedgerOverviewPanelProps) {
  const load = useCallback(
    () => getLedgerClient().call('getLedgerOverview', { ledgerId }),
    [ledgerId],
  );
  const resource = useAsyncResource(load, [ledgerId, revision]);

  if (resource.data === null) {
    return resource.status === 'error' ? (
      <StatsError message={resource.error} onRetry={resource.reload} />
    ) : (
      <StatsSkeleton />
    );
  }
  return <LedgerOverviewView overview={resource.data} catalog={catalog} />;
}

interface OverviewDay {
  date: string;
  entries: Entry[];
  expenseCents: number;
  incomeCents: number;
}

const TYPE_LABEL = {
  expense: '支出',
  income: '收入',
} as const;

function groupByDay(entries: readonly Entry[]): OverviewDay[] {
  const buckets = new Map<string, OverviewDay>();
  for (const entry of entries) {
    const date = localDateKey(entry.occurredAt);
    let bucket = buckets.get(date);
    if (!bucket) {
      bucket = { date, entries: [], expenseCents: 0, incomeCents: 0 };
      buckets.set(date, bucket);
    }
    bucket.entries.push(entry);
    if (entry.type === 'expense') bucket.expenseCents += entry.amountCents;
    else bucket.incomeCents += entry.amountCents;
  }
  return [...buckets.values()].sort((a, b) => b.date.localeCompare(a.date));
}

export function LedgerOverviewView({ overview, catalog }: LedgerOverviewViewProps) {
  const days = useMemo(() => groupByDay(overview.entries), [overview.entries]);

  if (overview.entryCount === 0) {
    return (
      <section className="stats-empty" aria-label="账本暂无记录">
        <span className="overview-empty__mark">
          <Icon name="ledger" size={24} />
        </span>
        <h2 className="stats-empty__title">账本还是空的</h2>
        <p className="stats-empty__copy">记录第一笔收支后，这里会按时间汇总全部账目。</p>
      </section>
    );
  }

  return (
    <>
      <section className="overview-hero" aria-label="账本总统计">
        <div className="overview-hero__top">
          <span className="overview-hero__label">账本总统计</span>
          <span className="overview-hero__count">{overview.entryCount} 笔记录</span>
        </div>
        <p className="overview-hero__amount num">{formatMoney(overview.totalCents)}</p>
        <p className="overview-hero__caption">总收入 + 总支出</p>
        <dl className="overview-hero__grid">
          <div>
            <dt>总收入</dt>
            <dd className="num">{formatMoney(overview.incomeCents)}</dd>
          </div>
          <div>
            <dt>总支出</dt>
            <dd className="num">{formatMoney(overview.expenseCents)}</dd>
          </div>
          <div>
            <dt>收支合计</dt>
            <dd className="num">{formatMoney(overview.totalCents)}</dd>
          </div>
          <div className={overview.netCents < 0 ? 'is-negative' : undefined}>
            <dt>结余</dt>
            <dd className="num">{formatMoney(overview.netCents, { sign: 'always' })}</dd>
          </div>
        </dl>
      </section>

      <div className="overview-days">
        {days.map((day, index) => {
          const heading = formatFullDate(day.date);
          return (
            <section
              key={day.date}
              className="overview-day"
              style={{ '--overview-day-index': Math.min(index, 6) } as CSSProperties}
            >
              <header className="overview-day__head">
                <div className="overview-day__date">
                  <h2>{heading}</h2>
                  <span>{weekdayLabel(day.date)}</span>
                </div>
                <div className="overview-day__totals">
                  {day.expenseCents > 0 ? <span className="is-expense num">支 {formatMoney(day.expenseCents)}</span> : null}
                  {day.incomeCents > 0 ? <span className="is-income num">收 {formatMoney(day.incomeCents)}</span> : null}
                </div>
              </header>
              <ul className="overview-list">
                {day.entries.map((entry) => {
                  const category = findCategory(catalog, entry.categoryId);
                  const account = findAccount(catalog, entry.accountId);
                  const hasNote = entry.note.length > 0;
                  return (
                    <li key={entry.id} className="overview-row">
                      <CategoryGlyph category={category} size="sm" />
                      <span className="overview-row__body">
                        <span className="overview-row__title" title={hasNote ? entry.note : category.name}>
                          {hasNote ? entry.note : category.name}
                        </span>
                        <span className="overview-row__meta">
                          <span className={`overview-row__type is-${entry.type}`}>{TYPE_LABEL[entry.type]}</span>
                          {hasNote ? <span>{category.name}</span> : null}
                          <span>{formatTime(entry.occurredAt)}</span>
                          <span>{account.name}</span>
                        </span>
                      </span>
                      <span className={`overview-row__amount num is-${entry.type}`}>
                        {formatEntryAmount(entry.type, entry.amountCents)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>

      <p className="stats-footnote">当前账本全部记录 · 按发生时间从近到远 · 数据仅保存在本机</p>
    </>
  );
}
