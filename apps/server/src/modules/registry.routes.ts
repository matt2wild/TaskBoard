/* eslint-disable @typescript-eslint/no-explicit-any */
import type { FastifyInstance } from 'fastify';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  ASSET_CONDITION, ASSET_STATUS, LOCATION_TYPES, TEMPERATURE_CLASSES, diffDays,
} from '@homestead/shared';
import {
  assetCategories, assets, locations, maintenancePlans, maintenanceRecords, properties, readings,
  schedules, warranties,
} from '../db/schema.js';
import { crudRoutes, makeCrud } from '../core/crud.js';
import { requireWrite } from '../core/auth.js';
import { badRequest, notFound } from '../core/errors.js';
import { spentOnMany, spentOn } from '../services/budget.js';
import { activityFromReading, emittedBy, emittedByMany } from '../services/carbon.js';
import { locationPaths } from './core.routes.js';

const optionalDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional();

export function registryRoutes(app: FastifyInstance): void {
  /* ── properties ── */
  crudRoutes(app, '/api/v1/properties', {
    table: properties, entityType: 'property', label: 'Property',
    create: z.object({
      name: z.string().trim().min(1),
      type: z.string().default('house'),
      address: z.record(z.string()).optional(),
      purchaseDate: optionalDate,
      purchasePrice: z.number().int().nullable().optional(),
      areaSqft: z.number().nullable().optional(),
      yearBuilt: z.number().int().nullable().optional(),
      lotSize: z.string().nullable().optional(),
      notesMd: z.string().nullable().optional(),
      profile: z.record(z.unknown()).optional(),
      isPrimary: z.boolean().optional(),
    }),
    update: z.object({
      name: z.string().trim().min(1).optional(),
      type: z.string().optional(),
      address: z.record(z.string()).nullable().optional(),
      purchaseDate: optionalDate,
      purchasePrice: z.number().int().nullable().optional(),
      areaSqft: z.number().nullable().optional(),
      yearBuilt: z.number().int().nullable().optional(),
      lotSize: z.string().nullable().optional(),
      notesMd: z.string().nullable().optional(),
      profile: z.record(z.unknown()).nullable().optional(),
      isPrimary: z.boolean().optional(),
    }),
    searchColumns: ['name'],
    filterColumns: ['type', 'isPrimary'],
  });

  /* ── locations: one tree shared by assets, storage and the pantry ── */
  const locationCrud = crudRoutes(app, '/api/v1/locations', {
    table: locations, entityType: 'location', label: 'Location',
    create: z.object({
      propertyId: z.string().min(1),
      parentId: z.string().nullable().optional(),
      name: z.string().trim().min(1),
      type: z.enum(LOCATION_TYPES).default('room'),
      shortCode: z.string().trim().max(12).nullable().optional(),
      description: z.string().nullable().optional(),
      holdsFood: z.boolean().optional(),
      temperatureClass: z.enum(TEMPERATURE_CLASSES).nullable().optional(),
      dimensions: z.record(z.number()).nullable().optional(),
      sort: z.number().int().optional(),
    }),
    update: z.object({
      parentId: z.string().nullable().optional(),
      name: z.string().trim().min(1).optional(),
      type: z.enum(LOCATION_TYPES).optional(),
      shortCode: z.string().trim().max(12).nullable().optional(),
      description: z.string().nullable().optional(),
      holdsFood: z.boolean().optional(),
      temperatureClass: z.enum(TEMPERATURE_CLASSES).nullable().optional(),
      dimensions: z.record(z.number()).nullable().optional(),
      sort: z.number().int().optional(),
    }),
    searchColumns: ['name', 'shortCode'],
    filterColumns: ['propertyId', 'parentId', 'type', 'holdsFood', 'temperatureClass'],
    hooks: {
      async beforeUpdate(values, before, ctx) {
        if (values.parentId && values.parentId !== before.parentId) {
          await assertNoLocationCycle(ctx.db, before.id, values.parentId as string);
        }
        return values;
      },
      async beforeDelete(row, ctx) {
        const kids = await ctx.db.select({ id: locations.id }).from(locations)
          .where(and(eq(locations.parentId, row.id), isNull(locations.deletedAt))).limit(1);
        if (kids.length) throw badRequest('Move or remove the sub-locations first');
      },
      async decorate(rows, ctx) {
        const paths = await locationPaths(ctx.db, rows.map((r) => r.id));
        return rows.map((r) => ({ ...r, path: paths.get(r.id) ?? r.name }));
      },
    },
  });
  void locationCrud;

  app.get('/api/v1/locations/tree', async (req) => {
    const q = z.object({ propertyId: z.string().optional() }).parse(req.query);
    const where = [isNull(locations.deletedAt)];
    if (q.propertyId) where.push(eq(locations.propertyId, q.propertyId));
    const rows = await req.ctx.db.select().from(locations).where(and(...where))
      .orderBy(asc(locations.sort), asc(locations.name));

    const counts = await req.ctx.db.select({
      locationId: assets.locationId, n: sql<number>`count(*)`,
    }).from(assets).where(isNull(assets.deletedAt)).groupBy(assets.locationId);
    const assetCount = new Map(counts.map((c) => [c.locationId, Number(c.n)]));

    type Node = typeof locations.$inferSelect & { children: Node[]; assetCount: number };
    const byId = new Map<string, Node>();
    for (const r of rows) byId.set(r.id, { ...r, children: [], assetCount: assetCount.get(r.id) ?? 0 });
    const roots: Node[] = [];
    for (const node of byId.values()) {
      const parent = node.parentId ? byId.get(node.parentId) : undefined;
      if (parent) parent.children.push(node); else roots.push(node);
    }
    return { items: roots };
  });

  app.get('/api/v1/locations/:id/contents', async (req) => {
    const id = (req.params as { id: string }).id;
    const { storageItems, stockItems, products } = await import('../db/schema.js');
    const [children, assetRows, storage, stock] = await Promise.all([
      req.ctx.db.select().from(locations)
        .where(and(eq(locations.parentId, id), isNull(locations.deletedAt))).orderBy(asc(locations.name)),
      req.ctx.db.select().from(assets)
        .where(and(eq(assets.locationId, id), isNull(assets.deletedAt))).orderBy(asc(assets.name)),
      req.ctx.db.select().from(storageItems)
        .where(and(eq(storageItems.locationId, id), isNull(storageItems.deletedAt))).orderBy(asc(storageItems.name)),
      req.ctx.db.select({ s: stockItems, product: products.name })
        .from(stockItems).innerJoin(products, eq(products.id, stockItems.productId))
        .where(and(eq(stockItems.locationId, id), isNull(stockItems.deletedAt))),
    ]);
    const paths = await locationPaths(req.ctx.db, [id]);
    return {
      path: paths.get(id) ?? null,
      children,
      assets: assetRows.filter((a) => a.kind === 'asset'),
      tools: assetRows.filter((a) => a.kind === 'tool'),
      storageItems: storage,
      stock: stock.map((r) => ({ ...r.s, product: r.product })),
    };
  });

  /* ── asset categories ── */
  crudRoutes(app, '/api/v1/asset-categories', {
    table: assetCategories, entityType: 'category', label: 'Asset category',
    create: z.object({
      name: z.string().trim().min(1),
      slug: z.string().trim().min(1),
      parentId: z.string().nullable().optional(),
      defaultLifespanYears: z.number().int().nullable().optional(),
      icon: z.string().nullable().optional(),
      sort: z.number().int().optional(),
    }),
    update: z.object({
      name: z.string().trim().min(1).optional(),
      parentId: z.string().nullable().optional(),
      defaultLifespanYears: z.number().int().nullable().optional(),
      icon: z.string().nullable().optional(),
      sort: z.number().int().optional(),
    }),
    searchColumns: ['name'],
    filterColumns: ['parentId', 'slug'],
  });

  /* ── assets ── */
  const assetShape = {
    propertyId: z.string().min(1),
    locationId: z.string().nullable().optional(),
    categoryId: z.string().nullable().optional(),
    kind: z.enum(['asset', 'tool']).default('asset'),
    name: z.string().trim().min(1),
    make: z.string().nullable().optional(),
    model: z.string().nullable().optional(),
    serial: z.string().nullable().optional(),
    purchaseDate: optionalDate,
    purchasePrice: z.number().int().nullable().optional(),
    purchaseVendorId: z.string().nullable().optional(),
    purchaseTransactionId: z.string().nullable().optional(),
    installedDate: optionalDate,
    warrantyExpiry: optionalDate,
    expectedLifespanYears: z.number().int().nullable().optional(),
    replacementCostEstimate: z.number().int().nullable().optional(),
    condition: z.enum(ASSET_CONDITION).default('good'),
    status: z.enum(ASSET_STATUS).default('active'),
    notesMd: z.string().nullable().optional(),
    custom: z.record(z.unknown()).nullable().optional(),
  };

  const assetCrud = crudRoutes(app, '/api/v1/assets', {
    table: assets, entityType: 'asset', label: 'Asset',
    create: z.object(assetShape),
    update: z.object({ ...assetShape, propertyId: z.string().optional(), name: z.string().trim().min(1).optional(), kind: z.enum(['asset', 'tool']).optional(), condition: z.enum(ASSET_CONDITION).optional(), status: z.enum(ASSET_STATUS).optional() }).partial(),
    searchColumns: ['name', 'make', 'model', 'serial'],
    filterColumns: ['propertyId', 'locationId', 'categoryId', 'kind', 'status', 'condition'],
    sortColumns: ['name', 'purchaseDate', 'warrantyExpiry', 'createdAt'],
    hooks: {
      scope: () => eq(assets.kind, 'asset'),
      decorate: async (rows, ctx) => {
        const ids = rows.map((r) => r.id);
        const { extendedLifeForMany } = await import('../services/circular.js');
        const [spend, carbon, paths, nextDue, extended] = await Promise.all([
          spentOnMany(ctx, 'asset', ids),
          emittedByMany(ctx, 'asset', ids),
          locationPaths(ctx.db, rows.map((r) => r.locationId).filter(Boolean) as string[]),
          nextMaintenanceFor(ctx.db, ids),
          extendedLifeForMany(ctx, 'asset', ids),
        ]);
        return rows.map((r) => ({
          ...r,
          locationPath: r.locationId ? paths.get(r.locationId) ?? null : null,
          ageYears: r.installedDate ?? r.purchaseDate
            ? Math.round((diffDays(ctx.today, (r.installedDate ?? r.purchaseDate)!) / 365.25) * 10) / 10
            : null,
          warrantyDaysLeft: r.warrantyExpiry ? diffDays(r.warrantyExpiry, ctx.today) : null,
          totalCost: (r.purchasePrice ?? 0) + (spend.get(r.id) ?? 0),
          maintenanceSpend: spend.get(r.id) ?? 0,
          gCo2e: carbon.get(r.id) ?? 0,
          nextMaintenanceDue: nextDue.get(r.id) ?? null,
          lifeExtendedYears: extended.get(r.id) ?? 0,
          replacementYear: estimateReplacementYear(r, ctx.today, extended.get(r.id) ?? 0),
        }));
      },
    },
  });

  app.get('/api/v1/assets/:id/timeline', async (req) => {
    const id = (req.params as { id: string }).id;
    const asset = (await req.ctx.db.select().from(assets).where(eq(assets.id, id)).limit(1))[0];
    if (!asset) throw notFound('Asset');
    const [records, readingRows, warrantyRows, spend, carbon] = await Promise.all([
      req.ctx.db.select().from(maintenanceRecords).where(and(
        eq(maintenanceRecords.targetType, 'asset'), eq(maintenanceRecords.targetId, id),
        isNull(maintenanceRecords.deletedAt),
      )).orderBy(desc(maintenanceRecords.performedAt)),
      req.ctx.db.select().from(readings).where(and(eq(readings.assetId, id), isNull(readings.deletedAt)))
        .orderBy(desc(readings.takenAt)).limit(500),
      req.ctx.db.select().from(warranties).where(and(eq(warranties.assetId, id), isNull(warranties.deletedAt))),
      spentOn(req.ctx, 'asset', id),
      emittedBy(req.ctx, 'asset', id),
    ]);
    const events = [
      ...(asset.purchaseDate ? [{ at: asset.purchaseDate, kind: 'purchased', label: 'Purchased', amount: asset.purchasePrice }] : []),
      ...(asset.installedDate ? [{ at: asset.installedDate, kind: 'installed', label: 'Installed' }] : []),
      ...records.map((r) => ({ at: r.performedAt, kind: r.kind, label: r.title, id: r.id })),
      ...(asset.retiredAt ? [{ at: asset.retiredAt, kind: 'retired', label: 'Retired' }] : []),
    ].sort((a, b) => (a.at < b.at ? 1 : -1));
    return {
      asset, events, records, readings: readingRows, warranties: warrantyRows,
      spend, carbon,
    };
  });

  app.post('/api/v1/assets/:id/retire', async (req) => {
    requireWrite(req.ctx.user);
    const id = (req.params as { id: string }).id;
    const body = z.object({
      retiredAt: z.string().default(req.ctx.today),
      method: z.enum(['sold', 'recycled', 'trashed', 'donated', 'other']).default('other'),
      proceeds: z.number().int().nullable().optional(),
      replacedByAssetId: z.string().nullable().optional(),
      note: z.string().optional(),
    }).parse(req.body ?? {});
    const [row] = await req.ctx.db.update(assets).set({
      status: 'disposed', condition: 'retired', retiredAt: body.retiredAt,
      disposal: { method: body.method, proceeds: body.proceeds ?? null, note: body.note ?? null },
      replacedByAssetId: body.replacedByAssetId ?? null,
      updatedBy: req.ctx.user!.id,
    }).where(eq(assets.id, id)).returning();
    if (!row) throw notFound('Asset');
    if (body.proceeds && body.proceeds > 0) {
      const { attachCost } = await import('../services/budget.js');
      await attachCost(req.ctx, {
        amount: body.proceeds, type: 'income', date: body.retiredAt,
        memo: `Sold ${row.name}`, attributions: [{ entityType: 'asset', entityId: id }],
      });
    }
    return row;
  });

  /* ── warranties (MAINT-008) ── */
  crudRoutes(app, '/api/v1/warranties', {
    table: warranties, entityType: 'asset', label: 'Warranty',
    create: z.object({
      assetId: z.string().min(1),
      providerContactId: z.string().nullable().optional(),
      type: z.string().default('manufacturer'),
      startDate: optionalDate,
      endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      coverageMd: z.string().nullable().optional(),
      claimContact: z.string().nullable().optional(),
      costTransactionId: z.string().nullable().optional(),
    }),
    update: z.object({
      providerContactId: z.string().nullable().optional(),
      type: z.string().optional(),
      startDate: optionalDate,
      endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      coverageMd: z.string().nullable().optional(),
      claimContact: z.string().nullable().optional(),
    }),
    filterColumns: ['assetId', 'type'],
    sortColumns: ['endDate', 'createdAt'],
    defaultSort: { column: 'endDate', dir: 'asc' },
    hooks: {
      afterCreate: async (row, ctx) => {
        // Keep the asset's headline warranty date in step with its longest cover.
        const all = await ctx.db.select().from(warranties)
          .where(and(eq(warranties.assetId, row.assetId), isNull(warranties.deletedAt)));
        const latest = all.map((w) => w.endDate).sort().at(-1);
        if (latest) await ctx.db.update(assets).set({ warrantyExpiry: latest }).where(eq(assets.id, row.assetId));
      },
    },
  });

  /* ── readings (MAINT-009) ── */
  crudRoutes(app, '/api/v1/readings', {
    table: readings, entityType: 'asset', label: 'Reading',
    create: z.object({
      assetId: z.string().min(1),
      metric: z.string().trim().min(1),
      value: z.number(),
      unit: z.string().nullable().optional(),
      takenAt: z.string().default(new Date().toISOString()),
      note: z.string().nullable().optional(),
    }),
    update: z.object({ value: z.number().optional(), note: z.string().nullable().optional() }),
    filterColumns: ['assetId', 'metric'],
    sortColumns: ['takenAt'],
    defaultSort: { column: 'takenAt', dir: 'desc' },
    hooks: {
      afterCreate: async (row, ctx) => {
        const { checkReadingTriggers } = await import('../services/maintenance.js');
        await checkReadingTriggers(ctx, row.assetId, row.metric, row.value);
        // A meter reading is a running total; the difference is the consumption,
        // so nobody has to type a kWh figure twice (GHG-008).
        await activityFromReading(ctx, row.id).catch(() => undefined);
      },
    },
  });

  void assetCrud;
}

async function assertNoLocationCycle(db: any, id: string, parentId: string): Promise<void> {
  let cur: string | null = parentId;
  for (let i = 0; i < 50 && cur; i++) {
    if (cur === id) throw badRequest('A location cannot be inside itself');
    const rows: Array<{ parentId: string | null }> = await db
      .select({ parentId: locations.parentId }).from(locations).where(eq(locations.id, cur)).limit(1);
    cur = rows[0]?.parentId ?? null;
  }
}

async function nextMaintenanceFor(db: any, assetIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!assetIds.length) return out;
  const rows = await db.select({
    targetId: maintenancePlans.targetId, nextDue: schedules.nextDue,
  }).from(maintenancePlans)
    .innerJoin(schedules, eq(schedules.id, maintenancePlans.scheduleId))
    .where(and(
      eq(maintenancePlans.targetType, 'asset'),
      inArray(maintenancePlans.targetId, assetIds),
      eq(maintenancePlans.active, true),
      isNull(maintenancePlans.deletedAt),
    ));
  for (const r of rows as Array<{ targetId: string; nextDue: string | null }>) {
    if (!r.nextDue) continue;
    const cur = out.get(r.targetId);
    if (!cur || r.nextDue < cur) out.set(r.targetId, r.nextDue);
  }
  return out;
}

/**
 * Replacement planning from age and expected life (ASSET-009), pushed out by
 * whatever the recorded repairs bought. A repair that keeps a machine going for
 * four more years should move the forecast by four years without anyone
 * re-entering anything (INT-012, CIRC-003).
 */
function estimateReplacementYear(asset: any, today: string, extendedYears = 0): number | null {
  const start = asset.installedDate ?? asset.purchaseDate;
  if (!start || !asset.expectedLifespanYears) return null;
  const year = Number(start.slice(0, 4)) + asset.expectedLifespanYears + Math.round(extendedYears);
  return year < Number(today.slice(0, 4)) ? Number(today.slice(0, 4)) : year;
}
