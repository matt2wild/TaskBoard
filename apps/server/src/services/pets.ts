/* eslint-disable @typescript-eslint/no-explicit-any */
import { and, asc, desc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import { addDays, diffDays, zonedToUtc } from '@homestead/shared';
import type { Ctx } from '../core/ctx.js';
import { notFound } from '../core/errors.js';
import {
  petDietEntries, petDoses, petMedications, petWeights, pets, products, tasks,
} from '../db/schema.js';
import { onTaskComplete } from './tasks.js';
import { addToShoppingList, onHand } from './stock.js';

/**
 * Turns each medication's dosing times into concrete, checkable doses (CAT-004).
 * Idempotent on (medication, date, time), so running it repeatedly — including
 * after downtime — never double-doses the schedule.
 */
export async function materialiseDoses(
  ctx: Ctx, opts: { horizonDays?: number; medicationId?: string } = {},
): Promise<{ created: number; medications: number }> {
  const horizon = opts.horizonDays ?? 3;
  const where = [eq(petMedications.active, true), isNull(petMedications.deletedAt)];
  if (opts.medicationId) where.push(eq(petMedications.id, opts.medicationId));
  const meds = await ctx.db.select().from(petMedications).where(and(...where));

  let created = 0;
  for (const med of meds) {
    const times = med.timesOfDay ?? [];
    if (!times.length) continue;
    const every = Math.max(med.everyDays, 1);
    for (let offset = 0; offset <= horizon; offset++) {
      const date = addDays(ctx.today, offset);
      if (med.startDate > date) continue;
      if (med.endDate && date > med.endDate) continue;
      // Dose days step from the start date, so an every-30-days preventive
      // lands on the same day of its cycle rather than every day.
      if (every > 1 && diffDays(date, med.startDate) % every !== 0) continue;
      for (const time of times) {
        const dueAt = zonedToUtc(date, time, ctx.household.timezone).toISOString();
        const [dose] = await ctx.db.insert(petDoses).values({
          medicationId: med.id, petId: med.petId, dueDate: date, dueTime: time, dueAt,
          status: 'due', createdBy: med.createdBy, updatedBy: med.createdBy,
        }).onConflictDoNothing().returning();
        if (!dose) continue;
        created++;
        const pet = (await ctx.db.select({ name: pets.name }).from(pets).where(eq(pets.id, med.petId)).limit(1))[0];
        const [task] = await ctx.db.insert(tasks).values({
          title: `${pet?.name ?? 'Pet'}: ${med.name}${med.dose ? ` ${med.dose}` : ''}`,
          dueDate: date, dueTime: time,
          originType: 'pet_medication', originId: dose.id,
          priority: 'high', descriptionMd: med.instructionsMd ?? null,
          createdBy: med.createdBy, updatedBy: med.createdBy,
        }).returning();
        await ctx.db.update(petDoses).set({ taskId: task!.id }).where(eq(petDoses.id, dose.id));
      }
    }
  }
  return { created, medications: meds.length };
}

/** Marks doses that are past due and were never given (CAT-004). */
export async function flagMissedDoses(ctx: Ctx, graceMinutes = 240): Promise<number> {
  const cutoff = new Date(ctx.now.getTime() - graceMinutes * 60_000).toISOString();
  const stale = await ctx.db.select().from(petDoses)
    .where(and(eq(petDoses.status, 'due'), lte(petDoses.dueAt, cutoff), isNull(petDoses.deletedAt)));
  for (const d of stale) {
    await ctx.db.update(petDoses).set({ status: 'missed' }).where(eq(petDoses.id, d.id));
  }
  return stale.length;
}

export async function giveDose(
  ctx: Ctx, doseId: string, opts: { givenAt?: string; note?: string; status?: 'given' | 'skipped' } = {},
): Promise<typeof petDoses.$inferSelect> {
  const dose = (await ctx.db.select().from(petDoses).where(eq(petDoses.id, doseId)).limit(1))[0];
  if (!dose) throw notFound('Dose');
  const [row] = await ctx.db.update(petDoses).set({
    status: opts.status ?? 'given',
    givenAt: opts.givenAt ?? new Date().toISOString(),
    givenBy: ctx.user?.id ?? null,
    note: opts.note ?? null,
    updatedBy: ctx.user?.id ?? null,
  }).where(eq(petDoses.id, doseId)).returning();

  if ((opts.status ?? 'given') === 'given') {
    const med = (await ctx.db.select().from(petMedications)
      .where(eq(petMedications.id, dose.medicationId)).limit(1))[0];
    if (med?.productId) {
      const { consumeStock } = await import('./stock.js');
      await consumeStock(ctx, {
        productId: med.productId, quantity: med.dosesPerUnit || 1, unit: 'dose',
        reason: 'consume', refType: 'pet_dose', refId: doseId,
      }).catch(() => undefined); // a dose given from a bottle we do not track is fine
    }
  }
  if (dose.taskId) {
    await ctx.db.update(tasks).set({
      status: 'done', completedAt: ctx.today, completedBy: ctx.user?.id ?? null,
    }).where(and(eq(tasks.id, dose.taskId), sql`${tasks.status} <> 'done'`));
  }
  return row!;
}

export function registerPetHooks(): void {
  onTaskComplete('pet_medication', async (ctx, task) => {
    if (!task.originId) return null;
    const dose = (await ctx.db.select().from(petDoses).where(eq(petDoses.id, task.originId)).limit(1))[0];
    if (!dose || dose.status === 'given') return null;
    return giveDose(ctx, dose.id);
  });
}

/** Projects when a medication or food runs out, so refills land in time. */
export async function runOutProjection(ctx: Ctx, petId: string): Promise<Array<{
  kind: 'medication' | 'food';
  name: string;
  productId: string | null;
  perDay: number;
  onHand: number;
  unit: string;
  daysLeft: number | null;
  runsOut: string | null;
}>> {
  const out = [];
  const meds = await ctx.db.select().from(petMedications).where(and(
    eq(petMedications.petId, petId), eq(petMedications.active, true), isNull(petMedications.deletedAt),
  ));
  for (const m of meds) {
    if (!m.productId) continue;
    const perDay = ((m.timesOfDay?.length ?? 0) * (m.dosesPerUnit || 1)) / Math.max(m.everyDays, 1);
    const have = await onHand(ctx, m.productId);
    const daysLeft = perDay > 0 ? Math.floor(have / perDay) : null;
    out.push({
      kind: 'medication' as const, name: m.name, productId: m.productId,
      perDay: Number(perDay.toFixed(3)), onHand: have, unit: 'dose',
      daysLeft, runsOut: daysLeft != null ? addDays(ctx.today, daysLeft) : null,
    });
  }

  const diet = await ctx.db.select({ d: petDietEntries, p: products })
    .from(petDietEntries).leftJoin(products, eq(products.id, petDietEntries.productId))
    .where(and(
      eq(petDietEntries.petId, petId), isNull(petDietEntries.deletedAt),
      sql`(${petDietEntries.activeTo} is null or ${petDietEntries.activeTo} >= ${ctx.today})`,
    ));
  const byProduct = new Map<string, { name: string; perDay: number; unit: string }>();
  for (const row of diet) {
    if (!row.d.productId) continue;
    const cur = byProduct.get(row.d.productId)
      ?? { name: row.p?.name ?? 'Food', perDay: 0, unit: row.d.unit };
    cur.perDay += row.d.amount;
    byProduct.set(row.d.productId, cur);
  }
  for (const [productId, info] of byProduct) {
    const have = await onHand(ctx, productId);
    const daysLeft = info.perDay > 0 ? Math.floor(have / info.perDay) : null;
    out.push({
      kind: 'food' as const, name: info.name, productId,
      perDay: info.perDay, onHand: have, unit: info.unit,
      daysLeft, runsOut: daysLeft != null ? addDays(ctx.today, daysLeft) : null,
    });
  }
  return out;
}

/** Adds pet supplies to the shopping list before they run out (FOOD-016). */
export async function reconcilePetSupplies(ctx: Ctx, leadDays = 7): Promise<string[]> {
  const active = await ctx.db.select({ id: pets.id, name: pets.name })
    .from(pets).where(and(eq(pets.status, 'active'), isNull(pets.deletedAt)));
  const added: string[] = [];
  for (const pet of active) {
    for (const p of await runOutProjection(ctx, pet.id)) {
      if (p.daysLeft == null || p.daysLeft > leadDays || !p.productId) continue;
      const product = (await ctx.db.select().from(products).where(eq(products.id, p.productId)).limit(1))[0];
      if (!product) continue;
      await addToShoppingList(ctx, {
        productId: p.productId, text: product.name,
        quantity: Math.max(Math.ceil(p.perDay * 30), 1), unit: product.defaultUnit,
        sourceType: 'pet_supply', sourceId: pet.id,
        note: `${pet.name}: about ${p.daysLeft} days left`,
      });
      added.push(`${pet.name} — ${product.name}`);
    }
  }
  return added;
}

/** Flags a rapid weight change, which in cats is an early warning (CAT-007). */
export async function weightTrend(ctx: Ctx, petId: string, warnPct = 10): Promise<{
  latest: number | null; unit: string; changePct: number | null; warn: boolean; series: Array<{ takenAt: string; weight: number }>;
}> {
  const rows = await ctx.db.select().from(petWeights)
    .where(and(eq(petWeights.petId, petId), isNull(petWeights.deletedAt)))
    .orderBy(desc(petWeights.takenAt)).limit(100);
  if (!rows.length) return { latest: null, unit: 'lb', changePct: null, warn: false, series: [] };
  const latest = rows[0]!;
  const monthAgo = addDays(ctx.today, -30);
  const baseline = rows.find((r) => r.takenAt.slice(0, 10) <= monthAgo) ?? rows.at(-1)!;
  const changePct = baseline.weight > 0
    ? Number((((latest.weight - baseline.weight) / baseline.weight) * 100).toFixed(1))
    : null;
  return {
    latest: latest.weight,
    unit: latest.unit,
    changePct,
    warn: changePct != null && Math.abs(changePct) >= warnPct,
    series: rows.slice().reverse().map((r) => ({ takenAt: r.takenAt, weight: r.weight })),
  };
}

export async function dosesDueToday(ctx: Ctx): Promise<Array<{
  id: string; petId: string; petName: string; medication: string; dueAt: string; dueTime: string; status: string;
}>> {
  const rows = await ctx.db.select({ d: petDoses, med: petMedications, pet: pets })
    .from(petDoses)
    .innerJoin(petMedications, eq(petMedications.id, petDoses.medicationId))
    .innerJoin(pets, eq(pets.id, petDoses.petId))
    .where(and(
      isNull(petDoses.deletedAt),
      gte(petDoses.dueDate, addDays(ctx.today, -1)),
      lte(petDoses.dueDate, ctx.today),
      inArray(petDoses.status, ['due', 'missed']),
    ))
    .orderBy(asc(petDoses.dueAt));
  return rows.map((r) => ({
    id: r.d.id, petId: r.pet.id, petName: r.pet.name,
    medication: `${r.med.name}${r.med.dose ? ` ${r.med.dose}` : ''}`,
    dueAt: r.d.dueAt, dueTime: r.d.dueTime, status: r.d.status,
  }));
}
