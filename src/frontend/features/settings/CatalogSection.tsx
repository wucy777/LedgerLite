import { useState } from 'react';
import type { Catalog } from '@shared/types';
import { CategoryGlyph } from '../../components/CategoryGlyph';
import { Icon } from '../../components/Icon';
import { CatalogSheet, type CatalogTab } from './CatalogSheet';

interface CatalogSectionProps {
  catalog: Catalog;
  onCatalogChange: (catalog: Catalog) => void;
}

function sortByOrder<T extends { sort: number }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => a.sort - b.sort);
}

export function CatalogSection({ catalog, onCatalogChange }: CatalogSectionProps) {
  const [openTab, setOpenTab] = useState<CatalogTab | null>(null);

  const expenseCount = catalog.categories.filter((category) => category.type === 'expense' && !category.archived).length;
  const incomeCount = catalog.categories.filter((category) => category.type === 'income' && !category.archived).length;
  const archivedCategoryCount = catalog.categories.filter((category) => category.archived).length;
  const activeAccountCount = catalog.accounts.filter((account) => !account.archived).length;
  const archivedAccountCount = catalog.accounts.filter((account) => account.archived).length;

  const categoryPreview = sortByOrder(catalog.categories.filter((category) => !category.archived)).slice(0, 3);
  const accountPreview = sortByOrder(catalog.accounts.filter((account) => !account.archived)).slice(0, 3);

  return (
    <section className="settings-section" aria-labelledby="settings-catalog-heading">
      <div className="settings-section__head">
        <h2 id="settings-catalog-heading">分类与账户</h2>
        <span>账本结构</span>
      </div>

      <div className="settings-card">
        <div className="settings-rows">
          <button
            type="button"
            className="settings-catalog-row"
            aria-haspopup="dialog"
            onClick={() => setOpenTab('categories')}
          >
            <span className="settings-catalog-preview" aria-hidden="true">
              {categoryPreview.length > 0 ? (
                categoryPreview.map((category) => (
                  <CategoryGlyph key={category.id} category={category} size="sm" className="settings-catalog-preview__glyph" />
                ))
              ) : (
                <span className="settings-catalog-preview__empty">
                  <Icon name="shopping" size={17} />
                </span>
              )}
            </span>
            <span className="settings-catalog-row__copy">
              <span className="settings-catalog-row__title">分类</span>
              <span className="settings-catalog-row__desc">
                {expenseCount} 个支出 · {incomeCount} 个收入
                {archivedCategoryCount > 0 ? ` · ${archivedCategoryCount} 个已归档` : ''}
              </span>
            </span>
            <span className="settings-catalog-row__trail" aria-hidden="true">
              <Icon name="chevron-right" size={17} />
            </span>
          </button>

          <button
            type="button"
            className="settings-catalog-row"
            aria-haspopup="dialog"
            onClick={() => setOpenTab('accounts')}
          >
            <span className="settings-catalog-preview" aria-hidden="true">
              {accountPreview.length > 0 ? (
                accountPreview.map((account) => (
                  <CategoryGlyph key={account.id} category={account} size="sm" className="settings-catalog-preview__glyph" />
                ))
              ) : (
                <span className="settings-catalog-preview__empty">
                  <Icon name="wallet" size={17} />
                </span>
              )}
            </span>
            <span className="settings-catalog-row__copy">
              <span className="settings-catalog-row__title">账户</span>
              <span className="settings-catalog-row__desc">
                {activeAccountCount} 个可用
                {archivedAccountCount > 0 ? ` · ${archivedAccountCount} 个已归档` : ''}
              </span>
            </span>
            <span className="settings-catalog-row__trail" aria-hidden="true">
              <Icon name="chevron-right" size={17} />
            </span>
          </button>
        </div>
      </div>

      {openTab ? (
        <CatalogSheet
          initialTab={openTab}
          catalog={catalog}
          onCatalogChange={onCatalogChange}
          onClose={() => setOpenTab(null)}
        />
      ) : null}
    </section>
  );
}
