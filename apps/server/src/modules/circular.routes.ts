/* eslint-disable @typescript-eslint/no-explicit-any */
import type { FastifyInstance } from 'fastify';
import { and, desc, eq, gte, isNull, lte } from 'drizzle-orm';
import { z } from 'zod';
import { CIRCULATION_KINDS, REPAIR_OUTCOMES } from '@homestead/shared';
import { assets, circulationEvents, repairs } from '../db/schema.js';
import { requireWrite } from '../core/auth.js';
import { notFound } from '../core/errors.js';
import { resolveLabels } from '../core/registry.js';
import {
  circularitySummary, embodiedForAsset, extendedLifeFor, recordRepair, repairOrReplaceFor,
  seedSelfSufficiency,
} from '../services/circular.js';
import { avoidedBetween } from '../services/carbon.js';

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export function circularRoutes(app: FastifyInstance): void {
  /* ── repairs ── */

  app.get('/api/v1/repairs', async (req) => {
    const q = z.object({
      targetType: z.string().optional(), targetId: z.string().optional(),
      outcome: z.string().optional(),
      from: dateStr.optional(), to: dateStr.optional(),
      limit: z.coerce.number().int().min(1).max(500).default(100),
    }).parse(req.query);

    const where = [isNull(repairs.deletedAt)];
    if (q.targetType) where.push(eq(repairs.targetType, q.targetType));
    if (q.targetId) where.push(eq(repairs.targetId, q.targetId));
    if (q.outcome) where.push(eq(repairs.outcome, q.outcome));
    if (q.from) where.push(gte(repairs.occurredOn, q.from));
    if (q.to) where.push(lte(repairs.occurredOn, q.to));

    const rows = await req.ctx.db.select().from(repairs).where(and(...where))
      .orderBy(desc(repairs.occurredOn)).limit(q.limit);
    const labels = await resolveLabels(req.ctx.db, rows
      .filter((r) => r.targetType && r.targetId)
      .map((r) => ({ type: r.targetType!, id: r.targetId! })));

    return {
      items: rows.map((r) => ({
        ...r,
        targetLabel: r.targetType && r.targetId
          ? labels.get(`${r.targetType}:${r.targetId}`) ?? r.targetText
          : r.targetText,
      })),
      currency: req.ctx.household.currency,
    };
  });

  app.post('/api/v1/repairs', async (req, reply) => {
    requireWrite(req.ctx.user);
    const body = z.object({
      targetType: z.enum(['asset', 'tool', 'storage_item', 'other']).nullable().optional(),
      targetId: z.string().nullable().optional(),
      targetText: z.string().nullable().optional(),
      occurredOn: dateStr.optional(),
      symptom: z.string().trim().min(1),
      workDone: z.string().nullable().optional(),
      partsCost: z.number().int().min(0).default(0),
      timeMin: z.number().int().min(0).nullable().optional(),
      byContactId: z.string().nullable().optional(),
      outcome: z.enum(REPAIR_OUTCOMES).default('fixed'),
      extendedLifeYears: z.number().min(0).max(50).nullable().optional(),
      notes: z.string().nullable().optional(),
      bookCost: z.boolean().default(true),
    }).parse(req.body);
    const result = await recordRepair(req.ctx, body as any);
    reply.status(201);
    return result;
  });

  app.delete('/api/v1/repairs/:id', async (req) => {
    requireWrite(req.ctx.user);
    await req.ctx.db.update(repairs)
      .set({ deletedAt: new Date().toISOString(), updatedBy: req.ctx.user!.id })
      .where(eq(repairs.id, (req.params as { id: string }).id));
    return { ok: true };
  });

  /**
   * Repair or replace, in money and in carbon, per year of service — which is
   * the comparison that means something. Where the two measures disagree the
   * answer says so rather than choosing for the household (CIRC-005).
   */
  app.get('/api/v1/assets/:id/repair-or-replace', async (req) => {
    const q = z.object({
      repairCost: z.coerce.number().int().min(0),
      extendedLifeYears: z.coerce.number().min(0.5).max(50).optional(),
      replacementCost: z.coerce.number().int().min(0).optional(),
      replacementAnnualCost: z.coerce.number().int().optional(),
      replacementAnnualGCo2e: z.coerce.number().int().optional(),
    }).parse(req.query);
    const result = await repairOrReplaceFor(req.ctx, (req.params as { id: string }).id, q);
    return { ...result, currency: req.ctx.household.currency };
  });

  app.get('/api/v1/assets/:id/circularity', async (req) => {
    const id = (req.params as { id: string }).id;
    const asset = (await req.ctx.db.select().from(assets).where(eq(assets.id, id)).limit(1))[0];
    if (!asset) throw notFound('Asset');
    const rows = await req.ctx.db.select().from(repairs).where(and(
      eq(repairs.targetType, 'asset'), eq(repairs.targetId, id), isNull(repairs.deletedAt),
    )).orderBy(desc(repairs.occurredOn));
    return {
      repairs: rows,
      extendedLifeYears: await extendedLifeFor(req.ctx, 'asset', id),
      embodied: await embodiedForAsset(req.ctx, asset),
      avoidedCost: rows.reduce((a, b) => a + (b.avoidedCost ?? 0), 0),
      avoidedGCo2e: rows.reduce((a, b) => a + (b.avoidedGCo2e ?? 0), 0),
      currency: req.ctx.household.currency,
    };
  });

  /* ── circulation events ── */

  app.get('/api/v1/circulation', async (req) => {
    const q = z.object({
      kind: z.string().optional(),
      from: dateStr.optional(), to: dateStr.optional(),
      limit: z.coerce.number().int().min(1).max(500).default(100),
    }).parse(req.query);
    const where = [isNull(circulationEvents.deletedAt)];
    if (q.kind) where.push(eq(circulationEvents.kind, q.kind));
    if (q.from) where.push(gte(circulationEvents.occurredOn, q.from));
    if (q.to) where.push(lte(circulationEvents.occurredOn, q.to));
    return {
      items: await req.ctx.db.select().from(circulationEvents).where(and(...where))
        .orderBy(desc(circulationEvents.occurredOn)).limit(q.limit),
      currency: req.ctx.household.currency,
    };
  });

  app.post('/api/v1/circulation', async (req, reply) => {
    requireWrite(req.ctx.user);
    const body = z.object({
      kind: z.enum(CIRCULATION_KINDS),
      itemType: z.string().nullable().optional(),
      itemId: z.string().nullable().optional(),
      itemText: z.string().nullable().optional(),
      occurredOn: dateStr.default(req.ctx.today),
      contactId: z.string().nullable().optional(),
      quantity: z.number().nullable().optional(),
      unit: z.string().nullable().optional(),
      value: z.number().int().nullable().optional(),
      note: z.string().nullable().optional(),
    }).parse(req.body);
    const [row] = await req.ctx.db.insert(circulationEvents).values({
      ...body, createdBy: req.ctx.user!.id, updatedBy: req.ctx.user!.id,
    }).returning();
    reply.status(201);
    return row;
  });

  app.delete('/api/v1/circulation/:id', async (req) => {
    requireWrite(req.ctx.user);
    await req.ctx.db.update(circulationEvents)
      .set({ deletedAt: new Date().toISOString(), updatedBy: req.ctx.user!.id })
      .where(eq(circulationEvents.id, (req.params as { id: string }).id));
    return { ok: true };
  });

  /* ── the report ── */

  app.get('/api/v1/circularity', async (req) => {
    const q = z.object({
      from: dateStr.optional(), to: dateStr.optional(), year: z.string().regex(/^\d{4}$/).optional(),
    }).parse(req.query);
    const year = q.year ?? req.ctx.today.slice(0, 4);
    const from = q.from ?? `${year}-01-01`;
    const to = q.to ?? `${year}-12-31`;
    const summary = await circularitySummary(req.ctx, from, to);
    return {
      ...summary,
      seeds: await seedSelfSufficiency(req.ctx, year),
      currency: req.ctx.household.currency,
    };
  });

  /** Everything avoided in a period, with the counterfactual for each. */
  app.get('/api/v1/avoided', async (req) => {
    const q = z.object({ from: dateStr.optional(), to: dateStr.optional() }).parse(req.query);
    const year = req.ctx.today.slice(0, 4);
    const result = await avoidedBetween(
      req.ctx, q.from ?? `${year}-01-01`, q.to ?? `${year}-12-31`,
    );
    return {
      ...result,
      note: 'Avoided emissions are counterfactuals, not reductions. They are never netted against the household footprint.',
      currency: req.ctx.household.currency,
    };
  });
}
