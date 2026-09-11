/* eslint-disable @typescript-eslint/no-explicit-any */
import { and, asc, desc, eq, isNull, isNotNull, lte, sql, inArray } from 'drizzle-orm';
import { addDays, convert, areCompatible, diffDays, type StockReason } from '@homestead/shared';
import type { Ctx } from '../core/ctx.js';
import { badRequest, notFound } from '../core/errors.js';
import {
  locations, products, shoppingLines, shoppingLists, stockItems, stockMovements, wasteLog,
} from '../db/schema.js';

/** Converts a quantity into the product's default unit, or refuses clearly. */
export function toDefaultUnit(qty: number, unit: string, defaultUnit: string): number {
  if (unit === defaultUnit) return qty;
  if (!areCompatible(unit, defaultUnit)) {
    throw badRequest(`Cannot combine ${unit} with ${defaultUnit}`);
  }
  return convert(qty, unit, defaultUnit);
}

export async function onHand(ctx: Ctx, productId: string): Promise<number> {
  const rows = await ctx.db.select({ q: stockItems.quantity, u: stockItems.unit })
    .from(stockItems).where(and(eq(stockItems.productId, productId), isNull(stockItems.deletedAt)));
  if (!rows.length) return 0;
  const p = await ctx.db.select({ defaultUnit: products.defaultUnit })
    .from(products).where(eq(products.id, productId)).limit(1);
  const du = p[0]?.defaultUnit ?? 'ea';
  return rows.reduce((sum, r) => {
    try { return sum + toDefaultUnit(r.q, r.u, du); } catch { return sum + r.q; }
  }, 0);
}

export async function onHandMany(ctx: Ctx, productIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!productIds.length) return out;
  const rows = await ctx.db.select({
    productId: stockItems.productId, q: stockItems.quantity, u: stockItems.unit,
  }).from(stockItems).where(and(inArray(stockItems.productId, productIds), isNull(stockItems.deletedAt)));
  const defs = await ctx.db.select({ id: products.id, defaultUnit: products.defaultUnit })
    .from(products).where(inArray(products.id, productIds));
  const du = new Map(defs.map((d) => [d.id, d.defaultUnit]));
  for (const id of productIds) out.set(id, 0);
  for (const r of rows) {
    const unit = du.get(r.productId) ?? 'ea';
    let q = r.q;
    try { q = toDefaultUnit(r.q, r.u, unit); } catch { /* incompatible: count as-is */ }
    out.set(r.productId, (out.get(r.productId) ?? 0) + q);
  }
  return out;
}

export interface AddStockArgs {
  productId: string;
  quantity: number;
  unit?: string;
  locationId?: string | null;
  expiryDate?: string | null;
  purchasedAt?: string | null;
  transactionId?: string | null;
  unitPrice?: number | null;
  note?: string | null;
}

/** Default expiry from the product's shelf life for the target area (FOOD-004). */
export async function defaultExpiry(
  ctx: Ctx, productId: string, locationId: string | null | undefined, from = ctx.today,
): Promise<string | null> {
  const p = (await ctx.db.select().from(products).where(eq(products.id, productId)).limit(1))[0];
  if (!p?.shelfLife) return null;
  let tempClass = 'ambient';
  if (locationId) {
    const loc = (await ctx.db.select({ t: locations.temperatureClass })
      .from(locations).where(eq(locations.id, locationId)).limit(1))[0];
    if (loc?.t) tempClass = loc.t;
  }
  const days = p.shelfLife[tempClass] ?? p.shelfLife.ambient;
  return typeof days === 'number' ? addDays(from, days) : null;
}

export async function addStock(ctx: Ctx, args: AddStockArgs): Promise<typeof stockItems.$inferSelect> {
  const p = (await ctx.db.select().from(products).where(eq(products.id, args.productId)).limit(1))[0];
  if (!p) throw notFound('Product');
  if (args.quantity <= 0) throw badRequest('Quantity must be greater than zero');
  const unit = args.unit ?? p.defaultUnit;
  const expiry = args.expiryDate !== undefined
    ? args.expiryDate
    : await defaultExpiry(ctx, args.productId, args.locationId ?? p.defaultLocationId);

  const [row] = await ctx.db.insert(stockItems).values({
    productId: args.productId,
    locationId: args.locationId ?? p.defaultLocationId ?? null,
    quantity: args.quantity,
    unit,
    expiryDate: expiry,
    purchasedAt: args.purchasedAt ?? ctx.today,
    transactionId: args.transactionId ?? null,
    unitPrice: args.unitPrice ?? null,
    note: args.note ?? null,
    createdBy: ctx.user?.id ?? null,
    updatedBy: ctx.user?.id ?? null,
  }).returning();

  await ctx.db.insert(stockMovements).values({
    stockItemId: row!.id, productId: args.productId, delta: args.quantity, unit,
    reason: 'add', userId: ctx.user?.id ?? null,
  });
  return row!;
}

export interface ConsumeArgs {
  productId: string;
  quantity: number;
  unit?: string;
  reason?: StockReason;
  wasteReason?: string;
  refType?: string;
  refId?: string;
  locationId?: string | null;
  note?: string;
}

export interface ConsumeResult {
  consumed: number;
  shortfall: number;
  unit: string;
  lots: Array<{ stockItemId: string; taken: number }>;
  lowStock: boolean;
}

/**
 * Takes stock from the lots that expire soonest, so the pantry drains in the
 * order a person actually would (FOOD-006). A shortfall is reported, not an
 * error: the physical world does not roll back.
 */
export async function consumeStock(ctx: Ctx, args: ConsumeArgs): Promise<ConsumeResult> {
  const p = (await ctx.db.select().from(products).where(eq(products.id, args.productId)).limit(1))[0];
  if (!p) throw notFound('Product');
  if (args.quantity <= 0) throw badRequest('Quantity must be greater than zero');
  const unit = args.unit ?? p.defaultUnit;
  let remaining = toDefaultUnit(args.quantity, unit, p.defaultUnit);
  const reason = args.reason ?? 'consume';

  const where = [eq(stockItems.productId, args.productId), isNull(stockItems.deletedAt), sql`${stockItems.quantity} > 0`];
  if (args.locationId) where.push(eq(stockItems.locationId, args.locationId));
  const lots = await ctx.db.select().from(stockItems).where(and(...where))
    // Opened lots first, then soonest expiry, then oldest purchase.
    .orderBy(desc(isNotNull(stockItems.openedAt)), asc(sql`coalesce(${stockItems.expiryDate}, '9999-12-31')`), asc(stockItems.purchasedAt));

  const taken: Array<{ stockItemId: string; taken: number }> = [];
  for (const lot of lots) {
    if (remaining <= 1e-9) break;
    let lotQty: number;
    try { lotQty = toDefaultUnit(lot.quantity, lot.unit, p.defaultUnit); } catch { continue; }
    const take = Math.min(lotQty, remaining);
    const newQty = lotQty - take;
    const backToLotUnit = lot.unit === p.defaultUnit ? newQty : convert(newQty, p.defaultUnit, lot.unit);
    await ctx.db.update(stockItems)
      .set({ quantity: Number(backToLotUnit.toFixed(6)), updatedBy: ctx.user?.id ?? null })
      .where(eq(stockItems.id, lot.id));
    await ctx.db.insert(stockMovements).values({
      stockItemId: lot.id, productId: args.productId, delta: -take, unit: p.defaultUnit,
      reason, userId: ctx.user?.id ?? null, refType: args.refType, refId: args.refId, note: args.note,
    });
    if (reason === 'waste') {
      await ctx.db.insert(wasteLog).values({
        stockItemId: lot.id, productId: args.productId, quantity: take, unit: p.defaultUnit,
        reason: args.wasteReason ?? 'expired',
        estCost: lot.unitPrice ? Math.round(lot.unitPrice * take) : null,
        userId: ctx.user?.id ?? null,
      });
    }
    taken.push({ stockItemId: lot.id, taken: take });
    remaining -= take;
  }

  const consumed = toDefaultUnit(args.quantity, unit, p.defaultUnit) - Math.max(remaining, 0);
  const low = await reconcileLowStock(ctx, args.productId);
  return {
    consumed: Number(consumed.toFixed(6)),
    shortfall: Number(Math.max(remaining, 0).toFixed(6)),
    unit: p.defaultUnit,
    lots: taken,
    lowStock: low,
  };
}

export async function defaultShoppingList(ctx: Ctx): Promise<string> {
  const rows = await ctx.db.select().from(shoppingLists)
    .where(and(eq(shoppingLists.isDefault, true), isNull(shoppingLists.deletedAt))).limit(1);
  if (rows[0]) return rows[0].id;
  const any = await ctx.db.select().from(shoppingLists).where(isNull(shoppingLists.deletedAt)).limit(1);
  if (any[0]) return any[0].id;
  const [made] = await ctx.db.insert(shoppingLists)
    .values({ name: 'Shopping', isDefault: true, createdBy: ctx.user?.id ?? null }).returning();
  return made!.id;
}

/**
 * Keeps the shopping list in step with par levels (FOOD-008): adds a line when
 * stock drops below the minimum, and withdraws its own line when it recovers.
 */
export async function reconcileLowStock(ctx: Ctx, productId: string): Promise<boolean> {
  const p = (await ctx.db.select().from(products).where(eq(products.id, productId)).limit(1))[0];
  if (!p || p.minQuantity == null || !p.autoShopping) return false;
  const have = await onHand(ctx, productId);
  const isLow = have < p.minQuantity;

  const existing = await ctx.db.select().from(shoppingLines).where(and(
    eq(shoppingLines.productId, productId),
    eq(shoppingLines.sourceType, 'low_stock'),
    isNull(shoppingLines.checkedAt),
    isNull(shoppingLines.deletedAt),
  )).limit(1);

  if (isLow && !existing[0]) {
    const listId = await defaultShoppingList(ctx);
    const want = Math.max(p.minQuantity - have, 1);
    await ctx.db.insert(shoppingLines).values({
      listId, productId, text: p.name, quantity: Number(want.toFixed(2)), unit: p.defaultUnit,
      sourceType: 'low_stock', sourceId: productId, createdBy: ctx.user?.id ?? null,
    });
  } else if (!isLow && existing[0]) {
    await ctx.db.update(shoppingLines)
      .set({ deletedAt: new Date().toISOString() }).where(eq(shoppingLines.id, existing[0].id));
  }
  return isLow;
}

export async function addToShoppingList(
  ctx: Ctx,
  args: { productId?: string | null; text: string; quantity?: number; unit?: string; listId?: string;
    sourceType?: string; sourceId?: string; note?: string; storeContactId?: string | null },
): Promise<typeof shoppingLines.$inferSelect> {
  const listId = args.listId ?? (await defaultShoppingList(ctx));
  // One open line per product, whatever asked for it. Two lines for the same
  // thing is always a mistake in a shop; keep the larger quantity.
  if (args.productId) {
    const dupe = await ctx.db.select().from(shoppingLines).where(and(
      eq(shoppingLines.listId, listId), eq(shoppingLines.productId, args.productId),
      isNull(shoppingLines.checkedAt), isNull(shoppingLines.deletedAt),
    )).limit(1);
    if (dupe[0]) {
      const wanted = args.quantity ?? 1;
      if (wanted > dupe[0].quantity) {
        const [bumped] = await ctx.db.update(shoppingLines)
          .set({ quantity: wanted, note: args.note ?? dupe[0].note, updatedBy: ctx.user?.id ?? null })
          .where(eq(shoppingLines.id, dupe[0].id)).returning();
        return bumped!;
      }
      return dupe[0];
    }
  }
  const [row] = await ctx.db.insert(shoppingLines).values({
    listId, productId: args.productId ?? null, text: args.text,
    quantity: args.quantity ?? 1, unit: args.unit ?? 'ea',
    sourceType: args.sourceType ?? 'manual', sourceId: args.sourceId ?? null,
    note: args.note ?? null, storeContactId: args.storeContactId ?? null,
    createdBy: ctx.user?.id ?? null,
  }).returning();
  return row!;
}

export async function expiringSoon(ctx: Ctx, days = 7): Promise<Array<{
  id: string; productId: string; product: string; quantity: number; unit: string;
  expiryDate: string; locationId: string | null; daysLeft: number;
}>> {
  const cutoff = addDays(ctx.today, days);
  const rows = await ctx.db.select({
    s: stockItems, name: products.name,
  }).from(stockItems).innerJoin(products, eq(products.id, stockItems.productId))
    .where(and(
      isNull(stockItems.deletedAt), isNotNull(stockItems.expiryDate),
      lte(stockItems.expiryDate, cutoff), sql`${stockItems.quantity} > 0`,
    )).orderBy(asc(stockItems.expiryDate)).limit(200);
  return rows.map((r) => ({
    id: r.s.id, productId: r.s.productId, product: r.name,
    quantity: r.s.quantity, unit: r.s.unit, expiryDate: r.s.expiryDate!,
    locationId: r.s.locationId, daysLeft: diffDays(r.s.expiryDate!, ctx.today),
  }));
}

export async function lowStockList(ctx: Ctx): Promise<Array<{
  productId: string; name: string; onHand: number; unit: string; minQuantity: number;
}>> {
  const rows = await ctx.db.select().from(products)
    .where(and(isNotNull(products.minQuantity), isNull(products.deletedAt)));
  if (!rows.length) return [];
  const have = await onHandMany(ctx, rows.map((r) => r.id));
  return rows
    .map((p) => ({
      productId: p.id, name: p.name, onHand: have.get(p.id) ?? 0,
      unit: p.defaultUnit, minQuantity: p.minQuantity!,
    }))
    .filter((r) => r.onHand < r.minQuantity)
    .sort((a, b) => (a.onHand / a.minQuantity) - (b.onHand / b.minQuantity));
}
