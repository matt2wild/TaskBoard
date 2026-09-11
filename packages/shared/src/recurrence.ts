import { between, lastOnOrBefore, nextAfter } from './rrule.js';
import {
  type DateStr, type TimeStr, addDays, addMonths, addYears, diffDays, fromEpochDay, toEpochDay,
} from './date.js';

/**
 * Household recurrence. Two modes matter and they are not the same thing:
 *
 *  - `fixed`    the calendar decides. "Trash goes out Tuesday" is Tuesday even
 *               if you forgot last week. Next due comes from the RRULE.
 *  - `floating` the last completion decides. "Change the filter every 90 days"
 *               means 90 days after you actually changed it, not after the date
 *               it was nominally due.
 *
 * Getting this wrong is the difference between a trusted reminder system and a
 * nagging one, so it lives in its own module with its own tests.
 */

export type ScheduleMode = 'one_off' | 'fixed' | 'floating' | 'on_demand';

export interface Interval {
  days?: number;
  weeks?: number;
  months?: number;
  years?: number;
}

export interface ScheduleSpec {
  mode: ScheduleMode;
  /** RFC 5545 RRULE body without DTSTART, e.g. `FREQ=WEEKLY;BYDAY=TU`. */
  rrule?: string | null;
  /** `fixed`: the DTSTART. `floating`/`one_off`: the first due date. */
  anchorDate?: DateStr | null;
  /** `floating`: how long after completion the next one is due. */
  every?: Interval | null;
  /** Wall-clock time the instance is due, in the household timezone. */
  timeOfDay?: TimeStr | null;
  /** Days past due before the item is called overdue rather than due. */
  graceDays?: number | null;
  /** Stop generating after this date. */
  untilDate?: DateStr | null;
  /** Stop generating after this many instances (fixed mode). */
  count?: number | null;
}

export class RecurrenceError extends Error {}

export function addInterval(d: DateStr, iv: Interval): DateStr {
  let out = d;
  if (iv.years) out = addYears(out, iv.years);
  if (iv.months) out = addMonths(out, iv.months);
  if (iv.weeks) out = addDays(out, iv.weeks * 7);
  if (iv.days) out = addDays(out, iv.days);
  if (out === d) throw new RecurrenceError('interval must move the date');
  return out;
}

export function intervalDaysApprox(iv: Interval): number {
  return (iv.days ?? 0) + (iv.weeks ?? 0) * 7 + (iv.months ?? 0) * 30.44 + (iv.years ?? 0) * 365.25;
}

/** Folds the schedule's own until/count into the rule string. */
function ruleOf(spec: ScheduleSpec): { rrule: string; dtstart: DateStr } {
  if (!spec.rrule) throw new RecurrenceError('fixed schedule requires an rrule');
  if (!spec.anchorDate) throw new RecurrenceError('fixed schedule requires an anchorDate');
  let body = spec.rrule.trim().replace(/^RRULE:/i, '');
  if (spec.untilDate && !/UNTIL=/i.test(body)) body += `;UNTIL=${spec.untilDate.replace(/-/g, '')}`;
  if (spec.count && !/COUNT=/i.test(body) && !/UNTIL=/i.test(body)) body += `;COUNT=${spec.count}`;
  return { rrule: body, dtstart: spec.anchorDate };
}

export interface NextDueContext {
  /** Return the first due date strictly after this date. */
  after?: DateStr | null;
  /** The date the previous instance was actually completed. */
  lastCompletedAt?: DateStr | null;
  /** Today, in the household timezone. Used by on-demand mode. */
  today: DateStr;
}

/** The next date this schedule is due, or null when it is finished. */
export function nextDue(spec: ScheduleSpec, ctx: NextDueContext): DateStr | null {
  const after = ctx.after ?? null;
  const past = (d: DateStr | null | undefined) =>
    d != null && spec.untilDate != null && diffDays(d, spec.untilDate) > 0;

  switch (spec.mode) {
    case 'one_off': {
      if (ctx.lastCompletedAt) return null;
      return spec.anchorDate ?? null;
    }
    case 'fixed': {
      const { rrule, dtstart } = ruleOf(spec);
      const cursor = after ?? (ctx.lastCompletedAt ?? fromEpochDay(toEpochDay(dtstart) - 1));
      const d = nextAfter(rrule, dtstart, cursor);
      if (!d) return null;
      return past(d) ? null : d;
    }
    case 'floating': {
      if (!spec.every) throw new RecurrenceError('floating schedule requires an interval');
      let d: DateStr;
      if (ctx.lastCompletedAt) d = addInterval(ctx.lastCompletedAt, spec.every);
      else if (spec.anchorDate) d = spec.anchorDate;
      else d = addInterval(ctx.today, spec.every);
      // A floating schedule never reaches back into the past on regeneration.
      while (after && diffDays(d, after) <= 0) d = addInterval(d, spec.every);
      return past(d) ? null : d;
    }
    case 'on_demand': {
      if (!ctx.lastCompletedAt) return spec.anchorDate ?? ctx.today;
      const d = ctx.lastCompletedAt;
      return past(d) ? null : d;
    }
    default:
      throw new RecurrenceError(`unknown mode: ${(spec as ScheduleSpec).mode}`);
  }
}

/** Dates this schedule falls due within a window, for materialising a horizon. */
export function occurrences(
  spec: ScheduleSpec,
  from: DateStr,
  to: DateStr,
  opts: { limit?: number; lastCompletedAt?: DateStr | null; today?: DateStr } = {},
): DateStr[] {
  const limit = opts.limit ?? 100;
  const today = opts.today ?? from;
  if (spec.mode === 'fixed') {
    const { rrule, dtstart } = ruleOf(spec);
    return between(rrule, dtstart, from, to, limit);
  }
  // Non-fixed schedules only ever have one instance outstanding at a time:
  // the next one cannot be known until this one is completed.
  const d = nextDue(spec, { lastCompletedAt: opts.lastCompletedAt ?? null, today });
  if (!d) return [];
  return diffDays(d, from) >= 0 && diffDays(d, to) <= 0 ? [d] : [];
}

/**
 * The most recent occurrence that has already come round and was not completed,
 * or null when nothing is outstanding. Used to keep exactly one overdue
 * instance alive rather than resurrecting the first date the rule ever had.
 */
export function outstandingDue(
  spec: ScheduleSpec,
  ctx: { today: DateStr; lastCompletedAt?: DateStr | null },
): DateStr | null {
  switch (spec.mode) {
    case 'fixed': {
      const { rrule, dtstart } = ruleOf(spec);
      const floor = ctx.lastCompletedAt ? addDays(ctx.lastCompletedAt, 1) : null;
      const hit = lastOnOrBefore(rrule, dtstart, ctx.today, floor);
      if (!hit) return null;
      if (spec.untilDate && diffDays(hit, spec.untilDate) > 0) return null;
      return hit;
    }
    case 'floating':
    case 'one_off':
    case 'on_demand': {
      const due = nextDue(spec, { today: ctx.today, lastCompletedAt: ctx.lastCompletedAt ?? null });
      return due && diffDays(due, ctx.today) <= 0 ? due : null;
    }
    default:
      return null;
  }
}

export type DueStatus = 'none' | 'upcoming' | 'due_soon' | 'due' | 'grace' | 'overdue';

export function dueStatus(
  due: DateStr | null | undefined,
  today: DateStr,
  opts: { graceDays?: number | null; soonDays?: number } = {},
): DueStatus {
  if (!due) return 'none';
  const grace = opts.graceDays ?? 0;
  const soon = opts.soonDays ?? 7;
  const delta = diffDays(due, today); // positive = in the future
  if (delta > soon) return 'upcoming';
  if (delta > 0) return 'due_soon';
  if (delta === 0) return 'due';
  if (-delta <= grace) return 'grace';
  return 'overdue';
}

const DAY_NAMES: Record<string, string> = {
  MO: 'Monday', TU: 'Tuesday', WE: 'Wednesday', TH: 'Thursday',
  FR: 'Friday', SA: 'Saturday', SU: 'Sunday',
};

function describeInterval(iv: Interval): string {
  const parts: string[] = [];
  const push = (n: number | undefined, unit: string) => {
    if (!n) return;
    parts.push(n === 1 ? unit : `${n} ${unit}s`);
  };
  push(iv.years, 'year'); push(iv.months, 'month'); push(iv.weeks, 'week'); push(iv.days, 'day');
  return parts.join(' and ') || 'no time';
}

/** Plain-English description, shown wherever a schedule is displayed. */
export function describeSchedule(spec: ScheduleSpec): string {
  switch (spec.mode) {
    case 'one_off':
      return spec.anchorDate ? `Once on ${spec.anchorDate}` : 'Once';
    case 'on_demand':
      return 'Repeats as soon as it is completed';
    case 'floating':
      return spec.every ? `Every ${describeInterval(spec.every)} after it is done` : 'Floating';
    case 'fixed': {
      const body = (spec.rrule ?? '').replace(/^RRULE:/i, '');
      const parts = Object.fromEntries(
        body.split(';').filter(Boolean).map((kv) => {
          const [k = '', v = ''] = kv.split('=');
          return [k.toUpperCase(), v];
        }),
      );
      const n = Number(parts.INTERVAL ?? 1);
      const freq = (parts.FREQ ?? '').toUpperCase();
      const unit = { DAILY: 'day', WEEKLY: 'week', MONTHLY: 'month', YEARLY: 'year' }[freq] ?? 'period';
      const every = n === 1 ? `Every ${unit}` : `Every ${n} ${unit}s`;
      const byday = parts.BYDAY
        ? ' on ' + parts.BYDAY.split(',').map((d) => DAY_NAMES[d.slice(-2)] ?? d).join(', ')
        : '';
      const bymonth = parts.BYMONTH
        ? ' in ' + parts.BYMONTH.split(',')
          .map((m) => new Date(Date.UTC(2000, Number(m) - 1, 1)).toLocaleString('en', { month: 'long', timeZone: 'UTC' }))
          .join(', ')
        : '';
      return `${every}${byday}${bymonth}`;
    }
    default:
      return 'Unknown schedule';
  }
}

/** Common schedules offered in the UI, and used by the maintenance template library. */
export const PRESETS = {
  daily: { mode: 'fixed', rrule: 'FREQ=DAILY' },
  weekly: { mode: 'fixed', rrule: 'FREQ=WEEKLY' },
  biweekly: { mode: 'fixed', rrule: 'FREQ=WEEKLY;INTERVAL=2' },
  monthly: { mode: 'fixed', rrule: 'FREQ=MONTHLY' },
  quarterly: { mode: 'fixed', rrule: 'FREQ=MONTHLY;INTERVAL=3' },
  semiannual: { mode: 'fixed', rrule: 'FREQ=MONTHLY;INTERVAL=6' },
  yearly: { mode: 'fixed', rrule: 'FREQ=YEARLY' },
  every3years: { mode: 'fixed', rrule: 'FREQ=YEARLY;INTERVAL=3' },
  every10years: { mode: 'fixed', rrule: 'FREQ=YEARLY;INTERVAL=10' },
  springAndFall: { mode: 'fixed', rrule: 'FREQ=YEARLY;BYMONTH=4,10;BYMONTHDAY=1' },
  after30Days: { mode: 'floating', every: { days: 30 } },
  after90Days: { mode: 'floating', every: { days: 90 } },
  after6Months: { mode: 'floating', every: { months: 6 } },
  afterYear: { mode: 'floating', every: { years: 1 } },
} as const satisfies Record<string, Partial<ScheduleSpec> & { mode: ScheduleMode }>;
