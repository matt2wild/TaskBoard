/* eslint-disable @typescript-eslint/no-explicit-any */
import type { FastifyInstance } from 'fastify';
import { and, asc, desc, eq, gte, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { STOCK_REASONS, WASTE_REASONS, addDays, diffDays } from '@homestead/shared';
import {
  locations, productBarcodes, productCategories, products, recipeIngredients, recipes,
  shoppingLines, shoppingLists, stockItems, stockMovements, transactionLineItems, transactions, wasteLog,
} from '../db/schema.js';
import { crudRoutes } from '../core/crud.js';
import { requireWrite } from '../core/auth.js';
import { badRequest, notFound } from '../core/errors.js';
import {
  addStock, addToShoppingList, consumeStock, defaultExpiry, defaultShoppingList,
  expiringSoon, lowStockList, onHand, onHandMany, reconcileLowStock,
} from '../services/stock.js';
import { attachCost, distributeReceipt } from '../services/budget.js';
import { recordProductEmissions } from '../services/carbon.js';
import { locationPaths } from './core.routes.js';

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export function foodRoutes(app: FastifyInstance): void {
  crudRoutes(app, '/api/v1/product-categories', {
    table: productCategories, entityType: 'category', label: 'Product category',
    create: z.object({
      name: z.string().trim().min(1), slug: z.string().trim().min(1),
      parentId: z.string().nullable().optional(), isFood: z.boolean().optional(),
      sort: z.number().int().optional(),
      emissionFactorKey: z.string().nullable().optional(),
    }),
    update: z.object({
      name: z.string().trim().min(1).optional(), parentId: z.string().nullable().optional(),
      isFood: z.boolean().optional(), sort: z.number().int().optional(),
      emissionFactorKey: z.string().nullable().optional(),
    }),
    searchColumns: ['name'], filterColumns: ['parentId', 'isFood', 'slug'],
  });

  const productShape = {
    name: z.string().trim().min(1),
    brand: z.string().nullable().optional(),
    categoryId: z.string().nullable().optional(),
    isFood: z.boolean().default(true),
    isPetSupply: z.boolean().optional(),
    defaultUnit: z.string().default('ea'),
    packageSize: z.number().nullable().optional(),
    packageUnit: z.string().nullable().optional(),
    shelfLife: z.record(z.number()).nullable().optional(),
    useWithinDaysOpened: z.number().int().nullable().optional(),
    minQuantity: z.number().nullable().optional(),
    autoShopping: z.boolean().optional(),
    defaultLocationId: z.string().nullable().optional(),
    nutrition: z.record(z.number()).nullable().optional(),
    spec: z.record(z.unknown()).nullable().optional(),
    notes: z.string().nullable().optional(),
    // Carbon travels with the catalogue, not beside it (INT-008).
    emissionFactorKey: z.string().nullable().optional(),
    unitMassKg: z.number().positive().nullable().optional(),
  };

  const productCrud = crudRoutes(app, '/api/v1/products', {
    table: products, entityType: 'product', label: 'Product',
    create: z.object(productShape),
    update: z.object(productShape).partial(),
    searchColumns: ['name', 'brand', 'notes'],
    filterColumns: ['categoryId', 'isFood', 'isPetSupply', 'defaultLocationId'],
    sortColumns: ['name', 'createdAt'],
    hooks: {
      decorate: async (rows, ctx) => {
        const have = await onHandMany(ctx, rows.map((r) => r.id));
        return rows.map((r) => ({
          ...r,
          onHand: have.get(r.id) ?? 0,
          isLow: r.minQuantity != null && (have.get(r.id) ?? 0) < r.minQuantity,
        }));
      },
      afterUpdate: async (row, _before, ctx) => { await reconcileLowStock(ctx, row.id); },
    },
  });

  app.post('/api/v1/products/:id/barcodes', async (req, reply) => {
    requireWrite(req.ctx.user);
    const id = (req.params as { id: string }).id;
    const body = z.object({ barcode: z.string().trim().min(4), symbology: z.string().optional() }).parse(req.body);
    const [row] = await req.ctx.db.insert(productBarcodes)
      .values({ productId: id, barcode: body.barcode, symbology: body.symbology }).returning();
    reply.status(201);
    return row;
  });

  /** Scan lookup (FOOD-003). Unknown codes come back as a stub to fill in. */
  app.get('/api/v1/products/by-barcode/:barcode', async (req) => {
    const barcode = (req.params as { barcode: string }).barcode.trim();
    const rows = await req.ctx.db.select({ product: products })
      .from(productBarcodes).innerJoin(products, eq(products.id, productBarcodes.productId))
      .where(and(eq(productBarcodes.barcode, barcode), isNull(products.deletedAt))).limit(1);
    if (!rows[0]) return { found: false, barcode };
    const have = await onHand(req.ctx, rows[0].product.id);
    return { found: true, barcode, product: { ...rows[0].product, onHand: have } };
  });

  app.post('/api/v1/products/from-barcode', async (req, reply) => {
    requireWrite(req.ctx.user);
    const body = z.object({
      barcode: z.string().trim().min(4),
      name: z.string().trim().min(1),
      brand: z.string().optional(),
      categoryId: z.string().optional(),
      defaultUnit: z.string().default('ea'),
      isFood: z.boolean().default(true),
    }).parse(req.body);
    const existing = await req.ctx.db.select().from(productBarcodes)
      .where(eq(productBarcodes.barcode, body.barcode)).limit(1);
    if (existing[0]) throw badRequest('That barcode is already on another product');
    const product = await productCrud.create(req.ctx, {
      name: body.name, brand: body.brand, categoryId: body.categoryId,
      defaultUnit: body.defaultUnit, isFood: body.isFood,
    });
    await req.ctx.db.insert(productBarcodes).values({ productId: product.id, barcode: body.barcode });
    reply.status(201);
    return product;
  });

  /* ── stock ── */

  app.get('/api/v1/stock', async (req) => {
    const q = z.object({
      locationId: z.string().optional(),
      productId: z.string().optional(),
      isFood: z.coerce.boolean().optional(),
      expiringDays: z.coerce.number().int().optional(),
      groupBy: z.enum(['none', 'product', 'location']).default('none'),
      limit: z.coerce.number().int().min(1).max(1000).default(300),
    }).parse(req.query);
    const where = [isNull(stockItems.deletedAt), sql`${stockItems.quantity} > 0`];
    if (q.locationId) where.push(eq(stockItems.locationId, q.locationId));
    if (q.productId) where.push(eq(stockItems.productId, q.productId));
    if (q.isFood !== undefined) where.push(eq(products.isFood, q.isFood));
    if (q.expiringDays != null) {
      where.push(sql`${stockItems.expiryDate} is not null and ${stockItems.expiryDate} <= ${addDays(req.ctx.today, q.expiringDays)}`);
    }
    const rows = await req.ctx.db.select({ s: stockItems, p: products })
      .from(stockItems).innerJoin(products, eq(products.id, stockItems.productId))
      .where(and(...where))
      .orderBy(asc(sql`coalesce(${stockItems.expiryDate}, '9999-12-31')`)).limit(q.limit);

    const paths = await locationPaths(req.ctx.db, rows.map((r) => r.s.locationId).filter(Boolean) as string[]);
    const items = rows.map((r) => ({
      ...r.s,
      product: { id: r.p.id, name: r.p.name, brand: r.p.brand, defaultUnit: r.p.defaultUnit, isFood: r.p.isFood },
      locationPath: r.s.locationId ? paths.get(r.s.locationId) ?? null : null,
      daysLeft: r.s.expiryDate ? diffDays(r.s.expiryDate, req.ctx.today) : null,
      expired: !!r.s.expiryDate && r.s.expiryDate < req.ctx.today,
    }));

    if (q.groupBy === 'none') return { items, today: req.ctx.today };
    const keyOf = (i: typeof items[number]) =>
      q.groupBy === 'product' ? i.product.name : (i.locationPath ?? 'Unassigned');
    const groups = new Map<string, typeof items>();
    for (const i of items) {
      const g = groups.get(keyOf(i)) ?? [];
      g.push(i);
      groups.set(keyOf(i), g);
    }
    return {
      groups: [...groups].map(([name, list]) => ({
        name, totalQuantity: list.reduce((a, b) => a + b.quantity, 0), items: list,
      })).sort((a, b) => a.name.localeCompare(b.name)),
      today: req.ctx.today,
    };
  });

  app.post('/api/v1/stock', async (req, reply) => {
    requireWrite(req.ctx.user);
    const body = z.object({
      productId: z.string().min(1),
      quantity: z.number().positive(),
      unit: z.string().optional(),
      locationId: z.string().nullable().optional(),
      expiryDate: dateStr.nullable().optional(),
      purchasedAt: dateStr.nullable().optional(),
      transactionId: z.string().nullable().optional(),
      unitPrice: z.number().int().nullable().optional(),
      note: z.string().nullable().optional(),
    }).parse(req.body);
    const row = await addStock(req.ctx, body);
    await reconcileLowStock(req.ctx, body.productId);
    reply.status(201);
    return row;
  });

  /** One-tap consume / waste / open / set from the stock list (FOOD-006). */
  app.post('/api/v1/stock/:id/adjust', async (req) => {
    requireWrite(req.ctx.user);
    const id = (req.params as { id: string }).id;
    const body = z.object({
      action: z.enum(['use', 'use_all', 'set', 'open', 'waste']),
      quantity: z.number().positive().optional(),
      wasteReason: z.enum(WASTE_REASONS).optional(),
    }).parse(req.body);
    const lot = (await req.ctx.db.select().from(stockItems).where(eq(stockItems.id, id)).limit(1))[0];
    if (!lot) throw notFound('Stock item');

    if (body.action === 'open') {
      const p = (await req.ctx.db.select().from(products).where(eq(products.id, lot.productId)).limit(1))[0];
      const newExpiry = p?.useWithinDaysOpened
        ? minDate(lot.expiryDate, addDays(req.ctx.today, p.useWithinDaysOpened))
        : lot.expiryDate;
      const [row] = await req.ctx.db.update(stockItems)
        .set({ openedAt: req.ctx.today, expiryDate: newExpiry, updatedBy: req.ctx.user!.id })
        .where(eq(stockItems.id, id)).returning();
      return { stockItem: row };
    }

    if (body.action === 'set') {
      if (body.quantity == null) throw badRequest('quantity is required');
      const delta = body.quantity - lot.quantity;
      const [row] = await req.ctx.db.update(stockItems)
        .set({ quantity: body.quantity, updatedBy: req.ctx.user!.id }).where(eq(stockItems.id, id)).returning();
      await req.ctx.db.insert(stockMovements).values({
        stockItemId: id, productId: lot.productId, delta, unit: lot.unit,
        reason: 'adjust', userId: req.ctx.user!.id,
      });
      const low = await reconcileLowStock(req.ctx, lot.productId);
      return { stockItem: row, lowStock: low };
    }

    const qty = body.action === 'use_all' ? lot.quantity : (body.quantity ?? 1);
    if (qty <= 0) throw badRequest('Nothing to take');
    const result = await consumeStock(req.ctx, {
      productId: lot.productId, quantity: qty, unit: lot.unit,
      reason: body.action === 'waste' ? 'waste' : 'consume',
      wasteReason: body.wasteReason, locationId: lot.locationId,
    });
    let wastedGCo2e: number | null = null;
    if (body.action === 'waste') {
      // Thrown-out food carries its whole footprint for nothing, which is the
      // number most likely to change behaviour.
      const carbon = await recordProductEmissions(req.ctx, {
        productId: lot.productId, quantity: qty, unit: lot.unit, type: 'waste',
        sourceType: 'waste_log', sourceId: id,
        note: `Wasted: ${body.wasteReason ?? 'expired'}`,
      });
      wastedGCo2e = carbon?.gCo2e ?? null;
    }
    const fresh = (await req.ctx.db.select().from(stockItems).where(eq(stockItems.id, id)).limit(1))[0];
    return { stockItem: fresh, ...result, wastedGCo2e };
  });

  app.post('/api/v1/stock/consume', async (req) => {
    requireWrite(req.ctx.user);
    const body = z.object({
      productId: z.string(), quantity: z.number().positive(), unit: z.string().optional(),
      reason: z.enum(STOCK_REASONS).optional(), locationId: z.string().nullable().optional(),
    }).parse(req.body);
    return consumeStock(req.ctx, body);
  });

  app.get('/api/v1/stock/expiring', async (req) => {
    const q = z.object({ days: z.coerce.number().int().min(0).max(365).default(7) }).parse(req.query);
    const items = await expiringSoon(req.ctx, q.days);
    const paths = await locationPaths(req.ctx.db, items.map((i) => i.locationId).filter(Boolean) as string[]);
    return {
      items: items.map((i) => ({ ...i, locationPath: i.locationId ? paths.get(i.locationId) ?? null : null })),
      today: req.ctx.today,
    };
  });

  app.get('/api/v1/stock/low', async (req) => ({ items: await lowStockList(req.ctx) }));

  app.get('/api/v1/stock/movements', async (req) => {
    const q = z.object({
      productId: z.string().optional(), limit: z.coerce.number().int().min(1).max(500).default(100),
    }).parse(req.query);
    const where = q.productId ? [eq(stockMovements.productId, q.productId)] : [];
    const rows = await req.ctx.db.select({ m: stockMovements, product: products.name })
      .from(stockMovements).innerJoin(products, eq(products.id, stockMovements.productId))
      .where(where.length ? and(...where) : undefined)
      .orderBy(desc(stockMovements.ts)).limit(q.limit);
    return { items: rows.map((r) => ({ ...r.m, product: r.product })) };
  });

  /** Inventory audit: confirm what is really on the shelf (FOOD-021). */
  app.post('/api/v1/stock/audit', async (req) => {
    requireWrite(req.ctx.user);
    const body = z.object({
      locationId: z.string(),
      counts: z.array(z.object({ stockItemId: z.string(), quantity: z.number().min(0) })),
    }).parse(req.body);
    const changed: string[] = [];
    for (const c of body.counts) {
      const lot = (await req.ctx.db.select().from(stockItems).where(eq(stockItems.id, c.stockItemId)).limit(1))[0];
      if (!lot || lot.quantity === c.quantity) continue;
      await req.ctx.db.update(stockItems)
        .set({ quantity: c.quantity, updatedBy: req.ctx.user!.id }).where(eq(stockItems.id, c.stockItemId));
      await req.ctx.db.insert(stockMovements).values({
        stockItemId: c.stockItemId, productId: lot.productId, delta: c.quantity - lot.quantity,
        unit: lot.unit, reason: 'audit', userId: req.ctx.user!.id,
      });
      changed.push(c.stockItemId);
      await reconcileLowStock(req.ctx, lot.productId);
    }
    return { auditedAt: new Date().toISOString(), locationId: body.locationId, changed: changed.length };
  });

  /* ── shopping lists (FOOD-009) ── */

  crudRoutes(app, '/api/v1/shopping-lists', {
    table: shoppingLists, entityType: 'shopping_list', label: 'Shopping list',
    create: z.object({
      name: z.string().trim().min(1), isDefault: z.boolean().optional(),
      storeContactId: z.string().nullable().optional(), sort: z.number().int().optional(),
    }),
    update: z.object({
      name: z.string().trim().min(1).optional(), isDefault: z.boolean().optional(),
      storeContactId: z.string().nullable().optional(), sort: z.number().int().optional(),
    }),
    searchColumns: ['name'],
  });

  app.get('/api/v1/shopping-lists/:id/lines', async (req) => {
    const id = (req.params as { id: string }).id;
    const rows = await req.ctx.db.select({ line: shoppingLines, product: products })
      .from(shoppingLines).leftJoin(products, eq(products.id, shoppingLines.productId))
      .where(and(eq(shoppingLines.listId, id), isNull(shoppingLines.deletedAt)))
      .orderBy(asc(shoppingLines.checkedAt), asc(shoppingLines.sort), asc(shoppingLines.createdAt));
    return {
      open: rows.filter((r) => !r.line.checkedAt).map(shape),
      checked: rows.filter((r) => r.line.checkedAt).map(shape),
    };
    function shape(r: { line: typeof shoppingLines.$inferSelect; product: typeof products.$inferSelect | null }) {
      return { ...r.line, product: r.product ? { id: r.product.id, name: r.product.name, defaultUnit: r.product.defaultUnit } : null };
    }
  });

  app.post('/api/v1/shopping-lists/:id/lines', async (req, reply) => {
    requireWrite(req.ctx.user);
    const id = (req.params as { id: string }).id;
    const body = z.object({
      productId: z.string().nullable().optional(),
      text: z.string().trim().min(1).optional(),
      quantity: z.number().positive().default(1),
      unit: z.string().optional(),
      note: z.string().nullable().optional(),
      storeContactId: z.string().nullable().optional(),
    }).parse(req.body);
    let text = body.text;
    if (!text && body.productId) {
      const p = (await req.ctx.db.select().from(products).where(eq(products.id, body.productId)).limit(1))[0];
      text = p?.name;
    }
    if (!text) throw badRequest('Give a product or some text');
    const row = await addToShoppingList(req.ctx, {
      listId: id, productId: body.productId ?? null, text,
      quantity: body.quantity, unit: body.unit, note: body.note ?? undefined,
      storeContactId: body.storeContactId ?? null, sourceType: 'manual',
    });
    reply.status(201);
    return row;
  });

  app.patch('/api/v1/shopping-lines/:id', async (req) => {
    requireWrite(req.ctx.user);
    const id = (req.params as { id: string }).id;
    const body = z.object({
      checked: z.boolean().optional(),
      quantity: z.number().positive().optional(),
      unit: z.string().optional(),
      text: z.string().trim().min(1).optional(),
      note: z.string().nullable().optional(),
    }).parse(req.body);
    const patch: Record<string, unknown> = { ...body };
    delete patch.checked;
    if (body.checked !== undefined) {
      patch.checkedAt = body.checked ? new Date().toISOString() : null;
      patch.checkedBy = body.checked ? req.ctx.user!.id : null;
    }
    const [row] = await req.ctx.db.update(shoppingLines)
      .set({ ...patch, updatedBy: req.ctx.user!.id }).where(eq(shoppingLines.id, id)).returning();
    if (!row) throw notFound('Shopping line');
    return row;
  });

  app.delete('/api/v1/shopping-lines/:id', async (req) => {
    requireWrite(req.ctx.user);
    await req.ctx.db.update(shoppingLines).set({ deletedAt: new Date().toISOString() })
      .where(eq(shoppingLines.id, (req.params as { id: string }).id));
    return { ok: true };
  });

  /**
   * Put-away (FOOD-010/011): turns a finished shopping trip into stock, one
   * transaction, and price history, in a single call.
   */
  app.post('/api/v1/shopping-lists/:id/put-away', async (req, reply) => {
    requireWrite(req.ctx.user);
    const listId = (req.params as { id: string }).id;
    const body = z.object({
      items: z.array(z.object({
        lineId: z.string(),
        productId: z.string().nullable().optional(),
        quantity: z.number().positive(),
        unit: z.string().optional(),
        locationId: z.string().nullable().optional(),
        expiryDate: dateStr.nullable().optional(),
        unitPrice: z.number().int().nullable().optional(),
      })).min(1),
      transaction: z.object({
        total: z.number().int().positive(),
        date: dateStr.optional(),
        payeeName: z.string().optional(),
        categoryId: z.string().optional(),
        accountId: z.string().optional(),
        memo: z.string().optional(),
      }).optional(),
      clearChecked: z.boolean().default(true),
    }).parse(req.body);

    let transactionId: string | null = null;
    if (body.transaction) {
      const { transaction } = await attachCost(req.ctx, {
        amount: body.transaction.total,
        date: body.transaction.date ?? req.ctx.today,
        payeeName: body.transaction.payeeName ?? null,
        categoryId: body.transaction.categoryId ?? null,
        accountId: body.transaction.accountId ?? null,
        memo: body.transaction.memo ?? 'Shopping trip',
      });
      transactionId = transaction.id;
    }

    // Spread the receipt total across the items so unit prices stay honest.
    const priced = body.items.map((i) => (i.unitPrice ?? 0) * i.quantity);
    const anyPriced = priced.some((p) => p > 0);
    const shares = body.transaction && !anyPriced
      ? distributeReceipt(body.transaction.total, body.items.map(() => 1))
      : body.transaction
        ? distributeReceipt(body.transaction.total, priced)
        : body.items.map(() => 0);

    const created = [];
    let embodied = 0;
    for (const [idx, item] of body.items.entries()) {
      const line = (await req.ctx.db.select().from(shoppingLines).where(eq(shoppingLines.id, item.lineId)).limit(1))[0];
      if (!line) continue;
      const productId = item.productId ?? line.productId;
      if (!productId) continue;
      const share = shares[idx] ?? 0;
      const unitPrice = item.unitPrice ?? (item.quantity > 0 ? Math.round(share / item.quantity) : null);
      const stock = await addStock(req.ctx, {
        productId,
        quantity: item.quantity,
        unit: item.unit ?? line.unit,
        locationId: item.locationId ?? null,
        expiryDate: item.expiryDate !== undefined
          ? item.expiryDate
          : await defaultExpiry(req.ctx, productId, item.locationId ?? null),
        purchasedAt: body.transaction?.date ?? req.ctx.today,
        transactionId,
        unitPrice,
      });
      if (transactionId) {
        await req.ctx.db.insert(transactionLineItems).values({
          transactionId, productId, description: line.text,
          quantity: item.quantity, unit: item.unit ?? line.unit, unitPrice: unitPrice ?? 0,
        });
      }
      await req.ctx.db.update(shoppingLines).set({
        checkedAt: new Date().toISOString(), checkedBy: req.ctx.user!.id,
        deletedAt: body.clearChecked ? new Date().toISOString() : null,
      }).where(eq(shoppingLines.id, item.lineId));
      await reconcileLowStock(req.ctx, productId);
      // One trip, both measures: the receipt and the footprint (INT-008).
      const carbon = await recordProductEmissions(req.ctx, {
        productId, quantity: item.quantity, unit: stock.unit,
        occurredOn: body.transaction?.date ?? req.ctx.today,
        transactionId, sourceType: 'stock_item', sourceId: stock.id,
        note: `Bought: ${line.text}`,
      });
      if (carbon) embodied += carbon.gCo2e;
      created.push(stock);
    }
    reply.status(201);
    return { listId, stockItems: created, transactionId, embodiedGCo2e: embodied };
  });

  /* ── waste (FOOD-013) ── */

  app.get('/api/v1/food/waste', async (req) => {
    const q = z.object({ from: dateStr.optional(), months: z.coerce.number().int().default(6) }).parse(req.query);
    const from = q.from ?? addDays(req.ctx.today, -30 * q.months);
    const rows = await req.ctx.db.select({ w: wasteLog, product: products.name })
      .from(wasteLog).innerJoin(products, eq(products.id, wasteLog.productId))
      .where(gte(wasteLog.ts, from)).orderBy(desc(wasteLog.ts)).limit(500);
    const byMonth = new Map<string, { count: number; cost: number }>();
    const byProduct = new Map<string, { count: number; cost: number; quantity: number }>();
    for (const r of rows) {
      const m = r.w.ts.slice(0, 7);
      const cur = byMonth.get(m) ?? { count: 0, cost: 0 };
      cur.count += 1; cur.cost += r.w.estCost ?? 0;
      byMonth.set(m, cur);
      const p = byProduct.get(r.product) ?? { count: 0, cost: 0, quantity: 0 };
      p.count += 1; p.cost += r.w.estCost ?? 0; p.quantity += r.w.quantity;
      byProduct.set(r.product, p);
    }
    const { emissions, activities: activityTable } = await import('../db/schema.js');
    const wasteCarbon = await req.ctx.db.select({
      total: sql<number>`coalesce(sum(${emissions.gCo2e}), 0)`,
    }).from(emissions)
      .innerJoin(activityTable, eq(activityTable.id, emissions.activityId))
      .where(and(
        eq(activityTable.sourceType, 'waste_log'),
        gte(activityTable.occurredOn, from),
        isNull(activityTable.deletedAt),
      ));
    return {
      items: rows.map((r) => ({ ...r.w, product: r.product })),
      totalCost: rows.reduce((a, b) => a + (b.w.estCost ?? 0), 0),
      totalGCo2e: Number(wasteCarbon[0]?.total ?? 0),
      byMonth: [...byMonth].sort().map(([month, v]) => ({ month, ...v })),
      byProduct: [...byProduct].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.cost - a.cost).slice(0, 20),
      currency: req.ctx.household.currency,
    };
  });

  /* ── price history (FOOD-014, BUD-018) ── */

  app.get('/api/v1/products/:id/prices', async (req) => {
    const id = (req.params as { id: string }).id;
    const rows = await req.ctx.db.select({
      li: transactionLineItems, date: transactions.date, payeeId: transactions.payeeId,
    }).from(transactionLineItems)
      .innerJoin(transactions, eq(transactions.id, transactionLineItems.transactionId))
      .where(and(eq(transactionLineItems.productId, id), isNull(transactions.deletedAt)))
      .orderBy(desc(transactions.date)).limit(200);
    const prices = rows.filter((r) => r.li.unitPrice > 0);
    const { payees } = await import('../db/schema.js');
    const payeeIds = [...new Set(prices.map((p) => p.payeeId).filter(Boolean))] as string[];
    const payeeRows = payeeIds.length
      ? await req.ctx.db.select().from(payees).where(inArray(payees.id, payeeIds)) : [];
    const payeeName = new Map(payeeRows.map((p) => [p.id, p.name]));
    const unit = prices.map((p) => p.li.unitPrice);
    return {
      items: prices.map((p) => ({
        date: p.date, unitPrice: p.li.unitPrice, quantity: p.li.quantity, unit: p.li.unit,
        vendor: p.payeeId ? payeeName.get(p.payeeId) ?? null : null,
      })),
      last: unit[0] ?? null,
      lowest: unit.length ? Math.min(...unit) : null,
      average: unit.length ? Math.round(unit.reduce((a, b) => a + b, 0) / unit.length) : null,
      currency: req.ctx.household.currency,
    };
  });

  /* ── recipes (FOOD-015) ── */

  crudRoutes(app, '/api/v1/recipes', {
    table: recipes, entityType: 'recipe', label: 'Recipe',
    create: z.object({
      name: z.string().trim().min(1), servings: z.number().positive().default(2),
      prepMin: z.number().int().nullable().optional(), cookMin: z.number().int().nullable().optional(),
      stepsMd: z.string().nullable().optional(), sourceUrl: z.string().nullable().optional(),
    }),
    update: z.object({
      name: z.string().trim().min(1).optional(), servings: z.number().positive().optional(),
      prepMin: z.number().int().nullable().optional(), cookMin: z.number().int().nullable().optional(),
      stepsMd: z.string().nullable().optional(), sourceUrl: z.string().nullable().optional(),
    }),
    searchColumns: ['name', 'stepsMd'],
  });

  app.put('/api/v1/recipes/:id/ingredients', async (req) => {
    requireWrite(req.ctx.user);
    const id = (req.params as { id: string }).id;
    const body = z.object({
      items: z.array(z.object({
        productId: z.string().nullable().optional(), text: z.string().trim().min(1),
        quantity: z.number().positive().default(1), unit: z.string().default('ea'),
        optional: z.boolean().optional(),
      })),
    }).parse(req.body);
    await req.ctx.db.delete(recipeIngredients).where(eq(recipeIngredients.recipeId, id));
    if (body.items.length) {
      await req.ctx.db.insert(recipeIngredients)
        .values(body.items.map((i, idx) => ({ recipeId: id, ...i, sort: idx })));
    }
    return { recipeId: id, count: body.items.length };
  });

  /** "Can I make this?" against what is actually in the house. */
  app.get('/api/v1/recipes/:id/availability', async (req) => {
    const id = (req.params as { id: string }).id;
    const recipe = (await req.ctx.db.select().from(recipes).where(eq(recipes.id, id)).limit(1))[0];
    if (!recipe) throw notFound('Recipe');
    const ings = await req.ctx.db.select({ i: recipeIngredients, p: products })
      .from(recipeIngredients).leftJoin(products, eq(products.id, recipeIngredients.productId))
      .where(eq(recipeIngredients.recipeId, id)).orderBy(asc(recipeIngredients.sort));
    const productIds = ings.map((r) => r.i.productId).filter(Boolean) as string[];
    const have = await onHandMany(req.ctx, productIds);
    const lines = ings.map((r) => {
      const onHandQty = r.i.productId ? have.get(r.i.productId) ?? 0 : null;
      return {
        ...r.i,
        productName: r.p?.name ?? null,
        onHand: onHandQty,
        enough: onHandQty == null ? null : onHandQty >= r.i.quantity,
      };
    });
    const missing = lines.filter((l) => l.enough === false && !l.optional);
    return {
      recipe, ingredients: lines, canMake: missing.length === 0,
      missing: missing.map((m) => ({ productId: m.productId, text: m.text, need: m.quantity - (m.onHand ?? 0), unit: m.unit })),
      unknown: lines.filter((l) => l.enough === null).length,
    };
  });

  app.post('/api/v1/recipes/:id/add-missing', async (req) => {
    requireWrite(req.ctx.user);
    const id = (req.params as { id: string }).id;
    const ings = await req.ctx.db.select({ i: recipeIngredients, p: products })
      .from(recipeIngredients).leftJoin(products, eq(products.id, recipeIngredients.productId))
      .where(eq(recipeIngredients.recipeId, id));
    const have = await onHandMany(req.ctx, ings.map((r) => r.i.productId).filter(Boolean) as string[]);
    const listId = await defaultShoppingList(req.ctx);
    const added: string[] = [];
    for (const r of ings) {
      const onHandQty = r.i.productId ? have.get(r.i.productId) ?? 0 : 0;
      if (r.i.productId && onHandQty >= r.i.quantity) continue;
      const need = Math.max(r.i.quantity - onHandQty, r.i.productId ? 0.01 : r.i.quantity);
      await addToShoppingList(req.ctx, {
        listId, productId: r.i.productId ?? null, text: r.p?.name ?? r.i.text,
        quantity: Number(need.toFixed(2)), unit: r.i.unit, sourceType: 'recipe', sourceId: id,
      });
      added.push(r.p?.name ?? r.i.text);
    }
    return { listId, added };
  });

  app.post('/api/v1/recipes/:id/cook', async (req) => {
    requireWrite(req.ctx.user);
    const id = (req.params as { id: string }).id;
    const body = z.object({ servingsMultiplier: z.number().positive().default(1) }).parse(req.body ?? {});
    const ings = await req.ctx.db.select().from(recipeIngredients).where(eq(recipeIngredients.recipeId, id));
    const results = [];
    for (const i of ings) {
      if (!i.productId) continue;
      results.push({
        productId: i.productId,
        ...(await consumeStock(req.ctx, {
          productId: i.productId, quantity: i.quantity * body.servingsMultiplier, unit: i.unit,
          reason: 'consume', refType: 'recipe', refId: id,
        })),
      });
    }
    return { recipeId: id, consumed: results };
  });
}

function minDate(a: string | null, b: string): string {
  if (!a) return b;
  return a < b ? a : b;
}
