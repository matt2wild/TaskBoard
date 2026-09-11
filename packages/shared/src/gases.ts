/**
 * Greenhouse gases, and the potentials that turn them into a common unit.
 *
 * CO₂e is a convenience and, like most conveniences, it hides the thing that
 * matters. Methane is roughly thirty times as warming as carbon dioxide over a
 * century and roughly eighty times as warming over twenty years, because it is
 * a strong absorber that leaves the atmosphere quickly. A household's two most
 * consequential choices — what it does with food waste, and whether it burns
 * gas — look far less important at the hundred-year horizon that almost every
 * report silently assumes.
 *
 * So the system stores gases and derives equivalence, never the reverse
 * (GHG-031, GHG-033). Aggregating late is what makes a different horizon a
 * re-reading of the same record rather than a rewrite of it.
 */

/** The periods over which a potential can be stated. */
export const HORIZONS = [100, 20] as const;
export type Horizon = typeof HORIZONS[number];
export const DEFAULT_HORIZON: Horizon = 100;

export interface GasDef {
  key: string;
  name: string;
  formula: string | null;
  /** Warming relative to CO₂ over one hundred years. */
  gwp100: number;
  /** …and over twenty. For methane this is nearly three times gwp100. */
  gwp20: number;
  /** Years, roughly. Null where the concept does not apply cleanly. */
  lifetimeYears: number | null;
  /** Carbon that was recently in the atmosphere, so its CO₂ is not counted again. */
  biogenic: boolean;
  kind: 'primary' | 'refrigerant' | 'mixture';
  source: string;
  notes?: string;
}

const AR6 = 'IPCC AR6 WG1 Chapter 7 (2021)';
const AR6_BLEND = 'IPCC AR6 component values, blended by mass fraction';

/**
 * Values are AR6. They differ from the AR5 numbers still in wide use — methane
 * went from 28 to 29.8 over a century — which is precisely why each emission
 * snapshots the potential it was computed with.
 */
export const GASES: Record<string, GasDef> = {
  co2: {
    key: 'co2', name: 'Carbon dioxide', formula: 'CO₂',
    gwp100: 1, gwp20: 1, lifetimeYears: null, biogenic: false,
    kind: 'primary', source: AR6,
    notes: 'The reference gas, by definition 1 at every horizon.',
  },
  ch4_fossil: {
    key: 'ch4_fossil', name: 'Methane (fossil)', formula: 'CH₄',
    gwp100: 29.8, gwp20: 82.5, lifetimeYears: 11.8, biogenic: false,
    kind: 'primary', source: AR6,
    notes: 'Fossil methane carries a higher potential than biogenic because its oxidation adds fossil CO₂ to the atmosphere.',
  },
  ch4_bio: {
    key: 'ch4_bio', name: 'Methane (biogenic)', formula: 'CH₄',
    gwp100: 27.0, gwp20: 79.7, lifetimeYears: 11.8, biogenic: true,
    kind: 'primary', source: AR6,
    notes: 'Landfill, compost, and livestock. The carbon was recently in the air, so only the methane step is counted.',
  },
  n2o: {
    key: 'n2o', name: 'Nitrous oxide', formula: 'N₂O',
    gwp100: 273, gwp20: 273, lifetimeYears: 109, biogenic: false,
    kind: 'primary', source: AR6,
    notes: 'Long-lived, so the horizon barely changes it. Comes mostly from soil nitrogen and combustion.',
  },

  /* Refrigerants. A household meets these as blends in a nameplate charge. */
  r32: {
    key: 'r32', name: 'R-32 (difluoromethane)', formula: 'CH₂F₂',
    gwp100: 771, gwp20: 2690, lifetimeYears: 5.4, biogenic: false,
    kind: 'refrigerant', source: AR6,
  },
  r125: {
    key: 'r125', name: 'R-125 (pentafluoroethane)', formula: 'C₂HF₅',
    gwp100: 3740, gwp20: 6740, lifetimeYears: 30, biogenic: false,
    kind: 'refrigerant', source: AR6,
  },
  r134a: {
    key: 'r134a', name: 'R-134a', formula: 'CH₂FCF₃',
    gwp100: 1530, gwp20: 4140, lifetimeYears: 14, biogenic: false,
    kind: 'refrigerant', source: AR6,
  },
  r143a: {
    key: 'r143a', name: 'R-143a', formula: 'CH₃CF₃',
    gwp100: 5810, gwp20: 7840, lifetimeYears: 51, biogenic: false,
    kind: 'refrigerant', source: AR6,
  },
  r22: {
    key: 'r22', name: 'R-22 (HCFC-22)', formula: 'CHClF₂',
    gwp100: 1960, gwp20: 5690, lifetimeYears: 11.9, biogenic: false,
    kind: 'refrigerant', source: AR6,
    notes: 'Phased out, but still in older air conditioners and heat pumps.',
  },
  r410a: {
    key: 'r410a', name: 'R-410A', formula: 'R-32/R-125 50/50',
    gwp100: 2256, gwp20: 4715, lifetimeYears: null, biogenic: false,
    kind: 'mixture', source: AR6_BLEND,
    notes: 'Common in heat pumps and split systems. Over twenty years it is more than twice as strong as its hundred-year figure.',
  },
  r404a: {
    key: 'r404a', name: 'R-404A', formula: 'R-125/R-143a/R-134a',
    gwp100: 4728, gwp20: 7208, lifetimeYears: null, biogenic: false,
    kind: 'mixture', source: AR6_BLEND,
    notes: 'Commercial refrigeration; occasionally a chest freezer.',
  },
  r290: {
    key: 'r290', name: 'R-290 (propane)', formula: 'C₃H₈',
    gwp100: 3, gwp20: 3, lifetimeYears: null, biogenic: false,
    kind: 'refrigerant', source: AR6,
    notes: 'A hydrocarbon refrigerant: near-zero potential, which is why new appliances are moving to it.',
  },
  r600a: {
    key: 'r600a', name: 'R-600a (isobutane)', formula: 'C₄H₁₀',
    gwp100: 3, gwp20: 3, lifetimeYears: null, biogenic: false,
    kind: 'refrigerant', source: AR6,
    notes: 'In most modern domestic fridges.',
  },
  r1234yf: {
    key: 'r1234yf', name: 'R-1234yf', formula: 'CF₃CF=CH₂',
    gwp100: 1, gwp20: 1, lifetimeYears: null, biogenic: false,
    kind: 'refrigerant', source: AR6,
    notes: 'Car air conditioning since the 2010s.',
  },
  r744: {
    key: 'r744', name: 'R-744 (carbon dioxide)', formula: 'CO₂',
    gwp100: 1, gwp20: 1, lifetimeYears: null, biogenic: false,
    kind: 'refrigerant', source: AR6,
  },
  sf6: {
    key: 'sf6', name: 'Sulphur hexafluoride', formula: 'SF₆',
    gwp100: 24300, gwp20: 18300, lifetimeYears: 3200, biogenic: false,
    kind: 'primary', source: AR6,
    notes: 'Unusual in a house, but it is the strongest of them and worth naming.',
  },

  /**
   * The honest placeholder. Most published factors — food, materials, most
   * services — give a single CO₂e figure and no composition. Recording that as
   * a mixture says so, rather than inventing a split the source never made
   * (GHG-032).
   */
  co2e: {
    key: 'co2e', name: 'Unspecified mixture', formula: null,
    gwp100: 1, gwp20: 1, lifetimeYears: null, biogenic: false,
    kind: 'mixture', source: 'Reported as CO₂e by the factor source',
    notes: 'The source gave an equivalent figure without a gas breakdown. It cannot be re-evaluated at a different horizon, and is carried forward unchanged.',
  },
};

export const GAS_KEYS = Object.keys(GASES);

/** A gas whose potential genuinely varies with the horizon. */
export function isHorizonSensitive(gasKey: string): boolean {
  const g = GASES[gasKey];
  if (!g) return false;
  return g.gwp20 !== g.gwp100;
}

export function gasDef(gasKey: string): GasDef | null {
  return GASES[gasKey] ?? null;
}

/**
 * The potential to apply. An unknown gas returns null rather than 1: silently
 * treating something unrecognised as carbon dioxide would understate it by
 * whatever factor it actually is.
 */
export function gwpFor(gasKey: string, horizon: Horizon = DEFAULT_HORIZON): number | null {
  const g = GASES[gasKey];
  if (!g) return null;
  return horizon === 20 ? g.gwp20 : g.gwp100;
}

/**
 * A mass of one gas, in **milligrams** of the gas itself.
 *
 * Milligrams rather than grams because the trace gases are tiny and their
 * potentials are enormous: two thirds of a gram of nitrous oxide is 184 g of
 * CO₂e, and rounding it up to a whole gram would report 273. A gram of R-410A
 * is 2.26 kg. Integer milligrams keep a household decade inside a safe integer
 * with room to spare, and they keep the rounding error below the point where
 * anyone could notice it.
 */
export interface GasMass {
  gas: string;
  /** Milligrams of the gas itself. */
  massMg: number;
}

export interface GasAmount extends GasMass {
  gwp: number;
  /** Grams of CO₂e, the unit every total is expressed in. */
  gCo2e: number;
}

/** Applies potentials to gas masses at a horizon. The whole point of storing masses. */
export function toCo2e(masses: GasMass[], horizon: Horizon = DEFAULT_HORIZON): GasAmount[] {
  return masses.map((m) => {
    // An unspecified mixture is already CO₂e and is carried through untouched;
    // re-evaluating it at another horizon is exactly what we cannot do.
    const gwp = gwpFor(m.gas, horizon) ?? 1;
    return { ...m, gwp, gCo2e: Math.round((m.massMg / 1000) * gwp) };
  });
}

export function totalCo2e(masses: GasMass[], horizon: Horizon = DEFAULT_HORIZON): number {
  return toCo2e(masses, horizon).reduce((a, b) => a + b.gCo2e, 0);
}

/**
 * How much a total changes between horizons, as a ratio. A household whose
 * waste is mostly landfilled sees a number well above 1; one that is all
 * electricity sees exactly 1.
 */
export function horizonSensitivity(masses: GasMass[]): number {
  const at100 = totalCo2e(masses, 100);
  if (at100 === 0) return 1;
  return totalCo2e(masses, 20) / at100;
}

/** A factor's coefficient expressed per gas, in kg of gas per activity unit. */
export type GasVector = Record<string, number>;

/**
 * The CO₂e a gas vector comes to per activity unit, used to keep the factor's
 * headline `kgPerUnit` in step with its composition.
 */
export function vectorToKgCo2e(vector: GasVector, horizon: Horizon = DEFAULT_HORIZON): number {
  let total = 0;
  for (const [gas, kg] of Object.entries(vector)) {
    total += kg * (gwpFor(gas, horizon) ?? 1);
  }
  return total;
}

/** Sums gas masses by gas, for rolling many emissions into one breakdown. */
export function sumByGas(masses: GasMass[]): GasMass[] {
  const m = new Map<string, number>();
  for (const g of masses) m.set(g.gas, (m.get(g.gas) ?? 0) + g.massMg);
  return [...m].map(([gas, massMg]) => ({ gas, massMg }));
}

/**
 * A mass of an actual gas, which is a different quantity from a mass of CO₂e
 * and should never be shown as though it were. Takes milligrams.
 */
export function formatGasMass(mg: number | null | undefined): string {
  if (mg == null) return '—';
  const sign = mg < 0 ? '-' : '';
  const abs = Math.abs(mg);
  if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(1).replace(/\.0$/, '')} t`;
  if (abs >= 1e6) return `${sign}${Math.round(abs / 1e6)} kg`;
  if (abs >= 10_000) return `${sign}${Math.round(abs / 1000)} g`;
  if (abs >= 1000) return `${sign}${(abs / 1000).toFixed(1)} g`;
  // Below a gram, milligrams read better than a string of leading zeros.
  return `${sign}${Math.round(abs)} mg`;
}

export function gasLabel(gasKey: string): string {
  return GASES[gasKey]?.name ?? gasKey;
}
