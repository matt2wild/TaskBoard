/* eslint-disable @typescript-eslint/no-explicit-any */
import { and, desc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import {
  addDays, applyFactor, applyFactorGases, areCompatible, consumptionBetween, resolveFactor,
  CREDIT_TYPES, DEFAULT_HORIZON, gwpFor,
  type ActivityType, type EmissionFactor, type Grams, type Horizon, type Scope,
} from '@homestead/shared';
import type { Ctx } from '../core/ctx.js';
import { badRequest, notFound } from '../core/errors.js';
import {
  activities, attributions, avoidedEmissions, emissionFactors, emissions, meters, readings,
} from '../db/schema.js';

export interface AttributionRef { entityType: string; entityId: string }

export interface RecordActivityInput {
  type: ActivityType | string;
  amount: number;
  unit: string;
  occurredOn?: string;
  propertyId?: string | null;
  locationId?: string | null;
  note?: string | null;
  transactionId?: string | null;
  sourceType?: string | null;
  sourceId?: string | null;
  readingId?: string | null;
  attributions?: AttributionRef[];
  /** Names the factor explicitly; otherwise it is resolved from the type. */
  factorKey?: string | null;
  /** Skips factor lookup entirely, for an amount already known in CO₂e. */
  explicitGrams?: Grams | null;
}

export interface RecordedActivity {
  activity: typeof activities.$inferSelect;
  emissions: Array<typeof emissions.$inferSelect>;
  gCo2e: Grams;
  /** The masses behind the equivalence, which is the point of storing gases. */
  byGas?: Array<{ gas: string; massMg: number; gCo2e: Grams }>;
  /** Set when no factor could be found, so callers can say so plainly. */
  unresolved?: string;
}

/** Activity types whose emissions are produced by more than one factor. */
const FACTOR_KEYS_BY_TYPE: Record<string, string[]> = {
  electricity: ['electricity.grid', 'electricity.upstream'],
  natural_gas: ['gas.combustion', 'gas.upstream'],
  heating_oil: ['oil.combustion', 'oil.upstream'],
  propane: ['propane.combustion', 'propane.upstream'],
  wood: ['wood.combustion'],
  district_heat: ['district_heat.supply'],
  vehicle_fuel: ['gasoline.combustion', 'gasoline.upstream'],
  vehicle_distance: ['vehicle.car_petrol'],
  water: ['water.supply'],
  waste: ['waste.landfill'],
  refrigerant: ['refrigerant.r410a'],
  generation: ['electricity.grid'],
  export: ['electricity.grid'],
};

async function factorsFor(ctx: Ctx, keys: string[]): Promise<Array<typeof emissionFactors.$inferSelect>> {
  if (!keys.length) return [];
  return ctx.db.select().from(emissionFactors).where(and(
    inArray(emissionFactors.key, keys),
    eq(emissionFactors.archived, false),
    isNull(emissionFactors.deletedAt),
  ));
}

function toDomain(row: typeof emissionFactors.$inferSelect): EmissionFactor {
  return {
    id: row.id, key: row.key, name: row.name, activityUnit: row.activityUnit,
    kgPerUnit: row.kgPerUnit, scope: row.scope as Scope, region: row.region,
    validFrom: row.validFrom, validTo: row.validTo, gases: row.gases ?? null,
  };
}

/**
 * The horizon a household reports at. An editorial choice rather than a
 * technical one, so it is a setting with a default rather than a constant
 * (GHG-039).
 */
export function horizonOf(ctx: Ctx): Horizon {
  const setting = ctx.household.settings?.gwpHorizon;
  return setting === 20 || setting === '20' ? 20 : DEFAULT_HORIZON;
}

/** The household's region, used to pick between regional factor variants. */
export function regionOf(ctx: Ctx): string | null {
  const fromSettings = ctx.household.settings?.emissionRegion;
  if (typeof fromSettings === 'string' && fromSettings) return fromSettings;
  // Fall back to the country implied by the locale, which is usually right.
  const parts = ctx.household.locale.split('-');
  return parts.length > 1 ? parts[parts.length - 1]!.toUpperCase() : null;
}

/**
 * The one path every module uses to record a footprint (GHG-004), the exact
 * counterpart of `attachCost`. A single household event calls both, so a
 * utility bill is entered once and yields money and carbon together.
 */
export async function recordActivity(ctx: Ctx, input: RecordActivityInput): Promise<RecordedActivity> {
  if (!Number.isFinite(input.amount)) throw badRequest('Activity amount must be a number');
  if (input.amount === 0) throw badRequest('Activity amount cannot be zero');

  const occurredOn = input.occurredOn ?? ctx.today;
  const isCredit = (CREDIT_TYPES as readonly string[]).includes(input.type);
  const horizon = horizonOf(ctx);

  const [activity] = await ctx.db.insert(activities).values({
    propertyId: input.propertyId ?? null,
    locationId: input.locationId ?? null,
    type: input.type,
    amount: input.amount,
    unit: input.unit,
    occurredOn,
    note: input.note ?? null,
    transactionId: input.transactionId ?? null,
    sourceType: input.sourceType ?? null,
    sourceId: input.sourceId ?? null,
    readingId: input.readingId ?? null,
    createdBy: ctx.user?.id ?? null,
    updatedBy: ctx.user?.id ?? null,
  }).returning();

  for (const ref of input.attributions ?? []) {
    await ctx.db.insert(attributions).values({
      sourceKind: 'activity', sourceId: activity!.id,
      entityType: ref.entityType, entityId: ref.entityId,
    }).onConflictDoNothing();
  }

  // An amount already expressed in CO₂e skips the factor library entirely.
  if (input.explicitGrams != null) {
    const signed = isCredit ? -Math.abs(input.explicitGrams) : input.explicitGrams;
    const [row] = await ctx.db.insert(emissions).values({
      activityId: activity!.id, factorId: null, factorKey: 'explicit',
      factorKgPerUnit: 0, quantityInFactorUnit: input.amount, factorUnit: input.unit,
      // An amount handed to us already in CO₂e has no composition to record.
      gas: 'co2e', massMg: signed * 1000, gwp: 1, gwpHorizon: horizon,
      gCo2e: signed,
      scope: 3, category: input.type,
      createdBy: ctx.user?.id ?? null,
    }).returning();
    return {
      activity: activity!, emissions: [row!], gCo2e: row!.gCo2e,
      byGas: [{ gas: 'co2e', massMg: signed * 1000, gCo2e: signed }],
    };
  }

  const keys = input.factorKey ? [input.factorKey] : FACTOR_KEYS_BY_TYPE[input.type] ?? [];
  const rows = await factorsFor(ctx, keys);
  const region = regionOf(ctx);

  const made: Array<typeof emissions.$inferSelect> = [];
  const byGas = new Map<string, { massMg: number; gCo2e: number }>();
  let total = 0;
  for (const key of keys) {
    const candidates = rows.filter((r) => r.key === key).map(toDomain);
    const chosen = resolveFactor(candidates, { on: occurredOn, region });
    if (!chosen) continue;

    // One row per gas, each carrying the mass of the gas itself alongside the
    // equivalence derived from it. Storing the mass is what lets the same
    // record be read at another horizon later without being rewritten.
    let applied: ReturnType<typeof applyFactorGases>;
    try {
      applied = applyFactorGases(Math.abs(input.amount), input.unit, chosen, horizon);
    } catch (err) {
      throw badRequest((err as Error).message);
    }
    const source = rows.find((r) => r.id === chosen.id)!;

    for (const g of applied.gases) {
      const massMg = isCredit ? -g.massMg : g.massMg;
      const gCo2e = isCredit ? -g.gCo2e : g.gCo2e;
      const [row] = await ctx.db.insert(emissions).values({
        activityId: activity!.id,
        factorId: chosen.id,
        factorKey: key,
        factorKgPerUnit: chosen.kgPerUnit,
        quantityInFactorUnit: applied.quantityInFactorUnit,
        factorUnit: chosen.activityUnit,
        gas: g.gas,
        massMg,
        gwp: g.gwp,
        gwpHorizon: horizon,
        gCo2e,
        scope: chosen.scope,
        category: source.category,
        createdBy: ctx.user?.id ?? null,
      }).returning();
      made.push(row!);
      const acc = byGas.get(g.gas) ?? { massMg: 0, gCo2e: 0 };
      byGas.set(g.gas, { massMg: acc.massMg + massMg, gCo2e: acc.gCo2e + gCo2e });
      total += gCo2e;
    }
  }

  return {
    activity: activity!,
    emissions: made,
    gCo2e: total,
    byGas: [...byGas].map(([gas, v]) => ({ gas, ...v })),
    ...(made.length ? {} : { unresolved: keys.length ? `No emission factor found for ${keys.join(', ')}` : `No factor mapped for activity type ${input.type}` }),
  };
}

/** Records an activity only if a factor exists, so callers can stay quiet. */
export async function tryRecordActivity(
  ctx: Ctx, input: RecordActivityInput,
): Promise<RecordedActivity | null> {
  try {
    const result = await recordActivity(ctx, input);
    return result.emissions.length ? result : null;
  } catch {
    return null; // a missing or mismatched factor must never fail the real work
  }
}

/* ────────────────────────────── roll-ups ───────────────────────────────── */

/** "What has this emitted?" — the counterpart of spentOn (INT-005, INT-007). */
export async function emittedBy(
  ctx: Ctx, entityType: string, entityId: string,
): Promise<{ total: Grams; count: number }> {
  const rows = await ctx.db.select({
    total: sql<number>`coalesce(sum(${emissions.gCo2e}), 0)`,
    count: sql<number>`count(distinct ${activities.id})`,
  }).from(attributions)
    .innerJoin(activities, eq(activities.id, attributions.sourceId))
    .innerJoin(emissions, eq(emissions.activityId, activities.id))
    .where(and(
      eq(attributions.sourceKind, 'activity'),
      eq(attributions.entityType, entityType),
      eq(attributions.entityId, entityId),
      isNull(activities.deletedAt),
    ));
  return { total: Number(rows[0]?.total ?? 0), count: Number(rows[0]?.count ?? 0) };
}

export async function emittedByMany(
  ctx: Ctx, entityType: string, ids: string[],
): Promise<Map<string, Grams>> {
  const out = new Map<string, Grams>(ids.map((i) => [i, 0]));
  if (!ids.length) return out;
  const rows = await ctx.db.select({
    id: attributions.entityId,
    total: sql<number>`coalesce(sum(${emissions.gCo2e}), 0)`,
  }).from(attributions)
    .innerJoin(activities, eq(activities.id, attributions.sourceId))
    .innerJoin(emissions, eq(emissions.activityId, activities.id))
    .where(and(
      eq(attributions.sourceKind, 'activity'),
      eq(attributions.entityType, entityType),
      inArray(attributions.entityId, ids),
      isNull(activities.deletedAt),
    ))
    .groupBy(attributions.entityId);
  for (const r of rows) out.set(r.id, Number(r.total));
  return out;
}

export interface FootprintSummary {
  from: string;
  to: string;
  total: Grams;
  byScope: Array<{ scope: number; total: Grams }>;
  byCategory: Array<{ category: string; total: Grams }>;
  byMonth: Array<{ month: string; total: Grams }>;
  byGas: Array<{ gas: string; massMg: number; total: Grams; pct: number }>;
  credits: Grams;
  activityCount: number;
  /** The horizon these figures were read at, always stated (GHG-034). */
  horizon: Horizon;
  /**
   * What the same period comes to at the other horizon, and the share of the
   * total that could be re-evaluated at all. A footprint that is mostly
   * unspecified mixtures cannot move much, and saying so is the honest way to
   * present the comparison.
   */
  atOtherHorizon: { horizon: Horizon; total: Grams; ratio: number; reEvaluablePct: number };
}

/**
 * The household's footprint over a period.
 *
 * Every figure is recomputed from the stored gas masses at the horizon asked
 * for, rather than summing the CO₂e that happened to be written at recording
 * time. That is what makes switching horizon a re-reading of the record
 * instead of a rewrite of it (GHG-034), and it means a factor recorded years
 * ago under one horizon reports correctly under another today.
 */
export async function footprint(
  ctx: Ctx, from: string, to: string, opts: { horizon?: Horizon } = {},
): Promise<FootprintSummary> {
  const horizon = opts.horizon ?? horizonOf(ctx);
  const other: Horizon = horizon === 100 ? 20 : 100;
  const where = and(
    isNull(activities.deletedAt),
    gte(activities.occurredOn, from),
    lte(activities.occurredOn, to),
  );
  const raw = await ctx.db.select({
    scope: emissions.scope,
    category: emissions.category,
    month: sql<string>`substr(${activities.occurredOn}, 1, 7)`,
    gas: emissions.gas,
    massMg: emissions.massMg,
    storedGrams: emissions.gCo2e,
    activityId: activities.id,
  }).from(emissions).innerJoin(activities, eq(activities.id, emissions.activityId)).where(where);

  // An unspecified mixture has no composition to re-evaluate, so it carries
  // through at whatever it was recorded as. Everything else is recomputed.
  const at = (r: typeof raw[number], h: Horizon): number => {
    const gwp = gwpFor(r.gas, h);
    if (gwp == null || r.gas === 'co2e') return Number(r.storedGrams);
    return Math.round((Number(r.massMg) / 1000) * gwp);
  };

  const rows = raw.map((r) => ({ ...r, grams: at(r, horizon) }));
  const sum = (list: typeof rows) => list.reduce((a, b) => a + b.grams, 0);
  const group = <K extends string | number>(key: (r: typeof rows[number]) => K) => {
    const m = new Map<K, number>();
    for (const r of rows) m.set(key(r), (m.get(key(r)) ?? 0) + r.grams);
    return m;
  };

  const total = sum(rows);
  const gasMass = new Map<string, { massMg: number; total: number }>();
  for (const r of rows) {
    const acc = gasMass.get(r.gas) ?? { massMg: 0, total: 0 };
    gasMass.set(r.gas, { massMg: acc.massMg + Number(r.massMg), total: acc.total + r.grams });
  }

  const otherTotal = raw.reduce((a, r) => a + at(r, other), 0);
  const reEvaluable = rows.filter((r) => r.gas !== 'co2e').reduce((a, b) => a + Math.abs(b.grams), 0);
  const absTotal = rows.reduce((a, b) => a + Math.abs(b.grams), 0);

  return {
    from, to,
    total,
    byScope: [...group((r) => r.scope)].map(([scope, t]) => ({ scope: Number(scope), total: t }))
      .sort((a, b) => a.scope - b.scope),
    byCategory: [...group((r) => r.category)].map(([category, t]) => ({ category: String(category), total: t }))
      .sort((a, b) => b.total - a.total),
    byMonth: [...group((r) => r.month)].map(([month, t]) => ({ month: String(month), total: t }))
      .sort((a, b) => a.month.localeCompare(b.month)),
    byGas: [...gasMass].map(([gas, v]) => ({
      gas, massMg: v.massMg, total: v.total,
      pct: total !== 0 ? Math.round((v.total / total) * 1000) / 10 : 0,
    })).sort((a, b) => b.total - a.total),
    credits: rows.filter((r) => r.grams < 0).reduce((a, b) => a + b.grams, 0),
    activityCount: new Set(rows.map((r) => r.activityId)).size,
    horizon,
    atOtherHorizon: {
      horizon: other,
      total: otherTotal,
      ratio: total !== 0 ? Math.round((otherTotal / total) * 1000) / 1000 : 1,
      reEvaluablePct: absTotal > 0 ? Math.round((reEvaluable / absTotal) * 100) : 0,
    },
  };
}

/* ─────────────────────────── avoided emissions ─────────────────────────── */

/**
 * Records what a counterfactual would have emitted and this household did not.
 *
 * Kept in its own table, never as a negative emission, so that no query can
 * accidentally net an avoidance against the footprint. An avoided tonne is a
 * statement about a world that did not happen; treating it as an emitted tonne
 * that did is the most common dishonesty in carbon accounting (GHG-038).
 */
export async function recordAvoided(ctx: Ctx, args: {
  sourceType: string;
  sourceId: string;
  occurredOn?: string;
  counterfactual: string;
  gCo2e100: number;
  gCo2e20?: number;
  cost?: number;
  basis?: 'measured' | 'estimated';
  category?: string;
}): Promise<typeof avoidedEmissions.$inferSelect> {
  const [row] = await ctx.db.insert(avoidedEmissions).values({
    sourceType: args.sourceType,
    sourceId: args.sourceId,
    occurredOn: args.occurredOn ?? ctx.today,
    counterfactual: args.counterfactual,
    gCo2e100: Math.round(args.gCo2e100),
    gCo2e20: Math.round(args.gCo2e20 ?? args.gCo2e100),
    cost: Math.round(args.cost ?? 0),
    basis: args.basis ?? 'estimated',
    category: args.category ?? 'other',
    createdBy: ctx.user?.id ?? null,
  }).returning();
  return row!;
}

export async function avoidedBetween(
  ctx: Ctx, from: string, to: string,
): Promise<{
  total100: number; total20: number; cost: number; count: number;
  byCategory: Array<{ category: string; total100: number; total20: number; cost: number }>;
  items: Array<typeof avoidedEmissions.$inferSelect>;
}> {
  const rows = await ctx.db.select().from(avoidedEmissions).where(and(
    isNull(avoidedEmissions.deletedAt),
    gte(avoidedEmissions.occurredOn, from),
    lte(avoidedEmissions.occurredOn, to),
  )).orderBy(desc(avoidedEmissions.occurredOn));

  const byCat = new Map<string, { total100: number; total20: number; cost: number }>();
  for (const r of rows) {
    const acc = byCat.get(r.category) ?? { total100: 0, total20: 0, cost: 0 };
    byCat.set(r.category, {
      total100: acc.total100 + r.gCo2e100,
      total20: acc.total20 + r.gCo2e20,
      cost: acc.cost + r.cost,
    });
  }
  return {
    total100: rows.reduce((a, b) => a + b.gCo2e100, 0),
    total20: rows.reduce((a, b) => a + b.gCo2e20, 0),
    cost: rows.reduce((a, b) => a + b.cost, 0),
    count: rows.length,
    byCategory: [...byCat].map(([category, v]) => ({ category, ...v }))
      .sort((a, b) => b.total100 - a.total100),
    items: rows.slice(0, 100),
  };
}

/* ──────────────────────────── meter readings ───────────────────────────── */

/**
 * A reading is a running total; what matters is the difference from the last
 * one. Differencing here means nobody types a consumption figure twice.
 */
export async function activityFromReading(
  ctx: Ctx, readingId: string,
): Promise<RecordedActivity | null> {
  const reading = (await ctx.db.select().from(readings).where(eq(readings.id, readingId)).limit(1))[0];
  if (!reading) throw notFound('Reading');
  const meter = (await ctx.db.select().from(meters).where(eq(meters.assetId, reading.assetId)).limit(1))[0];
  if (!meter) return null;

  const previous = (await ctx.db.select().from(readings).where(and(
    eq(readings.assetId, reading.assetId),
    eq(readings.metric, reading.metric),
    sql`${readings.takenAt} < ${reading.takenAt}`,
    isNull(readings.deletedAt),
  )).orderBy(desc(readings.takenAt)).limit(1))[0];

  const consumption = consumptionBetween(
    previous ? { value: previous.value, meterId: meter.assetId } : null,
    { value: reading.value, meterId: meter.assetId },
    { rolloverAt: meter.rolloverAt, multiplier: meter.multiplier },
  );
  if (consumption == null || consumption === 0) return null;

  const { assets } = await import('../db/schema.js');
  const asset = (await ctx.db.select().from(assets).where(eq(assets.id, reading.assetId)).limit(1))[0];

  return recordActivity(ctx, {
    type: meter.kind,
    amount: consumption,
    unit: meter.unit,
    occurredOn: reading.takenAt.slice(0, 10),
    propertyId: asset?.propertyId ?? null,
    factorKey: meter.emissionFactorKey ?? null,
    readingId,
    sourceType: 'reading',
    sourceId: readingId,
    note: `Metered from ${previous ? `${previous.value} → ` : ''}${reading.value} ${meter.unit}`,
    attributions: [{ entityType: 'asset', entityId: reading.assetId }],
  });
}

/* ───────────────────────── product and waste factors ───────────────────── */

/** Finds the factor key for a product: its own, else its category's. */
export async function factorKeyForProduct(ctx: Ctx, productId: string): Promise<{
  key: string | null; unitMassKg: number | null; defaultUnit: string | null;
}> {
  const { products, productCategories } = await import('../db/schema.js');
  const product = (await ctx.db.select().from(products).where(eq(products.id, productId)).limit(1))[0];
  if (!product) return { key: null, unitMassKg: null, defaultUnit: null };
  const rest = { unitMassKg: product.unitMassKg, defaultUnit: product.defaultUnit };
  if (product.emissionFactorKey) return { key: product.emissionFactorKey, ...rest };
  if (!product.categoryId) return { key: null, ...rest };

  // Walk up the category tree: a leaf without a factor inherits its parent's.
  let categoryId: string | null = product.categoryId;
  for (let depth = 0; depth < 6 && categoryId; depth++) {
    const cat: typeof productCategories.$inferSelect | undefined =
      (await ctx.db.select().from(productCategories).where(eq(productCategories.id, categoryId)).limit(1))[0];
    if (!cat) break;
    if (cat.emissionFactorKey) return { key: cat.emissionFactorKey, ...rest };
    categoryId = cat.parentId;
  }
  return { key: null, ...rest };
}

/** Converts a product quantity into the mass a per-kilogram factor needs. */
export function productMass(
  quantity: number, unit: string, unitMassKg: number | null,
): { amount: number; unit: string } | null {
  if (areCompatible(unit, 'kg')) return { amount: quantity, unit };
  if (unitMassKg && unitMassKg > 0) return { amount: quantity * unitMassKg, unit: 'kg' };
  return null;
}

export const WASTE_FACTOR_BY_METHOD: Record<string, string> = {
  trashed: 'waste.landfill',
  recycled: 'waste.recycled',
  donated: 'waste.reuse',
  sold: 'waste.reuse',
  compost: 'waste.compost',
};

/* ─────────────────────── module integration helpers ────────────────────── */

/**
 * Embodied emissions for a quantity of a catalogued product. Used by the
 * grocery put-away, pet feeding and waste paths, so all three agree.
 */
export async function recordProductEmissions(
  ctx: Ctx,
  args: {
    productId: string;
    quantity: number;
    /** Omitted means the product's own default unit. */
    unit?: string | null;
    type?: ActivityType | string;
    occurredOn?: string;
    transactionId?: string | null;
    sourceType?: string | null;
    sourceId?: string | null;
    attributions?: AttributionRef[];
    note?: string | null;
    factorKeyOverride?: string | null;
  },
): Promise<RecordedActivity | null> {
  const { key, unitMassKg, defaultUnit } = args.factorKeyOverride
    ? { key: args.factorKeyOverride, unitMassKg: null, defaultUnit: null }
    : await factorKeyForProduct(ctx, args.productId);
  if (!key) return null;

  // A caller that never asked for a unit means "however this product is counted".
  const startingUnit = args.unit || defaultUnit;
  if (!startingUnit) return null;

  // A factor per kilogram needs a mass; "2 cans" only becomes one if the
  // product says what a can weighs.
  const factorRows = await factorsFor(ctx, [key]);
  const chosen = resolveFactor(factorRows.map(toDomain), { on: args.occurredOn ?? ctx.today, region: regionOf(ctx) });
  if (!chosen) return null;

  let amount = args.quantity;
  let unit = startingUnit;
  if (!areCompatible(unit, chosen.activityUnit)) {
    const mass = productMass(args.quantity, startingUnit, unitMassKg);
    if (!mass || !areCompatible(mass.unit, chosen.activityUnit)) return null;
    amount = mass.amount;
    unit = mass.unit;
  }

  return tryRecordActivity(ctx, {
    type: args.type ?? 'food',
    amount, unit,
    occurredOn: args.occurredOn,
    factorKey: key,
    transactionId: args.transactionId ?? null,
    sourceType: args.sourceType ?? null,
    sourceId: args.sourceId ?? null,
    note: args.note ?? null,
    attributions: [
      { entityType: 'product', entityId: args.productId },
      ...(args.attributions ?? []),
    ],
  });
}

/**
 * What a quantity of a product embodied, computed and not written.
 *
 * The distinction matters. A pound of beef's embodied emissions were already
 * recorded when it was bought; recording them a second time because it was
 * later binned would count the same kilogram twice in the household's
 * footprint. What wasting it produces that is genuinely new is the *disposal*
 * emission — landfill methane, or a fraction of it on a compost pile.
 *
 * So the embodied figure is returned for the report, where it is the number
 * most likely to change behaviour, and only the disposal is emitted.
 */
export async function wastedEmbodied(ctx: Ctx, args: {
  productId: string; quantity: number; unit?: string | null; occurredOn?: string;
}): Promise<{ grams: Grams; factorKey: string } | null> {
  const { key, unitMassKg, defaultUnit } = await factorKeyForProduct(ctx, args.productId);
  if (!key) return null;
  const unit = args.unit || defaultUnit;
  if (!unit) return null;

  const factorRows = await factorsFor(ctx, [key]);
  const chosen = resolveFactor(factorRows.map(toDomain), {
    on: args.occurredOn ?? ctx.today, region: regionOf(ctx),
  });
  if (!chosen) return null;

  let amount = args.quantity;
  let useUnit = unit;
  if (!areCompatible(useUnit, chosen.activityUnit)) {
    const mass = productMass(args.quantity, unit, unitMassKg);
    if (!mass || !areCompatible(mass.unit, chosen.activityUnit)) return null;
    amount = mass.amount;
    useUnit = mass.unit;
  }
  try {
    const { grams } = applyFactor(amount, useUnit, chosen);
    return { grams, factorKey: key };
  } catch {
    return null;
  }
}

/** The mass of a product quantity in kilograms, for a disposal route. */
export async function productKg(ctx: Ctx, args: {
  productId: string; quantity: number; unit?: string | null;
}): Promise<number | null> {
  const { unitMassKg, defaultUnit } = await factorKeyForProduct(ctx, args.productId);
  const unit = args.unit || defaultUnit;
  if (!unit) return null;
  const mass = productMass(args.quantity, unit, unitMassKg);
  if (!mass) return null;
  if (mass.unit === 'kg') return mass.amount;
  try {
    const { convert } = await import('@homestead/shared');
    return convert(mass.amount, mass.unit, 'kg');
  } catch {
    return null;
  }
}

/** Refrigerant leakage, which is small in mass and enormous in effect (GHG-013). */
export async function recordRefrigerant(
  ctx: Ctx,
  args: { assetId: string; refrigerant: string; kg: number; occurredOn?: string; recordId?: string | null },
): Promise<RecordedActivity | null> {
  return tryRecordActivity(ctx, {
    type: 'refrigerant',
    amount: args.kg,
    unit: 'kg',
    occurredOn: args.occurredOn,
    factorKey: `refrigerant.${args.refrigerant.toLowerCase().replace(/[^a-z0-9]/g, '')}`,
    sourceType: 'maintenance_record',
    sourceId: args.recordId ?? null,
    note: `${args.kg} kg of ${args.refrigerant}`,
    attributions: [{ entityType: 'asset', entityId: args.assetId }],
  });
}

/** Everything attributed to one entity, in both currencies (INT-007). */
export async function ledgerFor(
  ctx: Ctx, entityType: string, entityId: string,
): Promise<{ cost: number; gCo2e: Grams; transactions: number; activities: number }> {
  const { spentOn } = await import('./budget.js');
  const [money, carbon] = await Promise.all([
    spentOn(ctx, entityType, entityId),
    emittedBy(ctx, entityType, entityId),
  ]);
  return {
    cost: money.total, transactions: money.count,
    gCo2e: carbon.total, activities: carbon.count,
  };
}

/** Decomposes a total back to the activities and factors behind it (GHG-028). */
export async function explain(
  ctx: Ctx, from: string, to: string, opts: { category?: string; scope?: number } = {},
): Promise<Array<{
  activityId: string; occurredOn: string; type: string; amount: number; unit: string;
  factorKey: string; factorKgPerUnit: number; factorUnit: string; gCo2e: Grams;
  gas: string; massMg: number; gwp: number;
  scope: number; category: string; note: string | null; source: string | null;
}>> {
  const where = [
    isNull(activities.deletedAt),
    gte(activities.occurredOn, from),
    lte(activities.occurredOn, to),
  ];
  if (opts.category) where.push(eq(emissions.category, opts.category));
  if (opts.scope) where.push(eq(emissions.scope, opts.scope));

  const rows = await ctx.db.select({ e: emissions, a: activities, f: emissionFactors })
    .from(emissions)
    .innerJoin(activities, eq(activities.id, emissions.activityId))
    .leftJoin(emissionFactors, eq(emissionFactors.id, emissions.factorId))
    .where(and(...where))
    .orderBy(desc(activities.occurredOn))
    .limit(500);

  return rows.map((r) => ({
    activityId: r.a.id, occurredOn: r.a.occurredOn, type: r.a.type,
    amount: r.a.amount, unit: r.a.unit,
    factorKey: r.e.factorKey, factorKgPerUnit: r.e.factorKgPerUnit, factorUnit: r.e.factorUnit,
    gCo2e: r.e.gCo2e, gas: r.e.gas, massMg: r.e.massMg, gwp: r.e.gwp,
    scope: r.e.scope, category: r.e.category,
    note: r.a.note, source: r.f?.source ?? null,
  }));
}

/**
 * A planning estimate for material that has not been bought yet, so a project
 * can show its likely footprint while it is still a drawing (GHG-012).
 */
export async function estimateEmbodied(
  ctx: Ctx,
  lines: Array<{ quantity: number; unit: string; unitMassKg: number | null; emissionFactorKey: string | null }>,
  on?: string,
): Promise<Grams> {
  const keys = [...new Set(lines.map((l) => l.emissionFactorKey).filter(Boolean))] as string[];
  if (!keys.length) return 0;
  const rows = await factorsFor(ctx, keys);
  const region = regionOf(ctx);
  const date = on ?? ctx.today;

  let total = 0;
  for (const line of lines) {
    if (!line.emissionFactorKey) continue;
    const chosen = resolveFactor(
      rows.filter((r) => r.key === line.emissionFactorKey).map(toDomain),
      { on: date, region },
    );
    if (!chosen) continue;
    const amount = line.unitMassKg ? line.quantity * line.unitMassKg : line.quantity;
    const unit = line.unitMassKg ? 'kg' : line.unit;
    if (!areCompatible(unit, chosen.activityUnit)) continue;
    try {
      total += applyFactor(amount, unit, chosen).grams;
    } catch { /* a line we cannot estimate simply does not contribute */ }
  }
  return total;
}

/**
 * A household with a meter *and* a bill has two records of the same kilowatt
 * hours. Counting both would inflate the footprint, so when a bill names a
 * meter and that meter has already recorded the period, the bill attaches its
 * cost to that activity instead of creating a second one.
 */
export async function attachCostToMeteredPeriod(
  ctx: Ctx,
  args: { meterAssetId: string; type: string; periodEnd: string; transactionId: string },
): Promise<typeof activities.$inferSelect | null> {
  const periodStart = addDays(args.periodEnd, -45);
  const rows = await ctx.db.select({ a: activities })
    .from(attributions)
    .innerJoin(activities, eq(activities.id, attributions.sourceId))
    .where(and(
      eq(attributions.sourceKind, 'activity'),
      eq(attributions.entityType, 'asset'),
      eq(attributions.entityId, args.meterAssetId),
      eq(activities.type, args.type),
      eq(activities.sourceType, 'reading'),
      isNull(activities.deletedAt),
      isNull(activities.transactionId),
      gte(activities.occurredOn, periodStart),
      lte(activities.occurredOn, args.periodEnd),
    ))
    .orderBy(desc(activities.occurredOn))
    .limit(1);

  const existing = rows[0]?.a;
  if (!existing) return null;
  const [updated] = await ctx.db.update(activities)
    .set({ transactionId: args.transactionId, updatedBy: ctx.user?.id ?? null })
    .where(eq(activities.id, existing.id)).returning();
  return updated ?? null;
}
