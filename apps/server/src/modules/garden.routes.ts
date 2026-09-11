/* eslint-disable @typescript-eslint/no-explicit-any */
import type { FastifyInstance } from 'fastify';
import { and, asc, desc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  GROWING_METHODS, OBSERVATION_KINDS, PLANTING_STATUS, SEED_ORIGINS, SOW_METHODS,
  seedViability, sowAdvice, successionDates,
} from '@homestead/shared';
import {
  beds, gardenObservations, harvests, plantings, plantVarieties, properties, seedLots, soilTests,
} from '../db/schema.js';
import { crudRoutes } from '../core/crud.js';
import { requireWrite } from '../core/auth.js';
import { badRequest, notFound } from '../core/errors.js';
import {
  bedDetail, bedHistory, checkRotation, frostDatesOf, gardenNet, plantingTasks,
  primaryPropertyId, recordGardenInput, recordHarvest, seedDrawer,
} from '../services/garden.js';
import { emittedBy } from '../services/carbon.js';

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const monthDay = z.string().regex(/^\d{2}-\d{2}$/);

export function gardenRoutes(app: FastifyInstance): void {
  /* ── beds ── */

  crudRoutes(app, '/api/v1/garden/beds', {
    table: beds, entityType: 'bed', label: 'Bed',
    create: z.object({
      propertyId: z.string().optional(),
      locationId: z.string().nullable().optional(),
      name: z.string().trim().min(1),
      method: z.enum(GROWING_METHODS).default('raised'),
      areaSqft: z.number().positive().nullable().optional(),
      sun: z.string().nullable().optional(),
      irrigation: z.string().nullable().optional(),
      soilNotes: z.string().nullable().optional(),
      activeFrom: dateStr.nullable().optional(),
      sort: z.number().int().optional(),
    }),
    update: z.object({
      name: z.string().trim().min(1).optional(),
      locationId: z.string().nullable().optional(),
      method: z.enum(GROWING_METHODS).optional(),
      areaSqft: z.number().positive().nullable().optional(),
      sun: z.string().nullable().optional(),
      irrigation: z.string().nullable().optional(),
      soilNotes: z.string().nullable().optional(),
      activeTo: dateStr.nullable().optional(),
      sort: z.number().int().optional(),
    }),
    searchColumns: ['name', 'soilNotes'],
    filterColumns: ['propertyId', 'method'],
    sortColumns: ['sort', 'name'],
    defaultSort: { column: 'sort', dir: 'asc' },
    hooks: {
      beforeCreate: async (data, ctx) => ({
        ...data,
        propertyId: (data as any).propertyId ?? await primaryPropertyId(ctx),
      }),
      decorate: async (rows, ctx) => {
        const ids = rows.map((r) => r.id);
        if (!ids.length) return rows;
        const active = await ctx.db.select({
          bedId: plantings.bedId, n: sql<number>`count(*)`,
        }).from(plantings).where(and(
          inArray(plantings.bedId, ids),
          inArray(plantings.status, ['growing', 'harvesting']),
          isNull(plantings.deletedAt),
        )).groupBy(plantings.bedId);
        const counts = new Map(active.map((a) => [a.bedId, Number(a.n)]));
        return rows.map((r) => ({ ...r, activePlantings: counts.get(r.id) ?? 0 }));
      },
    },
  });

  app.get('/api/v1/garden/beds/:id/detail', async (req) =>
    bedDetail(req.ctx, (req.params as { id: string }).id));

  app.post('/api/v1/garden/beds/:id/soil-test', async (req, reply) => {
    requireWrite(req.ctx.user);
    const bedId = (req.params as { id: string }).id;
    const body = z.object({
      takenOn: dateStr.default(req.ctx.today),
      ph: z.number().min(0).max(14).nullable().optional(),
      n: z.number().nullable().optional(),
      p: z.number().nullable().optional(),
      k: z.number().nullable().optional(),
      organicMatterPct: z.number().min(0).max(100).nullable().optional(),
      lab: z.string().nullable().optional(),
      notes: z.string().nullable().optional(),
    }).parse(req.body);
    const [row] = await req.ctx.db.insert(soilTests)
      .values({ bedId, ...body, createdBy: req.ctx.user!.id }).returning();
    reply.status(201);
    return row;
  });

  app.get('/api/v1/garden/beds/:id/soil-tests', async (req) => ({
    items: await req.ctx.db.select().from(soilTests).where(and(
      eq(soilTests.bedId, (req.params as { id: string }).id), isNull(soilTests.deletedAt),
    )).orderBy(desc(soilTests.takenOn)),
  }));

  /* ── varieties ── */

  crudRoutes(app, '/api/v1/garden/varieties', {
    table: plantVarieties, entityType: 'variety', label: 'Variety',
    create: z.object({
      name: z.string().trim().min(1),
      cultivar: z.string().nullable().optional(),
      family: z.string().nullable().optional(),
      species: z.string().nullable().optional(),
      category: z.enum(['vegetable', 'herb', 'fruit', 'flower']).default('vegetable'),
      daysToMaturity: z.number().int().positive().nullable().optional(),
      sowDepthIn: z.number().positive().nullable().optional(),
      spacingIn: z.number().positive().nullable().optional(),
      sun: z.string().nullable().optional(),
      frostHardy: z.boolean().optional(),
      perennial: z.boolean().optional(),
      openPollinated: z.boolean().optional(),
      seedViabilityYears: z.number().int().positive().nullable().optional(),
      indoorWeeks: z.number().int().positive().nullable().optional(),
      sowWindow: z.object({
        anchor: z.enum(['last_spring', 'first_autumn']),
        startWeeks: z.number(), endWeeks: z.number(),
        method: z.string().optional(),
      }).nullable().optional(),
      emissionFactorKey: z.string().nullable().optional(),
      typicalPrice: z.number().int().nullable().optional(),
      typicalPriceUnit: z.string().nullable().optional(),
      yieldPerPlantLb: z.number().positive().nullable().optional(),
      notes: z.string().nullable().optional(),
    }),
    update: z.object({
      name: z.string().trim().min(1).optional(),
      cultivar: z.string().nullable().optional(),
      family: z.string().nullable().optional(),
      daysToMaturity: z.number().int().positive().nullable().optional(),
      openPollinated: z.boolean().optional(),
      seedViabilityYears: z.number().int().positive().nullable().optional(),
      indoorWeeks: z.number().int().positive().nullable().optional(),
      emissionFactorKey: z.string().nullable().optional(),
      typicalPrice: z.number().int().nullable().optional(),
      typicalPriceUnit: z.string().nullable().optional(),
      notes: z.string().nullable().optional(),
    }),
    searchColumns: ['name', 'cultivar', 'notes'],
    filterColumns: ['family', 'category', 'perennial', 'openPollinated'],
    sortColumns: ['name', 'daysToMaturity'],
    defaultSort: { column: 'name', dir: 'asc' },
    hooks: {
      decorate: async (rows, ctx) => {
        const frost = await frostDatesOf(ctx);
        return rows.map((r) => ({ ...r, sow: sowAdvice(r.sowWindow as any, frost, ctx.today) }));
      },
    },
  });

  /* ── seed lots: the drawer ── */

  app.get('/api/v1/garden/seeds', async (req) => ({
    items: await seedDrawer(req.ctx),
    frost: await frostDatesOf(req.ctx),
  }));

  app.post('/api/v1/garden/seeds', async (req, reply) => {
    requireWrite(req.ctx.user);
    const body = z.object({
      varietyId: z.string(),
      origin: z.enum(SEED_ORIGINS).default('bought'),
      supplierContactId: z.string().nullable().optional(),
      savedFromPlantingId: z.string().nullable().optional(),
      quantity: z.number().min(0).default(0),
      unit: z.string().default('seed'),
      yearPacked: z.number().int().min(1900).max(2200).nullable().optional(),
      locationId: z.string().nullable().optional(),
      cost: z.number().int().nullable().optional(),
      notes: z.string().nullable().optional(),
    }).parse(req.body);

    const variety = (await req.ctx.db.select().from(plantVarieties)
      .where(eq(plantVarieties.id, body.varietyId)).limit(1))[0];
    if (!variety) throw notFound('Variety');

    // Seed saved from an F1 hybrid does not come true. Say so, and let them
    // proceed anyway — plenty of people save it knowing what they will get
    // (CIRC-014).
    let warning: string | null = null;
    if (body.origin === 'saved' && !variety.openPollinated) {
      warning = `${variety.name}${variety.cultivar ? ` '${variety.cultivar}'` : ''} is an F1 hybrid. Seed saved from it will not come true — expect something between its parents.`;
    }

    const [row] = await req.ctx.db.insert(seedLots).values({
      ...body,
      yearPacked: body.yearPacked ?? Number(req.ctx.today.slice(0, 4)),
      createdBy: req.ctx.user!.id, updatedBy: req.ctx.user!.id,
    }).returning();
    reply.status(201);
    return { ...row, warning };
  });

  app.patch('/api/v1/garden/seeds/:id', async (req) => {
    requireWrite(req.ctx.user);
    const id = (req.params as { id: string }).id;
    const body = z.object({
      quantity: z.number().min(0).optional(),
      locationId: z.string().nullable().optional(),
      notes: z.string().nullable().optional(),
    }).parse(req.body);
    const [row] = await req.ctx.db.update(seedLots)
      .set({ ...body, updatedBy: req.ctx.user!.id }).where(eq(seedLots.id, id)).returning();
    if (!row) throw notFound('Seed lot');
    return row;
  });

  /** A germination test: a tested old lot beats an untested new one (GARD-010). */
  app.post('/api/v1/garden/seeds/:id/germination-test', async (req) => {
    requireWrite(req.ctx.user);
    const id = (req.params as { id: string }).id;
    const body = z.object({
      tested: z.number().int().positive(),
      germinated: z.number().int().min(0),
      testedOn: dateStr.default(req.ctx.today),
    }).parse(req.body);
    if (body.germinated > body.tested) throw badRequest('More germinated than were tested');

    const rate = body.germinated / body.tested;
    const [row] = await req.ctx.db.update(seedLots).set({
      germinationRate: Math.round(rate * 100) / 100,
      testedOn: body.testedOn,
      updatedBy: req.ctx.user!.id,
    }).where(eq(seedLots.id, id)).returning();
    if (!row) throw notFound('Seed lot');

    const variety = (await req.ctx.db.select().from(plantVarieties)
      .where(eq(plantVarieties.id, row.varietyId)).limit(1))[0];
    return {
      ...row,
      viability: seedViability(
        { yearPacked: row.yearPacked, germinationRate: row.germinationRate },
        variety?.seedViabilityYears ?? null, req.ctx.today,
      ),
    };
  });

  app.delete('/api/v1/garden/seeds/:id', async (req) => {
    requireWrite(req.ctx.user);
    await req.ctx.db.update(seedLots)
      .set({ deletedAt: new Date().toISOString(), updatedBy: req.ctx.user!.id })
      .where(eq(seedLots.id, (req.params as { id: string }).id));
    return { ok: true };
  });

  /* ── plantings ── */

  app.get('/api/v1/garden/plantings', async (req) => {
    const q = z.object({
      status: z.string().optional(), bedId: z.string().optional(),
      year: z.string().regex(/^\d{4}$/).optional(),
      limit: z.coerce.number().int().min(1).max(500).default(200),
    }).parse(req.query);

    const where = [isNull(plantings.deletedAt)];
    if (q.status) where.push(inArray(plantings.status, q.status.split(',')));
    if (q.bedId) where.push(eq(plantings.bedId, q.bedId));
    if (q.year) {
      where.push(gte(plantings.sownOn, `${q.year}-01-01`));
      where.push(lte(plantings.sownOn, `${q.year}-12-31`));
    }

    const rows = await req.ctx.db.select({
      planting: plantings, variety: plantVarieties, bed: beds,
    }).from(plantings)
      .innerJoin(plantVarieties, eq(plantVarieties.id, plantings.varietyId))
      .leftJoin(beds, eq(beds.id, plantings.bedId))
      .where(and(...where))
      .orderBy(desc(plantings.sownOn))
      .limit(q.limit);

    const ids = rows.map((r) => r.planting.id);
    const harvestRows = ids.length
      ? await req.ctx.db.select().from(harvests)
        .where(and(inArray(harvests.plantingId, ids), isNull(harvests.deletedAt)))
      : [];

    return {
      items: rows.map((r) => {
        const mine = harvestRows.filter((h) => h.plantingId === r.planting.id);
        return {
          ...r.planting,
          variety: r.variety,
          bed: r.bed,
          harvestCount: mine.length,
          harvested: mine.reduce((a, b) => a + b.quantity, 0),
          harvestUnit: mine[0]?.unit ?? null,
          value: mine.reduce((a, b) => a + (b.estValue ?? 0), 0),
        };
      }),
    };
  });

  /** The rotation check, offered before the planting is made (GARD-004). */
  app.get('/api/v1/garden/rotation-check', async (req) => {
    const q = z.object({ bedId: z.string(), varietyId: z.string() }).parse(req.query);
    const conflict = await checkRotation(req.ctx, q.bedId, q.varietyId);
    return { conflict, history: await bedHistory(req.ctx, q.bedId) };
  });

  app.post('/api/v1/garden/plantings', async (req, reply) => {
    requireWrite(req.ctx.user);
    const body = z.object({
      varietyId: z.string(),
      bedId: z.string().nullable().optional(),
      seedLotId: z.string().nullable().optional(),
      method: z.enum(SOW_METHODS).default('direct'),
      sownOn: dateStr.default(req.ctx.today),
      quantity: z.number().positive().nullable().optional(),
      notes: z.string().nullable().optional(),
      /** Repeat sowings, producing separate plantings rather than one vague one. */
      succession: z.object({
        everyDays: z.number().int().min(1).max(120),
        count: z.number().int().min(1).max(24),
        until: dateStr.nullable().optional(),
      }).nullable().optional(),
    }).parse(req.body);

    const variety = (await req.ctx.db.select().from(plantVarieties)
      .where(eq(plantVarieties.id, body.varietyId)).limit(1))[0];
    if (!variety) throw notFound('Variety');

    const bed = body.bedId
      ? (await req.ctx.db.select().from(beds).where(eq(beds.id, body.bedId)).limit(1))[0]
      : null;

    const conflict = await checkRotation(req.ctx, body.bedId ?? null, body.varietyId, body.sownOn);

    const dates = body.succession
      ? successionDates(body.sownOn, body.succession.everyDays, body.succession.count, body.succession.until)
      : [body.sownOn];

    const made = [];
    for (const sownOn of dates) {
      const [row] = await req.ctx.db.insert(plantings).values({
        varietyId: body.varietyId,
        bedId: body.bedId ?? null,
        seedLotId: body.seedLotId ?? null,
        method: body.method,
        sownOn,
        quantity: body.quantity ?? null,
        status: sownOn > req.ctx.today ? 'planned' : 'growing',
        notes: body.notes ?? null,
        createdBy: req.ctx.user!.id, updatedBy: req.ctx.user!.id,
      }).returning();

      const { schedule } = await plantingTasks(req.ctx, row!, variety, bed?.name ?? null);
      await req.ctx.db.update(plantings).set({
        transplantedOn: null,
        expectedHarvestOn: schedule.firstHarvestOn,
      }).where(eq(plantings.id, row!.id));
      made.push({ ...row!, expectedHarvestOn: schedule.firstHarvestOn, schedule });
    }

    // Sowing from a lot decrements it; a lot at zero stays as history (GARD-011).
    if (body.seedLotId && body.quantity) {
      const lot = (await req.ctx.db.select().from(seedLots)
        .where(eq(seedLots.id, body.seedLotId)).limit(1))[0];
      if (lot) {
        const used = body.quantity * dates.length;
        await req.ctx.db.update(seedLots)
          .set({ quantity: Math.max(0, lot.quantity - used), updatedBy: req.ctx.user!.id })
          .where(eq(seedLots.id, body.seedLotId));
      }
    }

    reply.status(201);
    return { items: made, rotationWarning: conflict };
  });

  app.patch('/api/v1/garden/plantings/:id', async (req) => {
    requireWrite(req.ctx.user);
    const id = (req.params as { id: string }).id;
    const body = z.object({
      status: z.enum(PLANTING_STATUS).optional(),
      bedId: z.string().nullable().optional(),
      transplantedOn: dateStr.nullable().optional(),
      expectedHarvestOn: dateStr.nullable().optional(),
      removedOn: dateStr.nullable().optional(),
      failureReason: z.string().nullable().optional(),
      notes: z.string().nullable().optional(),
    }).parse(req.body);
    const [row] = await req.ctx.db.update(plantings)
      .set({ ...body, updatedBy: req.ctx.user!.id }).where(eq(plantings.id, id)).returning();
    if (!row) throw notFound('Planting');
    return row;
  });

  app.get('/api/v1/garden/plantings/:id', async (req) => {
    const id = (req.params as { id: string }).id;
    const row = (await req.ctx.db.select({ planting: plantings, variety: plantVarieties, bed: beds })
      .from(plantings)
      .innerJoin(plantVarieties, eq(plantVarieties.id, plantings.varietyId))
      .leftJoin(beds, eq(beds.id, plantings.bedId))
      .where(eq(plantings.id, id)).limit(1))[0];
    if (!row) throw notFound('Planting');

    const [harvestRows, observations, lot] = await Promise.all([
      req.ctx.db.select().from(harvests).where(and(
        eq(harvests.plantingId, id), isNull(harvests.deletedAt),
      )).orderBy(desc(harvests.harvestedOn)),
      req.ctx.db.select().from(gardenObservations).where(and(
        eq(gardenObservations.plantingId, id), isNull(gardenObservations.deletedAt),
      )).orderBy(desc(gardenObservations.observedOn)),
      row.planting.seedLotId
        ? req.ctx.db.select().from(seedLots).where(eq(seedLots.id, row.planting.seedLotId)).limit(1)
        : Promise.resolve([]),
    ]);

    // The other half of the cycle: seed saved *from* this planting (INT-015).
    const savedSeed = await req.ctx.db.select().from(seedLots).where(and(
      eq(seedLots.savedFromPlantingId, id), isNull(seedLots.deletedAt),
    ));

    return {
      ...row.planting,
      variety: row.variety,
      bed: row.bed,
      harvests: harvestRows,
      observations,
      sownFrom: lot[0] ?? null,
      savedSeed,
      totals: {
        harvested: harvestRows.reduce((a, b) => a + b.quantity, 0),
        unit: harvestRows[0]?.unit ?? null,
        value: harvestRows.reduce((a, b) => a + (b.estValue ?? 0), 0),
      },
    };
  });

  app.post('/api/v1/garden/plantings/:id/observations', async (req, reply) => {
    requireWrite(req.ctx.user);
    const body = z.object({
      kind: z.enum(OBSERVATION_KINDS).default('note'),
      text: z.string().trim().min(1),
      observedOn: dateStr.default(req.ctx.today),
    }).parse(req.body);
    const [row] = await req.ctx.db.insert(gardenObservations).values({
      plantingId: (req.params as { id: string }).id,
      ...body, createdBy: req.ctx.user!.id,
    }).returning();
    reply.status(201);
    return row;
  });

  /** Saving seed from a planting: the loop closes here (CIRC-013, INT-015). */
  app.post('/api/v1/garden/plantings/:id/save-seed', async (req, reply) => {
    requireWrite(req.ctx.user);
    const plantingId = (req.params as { id: string }).id;
    const body = z.object({
      quantity: z.number().min(0).default(0),
      unit: z.string().default('seed'),
      locationId: z.string().nullable().optional(),
      notes: z.string().nullable().optional(),
    }).parse(req.body ?? {});

    const planting = (await req.ctx.db.select().from(plantings)
      .where(eq(plantings.id, plantingId)).limit(1))[0];
    if (!planting) throw notFound('Planting');
    const variety = (await req.ctx.db.select().from(plantVarieties)
      .where(eq(plantVarieties.id, planting.varietyId)).limit(1))[0];
    if (!variety) throw notFound('Variety');

    const warning = variety.openPollinated ? null
      : `${variety.name}${variety.cultivar ? ` '${variety.cultivar}'` : ''} is an F1 hybrid, so this seed will not come true. Saved anyway — plenty of people do it on purpose.`;

    const [row] = await req.ctx.db.insert(seedLots).values({
      varietyId: planting.varietyId,
      origin: 'saved',
      savedFromPlantingId: plantingId,
      quantity: body.quantity,
      unit: body.unit,
      yearPacked: Number(req.ctx.today.slice(0, 4)),
      locationId: body.locationId ?? null,
      cost: 0,
      notes: body.notes ?? null,
      createdBy: req.ctx.user!.id, updatedBy: req.ctx.user!.id,
    }).returning();

    reply.status(201);
    return { ...row, variety, warning };
  });

  /* ── harvest ── */

  app.post('/api/v1/garden/plantings/:id/harvest', async (req, reply) => {
    requireWrite(req.ctx.user);
    const body = z.object({
      quantity: z.number().positive(),
      unit: z.string().default('lb'),
      harvestedOn: dateStr.optional(),
      quality: z.string().nullable().optional(),
      notes: z.string().nullable().optional(),
      toPantry: z.object({
        locationId: z.string().nullable().optional(),
        productId: z.string().nullable().optional(),
      }).nullable().optional(),
    }).parse(req.body);
    const result = await recordHarvest(req.ctx, {
      plantingId: (req.params as { id: string }).id, ...body,
    });
    reply.status(201);
    return result;
  });

  app.get('/api/v1/garden/harvests', async (req) => {
    const q = z.object({
      from: dateStr.optional(), to: dateStr.optional(),
      limit: z.coerce.number().int().min(1).max(500).default(200),
    }).parse(req.query);
    const where = [isNull(harvests.deletedAt)];
    if (q.from) where.push(gte(harvests.harvestedOn, q.from));
    if (q.to) where.push(lte(harvests.harvestedOn, q.to));

    const rows = await req.ctx.db.select({
      harvest: harvests, planting: plantings, variety: plantVarieties,
    }).from(harvests)
      .innerJoin(plantings, eq(plantings.id, harvests.plantingId))
      .innerJoin(plantVarieties, eq(plantVarieties.id, plantings.varietyId))
      .where(and(...where))
      .orderBy(desc(harvests.harvestedOn))
      .limit(q.limit);

    return {
      items: rows.map((r) => ({ ...r.harvest, variety: r.variety, planting: r.planting })),
      totalValue: rows.reduce((a, b) => a + (b.harvest.estValue ?? 0), 0),
      currency: req.ctx.household.currency,
    };
  });

  /* ── inputs, frost dates and the net position ── */

  app.post('/api/v1/garden/inputs', async (req, reply) => {
    requireWrite(req.ctx.user);
    const body = z.object({
      bedId: z.string().nullable().optional(),
      factorKey: z.string(),
      quantity: z.number().positive(),
      unit: z.string(),
      occurredOn: dateStr.optional(),
      note: z.string().nullable().optional(),
    }).parse(req.body);
    const result = await recordGardenInput(req.ctx, body);
    reply.status(201);
    return result ?? { gCo2e: 0, unresolved: 'No factor matched that key and unit.' };
  });

  app.put('/api/v1/garden/frost-dates', async (req) => {
    requireWrite(req.ctx.user);
    const body = z.object({
      lastSpring: monthDay.nullable(),
      firstAutumn: monthDay.nullable(),
      propertyId: z.string().optional(),
    }).parse(req.body);
    const id = body.propertyId ?? await primaryPropertyId(req.ctx);
    if (!id) throw badRequest('No property to set frost dates on');
    const row = (await req.ctx.db.select().from(properties).where(eq(properties.id, id)).limit(1))[0];
    if (!row) throw notFound('Property');
    const profile = { ...(row.profile ?? {}), lastFrost: body.lastSpring, firstFrost: body.firstAutumn };
    await req.ctx.db.update(properties)
      .set({ profile, updatedBy: req.ctx.user!.id }).where(eq(properties.id, id));
    return frostDatesOf(req.ctx, id);
  });

  /** The garden overview: what is growing, what wants sowing, what it came to. */
  app.get('/api/v1/garden/overview', async (req) => {
    const year = req.ctx.today.slice(0, 4);
    const [bedRows, active, frost, drawer, net] = await Promise.all([
      req.ctx.db.select().from(beds).where(isNull(beds.deletedAt)).orderBy(asc(beds.sort)),
      req.ctx.db.select({ planting: plantings, variety: plantVarieties, bed: beds })
        .from(plantings)
        .innerJoin(plantVarieties, eq(plantVarieties.id, plantings.varietyId))
        .leftJoin(beds, eq(beds.id, plantings.bedId))
        .where(and(
          inArray(plantings.status, ['planned', 'growing', 'harvesting']),
          isNull(plantings.deletedAt),
        )).orderBy(asc(plantings.expectedHarvestOn)),
      frostDatesOf(req.ctx),
      seedDrawer(req.ctx),
      gardenNet(req.ctx, `${year}-01-01`, `${year}-12-31`),
    ]);

    const harvestRows = await req.ctx.db.select().from(harvests).where(and(
      isNull(harvests.deletedAt),
      gte(harvests.harvestedOn, `${year}-01-01`),
    ));

    return {
      beds: bedRows,
      plantings: active.map((r) => ({ ...r.planting, variety: r.variety, bed: r.bed })),
      frost,
      /** What the drawer says can go in the ground this week. */
      sowNow: drawer
        .filter((d: any) => d.sow.verdict === 'open' || d.sow.verdict === 'closing')
        .slice(0, 12),
      pastViability: drawer.filter((d: any) => d.viability.status === 'past').length,
      year: {
        harvests: harvestRows.length,
        value: harvestRows.reduce((a, b) => a + (b.estValue ?? 0), 0),
        ...net,
      },
      currency: req.ctx.household.currency,
    };
  });

  app.get('/api/v1/garden/net', async (req) => {
    const q = z.object({ from: dateStr.optional(), to: dateStr.optional() }).parse(req.query);
    const year = req.ctx.today.slice(0, 4);
    return gardenNet(req.ctx, q.from ?? `${year}-01-01`, q.to ?? `${year}-12-31`);
  });

  app.get('/api/v1/garden/beds/:id/ledger', async (req) => {
    const id = (req.params as { id: string }).id;
    const { spentOn } = await import('../services/budget.js');
    const [money, carbon] = await Promise.all([
      spentOn(req.ctx, 'bed', id), emittedBy(req.ctx, 'bed', id),
    ]);
    return { cost: money.total, gCo2e: carbon.total, currency: req.ctx.household.currency };
  });
}
