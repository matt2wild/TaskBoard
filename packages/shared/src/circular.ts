/**
 * The circular economy: what did not have to be bought.
 *
 * Every other measure in this system records consumption. This one records its
 * absence, which is harder to do honestly. The rule the whole module hangs on
 * is that an avoided emission is not a negative emission: it is a statement
 * about a world that did not happen, and it is reported beside the footprint
 * and never inside it (GHG-038).
 */

export const REPAIR_OUTCOMES = ['fixed', 'partial', 'failed', 'replaced'] as const;
export type RepairOutcome = typeof REPAIR_OUTCOMES[number];

export const CIRCULATION_KINDS = [
  'repaired', 'repurposed', 'given', 'received', 'sold', 'swapped',
  'salvaged', 'refilled', 'borrowed', 'lent', 'composted', 'harvested',
] as const;
export type CirculationKind = typeof CIRCULATION_KINDS[number];

/** Kinds that keep a thing out of a waste stream, as opposed to moving it about. */
export const DIVERTING_KINDS: readonly CirculationKind[] = [
  'repaired', 'repurposed', 'given', 'sold', 'swapped', 'salvaged', 'composted',
];

/**
 * An avoided quantity, always carrying the sentence that explains what it is
 * counterfactual to. An unexplained "avoided" figure is worse than none
 * (CIRC-018).
 */
export interface Avoided {
  gCo2e100: number;
  gCo2e20: number;
  cost: number;
  counterfactual: string;
  basis: 'measured' | 'estimated';
}

export interface RepairVerdict {
  /** Cost per year of life bought by repairing. */
  repairCostPerYear: number | null;
  /** Cost per year of the replacement over its own life. */
  replaceCostPerYear: number | null;
  /** True when repairing is cheaper per year of service. */
  repairWins: boolean | null;
  /** Carbon per year of service, the same comparison in the other unit. */
  repairGCo2ePerYear: number | null;
  replaceGCo2ePerYear: number | null;
  /** Set when money and carbon disagree, which is the interesting case. */
  measuresDisagree: boolean;
  note: string;
}

/**
 * Repair or replace, in both units.
 *
 * The comparison people usually make is repair cost against replacement cost,
 * which is wrong: it ignores that the two buy different amounts of remaining
 * life. Per year of service is the comparison that means something.
 *
 * The case worth surfacing is where the two measures disagree — a repair that
 * costs more per year but avoids manufacturing an appliance — because that is
 * a decision the household has to make rather than a calculation to read off.
 */
export function repairOrReplace(input: {
  repairCost: number;
  extendedLifeYears: number;
  replacementCost: number;
  replacementLifeYears: number;
  replacementEmbodiedGCo2e: number;
  /** Running cost and emissions a year, where the replacement differs. */
  currentAnnualCost?: number;
  replacementAnnualCost?: number;
  currentAnnualGCo2e?: number;
  replacementAnnualGCo2e?: number;
}): RepairVerdict {
  const {
    repairCost, extendedLifeYears, replacementCost, replacementLifeYears,
    replacementEmbodiedGCo2e,
  } = input;

  if (extendedLifeYears <= 0 || replacementLifeYears <= 0) {
    return {
      repairCostPerYear: null, replaceCostPerYear: null, repairWins: null,
      repairGCo2ePerYear: null, replaceGCo2ePerYear: null, measuresDisagree: false,
      note: 'Give both an expected life to compare them.',
    };
  }

  const curCost = input.currentAnnualCost ?? 0;
  const newCost = input.replacementAnnualCost ?? curCost;
  const curGas = input.currentAnnualGCo2e ?? 0;
  const newGas = input.replacementAnnualGCo2e ?? curGas;

  const repairCostPerYear = repairCost / extendedLifeYears + curCost;
  const replaceCostPerYear = replacementCost / replacementLifeYears + newCost;

  // Repairing manufactures nothing, so its embodied carbon is zero; the running
  // difference is the only carbon in play on that side.
  const repairGCo2ePerYear = curGas;
  const replaceGCo2ePerYear = replacementEmbodiedGCo2e / replacementLifeYears + newGas;

  const cheaper = repairCostPerYear <= replaceCostPerYear;
  const cleaner = repairGCo2ePerYear <= replaceGCo2ePerYear;
  const disagree = cheaper !== cleaner;

  let note: string;
  if (!disagree) {
    note = cheaper
      ? 'Repairing is cheaper and cleaner per year of service.'
      : 'Replacing is cheaper and cleaner per year of service — an efficient replacement can genuinely beat keeping an old machine going.';
  } else if (cleaner) {
    note = 'Repairing costs more per year but avoids manufacturing a replacement. Which matters more is a judgement, not a calculation.';
  } else {
    note = 'Replacing costs less per year, but only pays back in carbon because the new one runs cleaner. If it does not, keep the old one.';
  }

  return {
    repairCostPerYear: Math.round(repairCostPerYear),
    replaceCostPerYear: Math.round(replaceCostPerYear),
    repairWins: cheaper,
    repairGCo2ePerYear: Math.round(repairGCo2ePerYear),
    replaceGCo2ePerYear: Math.round(replaceGCo2ePerYear),
    measuresDisagree: disagree,
    note,
  };
}

/**
 * What a successful repair avoided: the replacement that was not manufactured,
 * pro-rated for the fact that a repair usually buys less life than a new one
 * would have. Claiming the whole embodied carbon of a new appliance for a
 * repair that bought four years of a fifteen-year machine would be the usual
 * kind of overstatement.
 */
export function avoidedByRepair(input: {
  extendedLifeYears: number;
  replacementCost: number;
  replacementLifeYears: number;
  replacementEmbodiedGCo2e: number;
  label?: string;
}): Avoided {
  const share = Math.min(input.extendedLifeYears / Math.max(input.replacementLifeYears, 1), 1);
  const g = Math.round(input.replacementEmbodiedGCo2e * share);
  return {
    // Embodied carbon is a mixture reported as CO₂e, so it does not re-evaluate
    // with the horizon. Saying so is better than scaling something we cannot.
    gCo2e100: g,
    gCo2e20: g,
    cost: Math.round(input.replacementCost * share),
    counterfactual: `${input.label ?? 'A replacement'}, not bought — ${
      Math.round(share * 100)}% of its embodied carbon, for the ${
      input.extendedLifeYears} year${input.extendedLifeYears === 1 ? '' : 's'} this repair bought.`,
    basis: 'estimated',
  };
}

export interface CircularitySummary {
  repairs: number;
  repairsFixed: number;
  successRate: number | null;
  itemsCirculated: number;
  moneyAvoided: number;
  gCo2eAvoided100: number;
  gCo2eAvoided20: number;
}

export function summariseCircularity(input: {
  repairs: Array<{ outcome: RepairOutcome; avoidedCost: number | null; avoidedGCo2e: number | null }>;
  events: Array<{ kind: CirculationKind; value: number | null; avoidedGCo2e: number | null }>;
  compostedGCo2e100?: number;
  compostedGCo2e20?: number;
}): CircularitySummary {
  const fixed = input.repairs.filter((r) => r.outcome === 'fixed' || r.outcome === 'partial');
  const money = input.repairs.reduce((a, r) => a + (r.avoidedCost ?? 0), 0)
    + input.events.reduce((a, e) => a + (e.value ?? 0), 0);
  const carbon = input.repairs.reduce((a, r) => a + (r.avoidedGCo2e ?? 0), 0)
    + input.events.reduce((a, e) => a + (e.avoidedGCo2e ?? 0), 0);
  return {
    repairs: input.repairs.length,
    repairsFixed: fixed.length,
    successRate: input.repairs.length ? fixed.length / input.repairs.length : null,
    itemsCirculated: input.events.filter((e) => (DIVERTING_KINDS as readonly string[]).includes(e.kind)).length,
    moneyAvoided: money,
    gCo2eAvoided100: carbon + (input.compostedGCo2e100 ?? 0),
    gCo2eAvoided20: carbon + (input.compostedGCo2e20 ?? 0),
  };
}
