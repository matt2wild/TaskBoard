/* eslint-disable @typescript-eslint/no-explicit-any */
import type { FastifyInstance } from 'fastify';
import { and, asc, desc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import { DOSE_STATUS, JOURNAL_SEVERITY, PET_STATUS, addDays, addMonths, diffDays } from '@homestead/shared';
import {
  contacts, petClaims, petConditions, petDietEntries, petDoses, petInsurance, petJournal,
  petLabResults, petMedications, petVaccinations, petVisits, petWeights, pets, products,
  speciesProfiles, tasks,
} from '../db/schema.js';
import { crudRoutes } from '../core/crud.js';
import { requireWrite } from '../core/auth.js';
import { badRequest, notFound } from '../core/errors.js';
import { attachCost, spentOn } from '../services/budget.js';
import { emittedBy } from '../services/carbon.js';
import {
  dosesDueToday, giveDose, materialiseDoses, runOutProjection, weightTrend,
} from '../services/pets.js';

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const timeStr = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export function petRoutes(app: FastifyInstance): void {
  app.get('/api/v1/species', async (req) => {
    const rows = await req.ctx.db.select().from(speciesProfiles).where(isNull(speciesProfiles.deletedAt));
    return { items: rows };
  });

  const petShape = {
    name: z.string().trim().min(1),
    speciesCode: z.string().default('cat'),
    breed: z.string().nullable().optional(),
    sex: z.enum(['male', 'female', 'unknown']).nullable().optional(),
    neutered: z.boolean().nullable().optional(),
    dob: dateStr.nullable().optional(),
    adoptedAt: dateStr.nullable().optional(),
    microchip: z.string().nullable().optional(),
    markings: z.string().nullable().optional(),
    primaryVetContactId: z.string().nullable().optional(),
    emergencyVetContactId: z.string().nullable().optional(),
    targetWeightMin: z.number().nullable().optional(),
    targetWeightMax: z.number().nullable().optional(),
    weightUnit: z.string().default('lb'),
    careNotesMd: z.string().nullable().optional(),
    notesMd: z.string().nullable().optional(),
  };

  crudRoutes(app, '/api/v1/pets', {
    table: pets, entityType: 'pet', label: 'Pet',
    create: z.object(petShape),
    update: z.object({ ...petShape, status: z.enum(PET_STATUS).optional(), statusDate: dateStr.nullable().optional() }).partial(),
    searchColumns: ['name', 'breed', 'microchip', 'notesMd'],
    filterColumns: ['speciesCode', 'status'],
    hooks: {
      decorate: async (rows, ctx) => {
        const ids = rows.map((r) => r.id);
        if (!ids.length) return rows;
        const weights = await ctx.db.select().from(petWeights)
          .where(inArray(petWeights.petId, ids)).orderBy(desc(petWeights.takenAt));
        const latest = new Map<string, typeof weights[number]>();
        for (const w of weights) if (!latest.has(w.petId)) latest.set(w.petId, w);
        const meds = await ctx.db.select({ petId: petMedications.petId, n: sql<number>`count(*)` })
          .from(petMedications)
          .where(and(inArray(petMedications.petId, ids), eq(petMedications.active, true), isNull(petMedications.deletedAt)))
          .groupBy(petMedications.petId);
        const medCount = new Map(meds.map((m) => [m.petId, Number(m.n)]));
        return rows.map((r) => ({
          ...r,
          ageYears: r.dob ? Math.floor(diffDays(ctx.today, r.dob) / 365.25) : null,
          latestWeight: latest.get(r.id)?.weight ?? null,
          latestWeightAt: latest.get(r.id)?.takenAt ?? null,
          activeMedications: medCount.get(r.id) ?? 0,
        }));
      },
    },
  });

  /** Everything a sitter or a vet visit needs on one screen (CAT-010). */
  app.get('/api/v1/pets/:id/care-sheet', async (req) => {
    const id = (req.params as { id: string }).id;
    const pet = (await req.ctx.db.select().from(pets).where(eq(pets.id, id)).limit(1))[0];
    if (!pet) throw notFound('Pet');
    const [meds, diet, conditions, vax, insurance] = await Promise.all([
      req.ctx.db.select().from(petMedications).where(and(
        eq(petMedications.petId, id), eq(petMedications.active, true), isNull(petMedications.deletedAt),
      )),
      req.ctx.db.select({ d: petDietEntries, p: products })
        .from(petDietEntries).leftJoin(products, eq(products.id, petDietEntries.productId))
        .where(and(eq(petDietEntries.petId, id), isNull(petDietEntries.deletedAt)))
        .orderBy(asc(petDietEntries.timeOfDay)),
      req.ctx.db.select().from(petConditions).where(and(
        eq(petConditions.petId, id), eq(petConditions.status, 'active'), isNull(petConditions.deletedAt),
      )),
      req.ctx.db.select().from(petVaccinations)
        .where(and(eq(petVaccinations.petId, id), isNull(petVaccinations.deletedAt)))
        .orderBy(desc(petVaccinations.givenAt)),
      req.ctx.db.select().from(petInsurance)
        .where(and(eq(petInsurance.petId, id), isNull(petInsurance.deletedAt))).limit(1),
    ]);
    const contactIds = [pet.primaryVetContactId, pet.emergencyVetContactId].filter(Boolean) as string[];
    const contactRows = contactIds.length
      ? await req.ctx.db.select().from(contacts).where(inArray(contacts.id, contactIds)) : [];
    const byId = new Map(contactRows.map((c) => [c.id, c]));
    const weight = await weightTrend(req.ctx, id);
    return {
      pet: { ...pet, ageYears: pet.dob ? Math.floor(diffDays(req.ctx.today, pet.dob) / 365.25) : null },
      feeding: diet.map((d) => ({
        timeOfDay: d.d.timeOfDay, amount: d.d.amount, unit: d.d.unit,
        what: d.p?.name ?? d.d.description ?? 'Food',
      })),
      medications: meds.map((m) => ({
        name: m.name, dose: m.dose, route: m.route, form: m.form,
        timesOfDay: m.timesOfDay ?? [], everyDays: m.everyDays,
        instructions: m.instructionsMd, kind: m.kind,
      })),
      conditions: conditions.map((c) => ({ name: c.name, onsetDate: c.onsetDate, notes: c.notesMd })),
      vaccinations: vax.map((v) => ({ vaccine: v.vaccine, givenAt: v.givenAt, nextDue: v.nextDue })),
      weight: { latest: weight.latest, unit: weight.unit, target: [pet.targetWeightMin, pet.targetWeightMax] },
      vet: pet.primaryVetContactId ? byId.get(pet.primaryVetContactId) ?? null : null,
      emergencyVet: pet.emergencyVetContactId ? byId.get(pet.emergencyVetContactId) ?? null : null,
      insurance: insurance[0] ?? null,
      careNotes: pet.careNotesMd,
      generatedAt: new Date().toISOString(),
    };
  });

  app.get('/api/v1/pets/:id/overview', async (req) => {
    const id = (req.params as { id: string }).id;
    const pet = (await req.ctx.db.select().from(pets).where(eq(pets.id, id)).limit(1))[0];
    if (!pet) throw notFound('Pet');
    const [visits, journal, conditions, labs, doses, spend, weight, runOut, carbon] = await Promise.all([
      req.ctx.db.select().from(petVisits)
        .where(and(eq(petVisits.petId, id), isNull(petVisits.deletedAt))).orderBy(desc(petVisits.visitedAt)).limit(50),
      req.ctx.db.select().from(petJournal)
        .where(and(eq(petJournal.petId, id), isNull(petJournal.deletedAt))).orderBy(desc(petJournal.ts)).limit(50),
      req.ctx.db.select().from(petConditions)
        .where(and(eq(petConditions.petId, id), isNull(petConditions.deletedAt))),
      req.ctx.db.select().from(petLabResults)
        .where(and(eq(petLabResults.petId, id), isNull(petLabResults.deletedAt))).orderBy(desc(petLabResults.takenAt)).limit(200),
      req.ctx.db.select().from(petDoses).where(and(
        eq(petDoses.petId, id), isNull(petDoses.deletedAt),
        gte(petDoses.dueDate, addDays(req.ctx.today, -7)),
      )).orderBy(asc(petDoses.dueAt)),
      spentOn(req.ctx, 'pet', id),
      weightTrend(req.ctx, id),
      runOutProjection(req.ctx, id),
      emittedBy(req.ctx, 'pet', id),
    ]);

    const labSeries = new Map<string, Array<{ takenAt: string; value: number; refLow: number | null; refHigh: number | null; unit: string | null }>>();
    for (const l of labs) {
      const s = labSeries.get(l.test) ?? [];
      s.push({ takenAt: l.takenAt, value: l.value, refLow: l.refLow, refHigh: l.refHigh, unit: l.unit });
      labSeries.set(l.test, s);
    }
    const adherence = doses.filter((d) => d.dueDate <= req.ctx.today);
    return {
      pet,
      visits, journal, conditions,
      labs: [...labSeries].map(([test, series]) => ({ test, series: series.slice().reverse() })),
      doses,
      weight,
      runOut,
      spend: { ...spend, currency: req.ctx.household.currency },
      carbon,
      adherence: {
        window: adherence.length,
        given: adherence.filter((d) => d.status === 'given').length,
        missed: adherence.filter((d) => d.status === 'missed').length,
      },
    };
  });

  /* ── vaccinations (CAT-003) ── */

  app.post('/api/v1/pets/:id/vaccinations', async (req, reply) => {
    requireWrite(req.ctx.user);
    const id = (req.params as { id: string }).id;
    const body = z.object({
      vaccine: z.string().trim().min(1),
      givenAt: dateStr,
      providerContactId: z.string().nullable().optional(),
      lot: z.string().nullable().optional(),
      nextDue: dateStr.nullable().optional(),
      intervalMonths: z.number().int().min(1).max(120).optional(),
      notes: z.string().nullable().optional(),
    }).parse(req.body);
    const pet = (await req.ctx.db.select().from(pets).where(eq(pets.id, id)).limit(1))[0];
    if (!pet) throw notFound('Pet');

    let nextDue = body.nextDue ?? null;
    if (!nextDue) {
      const months = body.intervalMonths
        ?? await presetInterval(req.ctx, pet.speciesCode, body.vaccine);
      if (months) nextDue = addMonths(body.givenAt, months);
    }
    let taskId: string | null = null;
    if (nextDue) {
      const [task] = await req.ctx.db.insert(tasks).values({
        title: `${pet.name}: ${body.vaccine} booster due`,
        dueDate: nextDue, originType: 'pet_appointment', priority: 'normal',
        createdBy: req.ctx.user!.id, updatedBy: req.ctx.user!.id,
      }).returning();
      taskId = task!.id;
    }
    const [row] = await req.ctx.db.insert(petVaccinations)
      .values({ petId: id, ...body, nextDue, taskId, createdBy: req.ctx.user!.id, updatedBy: req.ctx.user!.id })
      .returning();
    if (taskId) await req.ctx.db.update(tasks).set({ originId: row!.id }).where(eq(tasks.id, taskId));
    reply.status(201);
    return row;
  });

  app.get('/api/v1/pets/vaccinations/due', async (req) => {
    const q = z.object({ days: z.coerce.number().int().min(1).max(365).default(60) }).parse(req.query);
    const cutoff = addDays(req.ctx.today, q.days);
    const rows = await req.ctx.db.select({ v: petVaccinations, pet: pets })
      .from(petVaccinations).innerJoin(pets, eq(pets.id, petVaccinations.petId))
      .where(and(
        isNull(petVaccinations.deletedAt), eq(pets.status, 'active'),
        sql`${petVaccinations.nextDue} is not null`, lte(petVaccinations.nextDue, cutoff),
      )).orderBy(asc(petVaccinations.nextDue));
    return {
      items: rows.map((r) => ({
        id: r.v.id, petId: r.pet.id, petName: r.pet.name, vaccine: r.v.vaccine,
        nextDue: r.v.nextDue!, daysLeft: diffDays(r.v.nextDue!, req.ctx.today),
      })),
    };
  });

  /* ── medications (CAT-004/005) ── */

  crudRoutes(app, '/api/v1/pet-medications', {
    table: petMedications, entityType: 'pet_medication', label: 'Medication',
    create: z.object({
      petId: z.string().min(1),
      name: z.string().trim().min(1),
      form: z.string().nullable().optional(),
      strength: z.string().nullable().optional(),
      dose: z.string().nullable().optional(),
      route: z.string().nullable().optional(),
      timesOfDay: z.array(timeStr).default([]),
      everyDays: z.number().int().min(1).max(365).default(1),
      kind: z.enum(['medication', 'preventive', 'supplement']).default('medication'),
      startDate: dateStr,
      endDate: dateStr.nullable().optional(),
      ongoing: z.boolean().default(true),
      vetContactId: z.string().nullable().optional(),
      pharmacyContactId: z.string().nullable().optional(),
      productId: z.string().nullable().optional(),
      dosesPerUnit: z.number().positive().default(1),
      refillsRemaining: z.number().int().nullable().optional(),
      refillQty: z.number().nullable().optional(),
      instructionsMd: z.string().nullable().optional(),
      conditionId: z.string().nullable().optional(),
    }),
    update: z.object({
      name: z.string().trim().min(1).optional(),
      dose: z.string().nullable().optional(),
      timesOfDay: z.array(timeStr).optional(),
      everyDays: z.number().int().min(1).max(365).optional(),
      endDate: dateStr.nullable().optional(),
      active: z.boolean().optional(),
      productId: z.string().nullable().optional(),
      refillsRemaining: z.number().int().nullable().optional(),
      instructionsMd: z.string().nullable().optional(),
    }),
    searchColumns: ['name', 'instructionsMd'],
    filterColumns: ['petId', 'active', 'kind', 'conditionId'],
    hooks: {
      afterCreate: async (row, ctx) => { await materialiseDoses(ctx, { medicationId: row.id }); },
      afterUpdate: async (row, _before, ctx) => {
        if (!row.active) {
          // Withdraw the doses that have not happened yet; keep the history.
          const future = await ctx.db.select().from(petDoses).where(and(
            eq(petDoses.medicationId, row.id), eq(petDoses.status, 'due'),
            sql`${petDoses.dueDate} >= ${ctx.today}`,
          ));
          for (const d of future) {
            await ctx.db.update(petDoses).set({ status: 'skipped' }).where(eq(petDoses.id, d.id));
            if (d.taskId) {
              await ctx.db.update(tasks).set({ status: 'cancelled' }).where(eq(tasks.id, d.taskId));
            }
          }
        } else {
          await materialiseDoses(ctx, { medicationId: row.id });
        }
      },
    },
  });

  app.get('/api/v1/pet-doses', async (req) => {
    const q = z.object({
      petId: z.string().optional(),
      from: dateStr.optional(), to: dateStr.optional(),
      status: z.enum(DOSE_STATUS).optional(),
    }).parse(req.query);
    const where = [isNull(petDoses.deletedAt)];
    if (q.petId) where.push(eq(petDoses.petId, q.petId));
    if (q.from) where.push(gte(petDoses.dueDate, q.from));
    if (q.to) where.push(lte(petDoses.dueDate, q.to));
    if (q.status) where.push(eq(petDoses.status, q.status));
    const rows = await req.ctx.db.select({ d: petDoses, med: petMedications, pet: pets })
      .from(petDoses)
      .innerJoin(petMedications, eq(petMedications.id, petDoses.medicationId))
      .innerJoin(pets, eq(pets.id, petDoses.petId))
      .where(and(...where)).orderBy(asc(petDoses.dueAt)).limit(500);
    return {
      items: rows.map((r) => ({
        ...r.d, medication: r.med.name, dose: r.med.dose, petName: r.pet.name,
      })),
    };
  });

  /** Tonight's doses across every pet, as one checklist (CAT-019). */
  app.get('/api/v1/pet-doses/today', async (req) => ({
    items: await dosesDueToday(req.ctx), today: req.ctx.today,
  }));

  app.post('/api/v1/pet-doses/:id/give', async (req) => {
    requireWrite(req.ctx.user);
    const body = z.object({
      givenAt: z.string().optional(), note: z.string().optional(),
      status: z.enum(['given', 'skipped']).default('given'),
    }).parse(req.body ?? {});
    return giveDose(req.ctx, (req.params as { id: string }).id, body);
  });

  app.post('/api/v1/pet-doses/materialise', async (req) => {
    requireWrite(req.ctx.user);
    const body = z.object({ horizonDays: z.number().int().min(1).max(30).optional() }).parse(req.body ?? {});
    return materialiseDoses(req.ctx, body);
  });

  /* ── visits (CAT-006) ── */

  app.post('/api/v1/pets/:id/visits', async (req, reply) => {
    requireWrite(req.ctx.user);
    const id = (req.params as { id: string }).id;
    const body = z.object({
      visitedAt: dateStr,
      providerContactId: z.string().nullable().optional(),
      reason: z.string().trim().min(1),
      notesMd: z.string().nullable().optional(),
      diagnosis: z.string().nullable().optional(),
      weight: z.number().positive().nullable().optional(),
      weightUnit: z.string().optional(),
      followUpDate: dateStr.nullable().optional(),
      cost: z.object({
        amount: z.number().int().positive(),
        categoryId: z.string().optional(),
        payeeName: z.string().optional(),
        accountId: z.string().optional(),
      }).nullable().optional(),
      createCondition: z.string().nullable().optional(),
      prescriptions: z.array(z.object({
        name: z.string(), dose: z.string().optional(), form: z.string().optional(),
        timesOfDay: z.array(timeStr).default([]), everyDays: z.number().int().min(1).default(1),
        endDate: dateStr.nullable().optional(), instructionsMd: z.string().optional(),
      })).optional(),
    }).parse(req.body);

    const pet = (await req.ctx.db.select().from(pets).where(eq(pets.id, id)).limit(1))[0];
    if (!pet) throw notFound('Pet');

    let transactionId: string | null = null;
    if (body.cost) {
      const { transaction } = await attachCost(req.ctx, {
        amount: body.cost.amount, date: body.visitedAt,
        categoryId: body.cost.categoryId ?? null, payeeName: body.cost.payeeName ?? null,
        accountId: body.cost.accountId ?? null,
        memo: `${pet.name}: ${body.reason}`,
        attributions: [{ entityType: 'pet', entityId: id }],
      });
      transactionId = transaction.id;
    }

    let followUpTaskId: string | null = null;
    if (body.followUpDate) {
      const [task] = await req.ctx.db.insert(tasks).values({
        title: `${pet.name}: follow-up (${body.reason})`,
        dueDate: body.followUpDate, originType: 'pet_appointment', originId: id,
        priority: 'high', createdBy: req.ctx.user!.id, updatedBy: req.ctx.user!.id,
      }).returning();
      followUpTaskId = task!.id;
    }

    const [visit] = await req.ctx.db.insert(petVisits).values({
      petId: id, visitedAt: body.visitedAt, providerContactId: body.providerContactId ?? null,
      reason: body.reason, notesMd: body.notesMd ?? null, diagnosis: body.diagnosis ?? null,
      weight: body.weight ?? null, weightUnit: body.weightUnit ?? pet.weightUnit,
      followUpDate: body.followUpDate ?? null, followUpTaskId, costTransactionId: transactionId,
      createdBy: req.ctx.user!.id, updatedBy: req.ctx.user!.id,
    }).returning();

    if (body.weight) {
      await req.ctx.db.insert(petWeights).values({
        petId: id, takenAt: body.visitedAt, weight: body.weight,
        unit: body.weightUnit ?? pet.weightUnit, source: 'visit', visitId: visit!.id,
        createdBy: req.ctx.user!.id, updatedBy: req.ctx.user!.id,
      });
    }

    let conditionId: string | null = null;
    if (body.createCondition) {
      const [c] = await req.ctx.db.insert(petConditions).values({
        petId: id, name: body.createCondition, onsetDate: body.visitedAt,
        createdBy: req.ctx.user!.id, updatedBy: req.ctx.user!.id,
      }).returning();
      conditionId = c!.id;
    }

    const meds: string[] = [];
    for (const p of body.prescriptions ?? []) {
      const [m] = await req.ctx.db.insert(petMedications).values({
        petId: id, name: p.name, dose: p.dose ?? null, form: p.form ?? null,
        timesOfDay: p.timesOfDay, everyDays: p.everyDays,
        startDate: body.visitedAt, endDate: p.endDate ?? null, ongoing: !p.endDate,
        vetContactId: body.providerContactId ?? null, conditionId,
        instructionsMd: p.instructionsMd ?? null,
        createdBy: req.ctx.user!.id, updatedBy: req.ctx.user!.id,
      }).returning();
      meds.push(m!.id);
      await materialiseDoses(req.ctx, { medicationId: m!.id });
    }

    reply.status(201);
    return { visit, transactionId, followUpTaskId, conditionId, medications: meds };
  });

  /* ── weight, journal, conditions, labs, diet ── */

  app.post('/api/v1/pets/:id/weights', async (req, reply) => {
    requireWrite(req.ctx.user);
    const id = (req.params as { id: string }).id;
    const body = z.object({
      weight: z.number().positive(), unit: z.string().optional(),
      takenAt: z.string().optional(), note: z.string().nullable().optional(),
    }).parse(req.body);
    const pet = (await req.ctx.db.select().from(pets).where(eq(pets.id, id)).limit(1))[0];
    if (!pet) throw notFound('Pet');
    const [row] = await req.ctx.db.insert(petWeights).values({
      petId: id, weight: body.weight, unit: body.unit ?? pet.weightUnit,
      takenAt: body.takenAt ?? req.ctx.today, note: body.note ?? null,
      createdBy: req.ctx.user!.id, updatedBy: req.ctx.user!.id,
    }).returning();
    reply.status(201);
    return { weight: row, trend: await weightTrend(req.ctx, id) };
  });

  app.get('/api/v1/pets/:id/weights', async (req) =>
    weightTrend(req.ctx, (req.params as { id: string }).id));

  crudRoutes(app, '/api/v1/pet-journal', {
    table: petJournal, entityType: 'pet', label: 'Journal entry',
    create: z.object({
      petId: z.string().min(1),
      ts: z.string().optional(),
      bodyMd: z.string().trim().min(1),
      tags: z.array(z.string()).nullable().optional(),
      severity: z.enum(JOURNAL_SEVERITY).default('info'),
      visitId: z.string().nullable().optional(),
    }),
    update: z.object({
      bodyMd: z.string().trim().min(1).optional(),
      tags: z.array(z.string()).nullable().optional(),
      severity: z.enum(JOURNAL_SEVERITY).optional(),
      visitId: z.string().nullable().optional(),
    }),
    searchColumns: ['bodyMd'],
    filterColumns: ['petId', 'severity', 'visitId'],
    sortColumns: ['ts', 'createdAt'],
    defaultSort: { column: 'ts', dir: 'desc' },
    hooks: { beforeCreate: (v, ctx) => ({ ...v, ts: (v as any).ts ?? ctx.now.toISOString() }) },
  });

  crudRoutes(app, '/api/v1/pet-conditions', {
    table: petConditions, entityType: 'pet_condition', label: 'Condition',
    create: z.object({
      petId: z.string().min(1), name: z.string().trim().min(1),
      onsetDate: dateStr.nullable().optional(),
      status: z.enum(['active', 'managed', 'resolved']).default('active'),
      notesMd: z.string().nullable().optional(),
    }),
    update: z.object({
      name: z.string().trim().min(1).optional(),
      status: z.enum(['active', 'managed', 'resolved']).optional(),
      notesMd: z.string().nullable().optional(),
    }),
    searchColumns: ['name', 'notesMd'], filterColumns: ['petId', 'status'],
  });

  crudRoutes(app, '/api/v1/pet-labs', {
    table: petLabResults, entityType: 'pet', label: 'Lab result',
    create: z.object({
      petId: z.string().min(1), visitId: z.string().nullable().optional(),
      test: z.string().trim().min(1), value: z.number(),
      unit: z.string().nullable().optional(),
      refLow: z.number().nullable().optional(), refHigh: z.number().nullable().optional(),
      takenAt: dateStr,
    }),
    update: z.object({ value: z.number().optional(), unit: z.string().nullable().optional() }),
    filterColumns: ['petId', 'test', 'visitId'],
    sortColumns: ['takenAt'], defaultSort: { column: 'takenAt', dir: 'desc' },
  });

  app.put('/api/v1/pets/:id/diet', async (req) => {
    requireWrite(req.ctx.user);
    const id = (req.params as { id: string }).id;
    const body = z.object({
      entries: z.array(z.object({
        timeOfDay: timeStr,
        productId: z.string().nullable().optional(),
        description: z.string().nullable().optional(),
        amount: z.number().positive().default(1),
        unit: z.string().default('ea'),
      })),
    }).parse(req.body);
    // Close the old plan rather than deleting it: diet history matters clinically.
    await req.ctx.db.update(petDietEntries)
      .set({ activeTo: req.ctx.today, updatedBy: req.ctx.user!.id })
      .where(and(eq(petDietEntries.petId, id), isNull(petDietEntries.activeTo)));
    if (body.entries.length) {
      await req.ctx.db.insert(petDietEntries).values(body.entries.map((e) => ({
        petId: id, ...e, activeFrom: req.ctx.today,
        createdBy: req.ctx.user!.id, updatedBy: req.ctx.user!.id,
      })));
    }
    return { petId: id, entries: body.entries.length };
  });

  app.get('/api/v1/pets/:id/run-out', async (req) =>
    ({ items: await runOutProjection(req.ctx, (req.params as { id: string }).id) }));

  /* ── insurance and claims (CAT-014) ── */

  crudRoutes(app, '/api/v1/pet-insurance', {
    table: petInsurance, entityType: 'pet', label: 'Insurance policy',
    create: z.object({
      petId: z.string().min(1), insurerContactId: z.string().nullable().optional(),
      policyNumber: z.string().nullable().optional(), premiumBillId: z.string().nullable().optional(),
      deductible: z.number().int().nullable().optional(),
      reimbursementPct: z.number().min(0).max(100).nullable().optional(),
      notesMd: z.string().nullable().optional(),
    }),
    update: z.object({
      policyNumber: z.string().nullable().optional(),
      deductible: z.number().int().nullable().optional(),
      reimbursementPct: z.number().min(0).max(100).nullable().optional(),
      notesMd: z.string().nullable().optional(),
    }),
    filterColumns: ['petId'],
  });

  app.post('/api/v1/pet-claims', async (req, reply) => {
    requireWrite(req.ctx.user);
    const body = z.object({
      insuranceId: z.string().min(1), visitId: z.string().nullable().optional(),
      claimedAmount: z.number().int().positive(), submittedAt: dateStr.optional(),
    }).parse(req.body);
    const [row] = await req.ctx.db.insert(petClaims).values({
      ...body, submittedAt: body.submittedAt ?? req.ctx.today,
      createdBy: req.ctx.user!.id, updatedBy: req.ctx.user!.id,
    }).returning();
    reply.status(201);
    return row;
  });

  app.post('/api/v1/pet-claims/:id/reimburse', async (req) => {
    requireWrite(req.ctx.user);
    const id = (req.params as { id: string }).id;
    const body = z.object({ amount: z.number().int().positive(), date: dateStr.optional() }).parse(req.body);
    const claim = (await req.ctx.db.select().from(petClaims).where(eq(petClaims.id, id)).limit(1))[0];
    if (!claim) throw notFound('Claim');
    const policy = (await req.ctx.db.select().from(petInsurance)
      .where(eq(petInsurance.id, claim.insuranceId)).limit(1))[0];
    const { transaction } = await attachCost(req.ctx, {
      amount: body.amount, type: 'income', date: body.date ?? req.ctx.today,
      memo: 'Insurance reimbursement',
      attributions: policy ? [{ entityType: 'pet', entityId: policy.petId }] : [],
    });
    const [row] = await req.ctx.db.update(petClaims).set({
      reimbursedTransactionId: transaction.id, status: 'reimbursed', updatedBy: req.ctx.user!.id,
    }).where(eq(petClaims.id, id)).returning();
    return { claim: row, transactionId: transaction.id };
  });

  /* ── status change: stop the reminders, keep the history (CAT-020) ── */

  app.post('/api/v1/pets/:id/status', async (req) => {
    requireWrite(req.ctx.user);
    const id = (req.params as { id: string }).id;
    const body = z.object({
      status: z.enum(PET_STATUS), statusDate: dateStr.optional(), note: z.string().optional(),
    }).parse(req.body);
    const [pet] = await req.ctx.db.update(pets).set({
      status: body.status, statusDate: body.statusDate ?? req.ctx.today, updatedBy: req.ctx.user!.id,
    }).where(eq(pets.id, id)).returning();
    if (!pet) throw notFound('Pet');
    if (body.status !== 'active') {
      await req.ctx.db.update(petMedications)
        .set({ active: false, updatedBy: req.ctx.user!.id }).where(eq(petMedications.petId, id));
      const future = await req.ctx.db.select().from(petDoses).where(and(
        eq(petDoses.petId, id), eq(petDoses.status, 'due'), gte(petDoses.dueDate, req.ctx.today),
      ));
      for (const d of future) {
        await req.ctx.db.update(petDoses).set({ status: 'skipped' }).where(eq(petDoses.id, d.id));
        if (d.taskId) await req.ctx.db.update(tasks).set({ status: 'cancelled' }).where(eq(tasks.id, d.taskId));
      }
      const openTasks = await req.ctx.db.select().from(tasks).where(and(
        eq(tasks.originType, 'pet_appointment'), eq(tasks.originId, id),
        inArray(tasks.status, ['open', 'in_progress', 'blocked']),
      ));
      for (const t of openTasks) {
        await req.ctx.db.update(tasks).set({ status: 'cancelled' }).where(eq(tasks.id, t.id));
      }
    }
    return pet;
  });
}

async function presetInterval(ctx: any, speciesCode: string, vaccine: string): Promise<number | null> {
  const sp = (await ctx.db.select().from(speciesProfiles)
    .where(eq(speciesProfiles.code, speciesCode)).limit(1))[0];
  if (!sp?.vaccinePresets) return null;
  const match = sp.vaccinePresets.find(
    (v: { name: string }) => v.name.toLowerCase() === vaccine.toLowerCase(),
  );
  return match?.intervalMonths ?? null;
}
