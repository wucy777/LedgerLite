import { CATEGORY_COLORS } from '@shared/defaults';
import type { EntryType, IconName } from '@shared/types';

export const EXPENSE_ICONS: readonly IconName[] = [
  'food',
  'transport',
  'shopping',
  'home',
  'fun',
  'health',
  'education',
  'other',
];

export const INCOME_ICONS: readonly IconName[] = [
  'salary',
  'bonus',
  'invest',
  'parttime',
  'gift',
  'refund',
  'other',
];

export const ACCOUNT_ICONS: readonly IconName[] = ['wallet', 'wechat', 'alipay', 'bank', 'cash', 'card'];

export const CATEGORY_PALETTE: readonly string[] = CATEGORY_COLORS;

export const ICON_LABELS: Partial<Record<IconName, string>> = {
  food: '餐饮',
  transport: '交通',
  shopping: '购物',
  home: '居住',
  fun: '娱乐',
  health: '医疗',
  education: '学习',
  other: '其他',
  salary: '工资',
  bonus: '奖金',
  invest: '理财',
  parttime: '兼职',
  gift: '红包',
  refund: '退款',
  wallet: '钱包',
  wechat: '微信',
  alipay: '支付宝',
  bank: '银行卡',
  cash: '现金',
  card: '信用卡',
};

export const PALETTE_LABELS: Record<string, string> = {
  '#d96f52': '陶土红',
  '#c59a3f': '赭金',
  '#6e936f': '苔绿',
  '#4f9a82': '松绿',
  '#4f86b5': '雾蓝',
  '#8176c4': '岩紫',
  '#bd7ba4': '藕粉',
  '#8a8e85': '灰褐',
};

export function iconsForCategory(type: EntryType): readonly IconName[] {
  return type === 'expense' ? EXPENSE_ICONS : INCOME_ICONS;
}

export function colorLabel(color: string): string {
  return PALETTE_LABELS[color] ?? '当前颜色';
}
