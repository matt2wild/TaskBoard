import { type DateStr, addDays, diffDays, toEpochDay } from './date.js';

/**
 * A focused RFC 5545 RRULE evaluator covering the shapes household schedules
 * actually use: DAILY/WEEKLY/MONTHLY/YEARLY with INTERVAL, BYDAY (with ordinals),
 * BYMONTH, BYMONTHDAY (negative counts from the end), COUNT and UNTIL.
 *
 * It is written out rather than pulled in so that month-end behaviour is ours to
 * test and so the server has one less CommonJS dependency to trip over.
 */

export interface ParsedRule {
  freq: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
  interval: number;
  byDay: Array<{ ordinal: number | null; day: number }>;
  byMonth: number[];
  byMonthDay: number[];
  count: number | null;
  until: DateStr | null;
}

export class RRuleError extends Error {}

const DAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

export function parseRRule(input: string): ParsedRule {
  const body = input.trim().replace(/^RRULE:/i, '');
  const parts: Record<string, string> = {};
  for (const kv of body.split(';')) {
    if (!kv) continue;
    const [k = '', v = ''] = kv.split('=');
    parts[k.toUpperCase()] = v;
  }
  const freq = (parts.FREQ ?? '').toUpperCase();
  if (!['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(freq)) {
    throw new RRuleError(`Unsupported FREQ: ${parts.FREQ ?? '(missing)'}`);
  }
  const interval = parts.INTERVAL ? Number(parts.INTERVAL) : 1;
  if (!Number.isInteger(interval) || interval < 1) throw new RRuleError('INTERVAL must be a positive integer');

  const byDay = (parts.BYDAY ?? '').split(',').filter(Boolean).map((token) => {
    const m = token.trim().toUpperCase().match(/^([+-]?\d+)?(SU|MO|TU|WE|TH|FR|SA)$/);
    if (!m) throw new RRuleError(`Unsupported BYDAY: ${token}`);
    return { ordinal: m[1] ? Number(m[1]) : null, day: DAY_CODES.indexOf(m[2]!) };
  });

  const nums = (v: string | undefined) =>
    (v ?? '').split(',').filter(Boolean).map((n) => {
      const parsed = Number(n);
      if (!Number.isInteger(parsed)) throw new RRuleError(`Expected whole numbers, got: ${n}`);
      return parsed;
    });

  let until: DateStr | null = null;
  if (parts.UNTIL) {
    const raw = parts.UNTIL.slice(0, 8);
    if (!/^\d{8}$/.test(raw)) throw new RRuleError(`Unsupported UNTIL: ${parts.UNTIL}`);
    until = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  }

  return {
    freq: freq as ParsedRule['freq'],
    interval,
    byDay,
    byMonth: nums(parts.BYMONTH),
    byMonthDay: nums(parts.BYMONTHDAY),
    count: parts.COUNT ? Number(parts.COUNT) : null,
    until,
  };
}

const dowOf = (d: DateStr): number => new Date(d + 'T00:00:00Z').getUTCDay();
const yearOf = (d: DateStr): number => Number(d.slice(0, 4));
const monthOf = (d: DateStr): number => Number(d.slice(5, 7));
const dayOf = (d: DateStr): number => Number(d.slice(8, 10));
const daysInMonth = (y: number, m: number): number => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** Start of the ISO-ish week containing `d`, taking Monday as the first day. */
function weekStart(d: DateStr): DateStr {
  const dow = dowOf(d);
  return addDays(d, -((dow + 6) % 7));
}

/** Does `date` satisfy the rule anchored at `dtstart`? */
export function matches(rule: ParsedRule, dtstart: DateStr, date: DateStr): boolean {
  if (diffDays(date, dtstart) < 0) return false;
  if (rule.until && diffDays(date, rule.until) > 0) return false;

  switch (rule.freq) {
    case 'DAILY':
      return diffDays(date, dtstart) % rule.interval === 0;

    case 'WEEKLY': {
      const weeks = Math.round(diffDays(weekStart(date), weekStart(dtstart)) / 7);
      if (weeks % rule.interval !== 0) return false;
      if (!rule.byDay.length) return dowOf(date) === dowOf(dtstart);
      return rule.byDay.some((b) => b.day === dowOf(date));
    }

    case 'MONTHLY': {
      const months = (yearOf(date) - yearOf(dtstart)) * 12 + (monthOf(date) - monthOf(dtstart));
      if (months % rule.interval !== 0) return false;
      return matchesDayOfMonth(rule, dtstart, date);
    }

    case 'YEARLY': {
      const years = yearOf(date) - yearOf(dtstart);
      if (years % rule.interval !== 0) return false;
      const months = rule.byMonth.length ? rule.byMonth : [monthOf(dtstart)];
      if (!months.includes(monthOf(date))) return false;
      if (!rule.byMonthDay.length && !rule.byDay.length) return dayOf(date) === dayOf(dtstart);
      return matchesDayOfMonth(rule, dtstart, date, { ignoreDefault: true });
    }

    default:
      return false;
  }
}

function matchesDayOfMonth(
  rule: ParsedRule, dtstart: DateStr, date: DateStr, opts: { ignoreDefault?: boolean } = {},
): boolean {
  const y = yearOf(date); const m = monthOf(date); const d = dayOf(date);
  const last = daysInMonth(y, m);

  if (rule.byMonthDay.length) {
    return rule.byMonthDay.some((n) => (n > 0 ? n === d : last + n + 1 === d));
  }
  if (rule.byDay.length) {
    return rule.byDay.some((b) => {
      if (b.day !== dowOf(date)) return false;
      if (b.ordinal == null) return true;
      if (b.ordinal > 0) return Math.ceil(d / 7) === b.ordinal;
      // Negative ordinal counts back from the end: -1FR is the last Friday.
      return Math.ceil((last - d + 1) / 7) === -b.ordinal;
    });
  }
  if (opts.ignoreDefault) return true;
  // No BY* parts: repeat on the anchor's day, clamped to short months.
  const target = Math.min(dayOf(dtstart), last);
  return d === target;
}

const MAX_SCAN_DAYS = 366 * 30;

/** Occurrences in [from, to], inclusive. */
export function between(
  rrule: string, dtstart: DateStr, from: DateStr, to: DateStr, limit = 500,
): DateStr[] {
  const rule = parseRRule(rrule);
  const out: DateStr[] = [];
  const start = diffDays(from, dtstart) > 0 ? from : dtstart;
  if (diffDays(start, to) > 0) return out;

  // COUNT is relative to DTSTART, so it has to be counted from there.
  let seen = 0;
  let cursor = rule.count != null ? dtstart : start;
  const days = diffDays(to, cursor);
  const scan = Math.min(days, MAX_SCAN_DAYS);
  for (let i = 0; i <= scan; i++) {
    const date = addDays(cursor, i);
    if (!matches(rule, dtstart, date)) continue;
    seen++;
    if (rule.count != null && seen > rule.count) break;
    if (diffDays(date, from) >= 0) {
      out.push(date);
      if (out.length >= limit) break;
    }
  }
  return out;
}

/** The latest occurrence on or before `date`, or null if there is none.
 *  This is the one that is actually outstanding when work has been missed:
 *  a yearly job skipped twice is due this year, not three years ago. */
export function lastOnOrBefore(
  rrule: string, dtstart: DateStr, date: DateStr, notBefore?: DateStr | null,
): DateStr | null {
  if (diffDays(date, dtstart) < 0) return null;
  const floor = notBefore && diffDays(notBefore, dtstart) > 0 ? notBefore : dtstart;
  const window = addDays(date, -MAX_SCAN_DAYS);
  const from = diffDays(floor, window) > 0 ? floor : window;
  const hits = between(rrule, dtstart, from, date, 20000);
  return hits.at(-1) ?? null;
}

/** The first occurrence strictly after `after`, or null when the rule is spent. */
export function nextAfter(rrule: string, dtstart: DateStr, after: DateStr): DateStr | null {
  const rule = parseRRule(rrule);
  if (rule.count != null) {
    // With COUNT, the rule has a finite tail; expand from the start and look past `after`.
    const all = between(rrule, dtstart, dtstart, addDays(dtstart, MAX_SCAN_DAYS), rule.count);
    return all.find((d) => diffDays(d, after) > 0) ?? null;
  }
  const start = diffDays(after, dtstart) >= 0 ? addDays(after, 1) : dtstart;
  for (let i = 0; i < MAX_SCAN_DAYS; i++) {
    const date = addDays(start, i);
    if (rule.until && diffDays(date, rule.until) > 0) return null;
    if (matches(rule, dtstart, date)) return date;
  }
  return null;
}

export { toEpochDay };
