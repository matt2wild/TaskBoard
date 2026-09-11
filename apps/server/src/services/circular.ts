/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Repair, reuse, repurpose.
 *
 * Every other service records what was spent. This one records what was not,
 * which is the harder thing to do honestly. The discipline throughout is that
 * an avoided emission lives in its own table and never nets against the
 * footprint (GHG-038), and that every avoided figure carries the sentence
 * explaining what it is counterfactual to (CIRC-018).
 */
import { and, desc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import {
  avoidedByRepair, repairOrReplace, summariseCircularity,
  type CirculationKind, type RepairOutcome, type RepairVerdict,
} from '@homestead/shared';
import type { Ctx } from '../core/ctx.js';
import { badRequest, notFound } from '../core/errors.js';
import {
  assetCategories, assets, circulationEvents, loans, repairs,
} from '../db/schema.js';
import { attachCost } from './budget.js';
import { recordAvoided, avoidedBetween } from './carbon.js';

/**
 * Shipped embodied-carbon estimates for a replacement, by asset category.
 *
 * Cradle-to-gate figures from published appliance life-cycle studies, rounded
 * hard because the spread between studies is wider than the rounding. They
 * exist so a repair can be argued for on the first day; a household with a
 * real figure for its own machine should use that instead.
 */
export const EMBODIED_BY_CATEGORY: Record<string, number> = {
  refrigerator: 500_000,
  freezer: 450_000,
  dishwasher: 350_000,
  washer: 450_000,
  dryer: 350_000,
  'range-oven': 400_000,
  cooktop: 300_000,
  microwave: 100_000,
  'range-hood': 80_000,
  'garbage-disposal': 60_000,
  furnace: 800_000,
  boiler: 900_000,
  'heat-pump': 1_200_000,
  'air-conditioner-central': 700_000,
  'mini-split': 600_000,
  thermostat: 15_000,
  'water-heater': 400_000,
  'well-pump': 200_000,
  'sump-pump': 120_000,
  generator: 500_000,
  'ev-charger': 150_000,
  'lawn-mower': 150_000,
  'snow-blower': 200_000,
  tv: 400_000,
  'server-nas': 300_000,
  'network-equipment': 80_000,
};

/** A generic fallback, so a repair of something uncategorised still says something. */
const EMBODIED_FALLBACK = 200_000;

export async function embodiedForAsset(
  ctx: Ctx, asset: typeof assets.$inferSelect | null,
): Promise<{ grams: number; basis: string }> {
  if (!asset?.categoryId) {
    return { grams: EMBODIED_FALLBACK, basis: 'a generic household appliance — categorise the asset and this improves' };
  }
  const cat = (await ctx.db.select().from(assetCategories)
    .where(eq(assetCategories.id, asset.categoryId)).limit(1))[0];
  const slug = cat?.slug ?? '';
  const grams = EMBODIED_BY_CATEGORY[slug];
  if (grams) return { grams, basis: `a typical replacement ${cat!.name.toLowerCase()}` };
  return { grams: EMBODIED_FALLBACK, basis: 'a generic household appliance' };
}

/**
 * Years of life the recorded repairs have bought a thing. Derived from the
 * repairs rather than stamped on the asset, so deleting a repair correctly
 * takes its extension away with it.
 */
export async function extendedLifeFor(
  ctx: Ctx, targetType: string, targetId: string,
): Promise<number> {
  const rows = await ctx.db.select({ years: repairs.extendedLifeYears, outcome: repairs.outcome })
    .from(repairs).where(and(
      eq(repairs.targetType, targetType), eq(repairs.targetId, targetId),
      isNull(repairs.deletedAt),
    ));
  return rows
    .filter((r) => r.outcome === 'fixed' || r.outcome === 'partial')
    .reduce((a, b) => a + (b.years ?? 0), 0);
}

export async function extendedLifeForMany(
  ctx: Ctx, targetType: string, ids: string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!ids.length) return out;
  const rows = await ctx.db.select({
    targetId: repairs.targetId,
    total: sql<number>`coalesce(sum(${repairs.extendedLifeYears}), 0)`,
  }).from(repairs).where(and(
    eq(repairs.targetType, targetType),
    inArray(repairs.targetId, ids),
    inArray(repairs.outcome, ['fixed', 'partial']),
    isNull(repairs.deletedAt),
  )).groupBy(repairs.targetId);
  for (const r of rows) if (r.targetId) out.set(r.targetId, Number(r.total));
  return out;
}

/**
 * Logging a repair.
 *
 * Three things follow from the one entry: the cost joins the thing's cost of
 * ownership, a successful repair pushes out its expected replacement, and the
 * replacement that was not manufactured is recorded as an avoided figure —
 * pro-rated, because a repair that buys four years of a fifteen-year machine
 * has not avoided a whole appliance (CIRC-003, CIRC-004).
 */
export async function recordRepair(ctx: Ctx, args: {
  targetType?: string | null;
  targetId?: string | null;
  targetText?: string | null;
  occurredOn?: string;
  symptom: string;
  workDone?: string | null;
  partsCost?: number;
  timeMin?: number | null;
  byUserId?: string | null;
  byContactId?: string | null;
  outcome?: RepairOutcome;
  extendedLifeYears?: number | null;
  notes?: string | null;
  bookCost?: boolean;
}): Promise<{
  repair: typeof repairs.$inferSelect;
  avoided: { gCo2e: number; cost: number; counterfactual: string } | null;
}> {
  if (!args.targetId && !args.targetText) {
    throw badRequest('Say what was repaired, even if it is not in the registry');
  }
  const on = args.occurredOn ?? ctx.today;
  const outcome = args.outcome ?? 'fixed';
  const partsCost = args.partsCost ?? 0;

  let asset: typeof assets.$inferSelect | null = null;
  if (args.targetType === 'asset' && args.targetId) {
    asset = (await ctx.db.select().from(assets).where(eq(assets.id, args.targetId)).limit(1))[0] ?? null;
  }

  // A repair that worked but was not given a life extension still bought
  // something; assume a conservative two years rather than nothing.
  const extended = outcome === 'fixed' || outcome === 'partial'
    ? args.extendedLifeYears ?? 2
    : 0;

  let avoidedCost: number | null = null;
  let avoidedGrams: number | null = null;
  let counterfactual: string | null = null;

  if (extended > 0) {
    const { grams, basis } = await embodiedForAsset(ctx, asset);
    const replacementCost = asset?.replacementCostEstimate ?? asset?.purchasePrice ?? 0;
    const life = asset?.expectedLifespanYears ?? 12;
    const a = avoidedByRepair({
      extendedLifeYears: extended,
      replacementCost,
      replacementLifeYears: life,
      replacementEmbodiedGCo2e: grams,
      label: basis.startsWith('a ') ? basis.charAt(0).toUpperCase() + basis.slice(1) : basis,
    });
    avoidedCost = a.cost;
    avoidedGrams = a.gCo2e100;
    counterfactual = a.counterfactual;
  }

  let transactionId: string | null = null;
  if (args.bookCost && partsCost > 0) {
    const { transaction } = await attachCost(ctx, {
      amount: partsCost,
      date: on,
      memo: `Repair: ${args.symptom}`,
      attributions: args.targetType && args.targetId
        ? [{ entityType: args.targetType, entityId: args.targetId }]
        : [],
    });
    transactionId = transaction.id;
  }

  const [repair] = await ctx.db.insert(repairs).values({
    targetType: args.targetType ?? null,
    targetId: args.targetId ?? null,
    targetText: args.targetText ?? null,
    occurredOn: on,
    symptom: args.symptom,
    workDone: args.workDone ?? null,
    partsCost,
    timeMin: args.timeMin ?? null,
    byUserId: args.byUserId ?? ctx.user?.id ?? null,
    byContactId: args.byContactId ?? null,
    outcome,
    extendedLifeYears: extended || null,
    avoidedCost,
    avoidedGCo2e: avoidedGrams,
    transactionId,
    notes: args.notes ?? null,
    createdBy: ctx.user?.id ?? null,
    updatedBy: ctx.user?.id ?? null,
  }).returning();

  if (avoidedGrams && avoidedGrams > 0 && counterfactual) {
    await recordAvoided(ctx, {
      sourceType: 'repair', sourceId: repair!.id, occurredOn: on,
      counterfactual,
      gCo2e100: avoidedGrams, gCo2e20: avoidedGrams,
      cost: avoidedCost ?? 0, category: 'repair', basis: 'estimated',
    });
  }

  return {
    repair: repair!,
    avoided: avoidedGrams && counterfactual
      ? { gCo2e: avoidedGrams, cost: avoidedCost ?? 0, counterfactual }
      : null,
  };
}

/**
 * Repair or replace, for a specific asset, in money and in carbon.
 *
 * The interesting answer is the one where the two measures disagree, and the
 * function says so rather than picking for the household (CIRC-005).
 */
export async function repairOrReplaceFor(ctx: Ctx, assetId: string, args: {
  repairCost: number;
  extendedLifeYears?: number;
  replacementCost?: number;
  replacementAnnualCost?: number;
  replacementAnnualGCo2e?: number;
}): Promise<{
  verdict: RepairVerdict;
  asset: typeof assets.$inferSelect;
  assumptions: string[];
  embodied: number;
}> {
  const asset = (await ctx.db.select().from(assets).where(eq(assets.id, assetId)).limit(1))[0];
  if (!asset) throw notFound('Asset');

  const { grams, basis } = await embodiedForAsset(ctx, asset);
  const replacementCost = args.replacementCost ?? asset.replacementCostEstimate ?? asset.purchasePrice ?? 0;
  const life = asset.expectedLifespanYears ?? 12;
  const extended = args.extendedLifeYears ?? 3;

  // Running cost and emissions come from what this asset has actually done,
  // where there is a year of it to go on.
  const { emittedBy } = await import('./carbon.js');
  const { spentOn } = await import('./budget.js');
  const [carbon, money] = await Promise.all([
    emittedBy(ctx, 'asset', assetId),
    spentOn(ctx, 'asset', assetId),
  ]);

  const assumptions: string[] = [];
  if (!args.replacementCost && !asset.replacementCostEstimate) {
    assumptions.push('replacement cost taken from the original purchase price');
  }
  if (!asset.expectedLifespanYears) {
    assumptions.push('a twelve-year life for the replacement, because none is recorded');
  }
  assumptions.push(`${Math.round(grams / 1000)} kg embodied carbon for ${basis}`);
  if (!args.extendedLifeYears) assumptions.push('three years bought by the repair');
  if (args.replacementAnnualGCo2e == null) {
    assumptions.push('the replacement runs no cleaner than what you have — set a figure if it does');
  }

  const verdict = repairOrReplace({
    repairCost: args.repairCost,
    extendedLifeYears: extended,
    replacementCost,
    replacementLifeYears: life,
    replacementEmbodiedGCo2e: grams,
    currentAnnualCost: money.total > 0 ? Math.round(money.total / Math.max(life, 1)) : 0,
    replacementAnnualCost: args.replacementAnnualCost,
    currentAnnualGCo2e: carbon.total > 0 ? Math.round(carbon.total / Math.max(life, 1)) : 0,
    replacementAnnualGCo2e: args.replacementAnnualGCo2e,
  });

  return { verdict, asset, assumptions, embodied: grams };
}

/**
 * The circularity report.
 *
 * Loans, disposals and compost inputs are circulation by virtue of what they
 * are, so they are read from their own records rather than duplicated into the
 * event table (INT-013).
 */
export async function circularitySummary(ctx: Ctx, from: string, to: string): Promise<any> {
  const [repairRows, eventRows, loanRows, avoided] = await Promise.all([
    ctx.db.select().from(repairs).where(and(
      isNull(repairs.deletedAt), gte(repairs.occurredOn, from), lte(repairs.occurredOn, to),
    )).orderBy(desc(repairs.occurredOn)),
    ctx.db.select().from(circulationEvents).where(and(
      isNull(circulationEvents.deletedAt),
      gte(circulationEvents.occurredOn, from), lte(circulationEvents.occurredOn, to),
    )).orderBy(desc(circulationEvents.occurredOn)),
    ctx.db.select().from(loans).where(and(
      isNull(loans.deletedAt), gte(loans.lentAt, from), lte(loans.lentAt, to),
    )),
    avoidedBetween(ctx, from, to),
  ]);

  const summary = summariseCircularity({
    repairs: repairRows.map((r) => ({
      outcome: r.outcome as RepairOutcome,
      avoidedCost: r.avoidedCost,
      avoidedGCo2e: r.avoidedGCo2e,
    })),
    events: eventRows.map((e) => ({
      kind: e.kind as CirculationKind,
      value: e.value,
      avoidedGCo2e: e.avoidedGCo2e,
    })),
  });

  const compost = avoided.byCategory.find((c) => c.category === 'compost');
  const garden = avoided.byCategory.find((c) => c.category === 'garden');

  return {
    from, to,
    repairs: {
      count: repairRows.length,
      fixed: repairRows.filter((r) => r.outcome === 'fixed').length,
      partial: repairRows.filter((r) => r.outcome === 'partial').length,
      failed: repairRows.filter((r) => r.outcome === 'failed').length,
      successRate: summary.successRate,
      partsCost: repairRows.reduce((a, b) => a + b.partsCost, 0),
      items: repairRows.slice(0, 50),
    },
    circulation: {
      count: eventRows.length,
      loansOut: loanRows.length,
      byKind: countBy(eventRows.map((e) => e.kind)),
      items: eventRows.slice(0, 50),
    },
    /**
     * Avoided figures, kept apart from the footprint on purpose. The totals are
     * a statement about what did not happen and are never netted against what
     * did (GHG-038).
     */
    avoided: {
      total100: avoided.total100,
      total20: avoided.total20,
      cost: avoided.cost,
      byCategory: avoided.byCategory,
      compost: compost ?? null,
      garden: garden ?? null,
      items: avoided.items.slice(0, 50),
      note: 'These are counterfactuals: what a landfill, a factory or a supermarket would have emitted instead. They are reported beside the household footprint and never subtracted from it.',
    },
  };
}

function countBy(keys: string[]): Array<{ kind: string; count: number }> {
  const m = new Map<string, number>();
  for (const k of keys) m.set(k, (m.get(k) ?? 0) + 1);
  return [...m].map(([kind, count]) => ({ kind, count })).sort((a, b) => b.count - a.count);
}

/** Seed self-sufficiency: how much sowing came from outside a shop (CIRC-016). */
export async function seedSelfSufficiency(ctx: Ctx, year?: string): Promise<{
  total: number; circular: number; pct: number | null; byOrigin: Array<{ origin: string; count: number }>;
}> {
  const { plantings, seedLots } = await import('../db/schema.js');
  const y = year ?? ctx.today.slice(0, 4);
  const rows = await ctx.db.select({ origin: seedLots.origin })
    .from(plantings)
    .innerJoin(seedLots, eq(seedLots.id, plantings.seedLotId))
    .where(and(
      isNull(plantings.deletedAt),
      gte(plantings.sownOn, `${y}-01-01`), lte(plantings.sownOn, `${y}-12-31`),
    ));
  const circular = rows.filter((r) => r.origin !== 'bought').length;
  return {
    total: rows.length,
    circular,
    pct: rows.length ? Math.round((circular / rows.length) * 100) : null,
    byOrigin: countBy(rows.map((r) => r.origin)).map((c) => ({ origin: c.kind, count: c.count })),
  };
}
