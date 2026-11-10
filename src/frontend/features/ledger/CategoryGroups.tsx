import { useState, type CSSProperties } from 'react';
import type { Catalog, Entry } from '@shared/types';
import { formatMonthDay, formatTime, localDateKey } from '@shared/date';
import { formatEntryAmount, formatMoney } from '@shared/money';
import { CategoryGlyph } from '../../components/CategoryGlyph';
import { Icon } from '../../components/Icon';
import { findAccount, findCategory } from '../../utils/catalog';
import type { LedgerCategoryGroupData } from './types';

interface CategoryGroupsProps {
  groups: LedgerCategoryGroupData[];
  catalog: Catalog;
  onEdit: (entry: Entry) => void;
}

interface GroupSectionProps {
  label: '支出' | '收入';
  type: 'expense' | 'income';
  groups: LedgerCategoryGroupData[];
  catalog: Catalog;
  onEdit: (entry: Entry) => void;
}

function compactDate(dateKey: string): string {
  const [, month, day] = dateKey.split('-');
  return `${Number(month)}.${Number(day)}`;
}

function dateRange(entries: readonly Entry[]): string {
  if (entries.length === 0) return '';
  const dates = entries.map((entry) => localDateKey(entry.occurredAt)).sort();
  const first = dates[0];
  const last = dates[dates.length - 1];
  if (!first || !last) return '';
  return first === last ? compactDate(first) : `${compactDate(first)}–${compactDate(last)}`;
}

function GroupSection({ label, type, groups, catalog, onEdit }: GroupSectionProps) {
  const count = groups.reduce((total, group) => total + group.entries.length, 0);
  const totalCents = groups.reduce((total, group) => total + group.totalCents, 0);
  if (groups.length === 0) return null;

  return (
    <section className="ledger-group-section" aria-label={`${label}分类汇总`}>
      <header className="ledger-group-section__head">
        <div className="ledger-group-section__title">
          <span className={`ledger-group-section__mark is-${type}`} aria-hidden="true" />
          <h2>{label}</h2>
          <span className="ledger-group-section__count">
            {groups.length} 类 · {count} 笔
          </span>
        </div>
        <span className={`ledger-group-section__total num is-${type}`}>{formatMoney(totalCents)}</span>
      </header>

      <div className="ledger-group-list">
        {groups.map((group, index) => (
          <CategoryGroupCard
            key={`${type}-${group.categoryId}`}
            group={group}
            catalog={catalog}
            onEdit={onEdit}
            index={index}
          />
        ))}
      </div>
    </section>
  );
}

interface CategoryGroupCardProps {
  group: LedgerCategoryGroupData;
  catalog: Catalog;
  onEdit: (entry: Entry) => void;
  index: number;
}

function CategoryGroupCard({ group, catalog, onEdit, index }: CategoryGroupCardProps) {
  const [expanded, setExpanded] = useState(false);
  const category = findCategory(catalog, group.categoryId);
  const accounts = [...new Set(group.entries.map((entry) => findAccount(catalog, entry.accountId).name))];
  const accountLabel = accounts.length === 1 ? (accounts[0] ?? '—') : `${accounts.length} 个账户`;
  const range = dateRange(group.entries);
  const style = { '--group-index': String(Math.min(index, 8)) } as CSSProperties;

  return (
    <article className={`ledger-group ${expanded ? 'is-open' : ''}`} style={style}>
      <button
        type="button"
        className="ledger-group__head"
        aria-expanded={expanded}
        onClick={() => setExpanded((current) => !current)}
      >
        <CategoryGlyph category={category} size="md" />
        <span className="ledger-group__copy">
          <span className="ledger-group__name">{category.name}</span>
          <span className="ledger-group__meta">
            <span>{group.entries.length} 笔</span>
            <span>{range}</span>
            <span>{accountLabel}</span>
          </span>
        </span>
        <span className={`ledger-group__amount num is-${group.type}`}>
          {formatEntryAmount(group.type, group.totalCents)}
        </span>
        <span className="ledger-group__chevron" aria-hidden="true">
          <Icon name="chevron-down" size={16} />
        </span>
      </button>

      <div className="ledger-group__collapse">
        <div className="ledger-group__collapse-inner">
          <ul className="ledger-group__entries" aria-label={`${category.name}明细`}>
            {group.entries.map((entry) => {
              const account = findAccount(catalog, entry.accountId);
              return (
                <li key={entry.id} className="ledger-group-entry">
                  <button
                    type="button"
                    className="ledger-group-entry__button"
                    onClick={() => onEdit(entry)}
                    aria-label={`${formatMonthDay(localDateKey(entry.occurredAt))} ${formatTime(
                      entry.occurredAt,
                    )}，${category.name}，${account.name}，${formatEntryAmount(entry.type, entry.amountCents)}${
                      entry.note ? `，备注：${entry.note}` : ''
                    }`}
                  >
                    <span className="ledger-group-entry__date num">
                      {compactDate(localDateKey(entry.occurredAt))}
                      <small>{formatTime(entry.occurredAt)}</small>
                    </span>
                    <span className="ledger-group-entry__copy">
                      <span className="ledger-group-entry__note">{entry.note || category.name}</span>
                      <span className="ledger-group-entry__meta">{account.name}</span>
                    </span>
                    <span className={`ledger-group-entry__amount num is-${entry.type}`}>
                      {formatEntryAmount(entry.type, entry.amountCents)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </article>
  );
}

export function CategoryGroups({ groups, catalog, onEdit }: CategoryGroupsProps) {
  const expenseGroups = groups.filter((group) => group.type === 'expense');
  const incomeGroups = groups.filter((group) => group.type === 'income');

  return (
    <div className="ledger-groups">
      <GroupSection label="支出" type="expense" groups={expenseGroups} catalog={catalog} onEdit={onEdit} />
      <GroupSection label="收入" type="income" groups={incomeGroups} catalog={catalog} onEdit={onEdit} />
    </div>
  );
}
