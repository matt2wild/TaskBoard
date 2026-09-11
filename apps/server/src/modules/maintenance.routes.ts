/* eslint-disable @typescript-eslint/no-explicit-any */
import type { FastifyInstance } from 'fastify';
import { and, asc, desc, eq, inArray, isNull, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  MAINTENANCE_KINDS, PRIORITY, addDays, describeSchedule, diffDays, dueStatus, seasonOf,
} from '@homestead/shared';
import {
  assets, maintenancePlans, maintenanceRecords, maintenanceTemplates, planConsumables, planTools,
  products, schedules, tasks, warranties,
} from '../db/schema.js';
import { crudRoutes } from '../core/crud.js';
import { requireWrite } from '../core/auth.js';
import { badRequest, notFound } from '../core/errors.js';
import { specOf, upsertSchedule, deactivateSchedulesFor, materialiseSchedule } from '../services/tasks.js';
import { applyTemplates, planReadiness, recordMaintenance } from '../services/maintenance.js';
import { spentOnMany } from '../services/budget.js';

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const scheduleSpec = z.object({
  mode: z.enum(['one_off', 'fixed', 'floating', 'on_demand']),
  rrule: z.string().nullable().optional(),
  anchorDate: dateStr.nullable().optional(),
  every: z.record(z.number().int().positive()).nullable().optional(),
  timeOfDay: z.string().nullable().optional(),
  graceDays: z.number().int().min(0).max(90).nullable().optional(),
  untilDate: dateStr.nullable().optional(),
});

export function maintenanceRoutes(app: FastifyInstance): void {
  const planShape = {
    targetType: z.enum(['asset', 'location', 'property', 'pet']).default('asset'),
    targetId: z.string().min(1),
    title: z.string().trim().min(1),
    descriptionMd: z.string().nullable().optional(),
    estimateMin: z.number().int().nullable().optional(),
    estimateCost: z.number().int().nullable().optional(),
    priority: z.enum(PRIORITY).default('normal'),
    diy: z.boolean().optional(),
    vendorContactId: z.string().nullable().optional(),
    assigneeUserId: z.string().nullable().optional(),
    checklist: z.array(z.string()).nullable().optional(),
    seasonTags: z.array(z.string()).nullable().optional(),
    graceDays: z.number().int().min(0).max(90).nullable().optional(),
    readingTrigger: z.object({
      metric: z.string(), op: z.enum(['lt', 'gt']), value: z.number(),
    }).nullable().optional(),
    instructionsMd: z.string().nullable().optional(),
    active: z.boolean().optional(),
  };

  const planCrud = crudRoutes(app, '/api/v1/maintenance/plans', {
    table: maintenancePlans, entityType: 'maintenance_plan', label: 'Maintenance plan',
    create: z.object(planShape),
    update: z.object(planShape).partial(),
    searchColumns: ['title', 'descriptionMd'],
    filterColumns: ['targetType', 'targetId', 'active', 'diy', 'vendorContactId'],
    sortColumns: ['title', 'createdAt'],
    hooks: {
      decorate: async (rows, ctx) => {
        const scheduleIds = rows.map((r) => r.scheduleId).filter(Boolean) as string[];
        const scheds = scheduleIds.length
          ? await ctx.db.select().from(schedules).where(inArray(schedules.id, scheduleIds))
          : [];
        const byId = new Map(scheds.map((s) => [s.id, s]));
        const targetIds = rows.map((r) => r.targetId);
        const names = targetIds.length
          ? await ctx.db.select({ id: assets.id, name: assets.name }).from(assets).where(inArray(assets.id, targetIds))
          : [];
        const nameById = new Map(names.map((n) => [n.id, n.name]));
        return rows.map((r) => {
          const s = r.scheduleId ? byId.get(r.scheduleId) : null;
          return {
            ...r,
            targetName: nameById.get(r.targetId) ?? null,
            schedule: s ? { ...s, description: describeSchedule(specOf(s)) } : null,
            nextDue: s?.nextDue ?? null,
            lastCompletedAt: s?.lastCompletedAt ?? null,
            dueStatus: dueStatus(s?.nextDue ?? null, ctx.today, { graceDays: r.graceDays ?? s?.graceDays }),
          };
        });
      },
      beforeDelete: async (row, ctx) => { await deactivateSchedulesFor(ctx, 'maintenance', row.id); },
    },
  });

  /** Create a plan and its schedule together: a plan without one is inert. */
  app.post('/api/v1/maintenance/plans/full', async (req, reply) => {
    requireWrite(req.ctx.user);
    const body = z.object({
      plan: z.object(planShape),
      schedule: scheduleSpec,
      tools: z.array(z.string()).optional(),
      consumables: z.array(z.object({
        productId: z.string(), quantity: z.number().positive().default(1), unit: z.string().default('ea'),
      })).optional(),
    }).parse(req.body);

    const plan = await planCrud.create(req.ctx, body.plan);
    const target = body.plan.targetType === 'asset'
      ? (await req.ctx.db.select().from(assets).where(eq(assets.id, body.plan.targetId)).limit(1))[0]
      : null;
    const scheduleId = await upsertSchedule(req.ctx, {
      spec: body.schedule as any,
      originType: 'maintenance',
      originId: plan.id,
      template: {
        title: target ? `${body.plan.title} — ${target.name}` : body.plan.title,
        descriptionMd: body.plan.descriptionMd ?? null,
        priority: body.plan.priority,
        estimateMin: body.plan.estimateMin ?? null,
        checklist: body.plan.checklist ?? [],
        assignees: body.plan.assigneeUserId ? [body.plan.assigneeUserId] : [],
        propertyId: target?.propertyId ?? null,
        locationId: target?.locationId ?? null,
      },
    });
    await req.ctx.db.update(maintenancePlans).set({ scheduleId }).where(eq(maintenancePlans.id, plan.id));
    if (body.tools?.length) {
      await req.ctx.db.insert(planTools)
        .values(body.tools.map((assetId) => ({ planId: plan.id, assetId }))).onConflictDoNothing();
    }
    if (body.consumables?.length) {
      await req.ctx.db.insert(planConsumables)
        .values(body.consumables.map((c) => ({ planId: plan.id, ...c })));
    }
    reply.status(201);
    return planCrud.get(req.ctx, plan.id);
  });

  app.get('/api/v1/maintenance/plans/:id/readiness', async (req) =>
    planReadiness(req.ctx, (req.params as { id: string }).id));

  app.put('/api/v1/maintenance/plans/:id/tools', async (req) => {
    requireWrite(req.ctx.user);
    const id = (req.params as { id: string }).id;
    const body = z.object({ assetIds: z.array(z.string()) }).parse(req.body);
    await req.ctx.db.delete(planTools).where(eq(planTools.planId, id));
    if (body.assetIds.length) {
      await req.ctx.db.insert(planTools).values(body.assetIds.map((assetId) => ({ planId: id, assetId })));
    }
    return { planId: id, assetIds: body.assetIds };
  });

  app.put('/api/v1/maintenance/plans/:id/consumables', async (req) => {
    requireWrite(req.ctx.user);
    const id = (req.params as { id: string }).id;
    const body = z.object({
      items: z.array(z.object({
        productId: z.string(), quantity: z.number().positive().default(1), unit: z.string().default('ea'),
      })),
    }).parse(req.body);
    await req.ctx.db.delete(planConsumables).where(eq(planConsumables.planId, id));
    if (body.items.length) {
      await req.ctx.db.insert(planConsumables).values(body.items.map((c) => ({ planId: id, ...c })));
    }
    return { planId: id, items: body.items };
  });

  app.get('/api/v1/maintenance/plans/:id/consumables', async (req) => {
    const id = (req.params as { id: string }).id;
    const rows = await req.ctx.db.select({ pc: planConsumables, product: products })
      .from(planConsumables).innerJoin(products, eq(products.id, planConsumables.productId))
      .where(eq(planConsumables.planId, id));
    return { items: rows.map((r) => ({ ...r.pc, product: r.product })) };
  });

  /* ── the upcoming / seasonal view (MAINT-006) ── */

  app.get('/api/v1/maintenance/upcoming', async (req) => {
    const q = z.object({
      days: z.coerce.number().int().min(1).max(400).default(60),
      groupBy: z.enum(['date', 'season', 'asset']).default('date'),
    }).parse(req.query);
    const cutoff = addDays(req.ctx.today, q.days);
    const rows = await req.ctx.db.select({ plan: maintenancePlans, schedule: schedules })
      .from(maintenancePlans).innerJoin(schedules, eq(schedules.id, maintenancePlans.scheduleId))
      .where(and(
        eq(maintenancePlans.active, true), isNull(maintenancePlans.deletedAt),
        sql`${schedules.nextDue} is not null`, lte(schedules.nextDue, cutoff),
      )).orderBy(asc(schedules.nextDue));

    const assetIds = [...new Set(rows.filter((r) => r.plan.targetType === 'asset').map((r) => r.plan.targetId))];
    const assetRows = assetIds.length
      ? await req.ctx.db.select({ id: assets.id, name: assets.name }).from(assets).where(inArray(assets.id, assetIds))
      : [];
    const names = new Map(assetRows.map((a) => [a.id, a.name]));

    const items = rows.map((r) => ({
      planId: r.plan.id,
      title: r.plan.title,
      targetType: r.plan.targetType,
      targetId: r.plan.targetId,
      targetName: names.get(r.plan.targetId) ?? null,
      dueDate: r.schedule.nextDue!,
      daysLeft: diffDays(r.schedule.nextDue!, req.ctx.today),
      season: seasonOf(r.schedule.nextDue!),
      estimateMin: r.plan.estimateMin,
      estimateCost: r.plan.estimateCost,
      diy: r.plan.diy,
      status: dueStatus(r.schedule.nextDue, req.ctx.today, { graceDays: r.plan.graceDays ?? r.schedule.graceDays }),
      description: describeSchedule(specOf(r.schedule)),
    }));

    if (q.groupBy === 'date') return { items, today: req.ctx.today };
    const key = (i: typeof items[number]) => (q.groupBy === 'season' ? i.season : i.targetName ?? 'Property');
    const groups = new Map<string, typeof items>();
    for (const i of items) {
      const g = groups.get(key(i)) ?? [];
      g.push(i);
      groups.set(key(i), g);
    }
    return { groups: [...groups].map(([name, list]) => ({ name, items: list })), today: req.ctx.today };
  });

  /* ── records (MAINT-004) ── */

  crudRoutes(app, '/api/v1/maintenance/records', {
    table: maintenanceRecords, entityType: 'maintenance_record', label: 'Maintenance record',
    create: z.object({
      planId: z.string().nullable().optional(),
      targetType: z.string().default('asset'),
      targetId: z.string().min(1),
      taskId: z.string().nullable().optional(),
      kind: z.enum(MAINTENANCE_KINDS).default('adhoc'),
      title: z.string().trim().min(1),
      performedAt: dateStr,
      performerContactId: z.string().nullable().optional(),
      minutes: z.number().int().nullable().optional(),
      notesMd: z.string().nullable().optional(),
      failureDescription: z.string().nullable().optional(),
      cause: z.string().nullable().optional(),
    }),
    update: z.object({
      title: z.string().trim().min(1).optional(),
      performedAt: dateStr.optional(),
      minutes: z.number().int().nullable().optional(),
      notesMd: z.string().nullable().optional(),
      failureDescription: z.string().nullable().optional(),
      cause: z.string().nullable().optional(),
    }),
    searchColumns: ['title', 'notesMd', 'failureDescription'],
    filterColumns: ['targetType', 'targetId', 'planId', 'kind', 'performedAt'],
    sortColumns: ['performedAt', 'createdAt'],
    defaultSort: { column: 'performedAt', dir: 'desc' },
  });

  /** Log work with all its side effects in one call (the completion sheet). */
  app.post('/api/v1/maintenance/log', async (req, reply) => {
    requireWrite(req.ctx.user);
    const body = z.object({
      planId: z.string().nullable().optional(),
      targetType: z.string().default('asset'),
      targetId: z.string().min(1),
      taskId: z.string().nullable().optional(),
      title: z.string().trim().min(1),
      performedAt: dateStr.optional(),
      minutes: z.number().int().nullable().optional(),
      kind: z.enum(MAINTENANCE_KINDS).optional(),
      notesMd: z.string().optional(),
      performerContactId: z.string().nullable().optional(),
      cost: z.object({
        amount: z.number().int().positive(),
        categoryId: z.string().optional(),
        payeeName: z.string().optional(),
        accountId: z.string().optional(),
        memo: z.string().optional(),
      }).optional(),
      consumables: z.array(z.object({
        productId: z.string(), quantity: z.number().positive(), unit: z.string().optional(),
      })).optional(),
      readings: z.array(z.object({
        metric: z.string(), value: z.number(), unit: z.string().optional(),
      })).optional(),
      refrigerant: z.object({
        type: z.string().trim().min(2), kg: z.number().positive(),
      }).optional(),
    }).parse(req.body);
    const { planId, targetType, targetId, taskId, title, performedAt, minutes, ...extra } = body;
    const result = await recordMaintenance(req.ctx, {
      planId, targetType, targetId, taskId, title, performedAt, minutes, extra,
    });
    reply.status(201);
    return result;
  });

  /* ── template library (MAINT-005) ── */

  app.get('/api/v1/maintenance/templates', async (req) => {
    const q = z.object({ categorySlug: z.string().optional() }).parse(req.query);
    const where = [isNull(maintenanceTemplates.deletedAt)];
    if (q.categorySlug) where.push(eq(maintenanceTemplates.categorySlug, q.categorySlug));
    const rows = await req.ctx.db.select().from(maintenanceTemplates).where(and(...where))
      .orderBy(asc(maintenanceTemplates.categorySlug), asc(maintenanceTemplates.title));
    return {
      items: rows.map((t) => ({
        ...t,
        description: describeSchedule({ mode: t.mode as any, rrule: t.rrule, every: t.every as any, anchorDate: req.ctx.today }),
      })),
    };
  });

  app.get('/api/v1/assets/:id/template-suggestions', async (req) => {
    const id = (req.params as { id: string }).id;
    const asset = (await req.ctx.db.select().from(assets).where(eq(assets.id, id)).limit(1))[0];
    if (!asset) throw notFound('Asset');
    if (!asset.categoryId) return { items: [], categorySlug: null };
    const { assetCategories } = await import('../db/schema.js');
    const cat = (await req.ctx.db.select().from(assetCategories)
      .where(eq(assetCategories.id, asset.categoryId)).limit(1))[0];
    if (!cat) return { items: [], categorySlug: null };
    const existing = await req.ctx.db.select({ title: maintenancePlans.title }).from(maintenancePlans)
      .where(and(eq(maintenancePlans.targetType, 'asset'), eq(maintenancePlans.targetId, id), isNull(maintenancePlans.deletedAt)));
    const have = new Set(existing.map((e) => e.title.toLowerCase()));
    const rows = await req.ctx.db.select().from(maintenanceTemplates)
      .where(and(eq(maintenanceTemplates.categorySlug, cat.slug), isNull(maintenanceTemplates.deletedAt)));
    return {
      categorySlug: cat.slug,
      items: rows.map((t) => ({
        ...t,
        alreadyApplied: have.has(t.title.toLowerCase()),
        description: describeSchedule({ mode: t.mode as any, rrule: t.rrule, every: t.every as any, anchorDate: req.ctx.today }),
      })),
    };
  });

  app.post('/api/v1/assets/:id/apply-templates', async (req, reply) => {
    requireWrite(req.ctx.user);
    const id = (req.params as { id: string }).id;
    const body = z.object({ templateIds: z.array(z.string()).min(1) }).parse(req.body);
    const made = await applyTemplates(req.ctx, id, body.templateIds);
    reply.status(201);
    return { created: made };
  });

  /* ── warranty watch (MAINT-008) ── */

  app.get('/api/v1/maintenance/warranties/expiring', async (req) => {
    const q = z.object({ days: z.coerce.number().int().min(1).max(400).default(60) }).parse(req.query);
    const cutoff = addDays(req.ctx.today, q.days);
    const rows = await req.ctx.db.select({ w: warranties, asset: assets })
      .from(warranties).innerJoin(assets, eq(assets.id, warranties.assetId))
      .where(and(isNull(warranties.deletedAt), lte(warranties.endDate, cutoff), isNull(assets.deletedAt)))
      .orderBy(asc(warranties.endDate));
    return {
      items: rows.map((r) => ({
        warrantyId: r.w.id, assetId: r.asset.id, assetName: r.asset.name,
        expiry: r.w.endDate, daysLeft: diffDays(r.w.endDate, req.ctx.today),
        type: r.w.type, expired: r.w.endDate < req.ctx.today,
      })),
    };
  });

  /* ── cost reporting (MAINT-012) ── */

  app.get('/api/v1/maintenance/costs', async (req) => {
    const q = z.object({ from: dateStr.optional(), to: dateStr.optional() }).parse(req.query);
    const where = [isNull(maintenanceRecords.deletedAt)];
    if (q.from) where.push(sql`${maintenanceRecords.performedAt} >= ${q.from}`);
    if (q.to) where.push(sql`${maintenanceRecords.performedAt} <= ${q.to}`);
    const records = await req.ctx.db.select().from(maintenanceRecords).where(and(...where));
    const spend = await spentOnMany(req.ctx, 'maintenance_record', records.map((r) => r.id));

    const byTarget = new Map<string, { targetType: string; targetId: string; total: number; count: number }>();
    const byMonth = new Map<string, number>();
    for (const r of records) {
      const amount = spend.get(r.id) ?? 0;
      const key = `${r.targetType}:${r.targetId}`;
      const cur = byTarget.get(key) ?? { targetType: r.targetType, targetId: r.targetId, total: 0, count: 0 };
      cur.total += amount; cur.count += 1;
      byTarget.set(key, cur);
      const m = r.performedAt.slice(0, 7);
      byMonth.set(m, (byMonth.get(m) ?? 0) + amount);
    }
    const assetIds = [...byTarget.values()].filter((t) => t.targetType === 'asset').map((t) => t.targetId);
    const names = assetIds.length
      ? await req.ctx.db.select({ id: assets.id, name: assets.name }).from(assets).where(inArray(assets.id, assetIds))
      : [];
    const nameById = new Map(names.map((n) => [n.id, n.name]));
    return {
      total: [...byTarget.values()].reduce((a, b) => a + b.total, 0),
      currency: req.ctx.household.currency,
      byTarget: [...byTarget.values()]
        .map((t) => ({ ...t, name: nameById.get(t.targetId) ?? t.targetId }))
        .sort((a, b) => b.total - a.total),
      byMonth: [...byMonth].sort().map(([month, total]) => ({ month, total })),
    };
  });

  app.post('/api/v1/maintenance/plans/:id/skip', async (req) => {
    requireWrite(req.ctx.user);
    const id = (req.params as { id: string }).id;
    const plan = (await req.ctx.db.select().from(maintenancePlans).where(eq(maintenancePlans.id, id)).limit(1))[0];
    if (!plan?.scheduleId) throw badRequest('That plan has no schedule');
    const open = await req.ctx.db.select().from(tasks).where(and(
      eq(tasks.scheduleId, plan.scheduleId), inArray(tasks.status, ['open', 'in_progress', 'blocked']), isNull(tasks.deletedAt),
    ));
    for (const t of open) {
      await req.ctx.db.update(tasks).set({ status: 'cancelled', updatedBy: req.ctx.user!.id }).where(eq(tasks.id, t.id));
    }
    await req.ctx.db.update(schedules)
      .set({ lastCompletedAt: req.ctx.today }).where(eq(schedules.id, plan.scheduleId));
    return materialiseSchedule(req.ctx, plan.scheduleId);
  });
}
