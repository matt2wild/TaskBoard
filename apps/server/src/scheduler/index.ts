/* eslint-disable @typescript-eslint/no-explicit-any */
import { and, asc, eq, inArray, isNull, lte, sql } from 'drizzle-orm';
import { OPEN_TASK_STATUS, addDays, diffDays } from '@homestead/shared';
import type { DB } from '../db/index.js';
import { makeCtx, type Ctx } from '../core/ctx.js';
import {
  assets, jobRuns, loans, maintenancePlans, recurringBills, schedules, tasks, taskAssignees, warranties,
} from '../db/schema.js';
import { materialiseAll } from '../services/tasks.js';
import { flagMissedDoses, dosesDueToday, materialiseDoses, reconcilePetSupplies } from '../services/pets.js';
import { expiringSoon, lowStockList } from '../services/stock.js';
import { flushDeliveries, notify } from '../services/notify.js';
import { monthOf, monthSummary } from '../services/budget.js';

/**
 * The reminder pass. Everything it emits is keyed by a dedupe key that encodes
 * the occasion, so running it twice — or running it late after the container
 * was down — produces the same notifications exactly once (NFR-005).
 */
export async function runDailyPass(ctx: Ctx): Promise<Record<string, number>> {
  const stats: Record<string, number> = {};
  const count = (k: string, n: number) => { stats[k] = (stats[k] ?? 0) + n; };

  const mat = await materialiseAll(ctx);
  count('tasksGenerated', mat.created);
  const doses = await materialiseDoses(ctx, { horizonDays: 3 });
  count('dosesGenerated', doses.created);
  count('dosesMissed', await flagMissedDoses(ctx));

  // Tasks due today and overdue.
  const due = await ctx.db.select().from(tasks).where(and(
    isNull(tasks.deletedAt), inArray(tasks.status, [...OPEN_TASK_STATUS]),
    sql`${tasks.dueDate} is not null`, lte(tasks.dueDate, ctx.today),
  )).orderBy(asc(tasks.dueDate)).limit(500);

  const assignees = due.length
    ? await ctx.db.select().from(taskAssignees).where(inArray(taskAssignees.taskId, due.map((t) => t.id)))
    : [];
  const byTask = new Map<string, string[]>();
  for (const a of assignees) {
    const list = byTask.get(a.taskId) ?? [];
    list.push(a.userId);
    byTask.set(a.taskId, list);
  }

  for (const t of due) {
    const overdue = t.dueDate! < ctx.today;
    const res = await notify(ctx, {
      eventType: overdue ? 'task.overdue' : 'task.due',
      title: overdue ? `Overdue: ${t.title}` : `Due today: ${t.title}`,
      body: overdue ? `Was due ${t.dueDate} (${diffDays(ctx.today, t.dueDate!)} days ago)` : undefined,
      entityType: 'task', entityId: t.id,
      // One reminder per task per day it is outstanding.
      dedupeKey: `task:${t.id}:${ctx.today}`,
      userIds: byTask.get(t.id),
    });
    count('taskReminders', res.created);
  }

  // Maintenance falling due.
  const maint = await ctx.db.select({ plan: maintenancePlans, schedule: schedules })
    .from(maintenancePlans).innerJoin(schedules, eq(schedules.id, maintenancePlans.scheduleId))
    .where(and(
      eq(maintenancePlans.active, true), isNull(maintenancePlans.deletedAt),
      sql`${schedules.nextDue} is not null`, lte(schedules.nextDue, ctx.today),
    ));
  for (const m of maint) {
    const res = await notify(ctx, {
      eventType: 'maintenance.due',
      title: `Maintenance due: ${m.plan.title}`,
      entityType: 'maintenance_plan', entityId: m.plan.id,
      dedupeKey: `maintenance:${m.plan.id}:${m.schedule.nextDue}`,
    });
    count('maintenanceReminders', res.created);
  }

  // Food about to expire, reported once a day as a digest rather than per item.
  const expiring = await expiringSoon(ctx, 7);
  if (expiring.length) {
    const res = await notify(ctx, {
      eventType: 'food.expiring',
      title: `${expiring.length} item${expiring.length === 1 ? '' : 's'} expiring soon`,
      body: expiring.slice(0, 8).map((e) => `${e.product} — ${e.expiryDate}`).join('\n'),
      dedupeKey: `expiring:${ctx.today}`,
    });
    count('expiryReminders', res.created);
  }

  const low = await lowStockList(ctx);
  if (low.length) {
    const res = await notify(ctx, {
      eventType: 'stock.low',
      title: `${low.length} item${low.length === 1 ? '' : 's'} below par`,
      body: low.slice(0, 8).map((l) => `${l.name}: ${l.onHand} of ${l.minQuantity} ${l.unit}`).join('\n'),
      dedupeKey: `lowstock:${ctx.today}`,
    });
    count('lowStockReminders', res.created);
  }

  // Warranties, at 60 / 30 / 7 days out.
  const warrantyRows = await ctx.db.select({ w: warranties, asset: assets })
    .from(warranties).innerJoin(assets, eq(assets.id, warranties.assetId))
    .where(and(isNull(warranties.deletedAt), isNull(assets.deletedAt)));
  for (const r of warrantyRows) {
    const daysLeft = diffDays(r.w.endDate, ctx.today);
    if (![60, 30, 7].includes(daysLeft)) continue;
    const res = await notify(ctx, {
      eventType: 'warranty.expiring',
      title: `Warranty on ${r.asset.name} expires in ${daysLeft} days`,
      body: `Cover ends ${r.w.endDate}.`,
      entityType: 'asset', entityId: r.asset.id,
      dedupeKey: `warranty:${r.w.id}:${daysLeft}`,
    });
    count('warrantyReminders', res.created);
  }

  // Bills, at their configured lead time.
  const bills = await ctx.db.select({ bill: recurringBills, schedule: schedules })
    .from(recurringBills).leftJoin(schedules, eq(schedules.id, recurringBills.scheduleId))
    .where(and(eq(recurringBills.active, true), isNull(recurringBills.deletedAt)));
  for (const b of bills) {
    const dueDate = b.schedule?.nextDue;
    if (!dueDate) continue;
    if (diffDays(dueDate, ctx.today) > b.bill.leadDays) continue;
    const res = await notify(ctx, {
      eventType: 'bill.due',
      title: `${b.bill.name} due ${dueDate}`,
      body: b.bill.amount ? `About ${(b.bill.amount / 100).toFixed(2)} ${ctx.household.currency}` : 'Amount varies',
      entityType: 'recurring_bill', entityId: b.bill.id,
      dedupeKey: `bill:${b.bill.id}:${dueDate}`,
    });
    count('billReminders', res.created);
  }

  // Pet doses due and missed.
  for (const d of await dosesDueToday(ctx)) {
    const res = await notify(ctx, {
      eventType: d.status === 'missed' ? 'pet.dose_missed' : 'pet.dose_due',
      title: d.status === 'missed'
        ? `Missed: ${d.petName} — ${d.medication} at ${d.dueTime}`
        : `${d.petName}: ${d.medication} at ${d.dueTime}`,
      entityType: 'pet', entityId: d.petId,
      dedupeKey: `dose:${d.id}:${d.status}`,
    });
    count('doseReminders', res.created);
  }

  count('petSuppliesAdded', (await reconcilePetSupplies(ctx)).length);

  // Loans past their return date.
  const openLoans = await ctx.db.select().from(loans)
    .where(and(isNull(loans.returnedAt), isNull(loans.deletedAt)));
  for (const l of openLoans) {
    if (!l.dueBack || l.dueBack > ctx.today) continue;
    const res = await notify(ctx, {
      eventType: 'loan.return_due',
      title: l.direction === 'out'
        ? `Still with ${l.contactName ?? 'someone'} since ${l.lentAt}`
        : `Return borrowed item to ${l.contactName ?? 'its owner'}`,
      entityType: 'loan', entityId: l.id,
      dedupeKey: `loan:${l.id}:${ctx.today}`,
    });
    count('loanReminders', res.created);
  }

  // Budget thresholds, once per category per month per threshold crossed.
  const budget = await monthSummary(ctx, monthOf(ctx.today));
  for (const c of budget.categories) {
    if (!c.categoryId || c.allocated <= 0 || c.pct == null) continue;
    const threshold = c.pct >= 100 ? 100 : c.pct >= 80 ? 80 : null;
    if (!threshold) continue;
    const res = await notify(ctx, {
      eventType: 'budget.threshold',
      title: threshold === 100
        ? `Over budget: ${c.name}`
        : `${c.name} is at ${c.pct}% of budget`,
      body: `${(c.spent / 100).toFixed(2)} of ${(c.allocated / 100).toFixed(2)} ${budget.currency}`,
      entityType: 'category', entityId: c.categoryId,
      dedupeKey: `budget:${c.categoryId}:${budget.period}:${threshold}`,
    });
    count('budgetAlerts', res.created);
  }

  const flushed = await flushDeliveries(ctx);
  count('delivered', flushed.sent);
  count('deliveryFailures', flushed.failed);
  return stats;
}

/** Runs the daily pass once per calendar day, catching up after downtime. */
export async function tick(db: DB, now = new Date()): Promise<{ ran: boolean; stats?: Record<string, number> }> {
  const ctx = await makeCtx(db, null, now);
  const jobKey = 'daily';
  const existing = await db.select().from(jobRuns)
    .where(and(eq(jobRuns.jobKey, jobKey), eq(jobRuns.ranForDate, ctx.today))).limit(1);
  if (existing[0]?.status === 'ok') {
    // Still drain any deliveries that failed earlier in the day.
    await flushDeliveries(ctx);
    return { ran: false };
  }

  const [run] = await db.insert(jobRuns)
    .values({ jobKey, ranForDate: ctx.today, status: 'running' })
    .onConflictDoUpdate({
      target: [jobRuns.jobKey, jobRuns.ranForDate],
      set: { status: 'running', startedAt: new Date().toISOString() },
    }).returning();

  try {
    const stats = await runDailyPass(ctx);
    await db.update(jobRuns).set({
      status: 'ok', finishedAt: new Date().toISOString(), detail: stats,
    }).where(eq(jobRuns.id, run!.id));
    return { ran: true, stats };
  } catch (err) {
    await db.update(jobRuns).set({
      status: 'error', finishedAt: new Date().toISOString(),
      detail: { error: (err as Error).message },
    }).where(eq(jobRuns.id, run!.id));
    throw err;
  }
}

export interface SchedulerHandle { stop: () => void }

export function startScheduler(db: DB, opts: { tickSeconds?: number; logger?: { info: (o: any, m?: string) => void; error: (o: any, m?: string) => void } } = {}): SchedulerHandle {
  const every = (opts.tickSeconds ?? 60) * 1000;
  let stopped = false;

  const run = async () => {
    if (stopped) return;
    try {
      const res = await tick(db);
      if (res.ran) opts.logger?.info({ stats: res.stats }, 'daily pass complete');
    } catch (err) {
      opts.logger?.error({ err }, 'scheduler tick failed');
    }
  };

  void run();
  const timer = setInterval(() => void run(), every);
  timer.unref?.();
  return { stop: () => { stopped = true; clearInterval(timer); } };
}

/** Housekeeping: purge soft-deleted rows past the retention window (GEN-004). */
export async function purgeTrash(db: DB, days = 30): Promise<number> {
  const cutoff = addDays(new Date().toISOString().slice(0, 10), -days);
  const { storageItems, stockItems, shoppingLines } = await import('../db/schema.js');
  let purged = 0;
  for (const table of [tasks, storageItems, stockItems, shoppingLines]) {
    const res = await db.delete(table as any)
      .where(sql`deleted_at is not null and deleted_at < ${cutoff}`).returning({ id: (table as any).id });
    purged += res.length;
  }
  return purged;
}
