export const MAX_AMOUNT_CENTS = 99_999_999_99;

export function formatCents(cents: number): string {
  const safe = Number.isFinite(cents) ? Math.trunc(cents) : 0;
  const negative = safe < 0;
  const absolute = Math.abs(safe);
  const yuan = Math.floor(absolute / 100);
  const fen = absolute % 100;
  const grouped = String(yuan).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}${grouped}.${String(fen).padStart(2, '0')}`;
}

export function formatMoney(cents: number, options: { symbol?: boolean; sign?: 'always' | 'negative' | 'none' } = {}): string {
  const { symbol = true, sign = 'none' } = options;
  const prefix = cents > 0 && sign === 'always' ? '+' : '';
  return `${prefix}${symbol ? '¥' : ''}${formatCents(cents)}`;
}

export function formatEntryAmount(type: 'expense' | 'income', cents: number): string {
  const sign = type === 'income' ? '+' : '-';
  return `${sign}¥${formatCents(Math.abs(cents))}`;
}

export function formatCompactCents(cents: number): string {
  const absolute = Math.abs(cents);
  if (absolute >= 10_000_000) {
    const wan = cents / 1_000_000;
    return `${trimFraction(wan)}万`;
  }
  return formatCents(cents);
}

function trimFraction(value: number): string {
  return value >= 100 ? Math.round(value).toString() : value.toFixed(1).replace(/\.0$/, '');
}

/**
 * Converts a keypad string into integer cents without floating point arithmetic.
 * Returns null for malformed, negative, or out-of-range input.
 */
export function parseAmountToCents(input: string): number | null {
  const normalized = input.trim().replace(/,/g, '');
  if (!/^\d{0,9}(?:\.\d{0,2})?$/.test(normalized) || normalized === '' || normalized === '.') {
    return null;
  }
  const [integerPart = '0', fractionPart = ''] = normalized.split('.');
  const yuan = integerPart === '' ? 0 : Number(integerPart);
  const fen = Number(fractionPart.padEnd(2, '0'));
  const cents = yuan * 100 + fen;
  if (!Number.isSafeInteger(cents) || cents <= 0 || cents > MAX_AMOUNT_CENTS) {
    return null;
  }
  return cents;
}

/** Applies one keypad token to the current amount string and keeps at most two decimals. */
export function applyAmountKey(current: string, key: string): string {
  if (key === 'backspace') {
    return current.slice(0, -1);
  }
  if (key === 'clear') {
    return '';
  }
  if (key === '.') {
    if (current.includes('.')) return current;
    return current === '' ? '0.' : `${current}.`;
  }
  if (!/^\d$/.test(key)) return current;
  if (current === '0') return key;
  const [integerPart = '', fractionPart] = current.split('.');
  if (fractionPart !== undefined) {
    if (fractionPart.length >= 2) return current;
    return `${current}${key}`;
  }
  if (integerPart.length >= 9) return current;
  return `${current}${key}`;
}
