/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * The garden service.
 *
 * Two jobs worth doing here rather than in a route: turning a planting into the
 * tasks it implies, and turning a harvest into pantry stock. Both are places
 * where the garden stops being a separate thing and becomes part of the house.
 */
import { and, desc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import {
  addDays, plantingSchedule, rotationConflict, seedViability, sowAdvice,
  type FrostDates, type PlantingSchedule, type RotationConflict, type SowMethod,
} from '@homestead/shared';
import type { Ctx } from '../core/ctx.js';
import { badRequest, notFound } from '../core/errors.js';
import {
  beds, harvests, plantings, plantVarieties, products, properties, seedLots,
  stockItems, tasks, transactionLineItems,
} from '../db/schema.js';
import { addStock } from './stock.js';
import { recordAvoided, tryRecordActivity } from './carbon.js';

/**
 * Frost dates live on the primary property. A garden without them still works;
 * it just cannot advise on timing (GARD-014).
 */
export async function frostDatesOf(ctx: Ctx, propertyId?: string | null): Promise<FrostDates> {
  const row = propertyId
    ? (await ctx.db.select().from(properties).where(eq(properties.id, propertyId)).limit(1))[0]
    : (await ctx.db.select().from(properties)
      .where(and(eq(properties.isPrimary, true), isNull(properties.deletedAt))).limit(1))[0];
  const profile = (row?.profile ?? {}) as Record<string, unknown>;
  const lastSpring = typeof profile.lastFrost === 'string' ? profile.lastFrost : null;
  const firstAutumn = typeof profile.firstFrost === 'string' ? profile.firstFrost : null;
  return { lastSpring, firstAutumn };
}

export async function primaryPropertyId(ctx: Ctx): Promise<string | null> {
  const row = (await ctx.db.select({ id: properties.id }).from(properties)
    .where(and(eq(properties.isPrimary, true), isNull(properties.deletedAt))).limit(1))[0];
  return row?.id ?? null;
}

/** What has grown in a bed, for the rotation check (GARD-004). */
export async function bedHistory(
  ctx: Ctx, bedId: string,
): Promise<Array<{ family: string | null; sownOn: string; variety: string }>> {
  const rows = await ctx.db.select({
    family: plantVarieties.family,
    sownOn: plantings.sownOn,
    name: plantVarieties.name,
    cultivar: plantVarieties.cultivar,
  }).from(plantings)
    .innerJoin(plantVarieties, eq(plantVarieties.id, plantings.varietyId))
    .where(and(eq(plantings.bedId, bedId), isNull(plantings.deletedAt)))
    .orderBy(desc(plantings.sownOn));
  return rows.map((r) => ({
    family: r.family,
    sownOn: r.sownOn,
    variety: r.cultivar ? `${r.name} '${r.cultivar}'` : r.name,
  }));
}

export async function checkRotation(
  ctx: Ctx, bedId: string | null, varietyId: string, on?: string,
): Promise<RotationConflict | null> {
  if (!bedId) return null;
  const variety = (await ctx.db.select().from(plantVarieties)
    .where(eq(plantVarieties.id, varietyId)).limit(1))[0];
  if (!variety?.family) return null;
  return rotationConflict(variety.family, await bedHistory(ctx, bedId), on ?? ctx.today);
}

/**
 * A planting generates the work it implies, through the ordinary task engine
 * so it lands wherever tasks land (GARD-013). Dates come from the variety's
 * days to maturity rather than a person's memory.
 */
export async function plantingTasks(
  ctx: Ctx,
  planting: typeof plantings.$inferSelect,
  variety: typeof plantVarieties.$inferSelect,
  bedName: string | null,
): Promise<{ schedule: PlantingSchedule; created: number }> {
  const schedule = plantingSchedule({
    method: planting.method as SowMethod,
    sownOn: planting.sownOn,
    daysToMaturity: variety.daysToMaturity,
    indoorWeeks: variety.indoorWeeks,
  });

  const label = variety.cultivar ? `${variety.name} '${variety.cultivar}'` : variety.name;
  const where = bedName ? ` — ${bedName}` : '';
  const wanted: Array<{ title: string; due: string | null; note?: string }> = [
    { title: `Harden off ${label}${where}`, due: schedule.hardenOffOn,
      note: 'Ten days of increasing time outside before it goes in the ground.' },
    { title: `Transplant ${label}${where}`, due: schedule.transplantOn },
    { title: `First harvest expected: ${label}${where}`, due: schedule.firstHarvestOn,
      note: 'An estimate from days to maturity, not a promise.' },
  ];

  let created = 0;
  for (const w of wanted) {
    if (!w.due) continue;
    const [row] = await ctx.db.insert(tasks).values({
      title: w.title,
      descriptionMd: w.note ?? null,
      dueDate: w.due,
      originType: 'planting',
      originId: planting.id,
      propertyId: null,
      createdBy: ctx.user?.id ?? null,
      updatedBy: ctx.user?.id ?? null,
    }).returning();
    if (row) created++;
  }
  return { schedule, created };
}

/**
 * What a harvest was worth: the household's own price for the same product
 * where it has one, and the variety's shipped typical price otherwise. The
 * basis is always stated, because one of those is evidence and the other is a
 * guess (GARD-020).
 */
export async function harvestValue(
  ctx: Ctx,
  variety: typeof plantVarieties.$inferSelect,
  quantity: number,
  unit: string,
): Promise<{ value: number | null; basis: string }> {
  // The household's own purchase history for a product of the same name is the
  // better answer whenever it exists.
  const own = await ctx.db.select({
    unitPrice: transactionLineItems.unitPrice,
    unit: transactionLineItems.unit,
  }).from(transactionLineItems)
    .innerJoin(products, eq(products.id, transactionLineItems.productId))
    .where(and(
      sql`lower(${products.name}) like ${'%' + variety.name.toLowerCase() + '%'}`,
      sql`${transactionLineItems.unitPrice} > 0`,
    ))
    .orderBy(desc(transactionLineItems.id))
    .limit(8);

  const matching = own.filter((o) => o.unit === unit);
  if (matching.length) {
    const avg = matching.reduce((a, b) => a + (b.unitPrice ?? 0), 0) / matching.length;
    return {
      value: Math.round(avg * quantity),
      basis: `your own price for ${variety.name}, averaged over ${matching.length} purchase${matching.length === 1 ? '' : 's'}`,
    };
  }
  if (variety.typicalPrice && variety.typicalPriceUnit === unit) {
    return {
      value: Math.round(variety.typicalPrice * quantity),
      basis: 'a shipped typical price — buy some and this becomes your own figure',
    };
  }
  return { value: null, basis: 'no price available for this unit' };
}

/**
 * Booking a harvest. Optionally puts it in the pantry as ordinary stock so
 * home-grown and bought food are held identically (INT-009), and records what
 * the bought equivalent would have emitted — as a counterfactual, never as a
 * credit against the footprint (GARD-022, GHG-038).
 */
export async function recordHarvest(ctx: Ctx, args: {
  plantingId: string;
  harvestedOn?: string;
  quantity: number;
  unit?: string;
  quality?: string | null;
  notes?: string | null;
  toPantry?: { locationId?: string | null; productId?: string | null } | null;
}): Promise<{
  harvest: typeof harvests.$inferSelect;
  stockItem: typeof stockItems.$inferSelect | null;
  avoided: { gCo2e: number; counterfactual: string } | null;
}> {
  const planting = (await ctx.db.select().from(plantings)
    .where(eq(plantings.id, args.plantingId)).limit(1))[0];
  if (!planting) throw notFound('Planting');
  const variety = (await ctx.db.select().from(plantVarieties)
    .where(eq(plantVarieties.id, planting.varietyId)).limit(1))[0];
  if (!variety) throw notFound('Variety');
  if (args.quantity <= 0) throw badRequest('A harvest has to be more than nothing');

  const unit = args.unit ?? 'lb';
  const on = args.harvestedOn ?? ctx.today;
  const { value, basis } = await harvestValue(ctx, variety, args.quantity, unit);

  let stockItem: typeof stockItems.$inferSelect | null = null;
  if (args.toPantry) {
    const productId = args.toPantry.productId ?? await productForVariety(ctx, variety);
    stockItem = await addStock(ctx, {
      productId,
      quantity: args.quantity,
      unit,
      locationId: args.toPantry.locationId ?? null,
      purchasedAt: on,
      unitPrice: value != null && args.quantity > 0 ? Math.round(value / args.quantity) : null,
      note: `Harvested from ${variety.name}`,
    });
  }

  const [harvest] = await ctx.db.insert(harvests).values({
    plantingId: args.plantingId,
    harvestedOn: on,
    quantity: args.quantity,
    unit,
    quality: args.quality ?? null,
    stockItemId: stockItem?.id ?? null,
    estValue: value,
    valueBasis: basis,
    notes: args.notes ?? null,
    createdBy: ctx.user?.id ?? null,
    updatedBy: ctx.user?.id ?? null,
  }).returning();

  // Growing it emitted something too — the compost, the water, the seed — and
  // that is recorded where those were bought. What is recorded here is only
  // what the bought equivalent would have emitted, kept out of the footprint.
  let avoided: { gCo2e: number; counterfactual: string } | null = null;
  if (variety.emissionFactorKey) {
    const estimate = await estimateBoughtEquivalent(ctx, variety.emissionFactorKey, args.quantity, unit, on);
    if (estimate) {
      await recordAvoided(ctx, {
        sourceType: 'harvest', sourceId: harvest!.id, occurredOn: on,
        counterfactual: `${args.quantity} ${unit} of ${variety.name}, not bought`,
        gCo2e100: estimate, cost: value ?? 0, category: 'garden', basis: 'estimated',
      });
      avoided = { gCo2e: estimate, counterfactual: `${args.quantity} ${unit} of ${variety.name}, not bought` };
    }
  }

  if (planting.status === 'growing') {
    await ctx.db.update(plantings).set({ status: 'harvesting', updatedBy: ctx.user?.id ?? null })
      .where(eq(plantings.id, planting.id));
  }

  return { harvest: harvest!, stockItem, avoided };
}

/** Finds or creates the pantry product a harvest of this variety becomes. */
async function productForVariety(
  ctx: Ctx, variety: typeof plantVarieties.$inferSelect,
): Promise<string> {
  const existing = (await ctx.db.select().from(products).where(and(
    sql`lower(${products.name}) = ${variety.name.toLowerCase()}`,
    isNull(products.deletedAt),
  )).limit(1))[0];
  if (existing) return existing.id;

  const [made] = await ctx.db.insert(products).values({
    name: variety.name,
    isFood: variety.category !== 'flower',
    defaultUnit: variety.typicalPriceUnit ?? 'lb',
    emissionFactorKey: variety.emissionFactorKey,
    notes: 'Created from a garden harvest.',
    createdBy: ctx.user?.id ?? null,
    updatedBy: ctx.user?.id ?? null,
  }).returning();
  return made!.id;
}

/** The emissions a bought equivalent would have carried, for the counterfactual. */
async function estimateBoughtEquivalent(
  ctx: Ctx, factorKey: string, quantity: number, unit: string, on: string,
): Promise<number | null> {
  const { estimateEmbodied } = await import('./carbon.js');
  const grams = await estimateEmbodied(ctx, [{
    quantity, unit, unitMassKg: null, emissionFactorKey: factorKey,
  }], on);
  return grams > 0 ? grams : null;
}

/** Everything a bed is, was and will be — the answer to "what is in Bed 4?" */
export async function bedDetail(ctx: Ctx, bedId: string): Promise<any> {
  const bed = (await ctx.db.select().from(beds).where(eq(beds.id, bedId)).limit(1))[0];
  if (!bed) throw notFound('Bed');

  const rows = await ctx.db.select({ planting: plantings, variety: plantVarieties })
    .from(plantings)
    .innerJoin(plantVarieties, eq(plantVarieties.id, plantings.varietyId))
    .where(and(eq(plantings.bedId, bedId), isNull(plantings.deletedAt)))
    .orderBy(desc(plantings.sownOn));

  const ids = rows.map((r) => r.planting.id);
  const harvestRows = ids.length
    ? await ctx.db.select().from(harvests).where(and(
      inArray(harvests.plantingId, ids), isNull(harvests.deletedAt),
    ))
    : [];

  return {
    bed,
    plantings: rows.map((r) => ({
      ...r.planting,
      variety: r.variety,
      harvested: harvestRows.filter((h) => h.plantingId === r.planting.id)
        .reduce((a, b) => a + b.quantity, 0),
      value: harvestRows.filter((h) => h.plantingId === r.planting.id)
        .reduce((a, b) => a + (b.estValue ?? 0), 0),
    })),
    history: await bedHistory(ctx, bedId),
    totals: {
      harvests: harvestRows.length,
      value: harvestRows.reduce((a, b) => a + (b.estValue ?? 0), 0),
      perSqft: bed.areaSqft
        ? Math.round(harvestRows.reduce((a, b) => a + (b.estValue ?? 0), 0) / bed.areaSqft)
        : null,
    },
  };
}

/** Seed lots with their viability worked out, which is what makes the drawer useful. */
export async function seedDrawer(ctx: Ctx): Promise<any[]> {
  const rows = await ctx.db.select({ lot: seedLots, variety: plantVarieties })
    .from(seedLots)
    .innerJoin(plantVarieties, eq(plantVarieties.id, seedLots.varietyId))
    .where(isNull(seedLots.deletedAt));

  const frost = await frostDatesOf(ctx);
  return rows.map((r) => ({
    ...r.lot,
    variety: r.variety,
    viability: seedViability(
      { yearPacked: r.lot.yearPacked, germinationRate: r.lot.germinationRate },
      r.variety.seedViabilityYears, ctx.today,
    ),
    sow: sowAdvice(r.variety.sowWindow as any, frost, ctx.today),
  }));
}

/**
 * The garden's net position: what it cost and emitted against what it yielded
 * and displaced. A garden that is a net emitter should be able to say so
 * (GARD-024).
 */
export async function gardenNet(ctx: Ctx, from: string, to: string): Promise<{
  harvestCount: number; harvestValue: number;
  avoidedGCo2e: number; inputGCo2e: number; inputCost: number;
  net: 'ahead' | 'behind' | 'even';
  note: string;
}> {
  const { avoidedBetween, emittedByMany } = await import('./carbon.js');
  const harvestRows = await ctx.db.select().from(harvests).where(and(
    isNull(harvests.deletedAt), gte(harvests.harvestedOn, from), lte(harvests.harvestedOn, to),
  ));
  const bedRows = await ctx.db.select({ id: beds.id }).from(beds).where(isNull(beds.deletedAt));
  const emitted = bedRows.length
    ? await emittedByMany(ctx, 'bed', bedRows.map((b) => b.id))
    : new Map<string, number>();
  const inputGCo2e = [...emitted.values()].reduce((a, b) => a + b, 0);

  const avoided = await avoidedBetween(ctx, from, to);
  const gardenAvoided = avoided.byCategory.find((c) => c.category === 'garden')?.total100 ?? 0;
  const value = harvestRows.reduce((a, b) => a + (b.estValue ?? 0), 0);

  const ahead = gardenAvoided - inputGCo2e;
  return {
    harvestCount: harvestRows.length,
    harvestValue: value,
    avoidedGCo2e: gardenAvoided,
    inputGCo2e,
    inputCost: 0,
    net: ahead > 0 ? 'ahead' : ahead < 0 ? 'behind' : 'even',
    note: inputGCo2e === 0
      ? 'No garden inputs recorded, so this compares a harvest against nothing. Record the compost, the water and the plastic to make it a real comparison.'
      : ahead > 0
        ? 'The produce displaced more than the inputs emitted.'
        : 'The inputs emitted more than the produce displaced — which is common in a first season with new beds and bought soil.',
  };
}

/** Garden input: soil, fertiliser, netting. Cost and carbon, like any purchase (GARD-023). */
export async function recordGardenInput(ctx: Ctx, args: {
  bedId?: string | null;
  factorKey: string;
  quantity: number;
  unit: string;
  occurredOn?: string;
  note?: string | null;
  transactionId?: string | null;
}): Promise<{ gCo2e: number } | null> {
  const result = await tryRecordActivity(ctx, {
    type: 'material',
    amount: args.quantity,
    unit: args.unit,
    occurredOn: args.occurredOn,
    factorKey: args.factorKey,
    transactionId: args.transactionId ?? null,
    sourceType: 'garden_input',
    note: args.note ?? null,
    attributions: args.bedId ? [{ entityType: 'bed', entityId: args.bedId }] : [],
  });
  return result ? { gCo2e: result.gCo2e } : null;
}

export { addDays };
