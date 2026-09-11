/* eslint-disable @typescript-eslint/no-explicit-any */
import type { FastifyInstance } from 'fastify';
import { and, asc, desc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  ACTIVITY_TYPES, ATTRIBUTABLE, FACTOR_CONFIDENCE, HEATING_SEASON_WEIGHTS,
  SCOPE_LABELS, SCOPE_NOTES, addDays, monthlyPacing, parseCo2eInput,
} from '@homestead/shared';
import {
  activities, assets, attributions, carbonTargets, emissionFactors, emissions,
  interventions, meters, properties,
} from '../db/schema.js';
import { crudRoutes } from '../core/crud.js';
import { requireAdmin, requireWrite } from '../core/auth.js';
import { badRequest, notFound } from '../core/errors.js';
import { resolveLabels } from '../core/registry.js';
import {
  activityFromReading, explain, footprint, ledgerFor, recordActivity, regionOf,
} from '../services/carbon.js';
import {
  acceptIntervention, candidateFromTemplate, electricityPricePerKwh, estimateIntervention,
  fuelProfile, rankedCandidates, type SavingModel,
} from '../services/interventions.js';

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const yearStr = z.string().regex(/^\d{4}$/);

export function carbonRoutes(app: FastifyInstance): void {
  /* ── emission factors (GHG-001) ── */

  crudRoutes(app, '/api/v1/carbon/factors', {
    table: emissionFactors, entityType: 'category', label: 'Emission factor',
    create: z.object({
      key: z.string().trim().min(2),
      name: z.string().trim().min(1),
      category: z.string().trim().min(1),
      activityUnit: z.string().trim().min(1),
      kgPerUnit: z.number().min(0),
      scope: z.number().int().min(1).max(3).default(3),
      region: z.string().nullable().optional(),
      validFrom: dateStr.nullable().optional(),
      validTo: dateStr.nullable().optional(),
      source: z.string().nullable().optional(),
      confidence: z.enum(FACTOR_CONFIDENCE).default('medium'),
      notes: z.string().nullable().optional(),
    }),
    update: z.object({
      name: z.string().trim().min(1).optional(),
      kgPerUnit: z.number().min(0).optional(),
      scope: z.number().int().min(1).max(3).optional(),
      region: z.string().nullable().optional(),
      validFrom: dateStr.nullable().optional(),
      validTo: dateStr.nullable().optional(),
      source: z.string().nullable().optional(),
      confidence: z.enum(FACTOR_CONFIDENCE).optional(),
      notes: z.string().nullable().optional(),
      archived: z.boolean().optional(),
    }),
    searchColumns: ['name', 'key', 'notes'],
    filterColumns: ['category', 'scope', 'region', 'archived', 'key'],
    sortColumns: ['category', 'name', 'kgPerUnit'],
    defaultSort: { column: 'category', dir: 'asc' },
  });

  /* ── activities (GHG-004) ── */

  app.get('/api/v1/carbon/activities', async (req) => {
    const q = z.object({
      from: dateStr.optional(), to: dateStr.optional(),
      type: z.string().optional(),
      entityType: z.string().optional(), entityId: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(500).default(100),
    }).parse(req.query);

    const where = [isNull(activities.deletedAt)];
    if (q.from) where.push(gte(activities.occurredOn, q.from));
    if (q.to) where.push(lte(activities.occurredOn, q.to));
    if (q.type) where.push(eq(activities.type, q.type));
    if (q.entityType && q.entityId) {
      where.push(sql`exists (
        select 1 from attribution a
        where a.source_kind = 'activity' and a.source_id = ${activities.id}
          and a.entity_type = ${q.entityType} and a.entity_id = ${q.entityId})`);
    }

    const rows = await req.ctx.db.select().from(activities).where(and(...where))
      .orderBy(desc(activities.occurredOn), desc(activities.createdAt)).limit(q.limit);
    if (!rows.length) return { items: [] };

    const ids = rows.map((r) => r.id);
    const emissionRows = await req.ctx.db.select().from(emissions)
      .where(inArray(emissions.activityId, ids));
    const attrRows = await req.ctx.db.select().from(attributions).where(and(
      eq(attributions.sourceKind, 'activity'), inArray(attributions.sourceId, ids),
    ));
    const labels = await resolveLabels(req.ctx.db,
      attrRows.map((a) => ({ type: a.entityType, id: a.entityId })));

    return {
      items: rows.map((a) => ({
        ...a,
        gCo2e: emissionRows.filter((e) => e.activityId === a.id).reduce((s, e) => s + e.gCo2e, 0),
        emissions: emissionRows.filter((e) => e.activityId === a.id),
        attributions: attrRows.filter((x) => x.sourceId === a.id).map((x) => ({
          entityType: x.entityType, entityId: x.entityId,
          label: labels.get(`${x.entityType}:${x.entityId}`) ?? x.entityId,
        })),
      })),
    };
  });

  app.post('/api/v1/carbon/activities', async (req, reply) => {
    requireWrite(req.ctx.user);
    const body = z.object({
      type: z.enum(ACTIVITY_TYPES),
      amount: z.number(),
      unit: z.string().trim().min(1),
      occurredOn: dateStr.optional(),
      propertyId: z.string().nullable().optional(),
      locationId: z.string().nullable().optional(),
      note: z.string().nullable().optional(),
      factorKey: z.string().nullable().optional(),
      transactionId: z.string().nullable().optional(),
      attributions: z.array(z.object({
        entityType: z.enum(ATTRIBUTABLE), entityId: z.string().min(1),
      })).optional(),
    }).parse(req.body);
    const result = await recordActivity(req.ctx, body);
    reply.status(201);
    return result;
  });

  app.delete('/api/v1/carbon/activities/:id', async (req) => {
    requireWrite(req.ctx.user);
    const id = (req.params as { id: string }).id;
    await req.ctx.db.update(activities)
      .set({ deletedAt: new Date().toISOString(), updatedBy: req.ctx.user!.id })
      .where(eq(activities.id, id));
    await req.ctx.db.delete(emissions).where(eq(emissions.activityId, id));
    return { ok: true };
  });

  /* ── the footprint (GHG-016) ── */

  app.get('/api/v1/carbon/footprint', async (req) => {
    const q = z.object({
      from: dateStr.optional(), to: dateStr.optional(), year: yearStr.optional(),
    }).parse(req.query);
    const from = q.year ? `${q.year}-01-01` : q.from ?? `${req.ctx.today.slice(0, 4)}-01-01`;
    const to = q.year ? `${q.year}-12-31` : q.to ?? req.ctx.today;

    const current = await footprint(req.ctx, from, to);
    const priorYear = String(Number(from.slice(0, 4)) - 1);
    const prior = await footprint(req.ctx, `${priorYear}-01-01`, `${priorYear}-12-31`);

    const target = (await req.ctx.db.select().from(carbonTargets).where(and(
      eq(carbonTargets.period, from.slice(0, 4)), isNull(carbonTargets.deletedAt),
    )).limit(1))[0];

    const attributed = await req.ctx.db.select({
      entityType: attributions.entityType,
      entityId: attributions.entityId,
      total: sql<number>`coalesce(sum(${emissions.gCo2e}), 0)`,
    }).from(attributions)
      .innerJoin(activities, eq(activities.id, attributions.sourceId))
      .innerJoin(emissions, eq(emissions.activityId, activities.id))
      .where(and(
        eq(attributions.sourceKind, 'activity'),
        isNull(activities.deletedAt),
        gte(activities.occurredOn, from), lte(activities.occurredOn, to),
      ))
      .groupBy(attributions.entityType, attributions.entityId);
    const labels = await resolveLabels(req.ctx.db,
      attributed.map((a) => ({ type: a.entityType, id: a.entityId })));

    const household = await req.ctx.db.select({ n: sql<number>`count(*)` })
      .from((await import('../db/schema.js')).users)
      .where(isNull((await import('../db/schema.js')).users.deletedAt));
    const people = Math.max(Number(household[0]?.n ?? 1), 1);
    const property = (await req.ctx.db.select().from(properties)
      .where(and(eq(properties.isPrimary, true), isNull(properties.deletedAt))).limit(1))[0];

    return {
      ...current,
      region: regionOf(req.ctx),
      scopes: current.byScope.map((s) => ({
        ...s, label: SCOPE_LABELS[s.scope as 1 | 2 | 3], note: SCOPE_NOTES[s.scope as 1 | 2 | 3],
      })),
      priorYear: { year: priorYear, total: prior.total },
      changePct: prior.total > 0
        ? Math.round(((current.total - prior.total) / prior.total) * 100)
        : null,
      target: target ? {
        period: target.period, gCo2e: target.gCo2e,
        pct: target.gCo2e > 0 ? Math.round((current.total / target.gCo2e) * 100) : null,
      } : null,
      byEntity: attributed.map((a) => ({
        entityType: a.entityType, entityId: a.entityId,
        label: labels.get(`${a.entityType}:${a.entityId}`) ?? a.entityId,
        total: Number(a.total),
      })).sort((a, b) => b.total - a.total).slice(0, 25),
      intensity: {
        perPerson: Math.round(current.total / people),
        people,
        perSqft: property?.areaSqft ? Math.round(current.total / property.areaSqft) : null,
        areaSqft: property?.areaSqft ?? null,
      },
    };
  });

  /** Every number decomposed to the activities and factors behind it (GHG-028). */
  app.get('/api/v1/carbon/explain', async (req) => {
    const q = z.object({
      from: dateStr, to: dateStr,
      category: z.string().optional(),
      scope: z.coerce.number().int().min(1).max(3).optional(),
    }).parse(req.query);
    return { items: await explain(req.ctx, q.from, q.to, q) };
  });

  /** What one thing has cost and emitted, from the one ledger (INT-007). */
  app.get('/api/v1/ledger/:type/:id', async (req) => {
    const { type, id } = req.params as { type: string; id: string };
    const ledger = await ledgerFor(req.ctx, type, id);
    return { ...ledger, currency: req.ctx.household.currency };
  });

  /* ── meters (GHG-008) ── */

  app.get('/api/v1/carbon/meters', async (req) => {
    const rows = await req.ctx.db.select({ meter: meters, asset: assets })
      .from(meters).innerJoin(assets, eq(assets.id, meters.assetId))
      .where(isNull(assets.deletedAt));
    return { items: rows.map((r) => ({ ...r.meter, name: r.asset.name, assetId: r.asset.id })) };
  });

  app.put('/api/v1/carbon/meters/:assetId', async (req) => {
    requireWrite(req.ctx.user);
    const assetId = (req.params as { assetId: string }).assetId;
    const body = z.object({
      kind: z.string().trim().min(1),
      unit: z.string().trim().min(1),
      emissionFactorKey: z.string().nullable().optional(),
      multiplier: z.number().positive().default(1),
      rolloverAt: z.number().positive().nullable().optional(),
      serial: z.string().nullable().optional(),
    }).parse(req.body);
    const [row] = await req.ctx.db.insert(meters)
      .values({ assetId, ...body, createdBy: req.ctx.user!.id })
      .onConflictDoUpdate({ target: meters.assetId, set: { ...body, updatedBy: req.ctx.user!.id } })
      .returning();
    return row;
  });

  app.post('/api/v1/carbon/readings/:id/recompute', async (req) => {
    requireWrite(req.ctx.user);
    const result = await activityFromReading(req.ctx, (req.params as { id: string }).id);
    if (!result) throw badRequest('That reading did not produce consumption. Is a meter configured, and is there an earlier reading?');
    return result;
  });

  /* ── carbon budget (GHG-018) ── */

  app.get('/api/v1/carbon/target/:period', async (req) => {
    const period = (req.params as { period: string }).period;
    const row = (await req.ctx.db.select().from(carbonTargets).where(and(
      eq(carbonTargets.period, period), isNull(carbonTargets.deletedAt),
    )).limit(1))[0];
    if (!row) return { period, gCo2e: null, months: null };
    const monthly = monthlyPacing(row.gCo2e, HEATING_SEASON_WEIGHTS);
    const year = period.slice(0, 4);
    const actual = await footprint(req.ctx, `${year}-01-01`, `${year}-12-31`);
    const byMonth = new Map(actual.byMonth.map((m) => [m.month, m.total]));
    return {
      period, gCo2e: row.gCo2e, note: row.note,
      total: actual.total,
      pct: row.gCo2e > 0 ? Math.round((actual.total / row.gCo2e) * 100) : null,
      months: monthly.map((budgeted, i) => {
        const month = `${year}-${String(i + 1).padStart(2, '0')}`;
        return { month, budgeted, actual: byMonth.get(month) ?? 0 };
      }),
    };
  });

  app.put('/api/v1/carbon/target/:period', async (req) => {
    requireWrite(req.ctx.user);
    const period = (req.params as { period: string }).period;
    const body = z.object({
      gCo2e: z.union([z.number().int().positive(), z.string()]),
      note: z.string().nullable().optional(),
    }).parse(req.body);
    const grams = typeof body.gCo2e === 'string' ? parseCo2eInput(body.gCo2e) : body.gCo2e;
    if (!grams || grams <= 0) throw badRequest('Give a target like "8 t" or "8000 kg"');
    const [row] = await req.ctx.db.insert(carbonTargets)
      .values({ period, gCo2e: grams, note: body.note ?? null, createdBy: req.ctx.user!.id })
      .onConflictDoUpdate({
        target: carbonTargets.period,
        set: { gCo2e: grams, note: body.note ?? null, updatedBy: req.ctx.user!.id },
      }).returning();
    return row;
  });

  /* ── interventions (GHG-019/020/021) ── */

  app.get('/api/v1/carbon/interventions/candidates', async (req) => ({
    items: await rankedCandidates(req.ctx),
    currency: req.ctx.household.currency,
    electricityPricePerKwh: await electricityPricePerKwh(req.ctx),
  }));

  app.get('/api/v1/carbon/interventions', async (req) => {
    const rows = await req.ctx.db.select().from(interventions)
      .where(isNull(interventions.deletedAt)).orderBy(asc(interventions.createdAt));
    return { items: rows, currency: req.ctx.household.currency };
  });

  app.post('/api/v1/carbon/interventions', async (req, reply) => {
    requireWrite(req.ctx.user);
    const body = z.object({
      templateKey: z.string().optional(),
      name: z.string().trim().min(1).optional(),
      category: z.string().default('other'),
      propertyId: z.string().nullable().optional(),
      targetAssetId: z.string().nullable().optional(),
      capitalCost: z.number().int().min(0).optional(),
      embodiedGCo2e: z.number().int().min(0).optional(),
      lifetimeYears: z.number().int().min(1).max(60).optional(),
      savingModel: z.object({
        kind: z.enum(['fuel_switch', 'reduce', 'generate']),
        fuel: z.string().optional(),
        existingEfficiency: z.number().min(0.1).max(1).optional(),
        replacementCop: z.number().min(0.5).max(8).optional(),
        fraction: z.number().min(0).max(1).optional(),
        annualKwh: z.number().min(0).optional(),
      }).optional(),
      notesMd: z.string().nullable().optional(),
    }).parse(req.body);

    let name = body.name;
    let capitalCost = body.capitalCost ?? 0;
    let embodied = body.embodiedGCo2e ?? 0;
    let lifetime = body.lifetimeYears ?? 20;
    let category = body.category;
    let estimate;

    if (body.templateKey) {
      const candidate = await candidateFromTemplate(req.ctx, body.templateKey, {
        targetAssetId: body.targetAssetId, capitalCost: body.capitalCost,
      });
      name = name ?? candidate.template.name;
      capitalCost = candidate.capitalCost;
      embodied = body.embodiedGCo2e ?? candidate.template.embodiedGCo2e ?? 0;
      lifetime = body.lifetimeYears ?? candidate.template.lifetimeYears;
      category = candidate.template.category;
      estimate = candidate.estimate;
    } else {
      if (!name) throw badRequest('Give it a name, or start from a template');
      estimate = await estimateIntervention(req.ctx, {
        model: (body.savingModel ?? { kind: 'reduce' }) satisfies SavingModel,
        capitalCost, embodiedGCo2e: embodied, lifetimeYears: lifetime,
      });
    }

    const property = body.propertyId ?? (await req.ctx.db.select({ id: properties.id })
      .from(properties).where(and(eq(properties.isPrimary, true), isNull(properties.deletedAt)))
      .limit(1))[0]?.id ?? null;

    const [row] = await req.ctx.db.insert(interventions).values({
      templateKey: body.templateKey ?? null,
      name: name!, category, propertyId: property,
      targetAssetId: body.targetAssetId ?? null,
      capitalCost, embodiedGCo2e: embodied,
      annualSavingKwh: estimate.annualSavingKwh,
      annualSavingCost: estimate.annualSavingCost,
      annualSavingGCo2e: estimate.annualSavingGCo2e,
      basis: estimate.basis, basisNote: estimate.basisNote,
      lifetimeYears: lifetime, notesMd: body.notesMd ?? null,
      createdBy: req.ctx.user!.id, updatedBy: req.ctx.user!.id,
    }).returning();

    reply.status(201);
    return { ...row, payback: estimate.payback };
  });

  app.post('/api/v1/carbon/interventions/:id/accept', async (req) => {
    requireWrite(req.ctx.user);
    const body = z.object({ propertyId: z.string().optional() }).parse(req.body ?? {});
    return acceptIntervention(req.ctx, (req.params as { id: string }).id, body.propertyId);
  });

  app.delete('/api/v1/carbon/interventions/:id', async (req) => {
    requireWrite(req.ctx.user);
    await req.ctx.db.update(interventions)
      .set({ deletedAt: new Date().toISOString(), updatedBy: req.ctx.user!.id })
      .where(eq(interventions.id, (req.params as { id: string }).id));
    return { ok: true };
  });

  /* ── energy, in its own right ── */

  app.get('/api/v1/carbon/energy', async (req) => {
    const q = z.object({ months: z.coerce.number().int().min(1).max(60).default(12) }).parse(req.query);
    const fuels = ['electricity', 'natural_gas', 'heating_oil', 'propane', 'wood', 'generation'];
    const profiles = [];
    for (const fuel of fuels) {
      const profile = await fuelProfile(req.ctx, fuel, { months: q.months });
      if (profile.measured) profiles.push(profile);
    }
    const from = addDays(req.ctx.today, -Math.round(q.months * 30.44));
    const monthly = await req.ctx.db.select({
      month: sql<string>`substr(${activities.occurredOn}, 1, 7)`,
      type: activities.type,
      total: sql<number>`coalesce(sum(${emissions.gCo2e}), 0)`,
    }).from(activities)
      .innerJoin(emissions, eq(emissions.activityId, activities.id))
      .where(and(
        isNull(activities.deletedAt),
        gte(activities.occurredOn, from),
        inArray(activities.type, fuels),
      ))
      .groupBy(sql`substr(${activities.occurredOn}, 1, 7)`, activities.type);

    return {
      profiles,
      pricePerKwh: await electricityPricePerKwh(req.ctx),
      currency: req.ctx.household.currency,
      monthly: monthly.map((m) => ({ ...m, total: Number(m.total) })),
    };
  });

  app.post('/api/v1/carbon/recalculate', async (req) => {
    requireAdmin(req.ctx.user);
    const body = z.object({ from: dateStr, to: dateStr, apply: z.boolean().default(false) }).parse(req.body);
    const { recalculate } = await import('../services/carbon-recalc.js');
    return recalculate(req.ctx, body.from, body.to, body.apply);
  });
}
