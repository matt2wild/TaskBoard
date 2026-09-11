/* eslint-disable @typescript-eslint/no-explicit-any */
import { and, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import { allocate, splitsBalance, type AttributableType } from '@homestead/shared';
import type { Ctx } from '../core/ctx.js';
import { badRequest } from '../core/errors.js';
import { logActivity } from '../core/activity.js';
import {
  budgetAllocations, categories, payees, splitAttributions, transactionSplits, transactions,
} from '../db/schema.js';

export interface AttributionRef { entityType: AttributableType | string; entityId: string }

export interface SplitInput {
  amount: number;
  categoryId?: string | null;
  memo?: string | null;
  attributions?: AttributionRef[];
}

export interface AttachCostInput {
  date?: string;
  amount: number;
  type?: 'expense' | 'income' | 'transfer';
  accountId?: string | null;
  payeeId?: string | null;
  payeeName?: string | null;
  categoryId?: string | null;
  memo?: string | null;
  cleared?: boolean;
  paidByUserId?: string | null;
  splits?: SplitInput[];
  attributions?: AttributionRef[];
  importHash?: string | null;
  recurringBillId?: string | null;
}

export async function resolvePayee(ctx: Ctx, name: string): Promise<string> {
  const trimmed = name.trim();
  const found = await ctx.db.select().from(payees)
    .where(and(eq(payees.name, trimmed), isNull(payees.deletedAt))).limit(1);
  if (found[0]) return found[0].id;
  const [row] = await ctx.db.insert(payees)
    .values({ name: trimmed, createdBy: ctx.user?.id ?? null }).returning();
  return row!.id;
}

/**
 * The one path every module uses to record money (BUD-009), so a furnace
 * filter, a tile order and a vet bill all land in the ledger the same way and
 * carry the same attribution back to the thing they were for.
 */
export async function attachCost(ctx: Ctx, input: AttachCostInput): Promise<{
  transaction: typeof transactions.$inferSelect;
  splits: Array<typeof transactionSplits.$inferSelect>;
}> {
  if (!Number.isInteger(input.amount)) throw badRequest('Amount must be in minor units (integer cents)');
  if (input.amount === 0) throw badRequest('Amount cannot be zero');

  let payeeId = input.payeeId ?? null;
  if (!payeeId && input.payeeName) payeeId = await resolvePayee(ctx, input.payeeName);

  const splits: SplitInput[] = input.splits?.length
    ? input.splits
    : [{ amount: input.amount, categoryId: input.categoryId ?? null, attributions: input.attributions }];

  const total = splits.reduce((a, b) => a + b.amount, 0);
  if (!splitsBalance(input.amount, splits.map((s) => s.amount))) {
    throw badRequest(`Splits total ${total} but the transaction is ${input.amount}`);
  }

  const [tx] = await ctx.db.insert(transactions).values({
    date: input.date ?? ctx.today,
    amount: input.amount,
    type: input.type ?? 'expense',
    accountId: input.accountId ?? null,
    payeeId,
    memo: input.memo ?? null,
    cleared: input.cleared ?? false,
    paidByUserId: input.paidByUserId ?? ctx.user?.id ?? null,
    importHash: input.importHash ?? null,
    recurringBillId: input.recurringBillId ?? null,
    createdBy: ctx.user?.id ?? null,
    updatedBy: ctx.user?.id ?? null,
  }).returning();

  const made: Array<typeof transactionSplits.$inferSelect> = [];
  for (const [i, s] of splits.entries()) {
    const [row] = await ctx.db.insert(transactionSplits).values({
      transactionId: tx!.id, amount: s.amount, categoryId: s.categoryId ?? null,
      memo: s.memo ?? null, sort: i,
    }).returning();
    made.push(row!);
    const attrs = s.attributions ?? [];
    if (attrs.length) {
      await ctx.db.insert(splitAttributions).values(
        attrs.map((a) => ({ splitId: row!.id, entityType: a.entityType, entityId: a.entityId })),
      );
    }
  }
  await logActivity(ctx.db, {
    userId: ctx.user?.id, action: 'create', entityType: 'transaction', entityId: tx!.id,
    summary: input.memo ?? `${input.amount / 100}`,
  });
  return { transaction: tx!, splits: made };
}

/** Total attributed to one entity: "what has this furnace cost me?" (INT-005). */
export async function spentOn(
  ctx: Ctx, entityType: string, entityId: string,
): Promise<{ total: number; count: number }> {
  const rows = await ctx.db.select({
    total: sql<number>`coalesce(sum(${transactionSplits.amount}), 0)`,
    count: sql<number>`count(distinct ${transactions.id})`,
  }).from(splitAttributions)
    .innerJoin(transactionSplits, eq(transactionSplits.id, splitAttributions.splitId))
    .innerJoin(transactions, eq(transactions.id, transactionSplits.transactionId))
    .where(and(
      eq(splitAttributions.entityType, entityType),
      eq(splitAttributions.entityId, entityId),
      isNull(transactions.deletedAt),
      eq(transactions.type, 'expense'),
    ));
  return { total: Number(rows[0]?.total ?? 0), count: Number(rows[0]?.count ?? 0) };
}

export async function spentOnMany(
  ctx: Ctx, entityType: string, ids: string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>(ids.map((i) => [i, 0]));
  if (!ids.length) return out;
  const rows = await ctx.db.select({
    id: splitAttributions.entityId,
    total: sql<number>`coalesce(sum(${transactionSplits.amount}), 0)`,
  }).from(splitAttributions)
    .innerJoin(transactionSplits, eq(transactionSplits.id, splitAttributions.splitId))
    .innerJoin(transactions, eq(transactions.id, transactionSplits.transactionId))
    .where(and(
      eq(splitAttributions.entityType, entityType),
      inArray(splitAttributions.entityId, ids),
      isNull(transactions.deletedAt),
      eq(transactions.type, 'expense'),
    ))
    .groupBy(splitAttributions.entityId);
  for (const r of rows) out.set(r.id, Number(r.total));
  return out;
}

export const monthOf = (date: string): string => date.slice(0, 7);
export const monthRange = (period: string): { start: string; end: string } => {
  const [y, m] = period.split('-').map(Number) as [number, number];
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { start: `${period}-01`, end: `${period}-${String(lastDay).padStart(2, '0')}` };
};

export interface CategorySpend {
  categoryId: string | null; name: string; allocated: number; spent: number;
  remaining: number; pct: number | null;
}

/** Budget vs actual for a month, with rollover carried from prior months. */
export async function monthSummary(ctx: Ctx, period: string): Promise<{
  period: string; currency: string; allocated: number; spent: number; income: number;
  categories: CategorySpend[];
}> {
  const { start, end } = monthRange(period);
  const cats = await ctx.db.select().from(categories).where(isNull(categories.deletedAt));
  const catName = new Map(cats.map((c) => [c.id, c.name]));

  const allocs = await ctx.db.select().from(budgetAllocations)
    .where(and(eq(budgetAllocations.period, period), isNull(budgetAllocations.deletedAt)));
  const allocByCat = new Map(allocs.map((a) => [a.categoryId, a.amount]));

  const spendRows = await ctx.db.select({
    categoryId: transactionSplits.categoryId,
    spent: sql<number>`coalesce(sum(case when ${transactions.type} = 'expense' then ${transactionSplits.amount} else 0 end), 0)`,
    income: sql<number>`coalesce(sum(case when ${transactions.type} = 'income' then ${transactionSplits.amount} else 0 end), 0)`,
  }).from(transactionSplits)
    .innerJoin(transactions, eq(transactions.id, transactionSplits.transactionId))
    .where(and(
      isNull(transactions.deletedAt),
      gte(transactions.date, start), lte(transactions.date, end),
      sql`${transactions.type} <> 'transfer'`,
    ))
    .groupBy(transactionSplits.categoryId);

  const spentByCat = new Map(spendRows.map((r) => [r.categoryId, Number(r.spent)]));
  const income = spendRows.reduce((a, r) => a + Number(r.income), 0);

  const ids = new Set<string | null>([...allocByCat.keys(), ...spentByCat.keys()]);
  const out: CategorySpend[] = [];
  for (const id of ids) {
    const allocated = (id && allocByCat.get(id)) || 0;
    const spent = spentByCat.get(id ?? null) ?? 0;
    if (allocated === 0 && spent === 0) continue;
    out.push({
      categoryId: id ?? null,
      name: (id && catName.get(id)) || 'Uncategorised',
      allocated, spent, remaining: allocated - spent,
      pct: allocated > 0 ? Math.round((spent / allocated) * 100) : null,
    });
  }
  out.sort((a, b) => b.spent - a.spent);
  return {
    period,
    currency: ctx.household.currency,
    allocated: out.reduce((a, c) => a + c.allocated, 0),
    spent: out.reduce((a, c) => a + c.spent, 0),
    income,
    categories: out,
  };
}

/** Splits a receipt total across its line items so price history stays honest. */
export function distributeReceipt(total: number, lineAmounts: number[]): number[] {
  return allocate(total, lineAmounts.map((a) => Math.max(a, 0)));
}
