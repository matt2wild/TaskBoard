/* eslint-disable @typescript-eslint/no-explicit-any */
import { and, eq, isNull } from 'drizzle-orm';
import type { ScheduleSpec } from '@homestead/shared';
import type { Ctx } from '../core/ctx.js';
import { notFound } from '../core/errors.js';
import {
  assets, maintenanceConsumption, maintenancePlans, maintenanceRecords,
  planConsumables, products, schedules, tasks,
} from '../db/schema.js';
import { attachCost } from './budget.js';
import { addToShoppingList, consumeStock, onHand } from './stock.js';
import { materialiseSchedule, onTaskComplete, upsertSchedule } from './tasks.js';

export interface CompleteMaintenanceExtra {
  cost?: { amount: number; categoryId?: string; payeeName?: string; memo?: string; accountId?: string };
  consumables?: Array<{ productId: string; quantity: number; unit?: string }>;
  readings?: Array<{ metric: string; value: number; unit?: string }>;
  performerContactId?: string | null;
  notesMd?: string;
  kind?: 'planned' | 'adhoc' | 'repair' | 'inspection';
}

/**
 * Recording maintenance is the moment several modules move at once: history is
 * written, money is booked against the asset, stock comes off the shelf, and a
 * short pantry triggers a shopping line (MAINT-003, MAINT-013).
 */
export async function recordMaintenance(
  ctx: Ctx,
  args: {
    planId?: string | null;
    targetType: string;
    targetId: string;
    taskId?: string | null;
    title: string;
    performedAt?: string;
    minutes?: number | null;
    extra?: CompleteMaintenanceExtra;
  },
): Promise<{ record: typeof maintenanceRecords.$inferSelect; stock: unknown[]; transactionId: string | null; shoppingAdded: string[] }> {
  const extra = args.extra ?? {};
  const performedAt = args.performedAt ?? ctx.today;

  let transactionId: string | null = null;
  if (extra.cost && extra.cost.amount > 0) {
    const { transaction } = await attachCost(ctx, {
      amount: extra.cost.amount,
      date: performedAt,
      categoryId: extra.cost.categoryId ?? null,
      payeeName: extra.cost.payeeName ?? null,
      accountId: extra.cost.accountId ?? null,
      memo: extra.cost.memo ?? args.title,
      attributions: [{ entityType: args.targetType, entityId: args.targetId }],
    });
    transactionId = transaction.id;
  }

  const [record] = await ctx.db.insert(maintenanceRecords).values({
    planId: args.planId ?? null,
    targetType: args.targetType,
    targetId: args.targetId,
    taskId: args.taskId ?? null,
    kind: extra.kind ?? (args.planId ? 'planned' : 'adhoc'),
    title: args.title,
    performedAt,
    performerUserId: extra.performerContactId ? null : ctx.user?.id ?? null,
    performerContactId: extra.performerContactId ?? null,
    costTransactionId: transactionId,
    minutes: args.minutes ?? null,
    notesMd: extra.notesMd ?? null,
    createdBy: ctx.user?.id ?? null,
    updatedBy: ctx.user?.id ?? null,
  }).returning();

  // Attribute the cost to the record too, so maintenance reporting can roll up.
  if (transactionId) {
    const { splitAttributions, transactionSplits } = await import('../db/schema.js');
    const splits = await ctx.db.select().from(transactionSplits)
      .where(eq(transactionSplits.transactionId, transactionId));
    if (splits[0]) {
      await ctx.db.insert(splitAttributions)
        .values({ splitId: splits[0].id, entityType: 'maintenance_record', entityId: record!.id });
    }
  }

  const stock: unknown[] = [];
  const shoppingAdded: string[] = [];
  for (const c of extra.consumables ?? []) {
    const result = await consumeStock(ctx, {
      productId: c.productId, quantity: c.quantity, unit: c.unit,
      reason: 'consume', refType: 'maintenance_record', refId: record!.id,
    });
    await ctx.db.insert(maintenanceConsumption).values({
      recordId: record!.id, productId: c.productId, quantity: c.quantity, unit: c.unit ?? 'ea',
    });
    stock.push({ productId: c.productId, ...result });
    // Only the shortfall is ours to raise: falling below par is already
    // handled inside consumeStock, and two lines for one product is a bug.
    if (result.shortfall > 0) {
      const p = (await ctx.db.select().from(products).where(eq(products.id, c.productId)).limit(1))[0];
      if (p) {
        await addToShoppingList(ctx, {
          productId: p.id, text: p.name, quantity: Math.max(result.shortfall, 1), unit: p.defaultUnit,
          sourceType: 'maintenance', sourceId: record!.id,
        });
        shoppingAdded.push(p.name);
      }
    }
  }

  if (extra.readings?.length && args.targetType === 'asset') {
    const { readings } = await import('../db/schema.js');
    await ctx.db.insert(readings).values(extra.readings.map((r) => ({
      assetId: args.targetId, metric: r.metric, value: r.value, unit: r.unit ?? null,
      takenAt: new Date().toISOString(), createdBy: ctx.user?.id ?? null,
    })));
  }

  return { record: record!, stock, transactionId, shoppingAdded };
}

/** Wires maintenance tasks into the task engine's completion hook. */
export function registerMaintenanceHooks(): void {
  onTaskComplete('maintenance', async (ctx, task, payload) => {
    if (!task.originId) return null;
    const plan = (await ctx.db.select().from(maintenancePlans)
      .where(eq(maintenancePlans.id, task.originId)).limit(1))[0];
    if (!plan) return null;
    const extra = (payload.extra ?? {}) as CompleteMaintenanceExtra;
    // Default the consumables to what the plan says it eats, so the common
    // case is one tap rather than a form.
    if (!extra.consumables) {
      const planned = await ctx.db.select().from(planConsumables)
        .where(eq(planConsumables.planId, plan.id));
      extra.consumables = planned.map((p) => ({ productId: p.productId, quantity: p.quantity, unit: p.unit }));
    }
    return recordMaintenance(ctx, {
      planId: plan.id,
      targetType: plan.targetType,
      targetId: plan.targetId,
      taskId: task.id,
      title: plan.title,
      performedAt: payload.completedAt ?? ctx.today,
      minutes: payload.actualMin ?? plan.estimateMin ?? null,
      extra,
    });
  });
}

/** Reading thresholds can bring a plan forward (MAINT-009). */
export async function checkReadingTriggers(
  ctx: Ctx, assetId: string, metric: string, value: number,
): Promise<string[]> {
  const plans = await ctx.db.select().from(maintenancePlans).where(and(
    eq(maintenancePlans.targetType, 'asset'),
    eq(maintenancePlans.targetId, assetId),
    eq(maintenancePlans.active, true),
    isNull(maintenancePlans.deletedAt),
  ));
  const fired: string[] = [];
  for (const plan of plans) {
    const trig = plan.readingTrigger;
    if (!trig || trig.metric !== metric) continue;
    const hit = trig.op === 'lt' ? value < trig.value : value > trig.value;
    if (!hit || !plan.scheduleId) continue;
    // Pull the next instance forward to today rather than creating a duplicate.
    const open = await ctx.db.select().from(tasks).where(and(
      eq(tasks.scheduleId, plan.scheduleId), eq(tasks.status, 'open'), isNull(tasks.deletedAt),
    )).limit(1);
    if (open[0]) {
      await ctx.db.update(tasks).set({ dueDate: ctx.today, priority: 'high' }).where(eq(tasks.id, open[0].id));
    } else {
      await ctx.db.update(schedules).set({ anchorDate: ctx.today }).where(eq(schedules.id, plan.scheduleId));
      await materialiseSchedule(ctx, plan.scheduleId);
    }
    fired.push(plan.id);
  }
  return fired;
}

/** Instantiates the shipped template library for an asset's category (MAINT-005). */
export async function applyTemplates(
  ctx: Ctx, assetId: string, templateIds: string[],
): Promise<Array<{ planId: string; title: string }>> {
  const asset = (await ctx.db.select().from(assets).where(eq(assets.id, assetId)).limit(1))[0];
  if (!asset) throw notFound('Asset');
  const { maintenanceTemplates } = await import('../db/schema.js');
  const made: Array<{ planId: string; title: string }> = [];
  for (const id of templateIds) {
    const t = (await ctx.db.select().from(maintenanceTemplates)
      .where(eq(maintenanceTemplates.id, id)).limit(1))[0];
    if (!t) continue;
    const [plan] = await ctx.db.insert(maintenancePlans).values({
      targetType: 'asset', targetId: assetId, title: t.title, descriptionMd: t.descriptionMd,
      estimateMin: t.estimateMin, diy: t.diy, checklist: t.checklist, seasonTags: t.seasonTags,
      createdBy: ctx.user?.id ?? null, updatedBy: ctx.user?.id ?? null,
    }).returning();
    const spec: ScheduleSpec = {
      mode: t.mode as ScheduleSpec['mode'],
      rrule: t.rrule,
      every: t.every ?? null,
      anchorDate: asset.installedDate ?? asset.purchaseDate ?? ctx.today,
    };
    const scheduleId = await upsertSchedule(ctx, {
      spec, originType: 'maintenance', originId: plan!.id,
      template: { title: `${t.title} — ${asset.name}`, descriptionMd: t.descriptionMd, checklist: t.checklist ?? [], estimateMin: t.estimateMin, propertyId: asset.propertyId, locationId: asset.locationId },
    });
    await ctx.db.update(maintenancePlans).set({ scheduleId }).where(eq(maintenancePlans.id, plan!.id));
    made.push({ planId: plan!.id, title: t.title });
  }
  return made;
}

/** "What do I need before I start?" (INT-006). */
export async function planReadiness(ctx: Ctx, planId: string): Promise<{
  tools: Array<{ assetId: string; name: string; status: string; available: boolean }>;
  consumables: Array<{ productId: string; name: string; needed: number; onHand: number; unit: string; enough: boolean }>;
}> {
  const { planTools, toolProfiles } = await import('../db/schema.js');
  const toolRows = await ctx.db.select({ asset: assets, profile: toolProfiles })
    .from(planTools)
    .innerJoin(assets, eq(assets.id, planTools.assetId))
    .leftJoin(toolProfiles, eq(toolProfiles.assetId, planTools.assetId))
    .where(eq(planTools.planId, planId));
  const consumableRows = await ctx.db.select({ pc: planConsumables, product: products })
    .from(planConsumables).innerJoin(products, eq(products.id, planConsumables.productId))
    .where(eq(planConsumables.planId, planId));

  const consumables = [];
  for (const r of consumableRows) {
    const have = await onHand(ctx, r.product.id);
    consumables.push({
      productId: r.product.id, name: r.product.name, needed: r.pc.quantity,
      onHand: have, unit: r.pc.unit, enough: have >= r.pc.quantity,
    });
  }
  return {
    tools: toolRows.map((r) => ({
      assetId: r.asset.id, name: r.asset.name,
      status: r.profile?.status ?? 'available',
      available: (r.profile?.status ?? 'available') === 'available',
    })),
    consumables,
  };
}
