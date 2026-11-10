import { useDeferredValue, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { Entry, EntryFilter } from '@shared/types';
import { localDateKey, parseMonthKey } from '@shared/date';
import { compareEntryRecency } from '@shared/entry-order';
import { formatMoney } from '@shared/money';
import { getLedgerClient } from '../api/client';
import { Icon } from '../components/Icon';
import { MonthSwitcher } from '../components/MonthSwitcher';
import { useAsyncResource } from '../hooks/useAsyncResource';
import { findAccount, findCategory } from '../utils/catalog';
import { CategoryGroups } from '../features/ledger/CategoryGroups';
import { LedgerDayGroup } from '../features/ledger/LedgerDayGroup';
import { LedgerSkeleton } from '../features/ledger/LedgerSkeleton';
import { MonthlySummary } from '../features/ledger/MonthlySummary';
import type {
  LedgerCategoryGroupData,
  LedgerDayGroupData,
  LedgerViewMode,
} from '../features/ledger/types';
import type { LedgerPageProps } from '../types/page-props';
import '../styles/ledger.css';

const FILTERS: ReadonlyArray<{ id: EntryFilter; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'expense', label: '支出' },
  { id: 'income', label: '收入' },
];

const EMPTY_ENTRIES: Entry[] = [];
const VIEW_STORAGE_KEY = 'ledgerlite.ui.ledgerView';

function readViewMode(): LedgerViewMode {
  try {
    return window.localStorage.getItem(VIEW_STORAGE_KEY) === 'category' ? 'category' : 'timeline';
  } catch {
    return 'timeline';
  }
}

function rememberViewMode(mode: LedgerViewMode): void {
  try {
    window.localStorage.setItem(VIEW_STORAGE_KEY, mode);
  } catch {
    // View preference is optional.
  }
}

export function LedgerPage({ ledgerId, month, revision, catalog, onMonthChange, onAdd, onEdit }: LedgerPageProps) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<EntryFilter>('all');
  const [viewMode, setViewMode] = useState<LedgerViewMode>(readViewMode);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const previousMonth = useRef(month);

  const resource = useAsyncResource(
    () => getLedgerClient().call('listMonth', { ledgerId, month }),
    [ledgerId, month, revision],
  );

  useEffect(() => {
    if (previousMonth.current === month) return;
    previousMonth.current = month;
    setQuery('');
    setFilter('all');
  }, [month]);

  useEffect(() => {
    setQuery('');
    setFilter('all');
  }, [ledgerId]);

  useEffect(() => {
    rememberViewMode(viewMode);
  }, [viewMode]);

  const data =
    resource.data && resource.data.month === month && resource.data.ledgerId === ledgerId
      ? resource.data
      : null;
  const showInitialLoading = data === null && resource.status !== 'error';
  const showError = data === null && resource.status === 'error';

  const entries = data?.entries ?? EMPTY_ENTRIES;
  const deferredQuery = useDeferredValue(query);

  const filteredEntries = useMemo(() => {
    const needle = deferredQuery.trim().toLowerCase();
    return entries.filter((entry) => {
      if (filter !== 'all' && entry.type !== filter) return false;
      if (!needle) return true;
      const category = findCategory(catalog, entry.categoryId);
      const account = findAccount(catalog, entry.accountId);
      return (
        entry.note.toLowerCase().includes(needle) ||
        category.name.toLowerCase().includes(needle) ||
        account.name.toLowerCase().includes(needle)
      );
    });
  }, [entries, filter, deferredQuery, catalog]);

  const groups = useMemo<LedgerDayGroupData[]>(() => {
    const buckets = new Map<string, LedgerDayGroupData>();
    for (const entry of filteredEntries) {
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
    const ordered = [...buckets.values()].sort((a, b) => a.date.localeCompare(b.date));
    for (const bucket of ordered) bucket.entries.sort(compareEntryRecency);
    return ordered;
  }, [filteredEntries]);

  const categoryGroups = useMemo<LedgerCategoryGroupData[]>(() => {
    const buckets = new Map<string, LedgerCategoryGroupData>();
    for (const entry of filteredEntries) {
      let bucket = buckets.get(entry.categoryId);
      if (!bucket) {
        bucket = {
          categoryId: entry.categoryId,
          type: entry.type,
          entries: [],
          totalCents: 0,
        };
        buckets.set(entry.categoryId, bucket);
      }
      bucket.entries.push(entry);
      bucket.totalCents += entry.amountCents;
    }
    return [...buckets.values()].sort((a, b) => b.totalCents - a.totalCents);
  }, [filteredEntries]);

  const activeDays = useMemo(() => {
    const days = new Set<string>();
    for (const entry of entries) days.add(localDateKey(entry.occurredAt));
    return days.size;
  }, [entries]);

  const filteredTotals = useMemo(() => {
    let expenseCents = 0;
    let incomeCents = 0;
    for (const entry of filteredEntries) {
      if (entry.type === 'expense') expenseCents += entry.amountCents;
      else incomeCents += entry.amountCents;
    }
    return { expenseCents, incomeCents };
  }, [filteredEntries]);

  const isFiltering = filter !== 'all' || deferredQuery.trim() !== '';
  const { year } = parseMonthKey(month);

  const clearFilters = () => {
    setQuery('');
    setFilter('all');
    searchRef.current?.focus();
  };

  return (
    <div className="ledger-page" aria-busy={resource.status === 'loading'}>
      <header className="ledger-head">
        <div>
          <p className="ledger-head__eyebrow">{year} · MONTH LEDGER</p>
          <h1 className="ledger-head__title">明细</h1>
        </div>
        <MonthSwitcher month={month} onChange={onMonthChange} compact />
      </header>

      {showInitialLoading ? <LedgerSkeleton /> : null}

      {showError ? (
        <div className="ledger-error" role="alert">
          <span className="ledger-error__mark">
            <Icon name="alert" size={24} />
          </span>
          <h2>账本没能载入</h2>
          <p>{resource.error ?? '本地数据服务暂时不可用。'}</p>
          <button type="button" className="secondary-button" onClick={resource.reload}>
            <Icon name="refresh" size={16} />
            重试
          </button>
        </div>
      ) : null}

      {data ? (
        <>
          <MonthlySummary summary={data.summary} activeDays={activeDays} />

          {resource.status === 'error' ? (
            <div className="ledger-banner" role="alert">
              <Icon name="alert" size={15} />
              <span>刷新失败，当前显示的是上次载入的记录。</span>
              <button type="button" onClick={resource.reload}>
                重试
              </button>
            </div>
          ) : null}

          <div className="ledger-toolbar">
            <div className="ledger-search">
              <Icon name="search" size={17} />
              <label className="sr-only" htmlFor="ledger-search">
                搜索账目
              </label>
              <input
                id="ledger-search"
                ref={searchRef}
                type="search"
                placeholder="搜索备注、分类或账户"
                value={query}
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape' && query) {
                    event.preventDefault();
                    event.stopPropagation();
                    setQuery('');
                  }
                }}
              />
              {query ? (
                <button
                  type="button"
                  className="ledger-search__clear"
                  aria-label="清空搜索"
                  onClick={() => {
                    setQuery('');
                    searchRef.current?.focus();
                  }}
                >
                  <Icon name="close" size={15} />
                </button>
              ) : null}
            </div>

            <div className="ledger-filterbar">
              <div
                className="ledger-filters"
                role="group"
                aria-label="按收支筛选"
                style={{ '--filter-index': FILTERS.findIndex((item) => item.id === filter) } as CSSProperties}
              >
                <span className="ledger-filters__thumb" aria-hidden="true" />
                {FILTERS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`ledger-filters__button ${filter === item.id ? 'is-active' : ''}`}
                    aria-pressed={filter === item.id}
                    onClick={() => setFilter(item.id)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              <button
                type="button"
                className={`ledger-view-toggle ${viewMode === 'category' ? 'is-active' : ''}`}
                aria-label={viewMode === 'timeline' ? '切换为按分类汇总' : '切换为按日明细'}
                title={viewMode === 'timeline' ? '按分类汇总' : '按日明细'}
                onClick={() => setViewMode((current) => (current === 'timeline' ? 'category' : 'timeline'))}
              >
                <Icon name={viewMode === 'timeline' ? 'archive' : 'ledger'} size={16} />
                <span>{viewMode === 'timeline' ? '分类' : '按日'}</span>
              </button>
            </div>
          </div>

          {entries.length === 0 ? (
            <div className="ledger-empty">
              <span className="ledger-empty__mark">
                <Icon name="ledger" size={25} />
              </span>
              <h2>这个月还没有记录</h2>
              <p>把第一笔记下来，月度概览会自动为你汇总。</p>
              <button type="button" className="primary-button" onClick={onAdd}>
                <Icon name="plus" size={17} />
                记一笔
              </button>
            </div>
          ) : filteredEntries.length === 0 ? (
            <div className="ledger-empty ledger-empty--quiet">
              <span className="ledger-empty__mark">
                <Icon name="search" size={24} />
              </span>
              <h2>没有找到匹配的账目</h2>
              <p>换个关键词，或者清除筛选查看本月全部记录。</p>
              <button type="button" className="secondary-button" onClick={clearFilters}>
                清除筛选
              </button>
            </div>
          ) : (
            <>
              {isFiltering ? (
                <div className="ledger-results" role="status">
                  <span className="ledger-results__count">{filteredEntries.length} 笔结果</span>
                  <span>支出 {formatMoney(filteredTotals.expenseCents)}</span>
                  <span>收入 {formatMoney(filteredTotals.incomeCents)}</span>
                </div>
              ) : null}

              {viewMode === 'timeline' ? (
                <div className="ledger-days">
                  {groups.map((group, index) => (
                    <LedgerDayGroup
                      key={group.date}
                      group={group}
                      catalog={catalog}
                      index={index}
                      onEdit={onEdit}
                    />
                  ))}
                </div>
              ) : (
                <CategoryGroups groups={categoryGroups} catalog={catalog} onEdit={onEdit} />
              )}
            </>
          )}
        </>
      ) : null}
    </div>
  );
}
