/**
 * Garden arithmetic: the handful of calculations worth getting right because a
 * person cannot do them in their head in March.
 *
 * Everything here is pure. Dates are ISO day strings, the same as everywhere
 * else, and a garden year is anchored to two of them — the last spring frost
 * and the first autumn frost — because almost every sowing decision is
 * expressed relative to one or the other.
 */

import { addDays, diffDays } from './date.js';

export const GROWING_METHODS = [
  'raised', 'in_ground', 'container', 'greenhouse', 'polytunnel', 'hydroponic',
] as const;
export type GrowingMethod = typeof GROWING_METHODS[number];

export const SOW_METHODS = ['direct', 'indoor', 'transplant'] as const;
export type SowMethod = typeof SOW_METHODS[number];

export const PLANTING_STATUS = [
  'planned', 'growing', 'harvesting', 'finished', 'failed',
] as const;
export type PlantingStatus = typeof PLANTING_STATUS[number];

export const SEED_ORIGINS = ['bought', 'saved', 'swapped', 'gifted', 'library'] as const;
export type SeedOrigin = typeof SEED_ORIGINS[number];

/** Origins that kept seed out of a shop, for the self-sufficiency figure (CIRC-016). */
export const CIRCULAR_SEED_ORIGINS: readonly SeedOrigin[] = ['saved', 'swapped', 'gifted', 'library'];

export const OBSERVATION_KINDS = ['pest', 'disease', 'weather', 'note'] as const;

/**
 * Frost dates, held as month-day so they survive the turn of the year.
 * A garden without them still works; it just cannot advise on timing.
 */
export interface FrostDates {
  /** Last spring frost, "MM-DD". */
  lastSpring: string | null;
  /** First autumn frost, "MM-DD". */
  firstAutumn: string | null;
}

/** Resolves a "MM-DD" frost date into an actual day in a given year. */
export function frostDay(monthDay: string | null, year: number): string | null {
  if (!monthDay || !/^\d{2}-\d{2}$/.test(monthDay)) return null;
  return `${year}-${monthDay}`;
}

/**
 * When a variety may be sown, expressed as an offset in weeks from a frost
 * date. "Start tomatoes six weeks before the last frost" is how seed packets
 * actually talk, and storing it that way means the window moves with the
 * household's own climate rather than a hard-coded calendar.
 */
export interface SowWindow {
  /** Which frost date the offsets are relative to. */
  anchor: 'last_spring' | 'first_autumn';
  /** Negative is before the frost date, positive after. */
  startWeeks: number;
  endWeeks: number;
  method?: SowMethod;
}

export type SowVerdict = 'too_early' | 'open' | 'closing' | 'too_late' | 'unknown';

export interface SowAdvice {
  verdict: SowVerdict;
  opensOn: string | null;
  closesOn: string | null;
  daysUntilOpen: number | null;
  daysLeft: number | null;
  note: string;
}

/**
 * Whether today is a sensible day to sow this variety. Deliberately gives an
 * opinion rather than a date range: "three weeks too early" is what a person
 * needs to hear in February.
 */
export function sowAdvice(
  window: SowWindow | null | undefined,
  frost: FrostDates,
  today: string,
): SowAdvice {
  const none: SowAdvice = {
    verdict: 'unknown', opensOn: null, closesOn: null,
    daysUntilOpen: null, daysLeft: null,
    note: 'No sowing window recorded for this variety.',
  };
  if (!window) return none;

  const year = Number(today.slice(0, 4));
  const anchorMonthDay = window.anchor === 'last_spring' ? frost.lastSpring : frost.firstAutumn;
  const anchor = frostDay(anchorMonthDay, year);
  if (!anchor) {
    return { ...none, note: 'Set the property’s frost dates to get sowing advice.' };
  }

  const opensOn = addDays(anchor, Math.round(window.startWeeks * 7));
  const closesOn = addDays(anchor, Math.round(window.endWeeks * 7));
  const untilOpen = diffDays(opensOn, today);
  const untilClose = diffDays(closesOn, today);

  if (untilOpen > 0) {
    return {
      verdict: 'too_early', opensOn, closesOn,
      daysUntilOpen: untilOpen, daysLeft: untilClose,
      note: `Too early — the window opens in ${untilOpen} day${untilOpen === 1 ? '' : 's'}.`,
    };
  }
  if (untilClose < 0) {
    return {
      verdict: 'too_late', opensOn, closesOn,
      daysUntilOpen: null, daysLeft: untilClose,
      note: `Too late — the window closed ${-untilClose} day${untilClose === -1 ? '' : 's'} ago.`,
    };
  }
  if (untilClose <= 10) {
    return {
      verdict: 'closing', opensOn, closesOn, daysUntilOpen: null, daysLeft: untilClose,
      note: `Last chance — ${untilClose} day${untilClose === 1 ? '' : 's'} left in the window.`,
    };
  }
  return {
    verdict: 'open', opensOn, closesOn, daysUntilOpen: null, daysLeft: untilClose,
    note: `In the window, with ${untilClose} days left.`,
  };
}

/**
 * Seed does not expire on a date; it loses vigour over seasons. A lot is
 * described by how many seasons old it is against the variety's typical
 * viability, and by a germination test where one was done — because a tested
 * old lot is worth more than an untested new one (GARD-010).
 */
export interface SeedViability {
  seasons: number;
  viabilityYears: number | null;
  /** 0..1 where a test exists. */
  testedRate: number | null;
  status: 'good' | 'ageing' | 'past' | 'unknown';
  note: string;
}

export function seedViability(
  lot: { yearPacked: number | null; germinationRate: number | null },
  viabilityYears: number | null,
  today: string,
): SeedViability {
  const thisYear = Number(today.slice(0, 4));
  const seasons = lot.yearPacked ? thisYear - lot.yearPacked : 0;
  const rate = lot.germinationRate != null ? lot.germinationRate : null;

  if (rate != null) {
    // A test beats an estimate. Say what it found and leave the age as context.
    const status = rate >= 0.7 ? 'good' : rate >= 0.4 ? 'ageing' : 'past';
    return {
      seasons, viabilityYears, testedRate: rate, status,
      note: `Tested at ${Math.round(rate * 100)}% germination${
        seasons ? `, ${seasons} season${seasons === 1 ? '' : 's'} old` : ''}.`,
    };
  }
  if (!lot.yearPacked || viabilityYears == null) {
    return {
      seasons, viabilityYears, testedRate: null, status: 'unknown',
      note: 'No packing year or typical viability recorded.',
    };
  }
  if (seasons > viabilityYears) {
    return {
      seasons, viabilityYears, testedRate: null, status: 'past',
      note: `${seasons} seasons old, past the ${viabilityYears}-year typical viability. Worth a germination test before sowing.`,
    };
  }
  if (seasons >= viabilityYears - 1) {
    return {
      seasons, viabilityYears, testedRate: null, status: 'ageing',
      note: `${seasons} seasons old, near the end of its typical ${viabilityYears} years. Sow thickly or test it.`,
    };
  }
  return {
    seasons, viabilityYears, testedRate: null, status: 'good',
    note: seasons === 0 ? 'Packed this year.' : `${seasons} season${seasons === 1 ? '' : 's'} old.`,
  };
}

/**
 * Rotation. Growing the same botanical family in the same ground year after
 * year concentrates whatever eats it. The rule is crude and everybody knows
 * it, which is exactly why it should be checked automatically rather than
 * remembered (GARD-004).
 */
export interface RotationConflict {
  family: string;
  lastGrown: string;
  seasonsAgo: number;
  variety: string;
}

export function rotationConflict(
  family: string | null,
  history: Array<{ family: string | null; sownOn: string; variety: string }>,
  today: string,
  withinSeasons = 2,
): RotationConflict | null {
  if (!family) return null;
  const thisYear = Number(today.slice(0, 4));
  const clashes = history
    .filter((h) => h.family === family)
    .map((h) => ({ ...h, seasonsAgo: thisYear - Number(h.sownOn.slice(0, 4)) }))
    .filter((h) => h.seasonsAgo >= 0 && h.seasonsAgo < withinSeasons)
    .sort((a, b) => a.seasonsAgo - b.seasonsAgo);
  const worst = clashes[0];
  if (!worst) return null;
  return {
    family, lastGrown: worst.sownOn, seasonsAgo: worst.seasonsAgo, variety: worst.variety,
  };
}

/** Dates a planting implies, from the variety and the method used. */
export interface PlantingSchedule {
  startIndoorsOn: string | null;
  hardenOffOn: string | null;
  transplantOn: string | null;
  firstHarvestOn: string | null;
}

export function plantingSchedule(input: {
  method: SowMethod;
  sownOn: string;
  daysToMaturity: number | null;
  /** Weeks under cover before going out, for an indoor start. */
  indoorWeeks?: number | null;
}): PlantingSchedule {
  const { method, sownOn, daysToMaturity } = input;
  const indoorWeeks = input.indoorWeeks ?? 6;

  if (method === 'indoor') {
    const transplantOn = addDays(sownOn, indoorWeeks * 7);
    return {
      startIndoorsOn: sownOn,
      hardenOffOn: addDays(transplantOn, -10),
      transplantOn,
      // Days to maturity are conventionally counted from transplant for a
      // crop started under cover, not from sowing.
      firstHarvestOn: daysToMaturity ? addDays(transplantOn, daysToMaturity) : null,
    };
  }
  if (method === 'transplant') {
    return {
      startIndoorsOn: null, hardenOffOn: null, transplantOn: sownOn,
      firstHarvestOn: daysToMaturity ? addDays(sownOn, daysToMaturity) : null,
    };
  }
  return {
    startIndoorsOn: null, hardenOffOn: null, transplantOn: null,
    firstHarvestOn: daysToMaturity ? addDays(sownOn, daysToMaturity) : null,
  };
}

/** Successive sowings of the same thing, so a household eats lettuce all summer. */
export function successionDates(
  first: string, everyDays: number, count: number, until?: string | null,
): string[] {
  if (everyDays <= 0 || count <= 0) return [first];
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const d = addDays(first, i * everyDays);
    if (until && d > until) break;
    out.push(d);
  }
  return out;
}
