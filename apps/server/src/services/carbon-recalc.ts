/* eslint-disable @typescript-eslint/no-explicit-any */
import { and, eq, gte, inArray, isNull, lte } from 'drizzle-orm';
import { applyFactorGases, resolveFactor, type Grams } from '@homestead/shared';
import type { Ctx } from '../core/ctx.js';
import { logActivity } from '../core/activity.js';
import { activities, emissionFactors, emissions } from '../db/schema.js';
import { regionOf } from './carbon.js';

export interface RecalcLine {
  activityId: string;
  occurredOn: string;
  factorKey: string;
  gas: string;
  was: Grams;
  now: Grams;
  wasFactor: number;
  nowFactor: number;
}

/**
 * Correcting a factor must never silently rewrite history (GHG-005), so a
 * recalculation is an explicit action that shows its diff first and only
 * writes when asked.
 */
export async function recalculate(
  ctx: Ctx, from: string, to: string, apply: boolean,
): Promise<{ applied: boolean; changed: RecalcLine[]; unchanged: number; deltaGCo2e: Grams }> {
  const rows = await ctx.db.select({ e: emissions, a: activities })
    .from(emissions)
    .innerJoin(activities, eq(activities.id, emissions.activityId))
    .where(and(
      isNull(activities.deletedAt),
      gte(activities.occurredOn, from),
      lte(activities.occurredOn, to),
    ));
  if (!rows.length) return { applied: false, changed: [], unchanged: 0, deltaGCo2e: 0 };

  const keys = [...new Set(rows.map((r) => r.e.factorKey))].filter((k) => k !== 'explicit');
  const factorRows = keys.length
    ? await ctx.db.select().from(emissionFactors).where(and(
      inArray(emissionFactors.key, keys),
      eq(emissionFactors.archived, false),
      isNull(emissionFactors.deletedAt),
    ))
    : [];
  const region = regionOf(ctx);

  const changed: RecalcLine[] = [];
  let unchanged = 0;
  let delta = 0;

  for (const row of rows) {
    if (row.e.factorKey === 'explicit') { unchanged++; continue; }
    const chosen = resolveFactor(
      factorRows.filter((f) => f.key === row.e.factorKey).map((f) => ({
        id: f.id, key: f.key, name: f.name, activityUnit: f.activityUnit,
        kgPerUnit: f.kgPerUnit, scope: f.scope as 1 | 2 | 3,
        region: f.region, validFrom: f.validFrom, validTo: f.validTo,
        gases: f.gases ?? null,
      })),
      { on: row.a.occurredOn, region },
    );
    if (!chosen) { unchanged++; continue; }

    // An emission is one gas of one factor, so it has to be recomputed against
    // that gas rather than against the factor's whole coefficient — applying
    // the total to every gas row would multiply the activity by its own gas
    // count, which is exactly the bug this shape is meant to prevent.
    let applied: ReturnType<typeof applyFactorGases>;
    try {
      applied = applyFactorGases(
        Math.abs(row.a.amount), row.a.unit, chosen, row.e.gwpHorizon === 20 ? 20 : 100,
      );
    } catch { unchanged++; continue; }

    const match = applied.gases.find((g) => g.gas === row.e.gas);
    if (!match) { unchanged++; continue; }

    const negative = row.e.gCo2e < 0;
    const signed = negative ? -match.gCo2e : match.gCo2e;
    const signedMass = negative ? -match.massMg : match.massMg;

    if (signed === row.e.gCo2e) { unchanged++; continue; }
    changed.push({
      activityId: row.a.id, occurredOn: row.a.occurredOn, factorKey: row.e.factorKey,
      gas: row.e.gas,
      was: row.e.gCo2e, now: signed,
      wasFactor: row.e.factorKgPerUnit, nowFactor: chosen.kgPerUnit,
    });
    delta += signed - row.e.gCo2e;

    if (apply) {
      await ctx.db.update(emissions).set({
        gCo2e: signed,
        massMg: signedMass,
        gwp: match.gwp,
        factorId: chosen.id,
        factorKgPerUnit: chosen.kgPerUnit,
        factorUnit: chosen.activityUnit,
        scope: chosen.scope,
        updatedBy: ctx.user?.id ?? null,
      }).where(eq(emissions.id, row.e.id));
    }
  }

  if (apply && changed.length) {
    await logActivity(ctx.db, {
      userId: ctx.user?.id, action: 'recalculate', entityType: 'category', entityId: 'carbon',
      summary: `Recalculated ${changed.length} emissions for ${from}..${to}, net ${delta > 0 ? '+' : ''}${Math.round(delta / 1000)} kg`,
    });
  }
  return { applied: apply, changed, unchanged, deltaGCo2e: delta };
}
