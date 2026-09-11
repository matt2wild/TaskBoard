/* eslint-disable @typescript-eslint/no-explicit-any */
import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { and, asc, desc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  ACCOUNT_TYPES, ATTRIBUTABLE, ROLLOVER_RULES, TRANSACTION_TYPES, addMonths, monthlySetAside, parseMoney,
} from '@homestead/shared';
import {
  accounts, attributions, budgetAllocations, categories, goals, payees, projects, recurringBills,
  transactionSplits, transactions, assets, pets,
} from '../db/schema.js';
import { crudRoutes } from '../core/crud.js';
import { requireWrite } from '../core/auth.js';
import { badRequest, notFound } from '../core/errors.js';
import { attachCost, monthOf, monthRange, monthSummary, resolvePayee } from '../services/budget.js';
import { attachCostToMeteredPeriod, tryRecordActivity } from '../services/carbon.js';
import { upsertSchedule, onTaskComplete } from '../services/tasks.js';
import { resolveLabels } from '../core/registry.js';

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const period = z.string().regex(/^\d{4}-\d{2}$/);

const attributionSchema = z.object({
  entityType: z.enum(ATTRIBUTABLE),
  entityId: z.string().min(1),
});

export function budgetRoutes(app: FastifyInstance): void {
  crudRoutes(app, '/api/v1/accounts', {
    table: accounts, entityType: 'account', label: 'Account',
    create: z.object({
      name: z.string().trim().min(1),
      type: z.enum(ACCOUNT_TYPES).default('checking'),
      openingBalance: z.number().int().default(0),
      openingDate: dateStr.nullable().optional(),
      currency: z.string().length(3).nullable().optional(),
      sort: z.number().int().optional(),
    }),
    update: z.object({
      name: z.string().trim().min(1).optional(),
      type: z.enum(ACCOUNT_TYPES).optional(),
      openingBalance: z.number().int().optional(),
      archived: z.boolean().optional(),
      sort: z.number().int().optional(),
    }),
    searchColumns: ['name'], filterColumns: ['type', 'archived'],
    hooks: {
      decorate: async (rows, ctx) => {
        const ids = rows.map((r) => r.id);
        if (!ids.length) return rows;
        const sums = await ctx.db.select({
          accountId: transactions.accountId,
          net: sql<number>`coalesce(sum(case when ${transactions.type} = 'income' then ${transactions.amount} else -${transactions.amount} end), 0)`,
        }).from(transactions)
          .where(and(inArray(transactions.accountId, ids), isNull(transactions.deletedAt)))
          .groupBy(transactions.accountId);
        const byId = new Map(sums.map((s) => [s.accountId, Number(s.net)]));
        return rows.map((r) => ({ ...r, balance: r.openingBalance + (byId.get(r.id) ?? 0) }));
      },
    },
  });

  crudRoutes(app, '/api/v1/categories', {
    table: categories, entityType: 'category', label: 'Category',
    create: z.object({
      name: z.string().trim().min(1),
      parentId: z.string().nullable().optional(),
      kind: z.enum(['expense', 'income']).default('expense'),
      rolloverRule: z.enum(ROLLOVER_RULES).default('none'),
      sort: z.number().int().optional(),
    }),
    update: z.object({
      name: z.string().trim().min(1).optional(),
      parentId: z.string().nullable().optional(),
      rolloverRule: z.enum(ROLLOVER_RULES).optional(),
      archived: z.boolean().optional(),
      sort: z.number().int().optional(),
    }),
    searchColumns: ['name'], filterColumns: ['parentId', 'kind', 'archived'],
    hooks: {
      beforeDelete: async (row, ctx) => {
        const used = await ctx.db.select({ id: transactionSplits.id }).from(transactionSplits)
          .where(eq(transactionSplits.categoryId, row.id)).limit(1);
        if (used.length) throw badRequest('That category is in use. Archive it instead.');
      },
    },
  });

  crudRoutes(app, '/api/v1/payees', {
    table: payees, entityType: 'contact', label: 'Payee',
    create: z.object({
      name: z.string().trim().min(1),
      contactId: z.string().nullable().optional(),
      defaultCategoryId: z.string().nullable().optional(),
    }),
    update: z.object({
      name: z.string().trim().min(1).optional(),
      contactId: z.string().nullable().optional(),
      defaultCategoryId: z.string().nullable().optional(),
    }),
    searchColumns: ['name'],
  });

  app.post('/api/v1/payees/merge', async (req) => {
    requireWrite(req.ctx.user);
    const body = z.object({ keepId: z.string(), mergeIds: z.array(z.string()).min(1) }).parse(req.body);
    if (body.mergeIds.includes(body.keepId)) throw badRequest('Cannot merge a payee into itself');
    await req.ctx.db.update(transactions).set({ payeeId: body.keepId })
      .where(inArray(transactions.payeeId, body.mergeIds));
    await req.ctx.db.update(payees).set({ deletedAt: new Date().toISOString() })
      .where(inArray(payees.id, body.mergeIds));
    return { keepId: body.keepId, merged: body.mergeIds.length };
  });

  /* ── transactions ── */

  app.get('/api/v1/transactions', async (req) => {
    const q = z.object({
      from: dateStr.optional(), to: dateStr.optional(),
      categoryId: z.string().optional(), accountId: z.string().optional(),
      payeeId: z.string().optional(), type: z.enum(TRANSACTION_TYPES).optional(),
      entityType: z.string().optional(), entityId: z.string().optional(),
      q: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(500).default(100),
      offset: z.coerce.number().int().min(0).default(0),
    }).parse(req.query);

    const where = [isNull(transactions.deletedAt)];
    if (q.from) where.push(gte(transactions.date, q.from));
    if (q.to) where.push(lte(transactions.date, q.to));
    if (q.accountId) where.push(eq(transactions.accountId, q.accountId));
    if (q.payeeId) where.push(eq(transactions.payeeId, q.payeeId));
    if (q.type) where.push(eq(transactions.type, q.type));
    if (q.q) where.push(sql`lower(coalesce(${transactions.memo}, '')) like ${`%${q.q.toLowerCase()}%`}`);
    if (q.categoryId) {
      where.push(sql`exists (select 1 from transaction_split ts where ts.transaction_id = ${transactions.id} and ts.category_id = ${q.categoryId})`);
    }
    if (q.entityType && q.entityId) {
      where.push(sql`exists (
        select 1 from transaction_split ts
        join attribution sa on sa.source_id = ts.id and sa.source_kind = 'split'
        where ts.transaction_id = ${transactions.id}
          and sa.entity_type = ${q.entityType} and sa.entity_id = ${q.entityId})`);
    }

    const rows = await req.ctx.db.select().from(transactions).where(and(...where))
      .orderBy(desc(transactions.date), desc(transactions.createdAt))
      .limit(q.limit).offset(q.offset);
    const total = await req.ctx.db.select({ n: sql<number>`count(*)` }).from(transactions).where(and(...where));
    return {
      items: await hydrate(req.ctx, rows),
      total: Number(total[0]?.n ?? 0),
      currency: req.ctx.household.currency,
    };
  });

  app.get('/api/v1/transactions/:id', async (req) => {
    const id = (req.params as { id: string }).id;
    const row = (await req.ctx.db.select().from(transactions).where(eq(transactions.id, id)).limit(1))[0];
    if (!row) throw notFound('Transaction');
    return (await hydrate(req.ctx, [row]))[0];
  });

  app.post('/api/v1/transactions', async (req, reply) => {
    requireWrite(req.ctx.user);
    const body = z.object({
      date: dateStr.optional(),
      amount: z.union([z.number().int(), z.string()]),
      type: z.enum(TRANSACTION_TYPES).default('expense'),
      accountId: z.string().nullable().optional(),
      payeeId: z.string().nullable().optional(),
      payeeName: z.string().nullable().optional(),
      categoryId: z.string().nullable().optional(),
      memo: z.string().nullable().optional(),
      cleared: z.boolean().optional(),
      splits: z.array(z.object({
        amount: z.union([z.number().int(), z.string()]),
        categoryId: z.string().nullable().optional(),
        memo: z.string().nullable().optional(),
        attributions: z.array(attributionSchema).optional(),
      })).optional(),
      attributions: z.array(attributionSchema).optional(),
    }).parse(req.body);

    const amount = typeof body.amount === 'string' ? parseMoney(body.amount) : body.amount;
    const splits = body.splits?.map((s) => ({
      ...s, amount: typeof s.amount === 'string' ? parseMoney(s.amount) : s.amount,
    }));
    const result = await attachCost(req.ctx, { ...body, amount, splits });
    reply.status(201);
    return (await hydrate(req.ctx, [result.transaction]))[0];
  });

  app.patch('/api/v1/transactions/:id', async (req) => {
    requireWrite(req.ctx.user);
    const id = (req.params as { id: string }).id;
    const body = z.object({
      date: dateStr.optional(), memo: z.string().nullable().optional(),
      cleared: z.boolean().optional(), accountId: z.string().nullable().optional(),
      payeeId: z.string().nullable().optional(), payeeName: z.string().optional(),
      amount: z.number().int().optional(),
      splits: z.array(z.object({
        amount: z.number().int(), categoryId: z.string().nullable().optional(),
        memo: z.string().nullable().optional(), attributions: z.array(attributionSchema).optional(),
      })).optional(),
    }).parse(req.body);

    const current = (await req.ctx.db.select().from(transactions).where(eq(transactions.id, id)).limit(1))[0];
    if (!current) throw notFound('Transaction');
    const patch: Record<string, unknown> = {
      date: body.date, memo: body.memo, cleared: body.cleared,
      accountId: body.accountId, amount: body.amount, updatedBy: req.ctx.user!.id,
    };
    if (body.payeeName) patch.payeeId = await resolvePayee(req.ctx, body.payeeName);
    else if (body.payeeId !== undefined) patch.payeeId = body.payeeId;
    for (const k of Object.keys(patch)) if (patch[k] === undefined) delete patch[k];

    if (body.splits) {
      const total = body.amount ?? current.amount;
      const sum = body.splits.reduce((a, b) => a + b.amount, 0);
      if (sum !== total) throw badRequest(`Splits total ${sum} but the transaction is ${total}`);
      await req.ctx.db.delete(transactionSplits).where(eq(transactionSplits.transactionId, id));
      for (const [i, s] of body.splits.entries()) {
        const [row] = await req.ctx.db.insert(transactionSplits)
          .values({ transactionId: id, amount: s.amount, categoryId: s.categoryId ?? null, memo: s.memo ?? null, sort: i })
          .returning();
        if (s.attributions?.length) {
          await req.ctx.db.insert(attributions).values(s.attributions.map((a) => ({
            sourceKind: 'split', sourceId: row!.id,
            entityType: a.entityType, entityId: a.entityId,
          }))).onConflictDoNothing();
        }
      }
    }
    const [updated] = await req.ctx.db.update(transactions).set(patch).where(eq(transactions.id, id)).returning();
    return (await hydrate(req.ctx, [updated!]))[0];
  });

  app.delete('/api/v1/transactions/:id', async (req) => {
    requireWrite(req.ctx.user);
    await req.ctx.db.update(transactions).set({ deletedAt: new Date().toISOString(), updatedBy: req.ctx.user!.id })
      .where(eq(transactions.id, (req.params as { id: string }).id));
    return { ok: true };
  });

  /* ── budgets ── */

  app.get('/api/v1/budget/:period', async (req) => {
    const p = period.parse((req.params as { period: string }).period);
    const summary = await monthSummary(req.ctx, p);
    const prev = await monthSummary(req.ctx, addMonths(`${p}-01`, -1).slice(0, 7));
    const prevByCat = new Map(prev.categories.map((c) => [c.categoryId, c]));
    const cats = await req.ctx.db.select().from(categories).where(isNull(categories.deletedAt));
    const ruleById = new Map(cats.map((c) => [c.id, c.rolloverRule]));
    return {
      ...summary,
      categories: summary.categories.map((c) => {
        const rule = c.categoryId ? ruleById.get(c.categoryId) ?? 'none' : 'none';
        const prior = c.categoryId ? prevByCat.get(c.categoryId) : undefined;
        const carry = rule === 'none' || !prior
          ? 0
          : rule === 'carry_positive'
            ? Math.max(prior.remaining, 0)
            : prior.remaining;
        return { ...c, rollover: carry, available: c.allocated + carry - c.spent };
      }),
    };
  });

  app.put('/api/v1/budget/:period/allocations', async (req) => {
    requireWrite(req.ctx.user);
    const p = period.parse((req.params as { period: string }).period);
    const body = z.object({
      allocations: z.array(z.object({ categoryId: z.string(), amount: z.number().int().min(0) })),
    }).parse(req.body);
    for (const a of body.allocations) {
      await req.ctx.db.insert(budgetAllocations)
        .values({ period: p, categoryId: a.categoryId, amount: a.amount, createdBy: req.ctx.user!.id })
        .onConflictDoUpdate({
          target: [budgetAllocations.period, budgetAllocations.categoryId],
          set: { amount: a.amount, updatedBy: req.ctx.user!.id },
        });
    }
    return monthSummary(req.ctx, p);
  });

  app.post('/api/v1/budget/:period/copy-from/:source', async (req) => {
    requireWrite(req.ctx.user);
    const p = period.parse((req.params as { period: string }).period);
    const source = period.parse((req.params as { source: string }).source);
    const body = z.object({ adjustPct: z.number().default(0) }).parse(req.body ?? {});
    const rows = await req.ctx.db.select().from(budgetAllocations)
      .where(and(eq(budgetAllocations.period, source), isNull(budgetAllocations.deletedAt)));
    for (const r of rows) {
      const amount = Math.round(r.amount * (1 + body.adjustPct / 100));
      await req.ctx.db.insert(budgetAllocations)
        .values({ period: p, categoryId: r.categoryId, amount, createdBy: req.ctx.user!.id })
        .onConflictDoUpdate({
          target: [budgetAllocations.period, budgetAllocations.categoryId],
          set: { amount, updatedBy: req.ctx.user!.id },
        });
    }
    return { period: p, copied: rows.length };
  });

  /* ── reports (BUD-006) ── */

  app.get('/api/v1/budget/reports/by-category', async (req) => {
    const q = z.object({ from: dateStr, to: dateStr }).parse(req.query);
    const rows = await req.ctx.db.select({
      categoryId: transactionSplits.categoryId,
      total: sql<number>`sum(${transactionSplits.amount})`,
      count: sql<number>`count(*)`,
    }).from(transactionSplits)
      .innerJoin(transactions, eq(transactions.id, transactionSplits.transactionId))
      .where(and(
        isNull(transactions.deletedAt), eq(transactions.type, 'expense'),
        gte(transactions.date, q.from), lte(transactions.date, q.to),
      )).groupBy(transactionSplits.categoryId);
    const cats = await req.ctx.db.select().from(categories);
    const byId = new Map(cats.map((c) => [c.id, c]));
    return {
      items: rows.map((r) => ({
        categoryId: r.categoryId,
        name: r.categoryId ? byId.get(r.categoryId)?.name ?? 'Unknown' : 'Uncategorised',
        total: Number(r.total), count: Number(r.count),
      })).sort((a, b) => b.total - a.total),
      currency: req.ctx.household.currency,
    };
  });

  app.get('/api/v1/budget/reports/over-time', async (req) => {
    const q = z.object({ from: dateStr, to: dateStr, groupBy: z.enum(['month']).default('month') }).parse(req.query);
    const rows = await req.ctx.db.select({
      month: sql<string>`substr(${transactions.date}, 1, 7)`,
      expense: sql<number>`sum(case when ${transactions.type} = 'expense' then ${transactions.amount} else 0 end)`,
      income: sql<number>`sum(case when ${transactions.type} = 'income' then ${transactions.amount} else 0 end)`,
    }).from(transactions)
      .where(and(isNull(transactions.deletedAt), gte(transactions.date, q.from), lte(transactions.date, q.to)))
      .groupBy(sql`substr(${transactions.date}, 1, 7)`)
      .orderBy(sql`substr(${transactions.date}, 1, 7)`);
    return {
      items: rows.map((r) => ({
        month: r.month, expense: Number(r.expense), income: Number(r.income),
        net: Number(r.income) - Number(r.expense),
      })),
      currency: req.ctx.household.currency,
    };
  });

  /** "Where does the money go?" by what it was for, not just its category. */
  app.get('/api/v1/budget/reports/by-attribution', async (req) => {
    const q = z.object({
      from: dateStr.optional(), to: dateStr.optional(), entityType: z.string().optional(),
    }).parse(req.query);
    const where = [isNull(transactions.deletedAt), eq(transactions.type, 'expense')];
    if (q.from) where.push(gte(transactions.date, q.from));
    if (q.to) where.push(lte(transactions.date, q.to));
    if (q.entityType) where.push(eq(attributions.entityType, q.entityType));
    where.push(eq(attributions.sourceKind, 'split'));
    const rows = await req.ctx.db.select({
      entityType: attributions.entityType,
      entityId: attributions.entityId,
      total: sql<number>`sum(${transactionSplits.amount})`,
      count: sql<number>`count(distinct ${transactions.id})`,
    }).from(attributions)
      .innerJoin(transactionSplits, eq(transactionSplits.id, attributions.sourceId))
      .innerJoin(transactions, eq(transactions.id, transactionSplits.transactionId))
      .where(and(...where))
      .groupBy(attributions.entityType, attributions.entityId);
    const labels = await resolveLabels(req.ctx.db, rows.map((r) => ({ type: r.entityType, id: r.entityId })));
    const byType = new Map<string, number>();
    for (const r of rows) byType.set(r.entityType, (byType.get(r.entityType) ?? 0) + Number(r.total));
    return {
      items: rows.map((r) => ({
        entityType: r.entityType, entityId: r.entityId,
        label: labels.get(`${r.entityType}:${r.entityId}`) ?? r.entityId,
        total: Number(r.total), count: Number(r.count),
      })).sort((a, b) => b.total - a.total),
      byType: [...byType].map(([type, total]) => ({ type, total })).sort((a, b) => b.total - a.total),
      currency: req.ctx.household.currency,
    };
  });

  /* ── recurring bills (BUD-007) ── */

  crudRoutes(app, '/api/v1/bills', {
    table: recurringBills, entityType: 'recurring_bill', label: 'Bill',
    create: z.object({
      name: z.string().trim().min(1),
      payeeId: z.string().nullable().optional(),
      categoryId: z.string().nullable().optional(),
      accountId: z.string().nullable().optional(),
      amount: z.number().int().nullable().optional(),
      variable: z.boolean().optional(),
      leadDays: z.number().int().min(0).max(60).default(5),
      everyMonths: z.number().int().min(1).max(12).default(1),
      meteredUnit: z.string().nullable().optional(),
      emissionFactorKey: z.string().nullable().optional(),
      meterAssetId: z.string().nullable().optional(),
    }),
    update: z.object({
      name: z.string().trim().min(1).optional(),
      amount: z.number().int().nullable().optional(),
      variable: z.boolean().optional(),
      leadDays: z.number().int().min(0).max(60).optional(),
      everyMonths: z.number().int().min(1).max(12).optional(),
      active: z.boolean().optional(),
      categoryId: z.string().nullable().optional(),
      accountId: z.string().nullable().optional(),
      meteredUnit: z.string().nullable().optional(),
      emissionFactorKey: z.string().nullable().optional(),
      meterAssetId: z.string().nullable().optional(),
    }),
    searchColumns: ['name'], filterColumns: ['active', 'categoryId', 'payeeId'],
    hooks: {
      decorate: async (rows, ctx) => {
        const { schedules } = await import('../db/schema.js');
        const ids = rows.map((r) => r.scheduleId).filter(Boolean) as string[];
        const scheds = ids.length ? await ctx.db.select().from(schedules).where(inArray(schedules.id, ids)) : [];
        const byId = new Map(scheds.map((s) => [s.id, s]));
        return rows.map((r) => ({
          ...r,
          nextDue: r.scheduleId ? byId.get(r.scheduleId)?.nextDue ?? null : null,
          monthlySetAside: r.amount ? monthlySetAside(r.amount, r.everyMonths) : null,
          metered: !!r.meteredUnit,
        }));
      },
    },
  });

  app.post('/api/v1/bills/:id/schedule', async (req) => {
    requireWrite(req.ctx.user);
    const id = (req.params as { id: string }).id;
    const body = z.object({ dayOfMonth: z.number().int().min(1).max(31), startDate: dateStr.optional() }).parse(req.body);
    const bill = (await req.ctx.db.select().from(recurringBills).where(eq(recurringBills.id, id)).limit(1))[0];
    if (!bill) throw notFound('Bill');
    const scheduleId = await upsertSchedule(req.ctx, {
      id: bill.scheduleId,
      spec: {
        mode: 'fixed',
        rrule: `FREQ=MONTHLY;INTERVAL=${bill.everyMonths};BYMONTHDAY=${body.dayOfMonth}`,
        anchorDate: body.startDate ?? req.ctx.today,
      },
      originType: 'bill', originId: id,
      template: { title: `Pay ${bill.name}`, priority: 'high' },
      horizonDays: 90,
    });
    await req.ctx.db.update(recurringBills).set({ scheduleId }).where(eq(recurringBills.id, id));
    return { billId: id, scheduleId };
  });

  app.post('/api/v1/bills/:id/pay', async (req, reply) => {
    requireWrite(req.ctx.user);
    const id = (req.params as { id: string }).id;
    const body = z.object({
      amount: z.number().int().positive().optional(),
      date: dateStr.optional(),
      taskId: z.string().optional(),
      accountId: z.string().optional(),
      /** Metered consumption for this period, when the bill carries a meter. */
      quantity: z.number().positive().optional(),
    }).parse(req.body ?? {});
    const bill = (await req.ctx.db.select().from(recurringBills).where(eq(recurringBills.id, id)).limit(1))[0];
    if (!bill) throw notFound('Bill');
    const amount = body.amount ?? bill.amount;
    if (!amount) throw badRequest('This bill varies; give the amount');
    const date = body.date ?? req.ctx.today;
    const { transaction } = await attachCost(req.ctx, {
      amount, date,
      categoryId: bill.categoryId, payeeId: bill.payeeId,
      accountId: body.accountId ?? bill.accountId, memo: bill.name,
      recurringBillId: bill.id, cleared: true,
    });

    // A utility bill is money and energy. Entered once, counted twice (INT-008).
    // If a meter already recorded this period, the bill joins that activity
    // rather than creating a second record of the same kilowatt hours.
    let activity = null;
    let attachedToMeter = null;
    if (bill.meterAssetId) {
      attachedToMeter = await attachCostToMeteredPeriod(req.ctx, {
        meterAssetId: bill.meterAssetId,
        type: bill.emissionFactorKey?.split('.')[0] ?? 'electricity',
        periodEnd: date,
        transactionId: transaction.id,
      });
    }
    if (!attachedToMeter && body.quantity && bill.meteredUnit) {
      activity = await tryRecordActivity(req.ctx, {
        type: bill.emissionFactorKey?.split('.')[0] ?? 'electricity',
        amount: body.quantity,
        unit: bill.meteredUnit,
        occurredOn: date,
        factorKey: bill.emissionFactorKey,
        transactionId: transaction.id,
        sourceType: 'recurring_bill',
        sourceId: bill.id,
        note: `${bill.name} for the period ending ${date}`,
        attributions: bill.meterAssetId ? [{ entityType: 'asset', entityId: bill.meterAssetId }] : [],
      });
    }
    if (body.taskId) {
      const { completeTask } = await import('../services/tasks.js');
      await completeTask(req.ctx, body.taskId, { completedAt: date });
    }
    reply.status(201);
    return {
      billId: id, transactionId: transaction.id, amount,
      activityId: activity?.activity.id ?? attachedToMeter?.id ?? null,
      gCo2e: activity?.gCo2e ?? null,
      attachedToMeterReading: !!attachedToMeter,
    };
  });

  app.get('/api/v1/bills/upcoming', async (req) => {
    const { schedules } = await import('../db/schema.js');
    const q = z.object({ days: z.coerce.number().int().min(1).max(120).default(14) }).parse(req.query);
    const cutoff = addMonths(req.ctx.today, 0);
    void cutoff;
    const rows = await req.ctx.db.select({ bill: recurringBills, schedule: schedules })
      .from(recurringBills).leftJoin(schedules, eq(schedules.id, recurringBills.scheduleId))
      .where(and(eq(recurringBills.active, true), isNull(recurringBills.deletedAt)));
    const payeeIds = [...new Set(rows.map((r) => r.bill.payeeId).filter(Boolean))] as string[];
    const payeeRows = payeeIds.length
      ? await req.ctx.db.select().from(payees).where(inArray(payees.id, payeeIds)) : [];
    const payeeName = new Map(payeeRows.map((p) => [p.id, p.name]));
    const { addDays, diffDays } = await import('@homestead/shared');
    const limit = addDays(req.ctx.today, q.days);
    return {
      items: rows
        .filter((r) => r.schedule?.nextDue && r.schedule.nextDue <= limit)
        .map((r) => ({
          id: r.bill.id, name: r.bill.name,
          payee: r.bill.payeeId ? payeeName.get(r.bill.payeeId) ?? null : null,
          amount: r.bill.amount, variable: r.bill.variable,
          dueDate: r.schedule!.nextDue!,
          daysLeft: diffDays(r.schedule!.nextDue!, req.ctx.today),
        }))
        .sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
      currency: req.ctx.household.currency,
    };
  });

  /* ── goals (BUD-013) ── */

  crudRoutes(app, '/api/v1/goals', {
    table: goals, entityType: 'goal', label: 'Goal',
    create: z.object({
      name: z.string().trim().min(1),
      targetAmount: z.number().int().positive(),
      targetDate: dateStr.nullable().optional(),
      accountId: z.string().nullable().optional(),
      notesMd: z.string().nullable().optional(),
    }),
    update: z.object({
      name: z.string().trim().min(1).optional(),
      targetAmount: z.number().int().positive().optional(),
      targetDate: dateStr.nullable().optional(),
      status: z.string().optional(),
      notesMd: z.string().nullable().optional(),
    }),
    searchColumns: ['name'], filterColumns: ['status'],
    hooks: {
      decorate: async (rows, ctx) => {
        const ids = rows.map((r) => r.id);
        const { spentOnMany } = await import('../services/budget.js');
        const contributed = await spentOnMany(ctx, 'goal', ids);
        return rows.map((r) => {
          const saved = contributed.get(r.id) ?? 0;
          return {
            ...r, saved,
            remaining: r.targetAmount - saved,
            pct: r.targetAmount > 0 ? Math.round((saved / r.targetAmount) * 100) : 0,
          };
        });
      },
    },
  });

  /* ── CSV import (BUD-008) ── */

  app.post('/api/v1/transactions/import/preview', async (req) => {
    requireWrite(req.ctx.user);
    const body = z.object({
      csv: z.string().min(1),
      mapping: z.object({
        date: z.string(), amount: z.string(), payee: z.string().optional(),
        memo: z.string().optional(), debitCredit: z.string().optional(),
      }),
      dateFormat: z.enum(['iso', 'us', 'eu']).default('iso'),
      invertAmount: z.boolean().default(false),
      accountId: z.string().optional(),
    }).parse(req.body);

    const rows = parseCsv(body.csv);
    if (!rows.length) throw badRequest('No rows found in that CSV');
    const header = rows[0]!;
    const idx = (col: string) => header.findIndex((h) => h.trim().toLowerCase() === col.trim().toLowerCase());
    const di = idx(body.mapping.date);
    const ai = idx(body.mapping.amount);
    if (di < 0 || ai < 0) throw badRequest('The date or amount column was not found');
    const pi = body.mapping.payee ? idx(body.mapping.payee) : -1;
    const mi = body.mapping.memo ? idx(body.mapping.memo) : -1;

    const parsed = [];
    for (const row of rows.slice(1)) {
      if (!row[di] && !row[ai]) continue;
      const date = normaliseDate(row[di] ?? '', body.dateFormat);
      if (!date) continue;
      let amount: number;
      try { amount = parseMoney(row[ai] ?? '0'); } catch { continue; }
      if (body.invertAmount) amount = -amount;
      const type = amount < 0 ? 'expense' : 'income';
      const abs = Math.abs(amount);
      const payee = pi >= 0 ? (row[pi] ?? '').trim() : '';
      const memo = mi >= 0 ? (row[mi] ?? '').trim() : '';
      parsed.push({
        date, amount: abs, type, payee, memo,
        importHash: importHash(date, abs, payee, body.accountId),
      });
    }
    const hashes = parsed.map((p) => p.importHash);
    const existing = hashes.length
      ? await req.ctx.db.select({ h: transactions.importHash }).from(transactions)
        .where(inArray(transactions.importHash, hashes))
      : [];
    const dupes = new Set(existing.map((e) => e.h));
    return {
      rows: parsed.map((p) => ({ ...p, duplicate: dupes.has(p.importHash) })),
      total: parsed.length,
      duplicates: parsed.filter((p) => dupes.has(p.importHash)).length,
      columns: header,
    };
  });

  app.post('/api/v1/transactions/import/commit', async (req, reply) => {
    requireWrite(req.ctx.user);
    const body = z.object({
      accountId: z.string().optional(),
      rows: z.array(z.object({
        date: dateStr, amount: z.number().int().positive(),
        type: z.enum(TRANSACTION_TYPES), payee: z.string().optional(),
        memo: z.string().optional(), categoryId: z.string().nullable().optional(),
        importHash: z.string(),
      })).min(1),
    }).parse(req.body);

    let imported = 0; let skipped = 0;
    for (const r of body.rows) {
      const dupe = await req.ctx.db.select({ id: transactions.id }).from(transactions)
        .where(eq(transactions.importHash, r.importHash)).limit(1);
      if (dupe.length) { skipped++; continue; }
      await attachCost(req.ctx, {
        date: r.date, amount: r.amount, type: r.type,
        accountId: body.accountId ?? null, payeeName: r.payee || null,
        categoryId: r.categoryId ?? null, memo: r.memo || null,
        importHash: r.importHash, cleared: true,
      });
      imported++;
    }
    reply.status(201);
    return { imported, skipped };
  });

  /** Long-range planning: replacements, project ideas and goals by year (BUD-030). */
  app.get('/api/v1/budget/long-range', async (req) => {
    const q = z.object({ years: z.coerce.number().int().min(1).max(20).default(10) }).parse(req.query);
    const thisYear = Number(req.ctx.today.slice(0, 4));
    const assetRows = await req.ctx.db.select().from(assets)
      .where(and(isNull(assets.deletedAt), eq(assets.status, 'active')));
    const projectRows = await req.ctx.db.select().from(projects)
      .where(and(eq(projects.status, 'idea'), isNull(projects.deletedAt)));
    const goalRows = await req.ctx.db.select().from(goals)
      .where(and(eq(goals.status, 'active'), isNull(goals.deletedAt)));

    const byYear = new Map<number, { year: number; items: Array<{ kind: string; label: string; amount: number }> }>();
    const push = (year: number, kind: string, label: string, amount: number) => {
      if (year < thisYear) year = thisYear;
      if (year > thisYear + q.years) return;
      const bucket = byYear.get(year) ?? { year, items: [] };
      bucket.items.push({ kind, label, amount });
      byYear.set(year, bucket);
    };
    for (const a of assetRows) {
      const start = a.installedDate ?? a.purchaseDate;
      if (!start || !a.expectedLifespanYears) continue;
      push(Number(start.slice(0, 4)) + a.expectedLifespanYears, 'asset_replacement', a.name,
        a.replacementCostEstimate ?? a.purchasePrice ?? 0);
    }
    for (const p of projectRows) {
      push(p.targetStart ? Number(p.targetStart.slice(0, 4)) : thisYear + 1, 'project', p.name,
        p.estimateCost ?? p.budgetAmount ?? 0);
    }
    for (const g of goalRows) {
      push(g.targetDate ? Number(g.targetDate.slice(0, 4)) : thisYear + 1, 'goal', g.name, g.targetAmount);
    }
    return {
      years: [...byYear.values()]
        .map((y) => ({ ...y, total: y.items.reduce((a, b) => a + b.amount, 0) }))
        .sort((a, b) => a.year - b.year),
      currency: req.ctx.household.currency,
    };
  });

  /* Paying a bill task marks the bill paid (TASK-007 origin hook). */
  onTaskComplete('bill', async (ctx, task, payload) => {
    if (!task.originId) return null;
    const bill = (await ctx.db.select().from(recurringBills)
      .where(eq(recurringBills.id, task.originId)).limit(1))[0];
    if (!bill) return null;
    const extra = (payload.extra ?? {}) as { amount?: number; skipTransaction?: boolean };
    if (extra.skipTransaction) return null;
    const amount = extra.amount ?? bill.amount;
    if (!amount) return { needsAmount: true, billId: bill.id };
    const { transaction } = await attachCost(ctx, {
      amount, date: payload.completedAt ?? ctx.today,
      categoryId: bill.categoryId, payeeId: bill.payeeId, accountId: bill.accountId,
      memo: bill.name, recurringBillId: bill.id, cleared: true,
    });
    return { transactionId: transaction.id, amount };
  });
}

async function hydrate(ctx: any, rows: Array<typeof transactions.$inferSelect>): Promise<any[]> {
  if (!rows.length) return rows;
  const ids = rows.map((r) => r.id);
  const splits = await ctx.db.select().from(transactionSplits)
    .where(inArray(transactionSplits.transactionId, ids)).orderBy(asc(transactionSplits.sort));
  const splitIds = splits.map((s: any) => s.id);
  const attrs = splitIds.length
    ? await ctx.db.select().from(attributions).where(and(
      eq(attributions.sourceKind, 'split'), inArray(attributions.sourceId, splitIds),
    ))
    : [];
  const labels = await resolveLabels(ctx.db, attrs.map((a: any) => ({ type: a.entityType, id: a.entityId })));
  const payeeIds = [...new Set(rows.map((r) => r.payeeId).filter(Boolean))] as string[];
  const payeeRows = payeeIds.length
    ? await ctx.db.select().from(payees).where(inArray(payees.id, payeeIds)) : [];
  const payeeName = new Map(payeeRows.map((p: any) => [p.id, p.name]));
  const catIds = [...new Set(splits.map((s: any) => s.categoryId).filter(Boolean))] as string[];
  const catRows = catIds.length
    ? await ctx.db.select().from(categories).where(inArray(categories.id, catIds)) : [];
  const catName = new Map(catRows.map((c: any) => [c.id, c.name]));

  return rows.map((t) => {
    const mine = splits.filter((s: any) => s.transactionId === t.id);
    return {
      ...t,
      payeeName: t.payeeId ? payeeName.get(t.payeeId) ?? null : null,
      splits: mine.map((s: any) => ({
        ...s,
        categoryName: s.categoryId ? catName.get(s.categoryId) ?? null : null,
        attributions: attrs.filter((a: any) => a.sourceId === s.id).map((a: any) => ({
          entityType: a.entityType, entityId: a.entityId,
          label: labels.get(`${a.entityType}:${a.entityId}`) ?? a.entityId,
        })),
      })),
    };
  });
}

/** Small RFC 4180 reader: quoted fields, embedded commas and newlines. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
      continue;
    }
    if (c === '"') { inQuotes = true; continue; }
    if (c === ',') { row.push(field); field = ''; continue; }
    if (c === '\r') continue;
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}

export function normaliseDate(raw: string, format: 'iso' | 'us' | 'eu'): string | null {
  const s = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (!m) return null;
  const a = Number(m[1]); const b = Number(m[2]);
  let y = Number(m[3]);
  if (y < 100) y += y < 70 ? 2000 : 1900;
  const [month, day] = format === 'eu' ? [b, a] : [a, b];
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function importHash(date: string, amount: number, payee: string, accountId?: string): string {
  return createHash('sha256')
    .update([date, amount, payee.toLowerCase().trim(), accountId ?? ''].join('|'))
    .digest('hex').slice(0, 32);
}

export { monthOf, monthRange, pets };
