/* eslint-disable @typescript-eslint/no-explicit-any */
import type { FastifyInstance } from 'fastify';
import { and, desc, eq, gte, isNull, lte } from 'drizzle-orm';
import { z } from 'zod';
import { COMPOST_EVENT_KINDS, COMPOST_METHODS, CN_TARGET, THERMOPHILIC_F } from '@homestead/shared';
import { beds, compostEvents, compostOutputs, compostSystems } from '../db/schema.js';
import { crudRoutes } from '../core/crud.js';
import { requireWrite } from '../core/auth.js';
import { notFound } from '../core/errors.js';
import {
  addCompostInput, balanceOf, fixAdvice, materialLibrary, recordOutput, systemDetail, turnsDue,
} from '../services/compost.js';
import { avoidedBetween } from '../services/carbon.js';

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export function compostRoutes(app: FastifyInstance): void {
  crudRoutes(app, '/api/v1/compost/systems', {
    table: compostSystems, entityType: 'compost_system', label: 'Compost system',
    create: z.object({
      name: z.string().trim().min(1),
      method: z.enum(COMPOST_METHODS).default('hot_pile'),
      locationId: z.string().nullable().optional(),
      capacity: z.number().positive().nullable().optional(),
      capacityUnit: z.string().default('cuft'),
      activeFrom: dateStr.nullable().optional(),
      notes: z.string().nullable().optional(),
    }),
    update: z.object({
      name: z.string().trim().min(1).optional(),
      method: z.enum(COMPOST_METHODS).optional(),
      locationId: z.string().nullable().optional(),
      capacity: z.number().positive().nullable().optional(),
      status: z.enum(['active', 'curing', 'retired']).optional(),
      notes: z.string().nullable().optional(),
    }),
    searchColumns: ['name', 'notes'],
    filterColumns: ['method', 'status'],
    sortColumns: ['name'],
    hooks: {
      decorate: async (rows, ctx) => Promise.all(rows.map(async (r) => ({
        ...r, balance: await balanceOf(ctx, r.id),
      }))),
    },
  });

  app.get('/api/v1/compost/materials', async (req) => ({
    items: await materialLibrary(req.ctx),
    targets: { cn: CN_TARGET, thermophilicF: THERMOPHILIC_F },
  }));

  app.get('/api/v1/compost/systems/:id/detail', async (req) =>
    systemDetail(req.ctx, (req.params as { id: string }).id));

  app.post('/api/v1/compost/systems/:id/inputs', async (req, reply) => {
    requireWrite(req.ctx.user);
    const body = z.object({
      materialKey: z.string(),
      quantity: z.number().positive(),
      unit: z.string().default('kg'),
      occurredOn: dateStr.optional(),
      note: z.string().nullable().optional(),
      counterfactualKey: z.string().nullable().optional(),
    }).parse(req.body);
    const result = await addCompostInput(req.ctx, {
      systemId: (req.params as { id: string }).id, ...body,
    });
    reply.status(201);
    return result;
  });

  app.post('/api/v1/compost/systems/:id/events', async (req, reply) => {
    requireWrite(req.ctx.user);
    const body = z.object({
      kind: z.enum(COMPOST_EVENT_KINDS).default('turned'),
      occurredOn: dateStr.default(req.ctx.today),
      temperatureF: z.number().min(-20).max(220).nullable().optional(),
      moisture: z.string().nullable().optional(),
      note: z.string().nullable().optional(),
    }).parse(req.body);
    const [row] = await req.ctx.db.insert(compostEvents).values({
      systemId: (req.params as { id: string }).id,
      ...body, createdBy: req.ctx.user!.id, updatedBy: req.ctx.user!.id,
    }).returning();
    reply.status(201);
    return { ...row, status: (await systemDetail(req.ctx, row!.systemId)).status };
  });

  /** Finished compost out, and into a bed if that is where it went (INT-011). */
  app.post('/api/v1/compost/systems/:id/outputs', async (req, reply) => {
    requireWrite(req.ctx.user);
    const body = z.object({
      quantity: z.number().positive(),
      unit: z.string().default('cuft'),
      occurredOn: dateStr.optional(),
      bedId: z.string().nullable().optional(),
      note: z.string().nullable().optional(),
    }).parse(req.body);
    const result = await recordOutput(req.ctx, {
      systemId: (req.params as { id: string }).id, ...body,
    });
    reply.status(201);
    const bed = result.output.bedId
      ? (await req.ctx.db.select().from(beds).where(eq(beds.id, result.output.bedId)).limit(1))[0]
      : null;
    return { ...result, bed };
  });

  app.get('/api/v1/compost/systems/:id/advice', async (req) =>
    fixAdvice(req.ctx, (req.params as { id: string }).id));

  app.get('/api/v1/compost/turns-due', async (req) => ({ items: await turnsDue(req.ctx) }));

  /**
   * The compost overview.
   *
   * The avoided figure is deliberately reported here and not folded into the
   * footprint, and it is given at both horizons because the case for a pile is
   * much stronger over twenty years than a hundred — which is a fact about
   * methane, not an argument (COMP-013, COMP-014).
   */
  app.get('/api/v1/compost/overview', async (req) => {
    const year = req.ctx.today.slice(0, 4);
    const systems = await req.ctx.db.select().from(compostSystems)
      .where(isNull(compostSystems.deletedAt));

    const details = await Promise.all(systems.map((s) => systemDetail(req.ctx, s.id)));
    const avoided = await avoidedBetween(req.ctx, `${year}-01-01`, `${year}-12-31`);
    const compost = avoided.byCategory.find((c) => c.category === 'compost');

    const outputs = await req.ctx.db.select().from(compostOutputs).where(and(
      isNull(compostOutputs.deletedAt), gte(compostOutputs.occurredOn, `${year}-01-01`),
    ));

    return {
      systems: details.map((d) => ({
        system: d.system, status: d.status, balance: d.balance,
        advice: d.advice.suggestion, readyOn: d.readyOn, totals: d.totals,
      })),
      turnsDue: await turnsDue(req.ctx),
      year: {
        divertedKg: details.reduce((a, d) => a + d.totals.inputKg, 0),
        outputs: outputs.reduce((a, b) => a + b.quantity, 0),
        displacedCost: outputs.reduce((a, b) => a + (b.estValue ?? 0), 0),
      },
      avoided: {
        gCo2e100: compost?.total100 ?? 0,
        gCo2e20: compost?.total20 ?? 0,
        note: 'What a landfill would have released from the same material, less what the pile itself releases. Reported beside the household footprint and never subtracted from it — the avoidance did not happen, which is the point.',
      },
      currency: req.ctx.household.currency,
    };
  });
}
