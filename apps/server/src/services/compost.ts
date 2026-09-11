/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * The compost service.
 *
 * This is where the household's largest per-kilogram greenhouse gas decision
 * gets made, and the module's job is to record it without overstating it. A
 * pile is not emission-free; it is roughly a sixtieth of landfill. Both halves
 * of that sentence matter, and the code says both.
 */
import { and, desc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import {
  addDays, cnBalance, convert, diffDays, gwpFor, MATURITY_DAYS, pileStatus,
  TURN_INTERVAL_DAYS, amendmentToTarget,
  type CnBalance, type CompostMethod, type PileStatus,
} from '@homestead/shared';
import type { Ctx } from '../core/ctx.js';
import { badRequest, notFound } from '../core/errors.js';
import {
  beds, compostEvents, compostInputs, compostMaterials, compostOutputs, compostSystems,
  emissionFactors,
} from '../db/schema.js';
import { recordAvoided, tryRecordActivity } from './carbon.js';

/** Everything reaching the arithmetic is in kilograms, converted once, here. */
function toKg(quantity: number, unit: string): number | null {
  if (unit === 'kg') return quantity;
  try {
    return convert(quantity, unit, 'kg');
  } catch {
    return null;
  }
}

export async function materialLibrary(ctx: Ctx): Promise<Array<typeof compostMaterials.$inferSelect>> {
  return ctx.db.select().from(compostMaterials)
    .where(isNull(compostMaterials.deletedAt))
    .orderBy(compostMaterials.kind, compostMaterials.name);
}

/**
 * Adding something to a pile. Records the input, snapshots the C:N ratio it was
 * credited with, and books the pile's own (small) emissions — because a module
 * that presented composting as free would be lying by omission (COMP-012).
 */
export async function addCompostInput(ctx: Ctx, args: {
  systemId: string;
  materialKey: string;
  quantity: number;
  unit?: string;
  occurredOn?: string;
  sourceType?: string | null;
  sourceId?: string | null;
  note?: string | null;
  /** What would have happened to it otherwise, for the avoided figure. */
  counterfactualKey?: string | null;
}): Promise<{
  input: typeof compostInputs.$inferSelect;
  gCo2e: number;
  avoided: { gCo2e100: number; gCo2e20: number; counterfactual: string } | null;
  balance: CnBalance;
}> {
  const system = (await ctx.db.select().from(compostSystems)
    .where(eq(compostSystems.id, args.systemId)).limit(1))[0];
  if (!system) throw notFound('Compost system');
  if (args.quantity <= 0) throw badRequest('Quantity must be more than nothing');

  const material = (await ctx.db.select().from(compostMaterials)
    .where(eq(compostMaterials.key, args.materialKey)).limit(1))[0];
  if (!material) throw notFound('Compost material');
  if (!material.acceptable) {
    throw badRequest(material.caution ?? `${material.name} does not belong in a domestic pile.`);
  }

  const unit = args.unit ?? 'kg';
  const on = args.occurredOn ?? ctx.today;
  const [input] = await ctx.db.insert(compostInputs).values({
    systemId: args.systemId,
    materialKey: args.materialKey,
    quantity: args.quantity,
    unit,
    occurredOn: on,
    sourceType: args.sourceType ?? null,
    sourceId: args.sourceId ?? null,
    cnRatio: material.cnRatio,
    note: args.note ?? null,
    createdBy: ctx.user?.id ?? null,
    updatedBy: ctx.user?.id ?? null,
  }).returning();

  const kg = toKg(args.quantity, unit);
  let gCo2e = 0;
  let avoided: { gCo2e100: number; gCo2e20: number; counterfactual: string } | null = null;

  if (kg && kg > 0) {
    // A badly run pile makes real methane; a managed one makes very little.
    // Which factor applies is a property of how the pile is actually run.
    const factorKey = await compostFactorFor(ctx, system);
    const recorded = await tryRecordActivity(ctx, {
      type: 'waste', amount: kg, unit: 'kg', occurredOn: on,
      factorKey,
      sourceType: 'compost_input', sourceId: input!.id,
      note: `Composted: ${material.name}`,
      attributions: [{ entityType: 'compost_system', entityId: system.id }],
    });
    gCo2e = recorded?.gCo2e ?? 0;

    // …and what the bin would have produced instead. Reported apart from the
    // footprint, at both horizons, because the case for composting is far
    // stronger over twenty years and hiding that would be a distortion
    // (COMP-013, COMP-014, GHG-038).
    const counterKey = args.counterfactualKey ?? 'waste.food_landfill';
    const diff = await avoidedAgainst(ctx, counterKey, factorKey, kg, on);
    if (diff && diff.gCo2e100 > 0) {
      const counterfactual = `${Math.round(kg * 10) / 10} kg of ${material.name.toLowerCase()} to landfill instead of the pile`;
      await recordAvoided(ctx, {
        sourceType: 'compost_input', sourceId: input!.id, occurredOn: on,
        counterfactual,
        gCo2e100: diff.gCo2e100, gCo2e20: diff.gCo2e20,
        category: 'compost', basis: 'estimated',
      });
      avoided = { ...diff, counterfactual };
    }
  }

  return { input: input!, gCo2e, avoided, balance: await balanceOf(ctx, args.systemId) };
}

/** A pile that is turned and aerated gets the managed factor; one that is not does not. */
async function compostFactorFor(
  ctx: Ctx, system: typeof compostSystems.$inferSelect,
): Promise<string> {
  const method = system.method as CompostMethod;
  if (method === 'bokashi' || method === 'municipal') return 'waste.compost';
  if (method === 'cold_pile' || method === 'trench') {
    // Never turned, so anaerobic pockets are the norm rather than the exception.
    return 'waste.compost_anaerobic';
  }
  const lastTurn = (await ctx.db.select().from(compostEvents).where(and(
    eq(compostEvents.systemId, system.id), eq(compostEvents.kind, 'turned'),
    isNull(compostEvents.deletedAt),
  )).orderBy(desc(compostEvents.occurredOn)).limit(1))[0];
  const interval = TURN_INTERVAL_DAYS[method];
  if (!lastTurn || interval == null) return 'waste.compost';
  // Badly overdue a turn for a method that depends on turning: the honest
  // factor is the anaerobic one.
  const overdue = diffDays(ctx.today, lastTurn.occurredOn) > interval * 5;
  return overdue ? 'waste.compost_anaerobic' : 'waste.compost';
}

/**
 * The difference between two disposal routes, at both horizons. Computed from
 * the factors' own gas vectors so the twenty-year figure is a real one rather
 * than the hundred-year figure scaled by a guess.
 */
async function avoidedAgainst(
  ctx: Ctx, counterfactualKey: string, actualKey: string, kg: number, on: string,
): Promise<{ gCo2e100: number; gCo2e20: number } | null> {
  const rows = await ctx.db.select().from(emissionFactors).where(and(
    inArray(emissionFactors.key, [counterfactualKey, actualKey]),
    eq(emissionFactors.archived, false), isNull(emissionFactors.deletedAt),
  ));
  const pick = (key: string) => rows.find((r) => r.key === key);
  const counter = pick(counterfactualKey);
  const actual = pick(actualKey);
  if (!counter) return null;

  const at = (f: typeof emissionFactors.$inferSelect | undefined, horizon: 100 | 20): number => {
    if (!f) return 0;
    if (!f.gases) return Math.round(f.kgPerUnit * kg * 1000);
    let total = 0;
    for (const [gas, kgPerUnit] of Object.entries(f.gases)) {
      total += kgPerUnit * kg * 1000 * (gwpFor(gas, horizon) ?? 1);
    }
    return Math.round(total);
  };

  return {
    gCo2e100: at(counter, 100) - at(actual, 100),
    gCo2e20: at(counter, 20) - at(actual, 20),
  };
}

/** The running carbon-to-nitrogen balance of a pile (COMP-005). */
export async function balanceOf(ctx: Ctx, systemId: string): Promise<CnBalance> {
  const rows = await ctx.db.select().from(compostInputs).where(and(
    eq(compostInputs.systemId, systemId), isNull(compostInputs.deletedAt),
  ));
  const lines = rows.map((r) => ({
    kg: toKg(r.quantity, r.unit) ?? 0,
    cnRatio: r.cnRatio ?? 30,
  })).filter((l) => l.kg > 0);
  return cnBalance(lines);
}

/** What to add, and how much of it, to bring a pile back into the band. */
export async function fixAdvice(ctx: Ctx, systemId: string): Promise<{
  balance: CnBalance;
  suggestion: { materialKey: string; name: string; kg: number } | null;
}> {
  const balance = await balanceOf(ctx, systemId);
  if (balance.status !== 'too_wet' && balance.status !== 'too_dry') {
    return { balance, suggestion: null };
  }
  const want = balance.status === 'too_wet' ? 'brown' : 'green';
  const candidates = await ctx.db.select().from(compostMaterials).where(and(
    eq(compostMaterials.kind, want), eq(compostMaterials.acceptable, true),
    isNull(compostMaterials.deletedAt),
  ));
  for (const c of candidates) {
    const kg = amendmentToTarget(balance, c.cnRatio);
    if (kg != null && kg > 0 && kg < balance.totalKg * 4) {
      return { balance, suggestion: { materialKey: c.key, name: c.name, kg } };
    }
  }
  return { balance, suggestion: null };
}

export async function systemDetail(ctx: Ctx, systemId: string): Promise<any> {
  const system = (await ctx.db.select().from(compostSystems)
    .where(eq(compostSystems.id, systemId)).limit(1))[0];
  if (!system) throw notFound('Compost system');

  const [inputs, events, outputs] = await Promise.all([
    ctx.db.select().from(compostInputs).where(and(
      eq(compostInputs.systemId, systemId), isNull(compostInputs.deletedAt),
    )).orderBy(desc(compostInputs.occurredOn)).limit(100),
    ctx.db.select().from(compostEvents).where(and(
      eq(compostEvents.systemId, systemId), isNull(compostEvents.deletedAt),
    )).orderBy(desc(compostEvents.occurredOn)).limit(100),
    ctx.db.select().from(compostOutputs).where(and(
      eq(compostOutputs.systemId, systemId), isNull(compostOutputs.deletedAt),
    )).orderBy(desc(compostOutputs.occurredOn)).limit(50),
  ]);

  const temps = events.filter((e) => e.temperatureF != null);
  const lastTemp = temps[0];
  const lastTurn = events.find((e) => e.kind === 'turned');
  const materials = await materialLibrary(ctx);
  const byKey = new Map(materials.map((m) => [m.key, m]));

  const status: PileStatus = pileStatus({
    method: system.method as CompostMethod,
    latestF: lastTemp?.temperatureF ?? null,
    daysSinceReading: lastTemp ? diffDays(ctx.today, lastTemp.occurredOn) : null,
    daysSinceTurn: lastTurn ? diffDays(ctx.today, lastTurn.occurredOn) : null,
  });

  const firstInput = inputs[inputs.length - 1];
  const maturity = MATURITY_DAYS[system.method as CompostMethod];

  return {
    system,
    status,
    balance: await balanceOf(ctx, systemId),
    advice: await fixAdvice(ctx, systemId),
    inputs: inputs.map((i) => ({ ...i, material: byKey.get(i.materialKey) ?? null })),
    events,
    outputs,
    temperatureSeries: temps.slice().reverse()
      .map((e) => ({ x: e.occurredOn, y: e.temperatureF! })),
    readyOn: firstInput && maturity ? addDays(firstInput.occurredOn, maturity) : null,
    totals: {
      inputKg: inputs.reduce((a, b) => a + (toKg(b.quantity, b.unit) ?? 0), 0),
      outputs: outputs.reduce((a, b) => a + b.quantity, 0),
      turns: events.filter((e) => e.kind === 'turned').length,
    },
  };
}

/**
 * Finished compost leaving the pile for a bed: one record that is an output of
 * the system and an input to the garden, never two (INT-011).
 */
export async function recordOutput(ctx: Ctx, args: {
  systemId: string;
  quantity: number;
  unit?: string;
  occurredOn?: string;
  bedId?: string | null;
  note?: string | null;
}): Promise<{ output: typeof compostOutputs.$inferSelect; displaced: number }> {
  const unit = args.unit ?? 'cuft';
  const on = args.occurredOn ?? ctx.today;

  // Bought compost runs around $5 a cubic foot; that is what this displaced.
  const displaced = unit === 'cuft' ? Math.round(args.quantity * 500) : 0;

  const [output] = await ctx.db.insert(compostOutputs).values({
    systemId: args.systemId,
    occurredOn: on,
    quantity: args.quantity,
    unit,
    bedId: args.bedId ?? null,
    estValue: displaced,
    note: args.note ?? null,
    createdBy: ctx.user?.id ?? null,
    updatedBy: ctx.user?.id ?? null,
  }).returning();

  if (displaced > 0) {
    await recordAvoided(ctx, {
      sourceType: 'compost_output', sourceId: output!.id, occurredOn: on,
      counterfactual: `${args.quantity} ${unit} of bought compost, not bought`,
      // Bagged compost is roughly 0.1 kg CO2e per litre delivered; a cubic foot
      // is about 28 litres. A mixture, so it does not re-read at another horizon.
      gCo2e100: Math.round(args.quantity * 28 * 100),
      cost: displaced,
      category: 'compost', basis: 'estimated',
    });
  }
  return { output: output!, displaced };
}

/** Piles that want turning, for the daily pass (COMP-009). */
export async function turnsDue(ctx: Ctx): Promise<Array<{
  system: typeof compostSystems.$inferSelect; daysSinceTurn: number | null; interval: number;
}>> {
  const systems = await ctx.db.select().from(compostSystems).where(and(
    eq(compostSystems.status, 'active'), isNull(compostSystems.deletedAt),
  ));
  const out = [];
  for (const system of systems) {
    const interval = TURN_INTERVAL_DAYS[system.method as CompostMethod];
    if (interval == null) continue;
    const lastTurn = (await ctx.db.select().from(compostEvents).where(and(
      eq(compostEvents.systemId, system.id), eq(compostEvents.kind, 'turned'),
      isNull(compostEvents.deletedAt),
    )).orderBy(desc(compostEvents.occurredOn)).limit(1))[0];
    const days = lastTurn ? diffDays(ctx.today, lastTurn.occurredOn) : null;
    if (days == null || days >= interval) out.push({ system, daysSinceTurn: days, interval });
  }
  return out;
}
