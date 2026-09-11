/** Display helpers. Money is always integer minor units on the wire. */

export function money(cents: number | null | undefined, currency = 'USD', opts: { sign?: boolean } = {}): string {
  if (cents == null) return '—';
  const value = cents / 100;
  const formatted = new Intl.NumberFormat(undefined, {
    style: 'currency', currency,
    maximumFractionDigits: Math.abs(value) >= 1000 ? 0 : 2,
  }).format(value);
  return opts.sign && cents > 0 ? `+${formatted}` : formatted;
}

export function moneyExact(cents: number | null | undefined, currency = 'USD'): string {
  if (cents == null) return '—';
  return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(cents / 100);
}

export function parseMoneyInput(raw: string): number | null {
  const cleaned = raw.replace(/[^0-9.-]/g, '');
  if (!cleaned || cleaned === '-' || cleaned === '.') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

const DAY_MS = 86400000;
export const todayStr = (): string => new Date().toISOString().slice(0, 10);

export function parseDate(d: string): Date { return new Date(d + 'T00:00:00'); }

export function dateLabel(d: string | null | undefined, today = todayStr()): string {
  if (!d) return 'No date';
  const diff = Math.round((parseDate(d).getTime() - parseDate(today).getTime()) / DAY_MS);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  if (diff > 1 && diff < 7) return parseDate(d).toLocaleDateString(undefined, { weekday: 'long' });
  if (diff < -1 && diff > -14) return `${-diff} days ago`;
  const sameYear = d.slice(0, 4) === today.slice(0, 4);
  return parseDate(d).toLocaleDateString(undefined, {
    month: 'short', day: 'numeric', year: sameYear ? undefined : 'numeric',
  });
}

export function longDate(d: string | null | undefined): string {
  if (!d) return '—';
  return parseDate(d).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

export function daysBetween(a: string, b: string): number {
  return Math.round((parseDate(a).getTime() - parseDate(b).getTime()) / DAY_MS);
}

export function addDays(d: string, n: number): string {
  const date = parseDate(d);
  date.setDate(date.getDate() + n);
  return date.toISOString().slice(0, 10);
}

export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function quantity(n: number | null | undefined, unit?: string | null): string {
  if (n == null) return '—';
  const rounded = Math.round(n * 100) / 100;
  const text = String(rounded);
  if (!unit || unit === 'ea') return text;
  return `${text} ${unit}`;
}

export function titleCase(s: string): string {
  return s.replace(/[_-]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function pluralise(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function initials(name: string): string {
  return name.split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('');
}
