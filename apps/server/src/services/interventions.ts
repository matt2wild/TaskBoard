/* eslint-disable @typescript-eslint/no-explicit-any */
import { and, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import {
  addDays, applyFactor, convert, fuelEnergyMj, payback, rankByAbatement, resolveFactor,
  type Grams, type Payback,
} from '@homestead/shared';
import type { Ctx } from '../core/ctx.js';
import { badRequest, notFound } from '../core/errors.js';
import {
  activities, emissionFactors, emissions, interventionTemplates, interventions,
  projects, transactions,
} from '../db/schema.js';
import { regionOf } from './carbon.js';

/**
 * What a fuel actually cost and emitted here over a window. This is the whole
 * reason energy, money and project planning live in one application: the saving
 * from a heat pump is computed from this household's own oil deliveries rather
 * than from a brochure (GHG-020).
 */
export interface FuelProfile {
  type: string;
  units: number;
  unit: string | null;
  grams: Grams;
  cost: number;
  measured: boolean;
  months: number;
}

export async function fuelProfile(
  ctx: Ctx, type: string, opts: { months?: number } = {},
): Promise<FuelProfile> {
  const months = opts.months ?? 12;
  const from = addDays(ctx.today, -Math.round(months * 30.44));

  const rows = await ctx.db.select({
    amount: activities.amount,
    unit: activities.unit,
    transactionId: activities.transactionId,
    id: activities.id,
  }).from(activities).where(and(
    eq(activities.type, type),
    isNull(activities.deletedAt),
    gte(activities.occurredOn, from),
    lte(activities.occurredOn, ctx.today),
  ));

  if (!rows.length) {
    return { type, units: 0, unit: null, grams: 0, cost: 0, measured: false, months };
  }

  // Normalise to the most common unit, converting where possible.
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.unit, (counts.get(r.unit) ?? 0) + 1);
  const unit = [...counts].sort((a, b) => b[1] - a[1])[0]![0];
  let units = 0;
  for (const r of rows) {
    if (r.unit === unit) { units += r.amount; continue; }
    try { units += convert(r.amount, r.unit, unit); } catch { /* skip what cannot be combined */ }
  }

  const ids = rows.map((r) => r.id);
  const gramRows = await ctx.db.select({ total: sql<number>`coalesce(sum(${emissions.gCo2e}), 0)` })
    .from(emissions).where(inArray(emissions.activityId, ids));

  const txIds = [...new Set(rows.map((r) => r.transactionId).filter(Boolean))] as string[];
  const costRows = txIds.length
    ? await ctx.db.select({ total: sql<number>`coalesce(sum(${transactions.amount}), 0)` })
      .from(transactions).where(and(inArray(transactions.id, txIds), isNull(transactions.deletedAt)))
    : [{ total: 0 }];

  return {
    type,
    units: Number(units.toFixed(4)),
    unit,
    grams: Number(gramRows[0]?.total ?? 0),
    cost: Number(costRows[0]?.total ?? 0),
    measured: true,
    months,
  };
}

/** The household's own electricity price, derived from its own bills. */
export async function electricityPricePerKwh(ctx: Ctx): Promise<number | null> {
  const profile = await fuelProfile(ctx, 'electricity');
  if (!profile.measured || profile.units <= 0 || profile.cost <= 0) return null;
  let kwh = profile.units;
  if (profile.unit && profile.unit !== 'kwh') {
    try { kwh = convert(profile.units, profile.unit, 'kwh'); } catch { return null; }
  }
  return kwh > 0 ? profile.cost / kwh : null;
}

async function gridFactor(ctx: Ctx): Promise<{ kgPerKwh: number } | null> {
  const rows = await ctx.db.select().from(emissionFactors).where(and(
    eq(emissionFactors.key, 'electricity.grid'),
    eq(emissionFactors.archived, false),
    isNull(emissionFactors.deletedAt),
  ));
  const chosen = resolveFactor(
    rows.map((r) => ({
      id: r.id, key: r.key, name: r.name, activityUnit: r.activityUnit,
      kgPerUnit: r.kgPerUnit, scope: r.scope as 1 | 2 | 3,
      region: r.region, validFrom: r.validFrom, validTo: r.validTo,
    })),
    { on: ctx.today, region: regionOf(ctx) },
  );
  if (!chosen) return null;
  const { grams } = applyFactor(1, 'kwh', chosen);
  return { kgPerKwh: grams / 1000 };
}

export interface SavingModel {
  kind: 'fuel_switch' | 'reduce' | 'generate';
  /** fuel_switch / reduce: the activity type being displaced. */
  fuel?: string;
  /** fuel_switch: seasonal efficiency of the existing system, 0–1. */
  existingEfficiency?: number;
  /** fuel_switch: coefficient of performance of the replacement. */
  replacementCop?: number;
  /** reduce: the fraction of that fuel this removes, 0–1. */
  fraction?: number;
  /** generate: annual output in kWh, before any measurement. */
  annualKwh?: number;
  /** Fallback annual consumption when nothing has been measured. */
  assumedAnnualUnits?: number;
  assumedUnit?: string;
}

export interface InterventionEstimate {
  annualSavingKwh: number | null;
  annualSavingGCo2e: Grams;
  annualSavingCost: number;
  basis: 'measured' | 'estimated';
  basisNote: string;
  payback: Payback;
}

/**
 * Turns a saving model plus this household's measured history into the two
 * numbers that matter: what it saves a year, and how long until it has paid
 * back in money and in carbon.
 */
export async function estimateIntervention(
  ctx: Ctx,
  args: {
    model: SavingModel;
    capitalCost: number;
    embodiedGCo2e: number;
    lifetimeYears?: number;
  },
): Promise<InterventionEstimate> {
  const { model } = args;
  const grid = await gridFactor(ctx);
  const elecPrice = await electricityPricePerKwh(ctx);
  let annualSavingGCo2e = 0;
  let annualSavingCost = 0;
  let annualSavingKwh: number | null = null;
  let basis: 'measured' | 'estimated' = 'estimated';
  let basisNote = '';

  if (model.kind === 'generate') {
    const kwh = model.annualKwh ?? 0;
    annualSavingKwh = kwh;
    annualSavingGCo2e = grid ? Math.round(kwh * grid.kgPerKwh * 1000) : 0;
    annualSavingCost = elecPrice ? Math.round(kwh * elecPrice) : 0;
    basisNote = elecPrice
      ? 'Valued at your own electricity price, from your bills.'
      : 'No electricity price on record yet, so the money saving is not estimated.';
    if (elecPrice) basis = 'measured';
  } else if (model.kind === 'reduce') {
    const profile = await fuelProfile(ctx, model.fuel ?? 'natural_gas');
    const fraction = model.fraction ?? 0.1;
    if (profile.measured && profile.grams > 0) {
      basis = 'measured';
      annualSavingGCo2e = Math.round(profile.grams * fraction);
      annualSavingCost = Math.round(profile.cost * fraction);
      basisNote = `From ${profile.units} ${profile.unit ?? 'units'} of ${(model.fuel ?? '').replace(/_/g, ' ')} over the last ${profile.months} months.`;
    } else {
      basisNote = `No measured ${(model.fuel ?? '').replace(/_/g, ' ')} use yet, so this is a generic estimate.`;
      annualSavingGCo2e = 0;
      annualSavingCost = 0;
    }
  } else {
    // fuel_switch: measured fuel → useful heat → replacement electricity.
    const profile = await fuelProfile(ctx, model.fuel ?? 'heating_oil');
    const efficiency = model.existingEfficiency ?? 0.8;
    const cop = model.replacementCop ?? 3;
    if (profile.measured && profile.unit && profile.units > 0) {
      // Oil is sold by the gallon but displaced as heat, so the comparison goes
      // through energy content rather than a dimensional conversion.
      const fuelMj = fuelEnergyMj(profile.units, profile.unit, model.fuel ?? 'heating_oil');
      if (fuelMj != null) {
        const usefulHeatMj = fuelMj * efficiency;
        const replacementKwh = convert(usefulHeatMj / cop, 'mj', 'kwh');
        const replacementGrams = grid ? Math.round(replacementKwh * grid.kgPerKwh * 1000) : 0;
        const replacementCost = elecPrice ? Math.round(replacementKwh * elecPrice) : 0;
        annualSavingKwh = -Number(replacementKwh.toFixed(0));
        annualSavingGCo2e = profile.grams - replacementGrams;
        annualSavingCost = profile.cost - replacementCost;
        basis = 'measured';
        basisNote = `From ${profile.units} ${profile.unit} of ${(model.fuel ?? '').replace(/_/g, ' ')} over ${profile.months} months, at ${Math.round(efficiency * 100)}% existing efficiency and a COP of ${cop}.`;
      }
    }
    if (basis === 'estimated') {
      basisNote = `No measured ${(model.fuel ?? '').replace(/_/g, ' ')} use yet. Record a year of deliveries or meter readings and this becomes a real number.`;
    }
  }

  return {
    annualSavingKwh,
    annualSavingGCo2e,
    annualSavingCost,
    basis,
    basisNote,
    payback: payback({
      capitalCost: args.capitalCost,
      embodiedGrams: args.embodiedGCo2e,
      annualSavingCost,
      annualSavingGrams: annualSavingGCo2e,
      lifetimeYears: args.lifetimeYears,
    }),
  };
}

/** Builds a candidate from a shipped template against this household. */
export async function candidateFromTemplate(
  ctx: Ctx, templateKey: string, opts: { targetAssetId?: string | null; capitalCost?: number } = {},
): Promise<{
  template: typeof interventionTemplates.$inferSelect;
  estimate: InterventionEstimate;
  capitalCost: number;
}> {
  const template = (await ctx.db.select().from(interventionTemplates)
    .where(eq(interventionTemplates.key, templateKey)).limit(1))[0];
  if (!template) throw notFound('Intervention template');
  const capitalCost = opts.capitalCost ?? template.typicalCost ?? 0;
  const estimate = await estimateIntervention(ctx, {
    model: (template.savingModel ?? { kind: 'reduce' }) as SavingModel,
    capitalCost,
    embodiedGCo2e: template.embodiedGCo2e ?? 0,
    lifetimeYears: template.lifetimeYears,
  });
  return { template, estimate, capitalCost };
}

/** Every shipped option, costed against this household and ranked. */
export async function rankedCandidates(ctx: Ctx): Promise<Array<{
  key: string; name: string; category: string; descriptionMd: string | null;
  capitalCost: number; embodiedGCo2e: number; lifetimeYears: number;
  estimate: InterventionEstimate; payback: Payback;
}>> {
  const templates = await ctx.db.select().from(interventionTemplates)
    .where(isNull(interventionTemplates.deletedAt));
  const out = [];
  for (const template of templates) {
    const estimate = await estimateIntervention(ctx, {
      model: (template.savingModel ?? { kind: 'reduce' }) as SavingModel,
      capitalCost: template.typicalCost ?? 0,
      embodiedGCo2e: template.embodiedGCo2e ?? 0,
      lifetimeYears: template.lifetimeYears,
    });
    out.push({
      key: template.key, name: template.name, category: template.category,
      descriptionMd: template.descriptionMd,
      capitalCost: template.typicalCost ?? 0,
      embodiedGCo2e: template.embodiedGCo2e ?? 0,
      lifetimeYears: template.lifetimeYears,
      estimate, payback: estimate.payback,
    });
  }
  return rankByAbatement(out);
}

/** Accepting an intervention puts it in the project backlog (GHG-021). */
export async function acceptIntervention(
  ctx: Ctx, interventionId: string, propertyId?: string,
): Promise<{ intervention: typeof interventions.$inferSelect; projectId: string }> {
  const row = (await ctx.db.select().from(interventions)
    .where(eq(interventions.id, interventionId)).limit(1))[0];
  if (!row) throw notFound('Intervention');
  if (row.projectId) throw badRequest('That is already in the backlog');

  const property = propertyId ?? row.propertyId;
  if (!property) throw badRequest('Which property is this for?');

  const [project] = await ctx.db.insert(projects).values({
    propertyId: property,
    name: row.name,
    descriptionMd: [
      row.descriptionMd,
      row.annualSavingGCo2e
        ? `Expected saving: about ${(row.annualSavingGCo2e / 1_000_000).toFixed(1)} tonnes CO₂e a year (${row.basis}).`
        : null,
      row.basisNote,
    ].filter(Boolean).join('\n\n'),
    status: 'idea',
    priority: 'normal',
    estimateCost: row.capitalCost,
    createdBy: ctx.user?.id ?? null,
    updatedBy: ctx.user?.id ?? null,
  }).returning();

  const [updated] = await ctx.db.update(interventions)
    .set({ projectId: project!.id, status: 'planned', updatedBy: ctx.user?.id ?? null })
    .where(eq(interventions.id, interventionId)).returning();

  return { intervention: updated!, projectId: project!.id };
}
