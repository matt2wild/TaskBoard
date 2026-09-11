/** Money is always integer minor units (cents). Never a float. */

export type Money = number; // minor units

export class MoneyError extends Error {}

export function parseMoney(input: string | number, opts: { minorDigits?: number } = {}): Money {
  const digits = opts.minorDigits ?? 2;
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) throw new MoneyError('not a finite number');
    return Math.round(input * 10 ** digits);
  }
  const cleaned = input.replace(/[\s,_]/g, '').replace(/^([^\d\-.]+)/, '').replace(/([^\d\-.]+)$/, '');
  if (!/^-?\d*(\.\d*)?$/.test(cleaned) || cleaned === '' || cleaned === '-') {
    throw new MoneyError(`cannot parse money: ${input}`);
  }
  const neg = cleaned.startsWith('-');
  const [whole = '0', frac = ''] = cleaned.replace('-', '').split('.');
  const padded = (frac + '0'.repeat(digits)).slice(0, digits);
  const rounded = frac.length > digits && Number(frac[digits]) >= 5 ? 1 : 0;
  const v = Number(whole) * 10 ** digits + Number(padded || '0') + rounded;
  return neg ? -v : v;
}

export function formatMoney(m: Money, currency = 'USD', locale = 'en-US', digits = 2): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(m / 10 ** digits);
}

export const sum = (xs: Money[]): Money => xs.reduce((a, b) => a + b, 0);

/** Split `total` into `n` parts differing by at most one minor unit, with the
 *  remainder distributed to the earliest parts so the parts always re-sum. */
export function splitEvenly(total: Money, n: number): Money[] {
  if (n <= 0) throw new MoneyError('n must be positive');
  const sign = total < 0 ? -1 : 1;
  const abs = Math.abs(total);
  const base = Math.floor(abs / n);
  const rem = abs - base * n;
  return Array.from({ length: n }, (_, i) => sign * (base + (i < rem ? 1 : 0)));
}

/** Allocate `total` across `weights` proportionally, losing nothing to rounding. */
export function allocate(total: Money, weights: number[]): Money[] {
  const tw = weights.reduce((a, b) => a + b, 0);
  if (tw <= 0) return splitEvenly(total, weights.length);
  const raw = weights.map((w) => (total * w) / tw);
  const floored = raw.map((r) => Math.trunc(r));
  let rem = total - floored.reduce((a, b) => a + b, 0);
  const order = raw
    .map((r, i) => ({ i, frac: Math.abs(r - Math.trunc(r)) }))
    .sort((a, b) => b.frac - a.frac);
  const step = rem < 0 ? -1 : 1;
  for (let k = 0; rem !== 0; k++) {
    const idx = order[k % order.length]!.i;
    floored[idx] = floored[idx]! + step;
    rem -= step;
  }
  return floored;
}

/** Validate that transaction splits add up to the transaction total. */
export function splitsBalance(total: Money, splits: Money[]): boolean {
  return sum(splits) === total;
}

/** Straight-line monthly set-aside for an irregular expense (sinking fund). */
export function monthlySetAside(amount: Money, everyMonths: number): Money {
  if (everyMonths <= 0) throw new MoneyError('everyMonths must be positive');
  return Math.ceil(amount / everyMonths);
}
