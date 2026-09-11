import { areCompatible, convert, dimensionOf, normaliseUnit, UnitError } from './units.js';

/**
 * Emissions are counted in whole grams of CO₂ equivalent, for the same reason
 * money is counted in whole cents: totals that must add up cannot be floats.
 * A household year is on the order of 10^10 g, comfortably inside a safe
 * integer, and a gram is far finer than any factor's real accuracy.
 */
export type Grams = number;

export const KG = 1_000;
export const TONNE = 1_000_000;

export class CarbonError extends Error {}

export const SCOPES = [1, 2, 3] as const;
export type Scope = typeof SCOPES[number];

export const SCOPE_LABELS: Record<Scope, string> = {
  1: 'Burned here',
  2: 'Electricity bought',
  3: 'Everything else',
};

export const SCOPE_NOTES: Record<Scope, string> = {
  1: 'Fuel burned on the property and refrigerant that leaked out of it.',
  2: 'Electricity bought from the grid.',
  3: 'Embodied in the things you buy, and released by what you throw away.',
};

export const ACTIVITY_TYPES = [
  'electricity', 'natural_gas', 'heating_oil', 'propane', 'wood', 'district_heat',
  'vehicle_fuel', 'vehicle_distance', 'flight',
  'water', 'waste', 'refrigerant',
  'food', 'goods', 'material', 'pet_food', 'service',
  'generation', 'export',
] as const;
export type ActivityType = typeof ACTIVITY_TYPES[number];

/** Types that reduce the footprint rather than adding to it. */
export const CREDIT_TYPES: readonly ActivityType[] = ['generation', 'export'];

export const FACTOR_CONFIDENCE = ['high', 'medium', 'low'] as const;
export type FactorConfidence = typeof FACTOR_CONFIDENCE[number];

export interface EmissionFactor {
  id: string;
  key: string;
  name: string;
  /** The unit the factor is expressed per: kwh, therm, gal, kg, mi, m3… */
  activityUnit: string;
  kgPerUnit: number;
  scope: Scope;
  region: string | null;
  validFrom: string | null;
  validTo: string | null;
  confidence?: FactorConfidence;
}

/**
 * Converts an activity quantity into the factor's own unit and applies it.
 * Refuses a dimensional mismatch rather than guessing: a factor per kilogram
 * cannot be applied to a quantity in litres without a density nobody supplied.
 */
export function applyFactor(
  quantity: number, unit: string, factor: Pick<EmissionFactor, 'activityUnit' | 'kgPerUnit'>,
): { grams: Grams; quantityInFactorUnit: number } {
  if (!Number.isFinite(quantity)) throw new CarbonError('Quantity must be a number');
  const from = normaliseUnit(unit);
  const to = normaliseUnit(factor.activityUnit);
  if (!from) throw new CarbonError(`Unknown unit: ${unit}`);
  if (!to) throw new CarbonError(`Unknown factor unit: ${factor.activityUnit}`);

  let converted: number;
  if (from === to) {
    converted = quantity;
  } else if (areCompatible(from, to)) {
    try {
      converted = convert(quantity, from, to);
    } catch (err) {
      throw new CarbonError((err as UnitError).message);
    }
  } else {
    throw new CarbonError(
      `Cannot apply a factor measured per ${factor.activityUnit} to a quantity in ${unit}`,
    );
  }
  return {
    grams: Math.round(converted * factor.kgPerUnit * KG),
    quantityInFactorUnit: converted,
  };
}

/** Picks the factor that best fits a date and a region: most specific wins. */
export function resolveFactor<T extends EmissionFactor>(
  candidates: T[], opts: { on: string; region?: string | null },
): T | null {
  const usable = candidates.filter((f) => {
    if (f.validFrom && opts.on < f.validFrom) return false;
    if (f.validTo && opts.on > f.validTo) return false;
    if (f.region && opts.region && f.region !== opts.region) return false;
    return true;
  });
  if (!usable.length) return null;
  const score = (f: T) => {
    let s = 0;
    if (f.region && opts.region && f.region === opts.region) s += 4;
    else if (!f.region) s += 1;
    if (f.validFrom) s += 2; // a dated factor beats an open-ended one
    return s;
  };
  return usable.slice().sort((a, b) => {
    const d = score(b) - score(a);
    if (d !== 0) return d;
    return (b.validFrom ?? '').localeCompare(a.validFrom ?? '');
  })[0]!;
}

/** Human-readable, and deliberately imprecise: these are estimates. */
export function formatCo2e(grams: Grams | null | undefined, opts: { long?: boolean } = {}): string {
  if (grams == null) return '—';
  const sign = grams < 0 ? '-' : '';
  const abs = Math.abs(grams);
  const unit = opts.long ? { t: ' tonnes CO₂e', kg: ' kg CO₂e', g: ' g CO₂e' } : { t: ' t', kg: ' kg', g: ' g' };
  // One decimal on tonnes is already more precision than a household estimate
  // has earned, so there is no case for showing more (GHG-029).
  if (abs >= TONNE) {
    const tonnes = (abs / TONNE).toFixed(1).replace(/\.0$/, '');
    return `${sign}${tonnes}${unit.t}`;
  }
  if (abs >= KG) return `${sign}${Math.round(abs / KG)}${unit.kg}`;
  return `${sign}${Math.round(abs)}${unit.g}`;
}

export function parseCo2eInput(raw: string): Grams | null {
  const m = raw.trim().match(/^(-?[\d.,]+)\s*(t|tonne|tonnes|kg|g)?$/i);
  if (!m) return null;
  const value = Number(m[1]!.replace(/,/g, ''));
  if (!Number.isFinite(value)) return null;
  const unit = (m[2] ?? 'kg').toLowerCase();
  const scale = unit.startsWith('t') ? TONNE : unit === 'g' ? 1 : KG;
  return Math.round(value * scale);
}

export interface PaybackInput {
  capitalCost: number;          // minor units
  embodiedGrams: Grams;
  annualSavingCost: number;     // minor units per year
  annualSavingGrams: Grams;     // per year
  lifetimeYears?: number;
}

export interface Payback {
  financialYears: number | null;
  carbonYears: number | null;
  costPerTonne: number | null;   // minor units per tonne abated over the lifetime
  lifetimeSavingGrams: Grams;
  lifetimeSavingCost: number;
  netLifetimeGrams: Grams;
}

/**
 * The two questions worth asking of any efficiency measure: how long until it
 * pays for itself, and how long until it has saved more carbon than it cost to
 * make. Both can be null, and saying so is better than printing infinity.
 */
export function payback(input: PaybackInput): Payback {
  const years = input.lifetimeYears ?? 20;
  const financialYears = input.annualSavingCost > 0
    ? Number((input.capitalCost / input.annualSavingCost).toFixed(2))
    : null;
  const carbonYears = input.annualSavingGrams > 0
    ? Number((input.embodiedGrams / input.annualSavingGrams).toFixed(2))
    : null;
  const lifetimeSavingGrams = input.annualSavingGrams * years;
  const netLifetimeGrams = lifetimeSavingGrams - input.embodiedGrams;
  const abatedTonnes = netLifetimeGrams / TONNE;
  const netCost = input.capitalCost - input.annualSavingCost * years;
  return {
    financialYears,
    carbonYears,
    costPerTonne: abatedTonnes > 0 ? Math.round(netCost / abatedTonnes) : null,
    lifetimeSavingGrams,
    lifetimeSavingCost: input.annualSavingCost * years,
    netLifetimeGrams,
  };
}

/** Ranks interventions by carbon abated per unit of money, cheapest first. */
export function rankByAbatement<T extends { payback: Payback }>(items: T[]): T[] {
  return items.slice().sort((a, b) => {
    const ax = a.payback.costPerTonne;
    const bx = b.payback.costPerTonne;
    if (ax == null && bx == null) return 0;
    if (ax == null) return 1;
    if (bx == null) return -1;
    return ax - bx;
  });
}

/**
 * Meter readings become consumption by differencing, which sounds trivial until
 * a meter rolls over at 99999 or is replaced and starts again at zero.
 */
export function consumptionBetween(
  previous: { value: number; meterId?: string | null } | null,
  current: { value: number; meterId?: string | null },
  opts: { rolloverAt?: number | null; multiplier?: number } = {},
): number | null {
  if (!previous) return null;
  if (previous.meterId && current.meterId && previous.meterId !== current.meterId) return null;
  const multiplier = opts.multiplier ?? 1;
  let delta = current.value - previous.value;
  if (delta < 0) {
    if (opts.rolloverAt && opts.rolloverAt > 0) delta = opts.rolloverAt - previous.value + current.value;
    else return null; // a meter that went backwards is a data problem, not a negative reading
  }
  return Number((delta * multiplier).toFixed(6));
}

/** Splits an annual figure over months, losing nothing, for budget pacing. */
export function monthlyPacing(annual: Grams, weights?: number[]): Grams[] {
  const w = weights && weights.length === 12 ? weights : Array(12).fill(1);
  const total = w.reduce((a, b) => a + b, 0);
  const raw = w.map((x) => (annual * x) / total);
  const out = raw.map((r) => Math.floor(r));
  let remainder = annual - out.reduce((a, b) => a + b, 0);
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac);
  for (let k = 0; remainder > 0; k++) {
    out[order[k % 12]!.i] = out[order[k % 12]!.i]! + 1;
    remainder -= 1;
  }
  return out;
}

/**
 * Energy content of fuels sold by volume or mass. A gallon of oil is a volume,
 * but a heat pump replaces the *heat* in it, so a comparison between the two
 * needs this bridge. Values are higher heating value, approximate.
 */
export const FUEL_ENERGY_MJ: Record<string, { perUnit: number; unit: string }> = {
  heating_oil: { perUnit: 146.1, unit: 'gal' },   // ~138,500 BTU/gal, No. 2 distillate
  propane: { perUnit: 96.5, unit: 'gal' },        // ~91,500 BTU/gal
  gasoline: { perUnit: 131.8, unit: 'gal' },      // ~125,000 BTU/gal
  diesel: { perUnit: 146.1, unit: 'gal' },
  wood: { perUnit: 15.5, unit: 'kg' },            // seasoned hardwood, ~20% moisture
  vehicle_fuel: { perUnit: 131.8, unit: 'gal' },
};

/**
 * Energy content of a fuel quantity in megajoules. Tries a plain dimensional
 * conversion first — therms and kilowatt hours already *are* energy — and falls
 * back to the density table for fuels sold by volume or mass.
 */
export function fuelEnergyMj(quantity: number, unit: string, fuelType: string): number | null {
  try {
    if (dimensionOf(unit) === 'energy') return convert(quantity, unit, 'mj');
  } catch { /* fall through to the density table */ }
  const density = FUEL_ENERGY_MJ[fuelType];
  if (!density) return null;
  let inDensityUnit = quantity;
  if (unit !== density.unit) {
    if (!areCompatible(unit, density.unit)) return null;
    try { inDensityUnit = convert(quantity, unit, density.unit); } catch { return null; }
  }
  return inDensityUnit * density.perUnit;
}

/** Heating-weighted month shape, so a winter carbon budget is not flat. */
export const HEATING_SEASON_WEIGHTS = [1.6, 1.5, 1.2, 0.9, 0.7, 0.6, 0.6, 0.6, 0.7, 0.9, 1.3, 1.6];
