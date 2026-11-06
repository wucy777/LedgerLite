import type { Account, Catalog, Category, Ledger } from './types';

export const DEFAULT_LEDGER_ID = 'ledger_default';
export const DEFAULT_LEDGER_NAME = '默认账本';
export const LEDGER_COLORS = ['#2c4d39', '#8a6545', '#4f6f8f', '#7a5b83', '#a76a50', '#5e7869'] as const;

export function createDefaultLedger(now = new Date(), sort = 0): Ledger {
  const timestamp = now.toISOString();
  return {
    id: DEFAULT_LEDGER_ID,
    name: DEFAULT_LEDGER_NAME,
    color: '#2c4d39',
    createdAt: timestamp,
    updatedAt: timestamp,
    sort,
  };
}

const EXPENSE_CATEGORIES: ReadonlyArray<Omit<Category, 'type' | 'archived' | 'preset' | 'sort'>> = [
  { id: 'cat_food', name: '餐饮', icon: 'food', color: '#d96f52' },
  { id: 'cat_transport', name: '交通', icon: 'transport', color: '#5f86c9' },
  { id: 'cat_shopping', name: '购物', icon: 'shopping', color: '#bd7ba4' },
  { id: 'cat_home', name: '居住', icon: 'home', color: '#b18a3f' },
  { id: 'cat_fun', name: '娱乐', icon: 'fun', color: '#8176c4' },
  { id: 'cat_health', name: '医疗', icon: 'health', color: '#4f9a82' },
  { id: 'cat_education', name: '学习', icon: 'education', color: '#6e936f' },
  { id: 'cat_other', name: '其他', icon: 'other', color: '#8a8e85' },
];

const INCOME_CATEGORIES: ReadonlyArray<Omit<Category, 'type' | 'archived' | 'preset' | 'sort'>> = [
  { id: 'cat_salary', name: '工资', icon: 'salary', color: '#347d5c' },
  { id: 'cat_bonus', name: '奖金', icon: 'bonus', color: '#c59a3f' },
  { id: 'cat_invest', name: '理财', icon: 'invest', color: '#4f86b5' },
  { id: 'cat_parttime', name: '兼职', icon: 'parttime', color: '#8a6fbd' },
  { id: 'cat_gift', name: '红包', icon: 'gift', color: '#cf708d' },
  { id: 'cat_refund', name: '退款', icon: 'refund', color: '#4f9a96' },
  { id: 'cat_income_other', name: '其他', icon: 'other', color: '#788b7a' },
];

export const DEFAULT_CATEGORIES: Category[] = [
  ...EXPENSE_CATEGORIES.map((category, index) => ({
    ...category,
    type: 'expense' as const,
    archived: false,
    preset: true,
    sort: index,
  })),
  ...INCOME_CATEGORIES.map((category, index) => ({
    ...category,
    type: 'income' as const,
    archived: false,
    preset: true,
    sort: index,
  })),
];

export const DEFAULT_ACCOUNTS: Account[] = [
  { id: 'acc_wechat', name: '微信', icon: 'wechat', color: '#3f9e63', archived: false, preset: true, sort: 0 },
  { id: 'acc_alipay', name: '支付宝', icon: 'alipay', color: '#3d7fca', archived: false, preset: true, sort: 1 },
  { id: 'acc_bank', name: '银行卡', icon: 'bank', color: '#8d7654', archived: false, preset: true, sort: 2 },
  { id: 'acc_cash', name: '现金', icon: 'cash', color: '#7f8b6d', archived: false, preset: true, sort: 3 },
  { id: 'acc_card', name: '信用卡', icon: 'card', color: '#a56d87', archived: false, preset: true, sort: 4 },
  { id: 'acc_ecny', name: '数字人民币', icon: 'ecny', color: '#b0424a', archived: false, preset: true, sort: 5 },
];

export function createDefaultCatalog(): Catalog {
  return {
    categories: DEFAULT_CATEGORIES.map((category) => ({ ...category })),
    accounts: DEFAULT_ACCOUNTS.map((account) => ({ ...account })),
  };
}

export const DEFAULT_CATEGORY_ID: Record<'expense' | 'income', string> = {
  expense: 'cat_food',
  income: 'cat_salary',
};

export const DEFAULT_ACCOUNT_ID = 'acc_wechat';

export const CATEGORY_COLORS = [
  '#d96f52',
  '#c59a3f',
  '#6e936f',
  '#4f9a82',
  '#4f86b5',
  '#8176c4',
  '#bd7ba4',
  '#8a8e85',
] as const;
