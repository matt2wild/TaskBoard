/* eslint-disable @typescript-eslint/no-explicit-any */
import type { FastifyInstance } from 'fastify';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { ASSET_CONDITION, LOAN_DIRECTIONS, addDays, diffDays } from '@homestead/shared';
import {
  assets, contacts, loans, storageCategories, storageItems, tasks, toolProfiles,
} from '../db/schema.js';
import { crudRoutes } from '../core/crud.js';
import { requireWrite } from '../core/auth.js';
import { badRequest, notFound } from '../core/errors.js';
import { attachCost } from '../services/budget.js';
import { tryRecordActivity, WASTE_FACTOR_BY_METHOD } from '../services/carbon.js';
import { locationPaths } from './core.routes.js';

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export function storageRoutes(app: FastifyInstance): void {
  crudRoutes(app, '/api/v1/storage-categories', {
    table: storageCategories, entityType: 'category', label: 'Storage category',
    create: z.object({
      name: z.string().trim().min(1), slug: z.string().trim().min(1),
      parentId: z.string().nullable().optional(), sort: z.number().int().optional(),
    }),
    update: z.object({ name: z.string().trim().min(1).optional(), sort: z.number().int().optional() }),
    searchColumns: ['name'], filterColumns: ['parentId', 'slug'],
  });

  const itemShape = {
    locationId: z.string().nullable().optional(),
    categoryId: z.string().nullable().optional(),
    name: z.string().trim().min(1),
    description: z.string().nullable().optional(),
    quantity: z.number().positive().default(1),
    unit: z.string().default('ea'),
    estValue: z.number().int().nullable().optional(),
    purchaseDate: dateStr.nullable().optional(),
    purchasePrice: z.number().int().nullable().optional(),
    condition: z.enum(ASSET_CONDITION).default('good'),
    reviewBy: dateStr.nullable().optional(),
    projectId: z.string().nullable().optional(),
    notesMd: z.string().nullable().optional(),
  };

  crudRoutes(app, '/api/v1/storage-items', {
    table: storageItems, entityType: 'storage_item', label: 'Storage item',
    create: z.object(itemShape),
    update: z.object(itemShape).partial(),
    searchColumns: ['name', 'description', 'notesMd'],
    filterColumns: ['locationId', 'categoryId', 'status', 'projectId', 'condition', 'reviewBy'],
    sortColumns: ['name', 'createdAt', 'estValue', 'reviewBy'],
    hooks: {
      decorate: async (rows, ctx) => {
        const paths = await locationPaths(ctx.db, rows.map((r) => r.locationId).filter(Boolean) as string[]);
        const open = await ctx.db.select().from(loans).where(and(
          eq(loans.itemType, 'storage_item'),
          inArray(loans.itemId, rows.map((r) => r.id)),
          isNull(loans.returnedAt), isNull(loans.deletedAt),
        ));
        const loanByItem = new Map(open.map((l) => [l.itemId, l]));
        return rows.map((r) => ({
          ...r,
          locationPath: r.locationId ? paths.get(r.locationId) ?? null : null,
          unlocated: !r.locationId,
          loan: loanByItem.get(r.id) ?? null,
        }));
      },
      afterUpdate: async (row, before, ctx) => {
        if (row.locationId !== before.locationId) {
          const { logActivity } = await import('../core/activity.js');
          await logActivity(ctx.db, {
            userId: ctx.user?.id, action: 'move', entityType: 'storage_item', entityId: row.id,
            summary: `Moved ${row.name}`,
          });
        }
      },
    },
  });

  /** The unsorted inbox: things captured without a home yet (STOR-002). */
  app.get('/api/v1/storage-items/unsorted', async (req) => {
    const rows = await req.ctx.db.select().from(storageItems)
      .where(and(isNull(storageItems.locationId), isNull(storageItems.deletedAt)))
      .orderBy(asc(storageItems.createdAt));
    return { items: rows };
  });

  app.post('/api/v1/storage-items/move', async (req) => {
    requireWrite(req.ctx.user);
    const body = z.object({
      ids: z.array(z.string()).min(1).max(500), locationId: z.string().nullable(),
    }).parse(req.body);
    await req.ctx.db.update(storageItems)
      .set({ locationId: body.locationId, updatedBy: req.ctx.user!.id })
      .where(inArray(storageItems.id, body.ids));
    return { moved: body.ids.length, locationId: body.locationId };
  });

  /** Insurance inventory (STOR-007): what it is, where it is, what it is worth. */
  app.get('/api/v1/storage/valuation', async (req) => {
    const [items, assetRows] = await Promise.all([
      req.ctx.db.select().from(storageItems).where(isNull(storageItems.deletedAt)),
      req.ctx.db.select().from(assets).where(isNull(assets.deletedAt)),
    ]);
    const locIds = [...new Set([
      ...items.map((i) => i.locationId), ...assetRows.map((a) => a.locationId),
    ].filter(Boolean))] as string[];
    const paths = await locationPaths(req.ctx.db, locIds);
    const rows = [
      ...items.map((i) => ({
        kind: 'storage_item' as const, id: i.id, name: i.name,
        value: i.estValue ?? i.purchasePrice ?? 0, quantity: i.quantity,
        locationPath: i.locationId ? paths.get(i.locationId) ?? null : null,
        serial: null as string | null,
      })),
      ...assetRows.map((a) => ({
        kind: a.kind === 'tool' ? 'tool' as const : 'asset' as const, id: a.id, name: a.name,
        value: a.replacementCostEstimate ?? a.purchasePrice ?? 0, quantity: 1,
        locationPath: a.locationId ? paths.get(a.locationId) ?? null : null,
        serial: a.serial,
      })),
    ];
    const byLocation = new Map<string, number>();
    for (const r of rows) {
      const k = r.locationPath ?? 'Unassigned';
      byLocation.set(k, (byLocation.get(k) ?? 0) + r.value * r.quantity);
    }
    return {
      total: rows.reduce((a, b) => a + b.value * b.quantity, 0),
      currency: req.ctx.household.currency,
      items: rows.sort((a, b) => b.value - a.value),
      byLocation: [...byLocation].map(([location, total]) => ({ location, total })).sort((a, b) => b.total - a.total),
    };
  });

  /** Declutter queue (STOR-009). */
  app.get('/api/v1/storage/review-queue', async (req) => {
    const q = z.object({ staleMonths: z.coerce.number().int().min(1).max(120).default(24) }).parse(req.query);
    const stale = addDays(req.ctx.today, -30 * q.staleMonths);
    const rows = await req.ctx.db.select().from(storageItems).where(and(
      isNull(storageItems.deletedAt),
      eq(storageItems.status, 'stored'),
      sql`(${storageItems.reviewBy} is not null and ${storageItems.reviewBy} <= ${req.ctx.today})
          or (${storageItems.reviewBy} is null and ${storageItems.updatedAt} < ${stale})`,
    )).orderBy(asc(storageItems.updatedAt)).limit(200);
    const paths = await locationPaths(req.ctx.db, rows.map((r) => r.locationId).filter(Boolean) as string[]);
    return {
      items: rows.map((r) => ({
        ...r,
        locationPath: r.locationId ? paths.get(r.locationId) ?? null : null,
        reason: r.reviewBy && r.reviewBy <= req.ctx.today ? 'review_due' : 'untouched',
      })),
    };
  });

  app.post('/api/v1/storage-items/:id/dispose', async (req) => {
    requireWrite(req.ctx.user);
    const id = (req.params as { id: string }).id;
    const body = z.object({
      method: z.enum(['sold', 'donated', 'recycled', 'trashed']),
      proceeds: z.number().int().nullable().optional(),
      massKg: z.number().positive().optional(),
      note: z.string().optional(),
    }).parse(req.body);
    const item = (await req.ctx.db.select().from(storageItems).where(eq(storageItems.id, id)).limit(1))[0];
    if (!item) throw notFound('Storage item');
    await req.ctx.db.update(storageItems).set({
      status: 'disposed', deletedAt: new Date().toISOString(), updatedBy: req.ctx.user!.id,
      notesMd: [item.notesMd, `Disposed (${body.method}) on ${req.ctx.today}. ${body.note ?? ''}`].filter(Boolean).join('\n'),
    }).where(eq(storageItems.id, id));
    let transactionId: string | null = null;
    if (body.proceeds && body.proceeds > 0) {
      const { transaction } = await attachCost(req.ctx, {
        amount: body.proceeds, type: 'income', memo: `Sold ${item.name}`,
        attributions: [{ entityType: 'storage_item', entityId: id }],
      });
      transactionId = transaction.id;
    }

    // Landfill, recycling and reuse are not the same thing, so the route the
    // item takes out of the house decides the factor.
    let carbon = null;
    if (body.massKg) {
      carbon = await tryRecordActivity(req.ctx, {
        type: 'waste', amount: body.massKg, unit: 'kg',
        factorKey: WASTE_FACTOR_BY_METHOD[body.method] ?? 'waste.landfill',
        sourceType: 'storage_item', sourceId: id,
        note: `${item.name} (${body.method})`,
        attributions: [{ entityType: 'storage_item', entityId: id }],
      });
    }
    return { id, method: body.method, transactionId, gCo2e: carbon?.gCo2e ?? null };
  });

  /* ── loans (STOR-008, TOOL-003) ── */

  app.get('/api/v1/loans', async (req) => {
    const q = z.object({
      open: z.coerce.boolean().optional(), direction: z.enum(LOAN_DIRECTIONS).optional(),
    }).parse(req.query);
    const where = [isNull(loans.deletedAt)];
    if (q.open) where.push(isNull(loans.returnedAt));
    if (q.direction) where.push(eq(loans.direction, q.direction));
    const rows = await req.ctx.db.select().from(loans).where(and(...where)).orderBy(asc(loans.dueBack));
    const labels = await loanLabels(req.ctx.db, rows);
    return {
      items: rows.map((l) => ({
        ...l,
        item: labels.get(`${l.itemType}:${l.itemId}`) ?? l.itemId,
        overdue: !l.returnedAt && !!l.dueBack && l.dueBack < req.ctx.today,
        daysOut: diffDays(l.returnedAt ?? req.ctx.today, l.lentAt),
      })),
    };
  });

  app.post('/api/v1/loans', async (req, reply) => {
    requireWrite(req.ctx.user);
    const body = z.object({
      itemType: z.enum(['storage_item', 'asset']).default('storage_item'),
      itemId: z.string().min(1),
      direction: z.enum(LOAN_DIRECTIONS).default('out'),
      contactId: z.string().nullable().optional(),
      contactName: z.string().nullable().optional(),
      lentAt: dateStr.optional(),
      dueBack: dateStr.nullable().optional(),
      note: z.string().nullable().optional(),
    }).parse(req.body);
    if (!body.contactId && !body.contactName) throw badRequest('Say who has it');

    const open = await req.ctx.db.select().from(loans).where(and(
      eq(loans.itemType, body.itemType), eq(loans.itemId, body.itemId),
      isNull(loans.returnedAt), isNull(loans.deletedAt),
    )).limit(1);
    if (open[0]) throw badRequest('That is already out on loan');

    let contactName = body.contactName ?? null;
    if (body.contactId && !contactName) {
      const c = (await req.ctx.db.select().from(contacts).where(eq(contacts.id, body.contactId)).limit(1))[0];
      contactName = c?.name ?? null;
    }

    const labels = await loanLabels(req.ctx.db, [{ itemType: body.itemType, itemId: body.itemId } as any]);
    const itemLabel = labels.get(`${body.itemType}:${body.itemId}`) ?? 'item';

    // A loan with a return date is a promise; make it a task so it is kept.
    let taskId: string | null = null;
    if (body.dueBack) {
      const [task] = await req.ctx.db.insert(tasks).values({
        title: body.direction === 'out'
          ? `Get ${itemLabel} back from ${contactName}`
          : `Return ${itemLabel} to ${contactName}`,
        dueDate: body.dueBack, originType: 'loan_return', priority: 'normal',
        createdBy: req.ctx.user!.id, updatedBy: req.ctx.user!.id,
      }).returning();
      taskId = task!.id;
    }

    const [row] = await req.ctx.db.insert(loans).values({
      ...body, contactName, lentAt: body.lentAt ?? req.ctx.today, taskId,
      createdBy: req.ctx.user!.id, updatedBy: req.ctx.user!.id,
    }).returning();
    if (taskId) {
      await req.ctx.db.update(tasks).set({ originId: row!.id }).where(eq(tasks.id, taskId));
    }
    if (body.itemType === 'asset' && body.direction === 'out') {
      await req.ctx.db.update(toolProfiles).set({ status: 'loaned_out' }).where(eq(toolProfiles.assetId, body.itemId));
    } else if (body.itemType === 'storage_item') {
      await req.ctx.db.update(storageItems)
        .set({ status: body.direction === 'out' ? 'loaned' : 'borrowed' }).where(eq(storageItems.id, body.itemId));
    }
    reply.status(201);
    return { ...row, item: itemLabel };
  });

  app.post('/api/v1/loans/:id/return', async (req) => {
    requireWrite(req.ctx.user);
    const id = (req.params as { id: string }).id;
    const body = z.object({
      returnedAt: dateStr.optional(), condition: z.enum(ASSET_CONDITION).optional(), note: z.string().optional(),
    }).parse(req.body ?? {});
    const loan = (await req.ctx.db.select().from(loans).where(eq(loans.id, id)).limit(1))[0];
    if (!loan) throw notFound('Loan');
    if (loan.returnedAt) throw badRequest('That loan is already closed');
    const [row] = await req.ctx.db.update(loans).set({
      returnedAt: body.returnedAt ?? req.ctx.today,
      returnCondition: body.condition ?? null,
      note: body.note ?? loan.note,
      updatedBy: req.ctx.user!.id,
    }).where(eq(loans.id, id)).returning();
    if (loan.taskId) {
      await req.ctx.db.update(tasks)
        .set({ status: 'done', completedAt: body.returnedAt ?? req.ctx.today, completedBy: req.ctx.user!.id })
        .where(and(eq(tasks.id, loan.taskId), sql`${tasks.status} <> 'done'`));
    }
    if (loan.itemType === 'asset') {
      await req.ctx.db.update(toolProfiles).set({ status: 'available' }).where(eq(toolProfiles.assetId, loan.itemId));
      if (body.condition) {
        await req.ctx.db.update(assets).set({ condition: body.condition }).where(eq(assets.id, loan.itemId));
      }
    } else {
      await req.ctx.db.update(storageItems).set({ status: 'stored' }).where(eq(storageItems.id, loan.itemId));
    }
    return row;
  });
}

async function loanLabels(db: any, rows: Array<{ itemType: string; itemId: string }>): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const storageIds = rows.filter((r) => r.itemType === 'storage_item').map((r) => r.itemId);
  const assetIds = rows.filter((r) => r.itemType === 'asset').map((r) => r.itemId);
  if (storageIds.length) {
    const s = await db.select({ id: storageItems.id, name: storageItems.name })
      .from(storageItems).where(inArray(storageItems.id, storageIds));
    for (const r of s as Array<{ id: string; name: string }>) out.set(`storage_item:${r.id}`, r.name);
  }
  if (assetIds.length) {
    const a = await db.select({ id: assets.id, name: assets.name })
      .from(assets).where(inArray(assets.id, assetIds));
    for (const r of a as Array<{ id: string; name: string }>) out.set(`asset:${r.id}`, r.name);
  }
  return out;
}
