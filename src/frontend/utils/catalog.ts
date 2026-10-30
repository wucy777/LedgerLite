import type { Account, Catalog, Category, Entry } from '@shared/types';

const FALLBACK_CATEGORY: Category = {
  id: 'cat_unknown',
  name: '未分类',
  type: 'expense',
  icon: 'other',
  color: '#8a8e85',
  archived: false,
  preset: false,
  sort: 999,
};

const FALLBACK_ACCOUNT: Account = {
  id: 'acc_unknown',
  name: '未知账户',
  icon: 'wallet',
  color: '#8a8e85',
  archived: false,
  preset: false,
  sort: 999,
};

export function findCategory(catalog: Catalog, id: string): Category {
  return catalog.categories.find((category) => category.id === id) ?? {
    ...FALLBACK_CATEGORY,
    id,
  };
}

export function findAccount(catalog: Catalog, id: string): Account {
  return catalog.accounts.find((account) => account.id === id) ?? {
    ...FALLBACK_ACCOUNT,
    id,
  };
}

export function categoryForEntry(catalog: Catalog, entry: Entry): Category {
  return findCategory(catalog, entry.categoryId);
}

export function accountForEntry(catalog: Catalog, entry: Entry): Account {
  return findAccount(catalog, entry.accountId);
}

export function activeCategories(catalog: Catalog, type: 'expense' | 'income'): Category[] {
  return catalog.categories
    .filter((category) => category.type === type && !category.archived)
    .sort((a, b) => a.sort - b.sort);
}

export function activeAccounts(catalog: Catalog): Account[] {
  return catalog.accounts.filter((account) => !account.archived).sort((a, b) => a.sort - b.sort);
}
