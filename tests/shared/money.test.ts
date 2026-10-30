import { describe, expect, it } from 'vitest';
import {
  applyAmountKey,
  formatCents,
  formatCompactCents,
  formatEntryAmount,
  formatMoney,
  parseAmountToCents,
} from '../../src/shared/money';

describe('money', () => {
  it('formats integer cents with grouping and two decimals', () => {
    expect(formatCents(0)).toBe('0.00');
    expect(formatCents(1)).toBe('0.01');
    expect(formatCents(123456789)).toBe('1,234,567.89');
    expect(formatCents(-2580)).toBe('-25.80');
  });

  it('formats signed entry amounts', () => {
    expect(formatEntryAmount('expense', 1800)).toBe('-¥18.00');
    expect(formatEntryAmount('income', 1800)).toBe('+¥18.00');
    expect(formatMoney(0)).toBe('¥0.00');
    expect(formatMoney(25, { symbol: false })).toBe('0.25');
  });

  it('compacts large amounts for dense labels', () => {
    expect(formatCompactCents(100_000)).toBe('1,000.00');
    expect(formatCompactCents(25_000_000)).toBe('25万');
  });

  it('parses only well-formed positive amounts', () => {
    expect(parseAmountToCents('12')).toBe(1200);
    expect(parseAmountToCents('12.3')).toBe(1230);
    expect(parseAmountToCents('12.34')).toBe(1234);
    expect(parseAmountToCents('0.01')).toBe(1);
    expect(parseAmountToCents('1,234.56')).toBe(123456);
    expect(parseAmountToCents('')).toBeNull();
    expect(parseAmountToCents('0')).toBeNull();
    expect(parseAmountToCents('-1')).toBeNull();
    expect(parseAmountToCents('1.234')).toBeNull();
    expect(parseAmountToCents('abc')).toBeNull();
    expect(parseAmountToCents('100000000.00')).toBeNull();
  });

  it('applies keypad tokens without floating point arithmetic', () => {
    expect(applyAmountKey('', '2')).toBe('2');
    expect(applyAmountKey('0', '2')).toBe('2');
    expect(applyAmountKey('2', '.')).toBe('2.');
    expect(applyAmountKey('', '.')).toBe('0.');
    expect(applyAmountKey('0.', '5')).toBe('0.5');
    expect(applyAmountKey('1.2', '3')).toBe('1.23');
    expect(applyAmountKey('1.23', '4')).toBe('1.23');
    expect(applyAmountKey('1.2', 'backspace')).toBe('1.');
    expect(applyAmountKey('1.2', 'clear')).toBe('');
    expect(applyAmountKey('123456789', '9')).toBe('123456789');
  });
});
