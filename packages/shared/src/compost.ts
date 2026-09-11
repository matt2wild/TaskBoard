/**
 * Compost arithmetic.
 *
 * A pile is managed by two numbers: the ratio of carbon to nitrogen in what
 * went into it, and its temperature. Both are easy to get wrong by feel and
 * easy to get right by sum, which is the whole case for a computer being
 * involved in a heap of vegetable peelings.
 */

export const COMPOST_METHODS = [
  'hot_pile', 'cold_pile', 'tumbler', 'worm', 'bokashi', 'trench', 'municipal',
] as const;
export type CompostMethod = typeof COMPOST_METHODS[number];

export const COMPOST_EVENT_KINDS = ['turned', 'watered', 'temperature', 'harvested'] as const;
export type CompostEventKind = typeof COMPOST_EVENT_KINDS[number];

/** Days between turns that each method implies, floating from the last one. */
export const TURN_INTERVAL_DAYS: Record<CompostMethod, number | null> = {
  hot_pile: 4,
  cold_pile: 60,
  tumbler: 3,
  worm: 14,
  bokashi: null,     // sealed and anaerobic by design; turning it defeats it
  trench: null,
  municipal: null,
};

/** The band a working aerobic pile wants to sit in, by mass. */
export const CN_TARGET = { low: 25, high: 30 } as const;

/** Above this a hot pile is doing what it is for; below it has stalled. */
export const THERMOPHILIC_F = { low: 130, high: 160 } as const;

export interface CompostInputLine {
  /** Kilograms. Everything is weighed to the same unit before it gets here. */
  kg: number;
  /** Carbon to nitrogen, by mass, from the material library. */
  cnRatio: number;
}

export interface CnBalance {
  ratio: number | null;
  totalKg: number;
  /** Carbon and nitrogen masses implied by the inputs, in arbitrary consistent units. */
  carbon: number;
  nitrogen: number;
  status: 'too_wet' | 'good' | 'too_dry' | 'unknown';
  advice: string;
}

/**
 * The running balance of a pile.
 *
 * The arithmetic people get wrong is that C:N is not an average of the
 * ratios — it is the ratio of the totals. Twenty kilograms of sawdust at
 * 400:1 and twenty of grass at 20:1 do not make a pile at 210:1; they make one
 * at about 38:1, because the sawdust brings very little nitrogen to divide by.
 */
export function cnBalance(lines: CompostInputLine[]): CnBalance {
  const usable = lines.filter((l) => l.kg > 0 && l.cnRatio > 0);
  if (!usable.length) {
    return {
      ratio: null, totalKg: 0, carbon: 0, nitrogen: 0, status: 'unknown',
      advice: 'Nothing recorded in this pile yet.',
    };
  }
  // Treat each kilogram as one unit of dry matter split between C and N in the
  // stated ratio. The absolute scale cancels in the division.
  let carbon = 0;
  let nitrogen = 0;
  let totalKg = 0;
  for (const l of usable) {
    const n = l.kg / (l.cnRatio + 1);
    carbon += n * l.cnRatio;
    nitrogen += n;
    totalKg += l.kg;
  }
  const ratio = nitrogen > 0 ? carbon / nitrogen : null;
  if (ratio == null) {
    return { ratio, totalKg, carbon, nitrogen, status: 'unknown', advice: 'Not enough to judge.' };
  }
  if (ratio < CN_TARGET.low) {
    return {
      ratio, totalKg, carbon, nitrogen, status: 'too_wet',
      advice: `At ${ratio.toFixed(0)}:1 there is more nitrogen than the pile can use. Add browns — dry leaves, cardboard, straw — or it will go slimy and smell of ammonia.`,
    };
  }
  if (ratio > CN_TARGET.high) {
    return {
      ratio, totalKg, carbon, nitrogen, status: 'too_dry',
      advice: `At ${ratio.toFixed(0)}:1 the pile is carbon-heavy and will sit there. Add greens — kitchen scraps, grass, coffee grounds — to get it working.`,
    };
  }
  return {
    ratio, totalKg, carbon, nitrogen, status: 'good',
    advice: `At ${ratio.toFixed(0)}:1 the balance is right. Keep it damp and turned.`,
  };
}

/** How much of a target ratio's worth of browns or greens would fix a pile. */
export function amendmentToTarget(
  balance: CnBalance, amendmentCn: number, target = (CN_TARGET.low + CN_TARGET.high) / 2,
): number | null {
  if (balance.ratio == null || amendmentCn <= 0) return null;
  // Solve for the mass m of amendment that brings (C + cm)/(N + nm) to target.
  const c = amendmentCn / (amendmentCn + 1);
  const n = 1 / (amendmentCn + 1);
  const denom = c - target * n;
  if (Math.abs(denom) < 1e-9) return null;
  const m = (target * balance.nitrogen - balance.carbon) / denom;
  return m > 0 ? Math.round(m * 10) / 10 : null;
}

export type PileHealth = 'cooking' | 'cooling' | 'stalled' | 'cold' | 'unknown';

export interface PileStatus {
  health: PileHealth;
  latestF: number | null;
  daysSinceReading: number | null;
  daysSinceTurn: number | null;
  turnDue: boolean;
  note: string;
}

/**
 * What the pile is doing, from its readings and turns. A hot pile that has
 * fallen out of the thermophilic range has usually either dried out or run out
 * of nitrogen, and either way wants turning (COMP-008).
 */
export function pileStatus(input: {
  method: CompostMethod;
  latestF: number | null;
  daysSinceReading: number | null;
  daysSinceTurn: number | null;
}): PileStatus {
  const interval = TURN_INTERVAL_DAYS[input.method];
  const turnDue = interval != null && input.daysSinceTurn != null && input.daysSinceTurn >= interval;
  const base = {
    latestF: input.latestF,
    daysSinceReading: input.daysSinceReading,
    daysSinceTurn: input.daysSinceTurn,
    turnDue,
  };

  if (input.method !== 'hot_pile' && input.method !== 'tumbler') {
    return {
      ...base, health: 'unknown',
      note: turnDue ? 'Due a turn.' : 'This method is not managed by temperature.',
    };
  }
  if (input.latestF == null) {
    return { ...base, health: 'unknown', note: 'No temperature taken yet.' };
  }
  if (input.latestF >= THERMOPHILIC_F.high) {
    return {
      ...base, health: 'cooking',
      note: `${Math.round(input.latestF)}°F and running hot. Turn it to let some heat out before it cooks the microbes that are making it.`,
    };
  }
  if (input.latestF >= THERMOPHILIC_F.low) {
    return { ...base, health: 'cooking', note: `${Math.round(input.latestF)}°F — thermophilic and working.` };
  }
  if (input.latestF >= 100) {
    return {
      ...base, health: 'cooling',
      note: `${Math.round(input.latestF)}°F and dropping out of the hot range. A turn will usually bring it back.`,
    };
  }
  if (input.latestF >= 70) {
    return {
      ...base, health: 'stalled',
      note: `${Math.round(input.latestF)}°F. Stalled: too dry, too little nitrogen, or finished. Check it is damp and add greens.`,
    };
  }
  return {
    ...base, health: 'cold',
    note: `${Math.round(input.latestF)}°F — cold. Either finished and curing, or it never got going.`,
  };
}

/**
 * How long a batch needs, roughly, by method. Used to say when compost is
 * likely ready rather than to promise that it is.
 */
export const MATURITY_DAYS: Record<CompostMethod, number | null> = {
  hot_pile: 90,
  cold_pile: 365,
  tumbler: 60,
  worm: 120,
  bokashi: 30,
  trench: 180,
  municipal: null,
};
