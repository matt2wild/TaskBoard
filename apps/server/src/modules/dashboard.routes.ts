/* eslint-disable @typescript-eslint/no-explicit-any */
import type { FastifyInstance } from 'fastify';
import { and, asc, desc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  ACTIVE_PROJECT_STATUS, OPEN_TASK_STATUS, addDays, diffDays,
} from '@homestead/shared';
import {
  assets, loans, maintenancePlans, projects, recurringBills, schedules, storageItems,
  stockItems, tasks, taskAssignees, transactions, warranties, wasteLog,
} from '../db/schema.js';
import { monthSummary, monthOf, spentOnMany } from '../services/budget.js';
import { footprint } from '../services/carbon.js';
import { expiringSoon, lowStockList } from '../services/stock.js';
import { dosesDueToday } from '../services/pets.js';
import { decorateTasks } from './tasks.routes.js';

export function dashboardRoutes(app: FastifyInstance): void {
  /** The Today screen: one call, everything that needs a person (DASH-001). */
  app.get('/api/v1/dashboard', async (req) => {
    const ctx = req.ctx;
    const q = z.object({
      expiringDays: z.coerce.number().int().min(1).max(60).default(7),
      upcomingDays: z.coerce.number().int().min(1).max(60).default(7),
      billDays: z.coerce.number().int().min(1).max(60).default(7),
      warrantyDays: z.coerce.number().int().min(1).max(180).default(60),
    }).parse(req.query);

    const soon = addDays(ctx.today, q.upcomingDays);

    const [taskRows, expiring, low, doses, projectRows, billRows, warrantyRows, loanRows, maintRows] =
      await Promise.all([
        ctx.db.select().from(tasks).where(and(
          isNull(tasks.deletedAt),
          inArray(tasks.status, [...OPEN_TASK_STATUS]),
          sql`${tasks.dueDate} is not null`,
          lte(tasks.dueDate, soon),
        )).orderBy(asc(tasks.dueDate)).limit(200),
        expiringSoon(ctx, q.expiringDays),
        lowStockList(ctx),
        dosesDueToday(ctx),
        ctx.db.select().from(projects).where(and(
          inArray(projects.status, [...ACTIVE_PROJECT_STATUS]), isNull(projects.deletedAt),
        )),
        ctx.db.select({ bill: recurringBills, schedule: schedules })
          .from(recurringBills).leftJoin(schedules, eq(schedules.id, recurringBills.scheduleId))
          .where(and(eq(recurringBills.active, true), isNull(recurringBills.deletedAt))),
        ctx.db.select({ w: warranties, asset: assets })
          .from(warranties).innerJoin(assets, eq(assets.id, warranties.assetId))
          .where(and(
            isNull(warranties.deletedAt), isNull(assets.deletedAt),
            gte(warranties.endDate, ctx.today), lte(warranties.endDate, addDays(ctx.today, q.warrantyDays)),
          )).orderBy(asc(warranties.endDate)),
        ctx.db.select().from(loans)
          .where(and(isNull(loans.returnedAt), isNull(loans.deletedAt))).orderBy(asc(loans.dueBack)),
        ctx.db.select({ plan: maintenancePlans, schedule: schedules })
          .from(maintenancePlans).innerJoin(schedules, eq(schedules.id, maintenancePlans.scheduleId))
          .where(and(
            eq(maintenancePlans.active, true), isNull(maintenancePlans.deletedAt),
            sql`${schedules.nextDue} is not null`, lte(schedules.nextDue, ctx.today),
          )),
      ]);

    const overdueCount = await ctx.db.select({ n: sql<number>`count(*)` }).from(tasks).where(and(
      isNull(tasks.deletedAt), inArray(tasks.status, [...OPEN_TASK_STATUS]),
      sql`${tasks.dueDate} is not null`, sql`${tasks.dueDate} < ${ctx.today}`,
    ));

    const decorated = await decorateTasks(taskRows, ctx);
    const projectSpend = await spentOnMany(ctx, 'project', projectRows.map((p) => p.id));
    const projectTasks = projectRows.length
      ? await ctx.db.select({ projectId: tasks.projectId, status: tasks.status }).from(tasks)
        .where(and(inArray(tasks.projectId, projectRows.map((p) => p.id)), isNull(tasks.deletedAt)))
      : [];

    const budget = await monthSummary(ctx, monthOf(ctx.today));

    // The same month last year is the only comparison that means anything for
    // a household, because heating dominates and seasons are not alike.
    const month = monthOf(ctx.today);
    const lastYearMonth = `${Number(month.slice(0, 4)) - 1}${month.slice(4)}`;
    const monthEnd = (m: string) => {
      const [y, mm] = m.split('-').map(Number) as [number, number];
      return `${m}-${String(new Date(Date.UTC(y, mm, 0)).getUTCDate()).padStart(2, '0')}`;
    };
    const [carbonNow, carbonThen, carbonTarget] = await Promise.all([
      footprint(ctx, `${month}-01`, monthEnd(month)),
      footprint(ctx, `${lastYearMonth}-01`, monthEnd(lastYearMonth)),
      (async () => {
        const { carbonTargets } = await import('../db/schema.js');
        const year = ctx.today.slice(0, 4);
        const rows = await ctx.db.select().from(carbonTargets)
          .where(and(eq(carbonTargets.period, year), isNull(carbonTargets.deletedAt))).limit(1);
        if (!rows[0]) return null;
        const ytd = await footprint(ctx, `${year}-01-01`, ctx.today);
        return {
          period: year, gCo2e: rows[0].gCo2e, ytd: ytd.total,
          pct: rows[0].gCo2e > 0 ? Math.round((ytd.total / rows[0].gCo2e) * 100) : null,
        };
      })(),
    ]);
    const bills = billRows
      .filter((b) => b.schedule?.nextDue && b.schedule.nextDue <= addDays(ctx.today, q.billDays))
      .map((b) => ({
        id: b.bill.id, payee: b.bill.name, amount: b.bill.amount,
        dueDate: b.schedule!.nextDue!, variable: b.bill.variable,
      }))
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate));

    return {
      today: ctx.today,
      household: { name: ctx.household.name, currency: ctx.household.currency, timezone: ctx.household.timezone },
      counts: {
        tasksDueToday: decorated.filter((t: any) => t.dueDate === ctx.today).length,
        tasksOverdue: Number(overdueCount[0]?.n ?? 0),
        maintenanceDue: maintRows.length,
        expiringSoon: expiring.length,
        lowStock: low.length,
        dosesDueToday: doses.filter((d) => d.status === 'due').length,
        dosesMissed: doses.filter((d) => d.status === 'missed').length,
        activeProjects: projectRows.length,
        loansOut: loanRows.length,
        warrantiesExpiring: warrantyRows.length,
        billsDueSoon: bills.length,
      },
      carbon: {
        month,
        gCo2e: carbonNow.total,
        lastYearGCo2e: carbonThen.total,
        changePct: carbonThen.total > 0
          ? Math.round(((carbonNow.total - carbonThen.total) / carbonThen.total) * 100)
          : null,
        byScope: carbonNow.byScope,
        topCategory: carbonNow.byCategory[0] ?? null,
        target: carbonTarget,
      },
      /** The garden and the pile, which both want looking at rather than reading about. */
      garden: await (async () => {
        const { plantings, harvests } = await import('../db/schema.js');
        const [growing, readySoon, recent] = await Promise.all([
          ctx.db.select({ n: sql<number>`count(*)` }).from(plantings).where(and(
            inArray(plantings.status, ['growing', 'harvesting']), isNull(plantings.deletedAt),
          )),
          ctx.db.select({ n: sql<number>`count(*)` }).from(plantings).where(and(
            eq(plantings.status, 'growing'), isNull(plantings.deletedAt),
            sql`${plantings.expectedHarvestOn} is not null`,
            lte(plantings.expectedHarvestOn, soon),
          )),
          ctx.db.select({
            n: sql<number>`count(*)`,
            value: sql<number>`coalesce(sum(${harvests.estValue}), 0)`,
          }).from(harvests).where(and(
            isNull(harvests.deletedAt), gte(harvests.harvestedOn, `${ctx.today.slice(0, 4)}-01-01`),
          )),
        ]);
        return {
          growing: Number(growing[0]?.n ?? 0),
          readySoon: Number(readySoon[0]?.n ?? 0),
          harvests: Number(recent[0]?.n ?? 0),
          harvestValue: Number(recent[0]?.value ?? 0),
        };
      })(),
      compost: await (async () => {
        const { turnsDue } = await import('../services/compost.js');
        const due = await turnsDue(ctx);
        return {
          turnsDue: due.length,
          names: due.slice(0, 3).map((d) => d.system.name),
        };
      })(),
      tasks: decorated.slice(0, 50),
      expiring: expiring.slice(0, 20),
      lowStock: low.slice(0, 20),
      doses,
      projects: projectRows.map((p) => {
        const mine = projectTasks.filter((t) => t.projectId === p.id);
        const spent = projectSpend.get(p.id) ?? 0;
        return {
          id: p.id, name: p.name, status: p.status,
          taskTotal: mine.length, taskDone: mine.filter((t) => t.status === 'done').length,
          budget: p.budgetAmount, spent,
          pctBudget: p.budgetAmount && p.budgetAmount > 0 ? Math.round((spent / p.budgetAmount) * 100) : null,
        };
      }),
      budget: {
        month: budget.period, allocated: budget.allocated, spent: budget.spent,
        currency: budget.currency,
        overCategories: budget.categories
          .filter((c) => c.allocated > 0 && c.spent > c.allocated * 0.8)
          .slice(0, 3),
      },
      bills,
      warranties: warrantyRows.map((r) => ({
        assetId: r.asset.id, assetName: r.asset.name, expiry: r.w.endDate,
        daysLeft: diffDays(r.w.endDate, ctx.today),
      })),
      loans: loanRows.map((l) => ({
        id: l.id, contact: l.contactName ?? 'someone', dueBack: l.dueBack,
        overdue: !!l.dueBack && l.dueBack < ctx.today, itemType: l.itemType, itemId: l.itemId,
      })),
      maintenance: maintRows.map((m) => ({
        planId: m.plan.id, title: m.plan.title, dueDate: m.schedule.nextDue!,
        daysLate: diffDays(ctx.today, m.schedule.nextDue!),
      })),
    };
  });

  /** Sunday planning: what happened, what is coming (DASH-004). */
  app.get('/api/v1/dashboard/weekly-review', async (req) => {
    const ctx = req.ctx;
    const weekAgo = addDays(ctx.today, -7);
    const weekAhead = addDays(ctx.today, 7);

    const [done, spent, waste, newItems, upcoming] = await Promise.all([
      ctx.db.select().from(tasks).where(and(
        isNull(tasks.deletedAt), eq(tasks.status, 'done'),
        gte(tasks.completedAt, weekAgo),
      )).orderBy(desc(tasks.completedAt)),
      ctx.db.select({
        total: sql<number>`coalesce(sum(${transactions.amount}), 0)`,
        count: sql<number>`count(*)`,
      }).from(transactions).where(and(
        isNull(transactions.deletedAt), eq(transactions.type, 'expense'),
        gte(transactions.date, weekAgo), lte(transactions.date, ctx.today),
      )),
      ctx.db.select({
        count: sql<number>`count(*)`, cost: sql<number>`coalesce(sum(${wasteLog.estCost}), 0)`,
      }).from(wasteLog).where(gte(wasteLog.ts, weekAgo)),
      ctx.db.select({ n: sql<number>`count(*)` }).from(storageItems)
        .where(and(isNull(storageItems.deletedAt), gte(storageItems.createdAt, weekAgo))),
      ctx.db.select().from(tasks).where(and(
        isNull(tasks.deletedAt), inArray(tasks.status, [...OPEN_TASK_STATUS]),
        sql`${tasks.dueDate} is not null`,
        gte(tasks.dueDate, ctx.today), lte(tasks.dueDate, weekAhead),
      )).orderBy(asc(tasks.dueDate)),
    ]);

    const byOrigin = new Map<string, number>();
    for (const t of done) byOrigin.set(t.originType, (byOrigin.get(t.originType) ?? 0) + 1);

    return {
      week: { from: weekAgo, to: ctx.today },
      completed: {
        total: done.length,
        byOrigin: [...byOrigin].map(([origin, count]) => ({ origin, count })),
        items: done.slice(0, 30).map((t) => ({ id: t.id, title: t.title, completedAt: t.completedAt })),
        minutes: done.reduce((a, b) => a + (b.actualMin ?? 0), 0),
      },
      spending: {
        total: Number(spent[0]?.total ?? 0), count: Number(spent[0]?.count ?? 0),
        currency: ctx.household.currency,
      },
      waste: { count: Number(waste[0]?.count ?? 0), cost: Number(waste[0]?.cost ?? 0) },
      newStorageItems: Number(newItems[0]?.n ?? 0),
      ahead: {
        total: upcoming.length,
        items: await decorateTasks(upcoming.slice(0, 40), ctx),
      },
    };
  });

  /** Capture endpoints for automations, NFC tags and shortcuts (API-009). */
  app.post('/api/v1/capture/task', async (req, reply) => {
    const body = z.object({ text: z.string().trim().min(1) }).parse(req.body);
    const { parseNaturalDue } = await import('../services/natural-date.js');
    const parsed = parseNaturalDue(body.text, req.ctx.today);
    const [row] = await req.ctx.db.insert(tasks).values({
      title: parsed.title, dueDate: parsed.dueDate, dueTime: parsed.dueTime,
      priority: parsed.priority ?? 'normal',
      createdBy: req.ctx.user?.id ?? null, updatedBy: req.ctx.user?.id ?? null,
    }).returning();
    if (req.ctx.user) {
      await req.ctx.db.insert(taskAssignees)
        .values({ taskId: row!.id, userId: req.ctx.user.id }).onConflictDoNothing();
    }
    reply.status(201);
    return row;
  });

  app.post('/api/v1/capture/stock', async (req, reply) => {
    const body = z.object({
      barcode: z.string().optional(), productId: z.string().optional(),
      quantity: z.number().default(1), locationId: z.string().optional(),
      consume: z.boolean().default(false),
    }).parse(req.body);
    const { productBarcodes } = await import('../db/schema.js');
    let productId = body.productId;
    if (!productId && body.barcode) {
      const hit = await req.ctx.db.select().from(productBarcodes)
        .where(eq(productBarcodes.barcode, body.barcode)).limit(1);
      productId = hit[0]?.productId;
    }
    if (!productId) {
      reply.status(404);
      return { found: false, barcode: body.barcode };
    }
    const { addStock, consumeStock } = await import('../services/stock.js');
    const result = body.consume
      ? await consumeStock(req.ctx, { productId, quantity: body.quantity })
      : await addStock(req.ctx, { productId, quantity: body.quantity, locationId: body.locationId ?? null });
    reply.status(201);
    return { productId, result };
  });

  /** Read-only counters for a wall tablet or Home Assistant (API-010). */
  app.get('/api/v1/metrics/summary', async (req) => {
    const ctx = req.ctx;
    const [openTasks, overdue, stock, activeProjects] = await Promise.all([
      ctx.db.select({ n: sql<number>`count(*)` }).from(tasks)
        .where(and(isNull(tasks.deletedAt), inArray(tasks.status, [...OPEN_TASK_STATUS]))),
      ctx.db.select({ n: sql<number>`count(*)` }).from(tasks).where(and(
        isNull(tasks.deletedAt), inArray(tasks.status, [...OPEN_TASK_STATUS]),
        sql`${tasks.dueDate} < ${ctx.today}`,
      )),
      ctx.db.select({ n: sql<number>`count(*)` }).from(stockItems)
        .where(and(isNull(stockItems.deletedAt), sql`${stockItems.quantity} > 0`)),
      ctx.db.select({ n: sql<number>`count(*)` }).from(projects)
        .where(and(isNull(projects.deletedAt), inArray(projects.status, [...ACTIVE_PROJECT_STATUS]))),
    ]);
    const doses = await dosesDueToday(ctx);
    const expiring = await expiringSoon(ctx, 7);
    return {
      today: ctx.today,
      openTasks: Number(openTasks[0]?.n ?? 0),
      overdueTasks: Number(overdue[0]?.n ?? 0),
      stockItems: Number(stock[0]?.n ?? 0),
      activeProjects: Number(activeProjects[0]?.n ?? 0),
      dosesDue: doses.filter((d) => d.status === 'due').length,
      expiringSoon: expiring.length,
    };
  });
}
