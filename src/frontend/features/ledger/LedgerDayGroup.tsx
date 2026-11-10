import type { CSSProperties } from 'react';
import type { Catalog, Entry } from '@shared/types';
import { dayHeading, formatTime, weekdayLabel } from '@shared/date';
import { formatEntryAmount, formatMoney } from '@shared/money';
import { CategoryGlyph } from '../../components/CategoryGlyph';
import { findAccount, findCategory } from '../../utils/catalog';
import type { LedgerDayGroupData } from './types';

interface LedgerDayGroupProps {
  group: LedgerDayGroupData;
  catalog: Catalog;
  index: number;
  onEdit: (entry: Entry) => void;
}

const TYPE_LABEL = {
  expense: '支出',
  income: '收入',
} as const;

export function LedgerDayGroup({ group, catalog, index, onEdit }: LedgerDayGroupProps) {
  const heading = dayHeading(group.date);
  const weekday = weekdayLabel(group.date);
  const style = { '--ledger-day-index': Math.min(index, 6) } as CSSProperties;

  return (
    <section className={`ledger-day ${heading === '今天' ? 'is-today' : ''}`} style={style}>
      <header className="ledger-day__head">
        <div className="ledger-day__date">
          <h2>{heading}</h2>
          <span className="ledger-day__weekday">{weekday}</span>
        </div>
        <div className="ledger-day__totals">
          {group.expenseCents > 0 ? (
            <span className="ledger-day__total is-expense num">
              支 {formatMoney(group.expenseCents)}
            </span>
          ) : null}
          {group.incomeCents > 0 ? (
            <span className="ledger-day__total is-income num">
              收 {formatMoney(group.incomeCents)}
            </span>
          ) : null}
        </div>
      </header>

      <ul className="ledger-day__list">
        {group.entries.map((entry) => {
          const category = findCategory(catalog, entry.categoryId);
          const account = findAccount(catalog, entry.accountId);
          const hasNote = entry.note.length > 0;
          const typeLabel = TYPE_LABEL[entry.type];
          return (
            <li key={entry.id} className="ledger-row">
              <button
                type="button"
                className="ledger-row__button"
                aria-label={`${heading} ${formatTime(entry.occurredAt)}，${category.name}，${account.name}，${
                  hasNote ? `备注：${entry.note}，` : ''
                }${typeLabel} ${formatEntryAmount(entry.type, entry.amountCents)}`}
                onClick={() => onEdit(entry)}
              >
                <CategoryGlyph category={category} size="md" />
                <span className="ledger-row__body">
                  <span className="ledger-row__title" title={hasNote ? entry.note : category.name}>
                    {hasNote ? entry.note : category.name}
                  </span>
                  <span className="ledger-row__meta">
                    <span className={`ledger-row__type is-${entry.type}`}>{typeLabel}</span>
                    {hasNote ? <span>{category.name}</span> : null}
                    <span>{formatTime(entry.occurredAt)}</span>
                    <span>{account.name}</span>
                  </span>
                </span>
                <span className={`ledger-row__amount num is-${entry.type}`}>
                  {formatEntryAmount(entry.type, entry.amountCents)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
