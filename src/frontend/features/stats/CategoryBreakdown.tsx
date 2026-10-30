import { useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from 'react';
import { formatMoney } from '@shared/money';
import type { MonthStats } from '@shared/types';
import { CategoryGlyph } from '../../components/CategoryGlyph';
import { Icon } from '../../components/Icon';

interface CategoryBreakdownProps {
  stats: MonthStats;
}

const TABS = [
  { id: 'expense', label: '支出' },
  { id: 'income', label: '收入' },
] as const;

type Kind = (typeof TABS)[number]['id'];

function formatShare(share: number): string {
  if (!Number.isFinite(share) || share <= 0) return '0%';
  const percent = share * 100;
  if (percent >= 10) return `${Math.round(percent)}%`;
  if (percent >= 1) return `${percent.toFixed(1).replace(/\.0$/, '')}%`;
  return '<1%';
}

export function CategoryBreakdown({ stats }: CategoryBreakdownProps) {
  const [kind, setKind] = useState<Kind>('expense');
  const tabRefs = useRef<Record<Kind, HTMLButtonElement | null>>({ expense: null, income: null });
  const categories = kind === 'expense' ? stats.expenseCategories : stats.incomeCategories;
  const totalCents = kind === 'expense' ? stats.expenseCents : stats.incomeCents;
  const kindLabel = kind === 'expense' ? '支出' : '收入';

  const handleTabKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, current: Kind) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' && event.key !== 'Home' && event.key !== 'End') {
      return;
    }
    event.preventDefault();
    const next: Kind =
      event.key === 'Home' ? 'expense' : event.key === 'End' ? 'income' : current === 'expense' ? 'income' : 'expense';
    setKind(next);
    tabRefs.current[next]?.focus();
  };

  return (
    <section className="stats-panel stats-categories" aria-labelledby="stats-categories-title">
      <div className="stats-categories__head">
        <div className="stats-categories__intro">
          <h2 className="stats-categories__title" id="stats-categories-title">
            分类构成
          </h2>
          <p className="stats-categories__sub">
            {kindLabel}合计 <span className="num">{formatMoney(totalCents)}</span>
          </p>
        </div>

        <div className="stats-tabs" role="tablist" aria-label="分类构成类型">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              ref={(node) => {
                tabRefs.current[tab.id] = node;
              }}
              type="button"
              className="stats-tab"
              id={`stats-tab-${tab.id}`}
              role="tab"
              aria-selected={kind === tab.id}
              aria-controls="stats-categories-panel"
              tabIndex={kind === tab.id ? 0 : -1}
              onClick={() => setKind(tab.id)}
              onKeyDown={(event) => handleTabKeyDown(event, tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div
        className="stats-categories__panel"
        id="stats-categories-panel"
        role="tabpanel"
        aria-labelledby={`stats-tab-${kind}`}
      >
        {categories.length === 0 ? (
          <div className="stats-cat-empty">
            <Icon name={kind === 'expense' ? 'wallet' : 'salary'} size={20} />
            <p>{kind === 'expense' ? '本月还没有支出分类数据。' : '本月还没有收入分类数据。'}</p>
          </div>
        ) : (
          <ul className="stats-cat-list" key={`${stats.month}-${kind}`}>
            {categories.map((category, index) => (
              <li
                key={category.categoryId}
                className="stats-cat"
                style={{ '--i': String(index) } as CSSProperties}
              >
                <CategoryGlyph
                  category={{ name: category.name, icon: category.icon, color: category.color }}
                  size="sm"
                />
                <div className="stats-cat__body">
                  <div className="stats-cat__line">
                    <span className="stats-cat__name">{category.name}</span>
                    <span className="stats-cat__amount num">{formatMoney(category.amountCents)}</span>
                  </div>
                  <div className="stats-cat__meta">
                    <span className="stats-cat__share">{formatShare(category.share)}</span>
                    <span className="stats-cat__count">{category.count} 笔</span>
                  </div>
                  <div className="stats-cat__track" aria-hidden="true">
                    <span
                      className="stats-cat__fill"
                      style={
                        {
                          '--share': `${(Math.min(Math.max(category.share, 0), 1) * 100).toFixed(2)}%`,
                        } as CSSProperties
                      }
                    />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {categories.length > 0 ? (
        <p className="stats-categories__note">
          按金额从高到低排列 · 共 {categories.length} 类
        </p>
      ) : null}
    </section>
  );
}
