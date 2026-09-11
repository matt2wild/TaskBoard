/* eslint-disable @typescript-eslint/no-explicit-any */
import type { FastifyInstance } from 'fastify';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { ASSET_CONDITION, TOOL_STATUS, TOOL_TYPES } from '@homestead/shared';
import {
  assets, batteries, batteryPlatforms, loans, products, projectTools, projects,
  toolConsumableProducts, toolConsumableSpecs, toolKitMembers, toolKits, toolProfiles, toolUsage,
} from '../db/schema.js';
import { crudRoutes } from '../core/crud.js';
import { requireWrite } from '../core/auth.js';
import { badRequest, notFound } from '../core/errors.js';
import { onHandMany } from '../services/stock.js';
import { spentOnMany } from '../services/budget.js';
import { locationPaths } from './core.routes.js';

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export function toolRoutes(app: FastifyInstance): void {
  /* Tools are assets with a profile; the list is scoped to kind = 'tool'. */
  const toolShape = {
    propertyId: z.string().min(1),
    locationId: z.string().nullable().optional(),
    categoryId: z.string().nullable().optional(),
    name: z.string().trim().min(1),
    make: z.string().nullable().optional(),
    model: z.string().nullable().optional(),
    serial: z.string().nullable().optional(),
    purchaseDate: dateStr.nullable().optional(),
    purchasePrice: z.number().int().nullable().optional(),
    purchaseVendorId: z.string().nullable().optional(),
    warrantyExpiry: dateStr.nullable().optional(),
    condition: z.enum(ASSET_CONDITION).default('good'),
    notesMd: z.string().nullable().optional(),
  };

  const toolCrud = crudRoutes(app, '/api/v1/tools', {
    table: assets, entityType: 'asset', label: 'Tool',
    create: z.object({ ...toolShape, kind: z.literal('tool').default('tool') }),
    update: z.object(toolShape).partial(),
    searchColumns: ['name', 'make', 'model', 'serial'],
    filterColumns: ['propertyId', 'locationId', 'categoryId', 'condition', 'status'],
    sortColumns: ['name', 'purchaseDate', 'createdAt'],
    hooks: {
      scope: () => eq(assets.kind, 'tool'),
      beforeCreate: (values) => ({ ...values, kind: 'tool' }),
      afterCreate: async (row, ctx) => {
        await ctx.db.insert(toolProfiles)
          .values({ assetId: row.id, createdBy: ctx.user?.id ?? null }).onConflictDoNothing();
      },
      decorate: async (rows, ctx) => {
        const ids = rows.map((r) => r.id);
        const [profiles, paths, spend, openLoans] = await Promise.all([
          ctx.db.select().from(toolProfiles).where(inArray(toolProfiles.assetId, ids)),
          locationPaths(ctx.db, rows.map((r) => r.locationId).filter(Boolean) as string[]),
          spentOnMany(ctx, 'asset', ids),
          ctx.db.select().from(loans).where(and(
            eq(loans.itemType, 'asset'), inArray(loans.itemId, ids),
            isNull(loans.returnedAt), isNull(loans.deletedAt),
          )),
        ]);
        const byAsset = new Map(profiles.map((p) => [p.assetId, p]));
        const loanByAsset = new Map(openLoans.map((l) => [l.itemId, l]));
        return rows.map((r) => {
          const p = byAsset.get(r.id);
          return {
            ...r,
            toolType: p?.toolType ?? 'hand',
            powerSource: p?.powerSource ?? null,
            batteryPlatformId: p?.batteryPlatformId ?? null,
            toolStatus: loanByAsset.get(r.id) ? 'loaned_out' : p?.status ?? 'available',
            hoursUsed: p?.hoursUsed ?? 0,
            accessories: p?.accessories ?? [],
            locationPath: r.locationId ? paths.get(r.locationId) ?? null : null,
            loan: loanByAsset.get(r.id) ?? null,
            totalCost: (r.purchasePrice ?? 0) + (spend.get(r.id) ?? 0),
          };
        });
      },
    },
  });

  app.put('/api/v1/tools/:id/profile', async (req) => {
    requireWrite(req.ctx.user);
    const id = (req.params as { id: string }).id;
    const body = z.object({
      toolType: z.enum(TOOL_TYPES).optional(),
      powerSource: z.string().nullable().optional(),
      batteryPlatformId: z.string().nullable().optional(),
      status: z.enum(TOOL_STATUS).optional(),
      accessories: z.array(z.string()).nullable().optional(),
      hoursUsed: z.number().min(0).optional(),
    }).parse(req.body);
    const existing = await req.ctx.db.select().from(toolProfiles).where(eq(toolProfiles.assetId, id)).limit(1);
    if (!existing[0]) {
      const [row] = await req.ctx.db.insert(toolProfiles)
        .values({ assetId: id, ...body, createdBy: req.ctx.user!.id }).returning();
      return row;
    }
    const [row] = await req.ctx.db.update(toolProfiles)
      .set({ ...body, updatedBy: req.ctx.user!.id }).where(eq(toolProfiles.assetId, id)).returning();
    return row;
  });

  /* ── consumable specs (TOOL-005) ── */

  app.get('/api/v1/tools/:id/consumables', async (req) => {
    const id = (req.params as { id: string }).id;
    const specs = await req.ctx.db.select().from(toolConsumableSpecs)
      .where(and(eq(toolConsumableSpecs.assetId, id), isNull(toolConsumableSpecs.deletedAt)));
    if (!specs.length) return { items: [] };
    const links = await req.ctx.db.select({ link: toolConsumableProducts, product: products })
      .from(toolConsumableProducts).innerJoin(products, eq(products.id, toolConsumableProducts.productId))
      .where(inArray(toolConsumableProducts.specId, specs.map((s) => s.id)));
    const have = await onHandMany(req.ctx, links.map((l) => l.product.id));
    return {
      items: specs.map((s) => ({
        ...s,
        products: links.filter((l) => l.link.specId === s.id).map((l) => ({
          id: l.product.id, name: l.product.name, unit: l.product.defaultUnit,
          onHand: have.get(l.product.id) ?? 0,
          isLow: l.product.minQuantity != null && (have.get(l.product.id) ?? 0) < l.product.minQuantity,
        })),
      })),
    };
  });

  app.post('/api/v1/tools/:id/consumables', async (req, reply) => {
    requireWrite(req.ctx.user);
    const id = (req.params as { id: string }).id;
    const body = z.object({
      description: z.string().trim().min(1),
      spec: z.record(z.unknown()).optional(),
      productIds: z.array(z.string()).optional(),
    }).parse(req.body);
    const [spec] = await req.ctx.db.insert(toolConsumableSpecs)
      .values({ assetId: id, description: body.description, spec: body.spec, createdBy: req.ctx.user!.id })
      .returning();
    if (body.productIds?.length) {
      await req.ctx.db.insert(toolConsumableProducts)
        .values(body.productIds.map((productId) => ({ specId: spec!.id, productId })))
        .onConflictDoNothing();
    }
    reply.status(201);
    return spec;
  });

  app.delete('/api/v1/tool-consumables/:id', async (req) => {
    requireWrite(req.ctx.user);
    await req.ctx.db.update(toolConsumableSpecs).set({ deletedAt: new Date().toISOString() })
      .where(eq(toolConsumableSpecs.id, (req.params as { id: string }).id));
    return { ok: true };
  });

  /* ── battery platforms (TOOL-006) ── */

  crudRoutes(app, '/api/v1/battery-platforms', {
    table: batteryPlatforms, entityType: 'battery_platform', label: 'Battery platform',
    create: z.object({
      name: z.string().trim().min(1), brand: z.string().nullable().optional(),
      voltage: z.number().nullable().optional(),
    }),
    update: z.object({
      name: z.string().trim().min(1).optional(), brand: z.string().nullable().optional(),
      voltage: z.number().nullable().optional(),
    }),
    searchColumns: ['name', 'brand'],
  });

  app.get('/api/v1/battery-platforms/:id/overview', async (req) => {
    const id = (req.params as { id: string }).id;
    const platform = (await req.ctx.db.select().from(batteryPlatforms)
      .where(eq(batteryPlatforms.id, id)).limit(1))[0];
    if (!platform) throw notFound('Battery platform');
    const [cells, toolRows] = await Promise.all([
      req.ctx.db.select().from(batteries)
        .where(and(eq(batteries.platformId, id), isNull(batteries.deletedAt))).orderBy(asc(batteries.name)),
      req.ctx.db.select({ asset: assets, profile: toolProfiles })
        .from(toolProfiles).innerJoin(assets, eq(assets.id, toolProfiles.assetId))
        .where(and(eq(toolProfiles.batteryPlatformId, id), isNull(assets.deletedAt))),
    ]);
    return {
      platform,
      batteries: cells.filter((c) => c.kind === 'battery'),
      chargers: cells.filter((c) => c.kind !== 'battery'),
      tools: toolRows.map((t) => ({ ...t.asset, status: t.profile.status })),
      health: {
        good: cells.filter((c) => c.health === 'good').length,
        degraded: cells.filter((c) => c.health === 'degraded').length,
        dead: cells.filter((c) => c.health === 'dead').length,
        totalAh: cells.filter((c) => c.kind === 'battery' && c.health !== 'dead')
          .reduce((a, b) => a + (b.capacityAh ?? 0), 0),
      },
    };
  });

  crudRoutes(app, '/api/v1/batteries', {
    table: batteries, entityType: 'battery_platform', label: 'Battery',
    create: z.object({
      platformId: z.string().min(1), name: z.string().trim().min(1),
      kind: z.enum(['battery', 'charger']).default('battery'),
      capacityAh: z.number().nullable().optional(),
      health: z.enum(['good', 'degraded', 'dead']).default('good'),
      purchasedAt: dateStr.nullable().optional(),
      locationId: z.string().nullable().optional(),
      note: z.string().nullable().optional(),
    }),
    update: z.object({
      name: z.string().trim().min(1).optional(),
      capacityAh: z.number().nullable().optional(),
      health: z.enum(['good', 'degraded', 'dead']).optional(),
      locationId: z.string().nullable().optional(),
      note: z.string().nullable().optional(),
    }),
    searchColumns: ['name'], filterColumns: ['platformId', 'kind', 'health'],
  });

  /* ── kits (TOOL-008) ── */

  crudRoutes(app, '/api/v1/tool-kits', {
    table: toolKits, entityType: 'tool_kit', label: 'Tool kit',
    create: z.object({
      name: z.string().trim().min(1), description: z.string().nullable().optional(),
      locationId: z.string().nullable().optional(),
    }),
    update: z.object({
      name: z.string().trim().min(1).optional(), description: z.string().nullable().optional(),
      locationId: z.string().nullable().optional(),
    }),
    searchColumns: ['name'],
  });

  app.put('/api/v1/tool-kits/:id/members', async (req) => {
    requireWrite(req.ctx.user);
    const id = (req.params as { id: string }).id;
    const body = z.object({ assetIds: z.array(z.string()) }).parse(req.body);
    await req.ctx.db.delete(toolKitMembers).where(eq(toolKitMembers.kitId, id));
    if (body.assetIds.length) {
      await req.ctx.db.insert(toolKitMembers).values(body.assetIds.map((assetId) => ({ kitId: id, assetId })));
    }
    return { kitId: id, assetIds: body.assetIds };
  });

  app.get('/api/v1/tool-kits/:id/contents', async (req) => {
    const id = (req.params as { id: string }).id;
    const rows = await req.ctx.db.select({ asset: assets, profile: toolProfiles })
      .from(toolKitMembers)
      .innerJoin(assets, eq(assets.id, toolKitMembers.assetId))
      .leftJoin(toolProfiles, eq(toolProfiles.assetId, toolKitMembers.assetId))
      .where(eq(toolKitMembers.kitId, id));
    const items = rows.map((r) => ({
      ...r.asset, status: r.profile?.status ?? 'available',
      present: (r.profile?.status ?? 'available') === 'available',
    }));
    return {
      items,
      complete: items.every((i) => i.present),
      missing: items.filter((i) => !i.present).map((i) => ({ id: i.id, name: i.name, status: i.status })),
    };
  });

  /* ── availability for projects and plans (TOOL-007) ── */

  app.post('/api/v1/tools/availability', async (req) => {
    const body = z.object({ assetIds: z.array(z.string()).min(1) }).parse(req.body);
    const rows = await req.ctx.db.select({ asset: assets, profile: toolProfiles })
      .from(assets).leftJoin(toolProfiles, eq(toolProfiles.assetId, assets.id))
      .where(and(inArray(assets.id, body.assetIds), isNull(assets.deletedAt)));
    const openLoans = await req.ctx.db.select().from(loans).where(and(
      eq(loans.itemType, 'asset'), inArray(loans.itemId, body.assetIds),
      isNull(loans.returnedAt), isNull(loans.deletedAt),
    ));
    const loanBy = new Map(openLoans.map((l) => [l.itemId, l]));
    return {
      items: rows.map((r) => {
        const loan = loanBy.get(r.asset.id);
        const status = loan ? 'loaned_out' : r.profile?.status ?? 'available';
        return {
          assetId: r.asset.id, name: r.asset.name, status,
          available: status === 'available',
          blockedBy: loan ? `Out with ${loan.contactName ?? 'someone'}` : status === 'needs_repair' ? 'Needs repair' : null,
        };
      }),
    };
  });

  app.post('/api/v1/tools/:id/checkout', async (req) => {
    requireWrite(req.ctx.user);
    const id = (req.params as { id: string }).id;
    const body = z.object({ projectId: z.string().nullable().optional() }).parse(req.body ?? {});
    const profile = (await req.ctx.db.select().from(toolProfiles).where(eq(toolProfiles.assetId, id)).limit(1))[0];
    if (profile && profile.status === 'loaned_out') throw badRequest('That tool is out on loan');
    await req.ctx.db.insert(toolProfiles)
      .values({ assetId: id, status: 'in_use', createdBy: req.ctx.user!.id })
      .onConflictDoUpdate({ target: toolProfiles.assetId, set: { status: 'in_use' } });
    if (body.projectId) {
      await req.ctx.db.insert(projectTools)
        .values({ projectId: body.projectId, assetId: id, checkedOutAt: new Date().toISOString() })
        .onConflictDoUpdate({
          target: [projectTools.projectId, projectTools.assetId],
          set: { checkedOutAt: new Date().toISOString(), checkedInAt: null },
        });
    }
    return { assetId: id, status: 'in_use', projectId: body.projectId ?? null };
  });

  app.post('/api/v1/tools/:id/checkin', async (req) => {
    requireWrite(req.ctx.user);
    const id = (req.params as { id: string }).id;
    const body = z.object({
      hours: z.number().min(0).optional(), projectId: z.string().nullable().optional(), note: z.string().optional(),
    }).parse(req.body ?? {});
    await req.ctx.db.update(toolProfiles).set({ status: 'available' }).where(eq(toolProfiles.assetId, id));
    if (body.projectId) {
      await req.ctx.db.update(projectTools).set({ checkedInAt: new Date().toISOString() })
        .where(and(eq(projectTools.projectId, body.projectId), eq(projectTools.assetId, id)));
    }
    if (body.hours && body.hours > 0) {
      await req.ctx.db.insert(toolUsage).values({
        assetId: id, projectId: body.projectId ?? null, ts: new Date().toISOString(),
        hours: body.hours, note: body.note, createdBy: req.ctx.user!.id,
      });
      await req.ctx.db.update(toolProfiles)
        .set({ hoursUsed: sql`${toolProfiles.hoursUsed} + ${body.hours}` })
        .where(eq(toolProfiles.assetId, id));
    }
    return { assetId: id, status: 'available' };
  });

  /* ── wishlist / gap analysis (TOOL-009) ── */

  app.get('/api/v1/tools/wishlist', async (req) => {
    const { projectToolWishes } = await import('../db/schema.js');
    const rows = await req.ctx.db.select().from(projectToolWishes)
      .where(isNull(projectToolWishes.deletedAt)).orderBy(asc(projectToolWishes.createdAt));
    const projectIds = [...new Set(rows.map((r) => r.projectId).filter(Boolean))] as string[];
    const names = projectIds.length
      ? await req.ctx.db.select({ id: projects.id, name: projects.name })
        .from(projects).where(inArray(projects.id, projectIds)) : [];
    const nameById = new Map(names.map((n) => [n.id, n.name]));
    return {
      items: rows.map((r) => ({ ...r, projectName: r.projectId ? nameById.get(r.projectId) ?? null : null })),
      totalEstimate: rows.reduce((a, b) => a + (b.estCost ?? 0), 0),
      currency: req.ctx.household.currency,
    };
  });

  app.post('/api/v1/tools/wishlist', async (req, reply) => {
    requireWrite(req.ctx.user);
    const { projectToolWishes } = await import('../db/schema.js');
    const body = z.object({
      description: z.string().trim().min(1),
      projectId: z.string().nullable().optional(),
      estCost: z.number().int().nullable().optional(),
      rentOrBuy: z.enum(['rent', 'buy']).default('buy'),
      note: z.string().nullable().optional(),
    }).parse(req.body);
    const [row] = await req.ctx.db.insert(projectToolWishes)
      .values({ ...body, createdBy: req.ctx.user!.id }).returning();
    reply.status(201);
    return row;
  });

  app.get('/api/v1/tools/:id/usage', async (req) => {
    const id = (req.params as { id: string }).id;
    const rows = await req.ctx.db.select().from(toolUsage)
      .where(and(eq(toolUsage.assetId, id), isNull(toolUsage.deletedAt))).orderBy(asc(toolUsage.ts));
    return { items: rows, totalHours: rows.reduce((a, b) => a + b.hours, 0) };
  });

  void toolCrud;
}
