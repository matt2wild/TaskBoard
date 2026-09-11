/* eslint-disable @typescript-eslint/no-explicit-any */
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  OPEN_TASK_STATUS, addDays, diffDays, nextDue, occurrences, outstandingDue,
  type ScheduleSpec, type TaskOrigin,
} from '@homestead/shared';
import type { Ctx } from '../core/ctx.js';
import { logActivity } from '../core/activity.js';
import { badRequest, notFound } from '../core/errors.js';
import {
  checklistItems, schedules, taskAssignees, taskDependencies, tasks,
} from '../db/schema.js';

export interface ScheduleTemplate {
  title?: string;
  descriptionMd?: string | null;
  priority?: string;
  estimateMin?: number | null;
  assignees?: string[];
  checklist?: string[];
  locationId?: string | null;
  propertyId?: string | null;
  projectId?: string | null;
}

export function specOf(row: typeof schedules.$inferSelect): ScheduleSpec {
  return {
    mode: row.mode as ScheduleSpec['mode'],
    rrule: row.rrule,
    anchorDate: row.anchorDate,
    every: row.every ?? null,
    timeOfDay: row.timeOfDay,
    graceDays: row.graceDays,
    untilDate: row.untilDate,
    count: row.count,
  };
}

/**
 * Creates the task rows a schedule owes, and no more. Idempotent: the unique
 * index on (schedule_id, due_date) means a second run is a no-op, which is what
 * makes catch-up after downtime safe (NFR-005).
 */
export async function materialiseSchedule(
  ctx: Ctx, scheduleId: string, opts: { horizonDays?: number } = {},
): Promise<{ created: string[]; nextDue: string | null }> {
  const rows = await ctx.db.select().from(schedules).where(eq(schedules.id, scheduleId)).limit(1);
  const sched = rows[0];
  if (!sched) throw notFound('Schedule');
  if (!sched.active || sched.deletedAt) return { created: [], nextDue: sched.nextDue };

  const spec = specOf(sched);
  const horizon = opts.horizonDays ?? sched.horizonDays ?? 45;
  const tmpl = (sched.template ?? {}) as ScheduleTemplate;

  // What is already on the books for this schedule?
  const existing = await ctx.db.select({ dueDate: tasks.dueDate, status: tasks.status })
    .from(tasks).where(and(eq(tasks.scheduleId, scheduleId), isNull(tasks.deletedAt)));
  const known = new Set(existing.map((r) => r.dueDate));
  const hasOpen = existing.some((r) => r.dueDate && (OPEN_TASK_STATUS as readonly string[]).includes(r.status));

  let wanted: string[] = [];
  if (spec.mode === 'fixed') {
    wanted = occurrences(spec, ctx.today, addDays(ctx.today, horizon), { limit: 60 });
    // Keep the outstanding instance alive, but only the most recent one: a
    // yearly job missed twice is owed for this year, not for the first year.
    const missed = outstandingDue(spec, { today: ctx.today, lastCompletedAt: sched.lastCompletedAt });
    if (missed && !wanted.includes(missed)) wanted.unshift(missed);
  } else {
    // Non-fixed schedules only ever have one instance outstanding.
    if (!hasOpen) {
      const d = nextDue(spec, { today: ctx.today, lastCompletedAt: sched.lastCompletedAt ?? null });
      if (d) wanted = [d];
    }
  }

  const created: string[] = [];
  for (const due of wanted) {
    if (known.has(due)) continue;
    const [row] = await ctx.db.insert(tasks).values({
      title: tmpl.title ?? 'Scheduled task',
      descriptionMd: tmpl.descriptionMd ?? null,
      status: 'open',
      priority: tmpl.priority ?? 'normal',
      dueDate: due,
      dueTime: sched.timeOfDay,
      scheduleId,
      originType: sched.originType,
      originId: sched.originId,
      propertyId: tmpl.propertyId ?? null,
      locationId: tmpl.locationId ?? null,
      projectId: tmpl.projectId ?? null,
      estimateMin: tmpl.estimateMin ?? null,
      createdBy: sched.createdBy,
      updatedBy: sched.createdBy,
    }).onConflictDoNothing().returning();
    if (!row) continue;
    created.push(row.id);
    known.add(due);
    if (tmpl.assignees?.length) {
      await ctx.db.insert(taskAssignees)
        .values(tmpl.assignees.map((userId) => ({ taskId: row.id, userId })))
        .onConflictDoNothing();
    }
    if (tmpl.checklist?.length) {
      await ctx.db.insert(checklistItems).values(
        tmpl.checklist.map((text, i) => ({ taskId: row.id, text, sort: i })),
      );
    }
  }

  const upcoming = wanted.find((d) => diffDays(d, ctx.today) >= 0)
    ?? nextDue(spec, { today: ctx.today, lastCompletedAt: sched.lastCompletedAt ?? null });
  await ctx.db.update(schedules).set({ nextDue: upcoming ?? null }).where(eq(schedules.id, scheduleId));
  return { created, nextDue: upcoming ?? null };
}

/** Runs every schedule that could owe a task. Cheap enough to run on each tick. */
export async function materialiseAll(ctx: Ctx): Promise<{ schedules: number; created: number }> {
  const rows = await ctx.db.select({ id: schedules.id }).from(schedules)
    .where(and(eq(schedules.active, true), isNull(schedules.deletedAt)));
  let created = 0;
  for (const r of rows) {
    const res = await materialiseSchedule(ctx, r.id);
    created += res.created.length;
  }
  return { schedules: rows.length, created };
}

export interface CompletionPayload {
  completedAt?: string;
  note?: string;
  actualMin?: number;
  /** Module-specific extras, e.g. maintenance cost and consumables. */
  extra?: Record<string, unknown>;
}

type OriginHandler = (ctx: Ctx, task: typeof tasks.$inferSelect, payload: CompletionPayload) => Promise<unknown>;
const originHandlers = new Map<TaskOrigin, OriginHandler>();

/** Modules register what "done" means for the tasks they generate (TASK-007). */
export function onTaskComplete(origin: TaskOrigin, handler: OriginHandler): void {
  originHandlers.set(origin, handler);
}

export async function completeTask(
  ctx: Ctx, taskId: string, payload: CompletionPayload = {},
): Promise<{ task: typeof tasks.$inferSelect; next: string | null; result?: unknown }> {
  const rows = await ctx.db.select().from(tasks)
    .where(and(eq(tasks.id, taskId), isNull(tasks.deletedAt))).limit(1);
  const task = rows[0];
  if (!task) throw notFound('Task');
  if (task.status === 'done') throw badRequest('That task is already done');

  const blockers = await ctx.db.select({ id: tasks.id, title: tasks.title, status: tasks.status })
    .from(taskDependencies).innerJoin(tasks, eq(tasks.id, taskDependencies.blockedByTaskId))
    .where(and(eq(taskDependencies.taskId, taskId), isNull(tasks.deletedAt)));
  const openBlockers = blockers.filter((b) => (OPEN_TASK_STATUS as readonly string[]).includes(b.status));
  if (openBlockers.length) {
    throw badRequest(`Blocked by: ${openBlockers.map((b) => b.title).join(', ')}`);
  }

  const completedAt = payload.completedAt ?? ctx.today;
  const [updated] = await ctx.db.update(tasks).set({
    status: 'done',
    completedAt,
    completedBy: ctx.user?.id ?? null,
    completionNote: payload.note ?? null,
    actualMin: payload.actualMin ?? task.actualMin,
    updatedBy: ctx.user?.id ?? null,
  }).where(eq(tasks.id, taskId)).returning();

  await logActivity(ctx.db, {
    userId: ctx.user?.id, action: 'complete', entityType: 'task', entityId: taskId, summary: task.title,
  });

  let result: unknown;
  const handler = originHandlers.get(task.originType as TaskOrigin);
  if (handler) result = await handler(ctx, updated!, payload);

  let next: string | null = null;
  if (task.scheduleId) {
    await ctx.db.update(schedules)
      .set({ lastCompletedAt: completedAt }).where(eq(schedules.id, task.scheduleId));
    const m = await materialiseSchedule(ctx, task.scheduleId);
    next = m.nextDue;
  }
  return { task: updated!, next, result };
}

export async function uncompleteTask(ctx: Ctx, taskId: string): Promise<typeof tasks.$inferSelect> {
  const [row] = await ctx.db.update(tasks).set({
    status: 'open', completedAt: null, completedBy: null, completionNote: null,
    updatedBy: ctx.user?.id ?? null,
  }).where(eq(tasks.id, taskId)).returning();
  if (!row) throw notFound('Task');
  return row;
}

/** Creates (or updates) the schedule that drives a module's recurring work. */
export async function upsertSchedule(
  ctx: Ctx,
  args: {
    id?: string | null;
    spec: ScheduleSpec;
    originType: TaskOrigin;
    originId: string;
    template: ScheduleTemplate;
    horizonDays?: number;
    active?: boolean;
  },
): Promise<string> {
  const values = {
    mode: args.spec.mode,
    rrule: args.spec.rrule ?? null,
    anchorDate: args.spec.anchorDate ?? ctx.today,
    every: args.spec.every ?? null,
    timeOfDay: args.spec.timeOfDay ?? null,
    graceDays: args.spec.graceDays ?? null,
    untilDate: args.spec.untilDate ?? null,
    count: args.spec.count ?? null,
    horizonDays: args.horizonDays ?? 45,
    template: args.template as Record<string, unknown>,
    originType: args.originType,
    originId: args.originId,
    active: args.active ?? true,
    updatedBy: ctx.user?.id ?? null,
  };
  if (args.id) {
    await ctx.db.update(schedules).set(values).where(eq(schedules.id, args.id));
    await materialiseSchedule(ctx, args.id);
    return args.id;
  }
  const [row] = await ctx.db.insert(schedules)
    .values({ ...values, createdBy: ctx.user?.id ?? null }).returning();
  await materialiseSchedule(ctx, row!.id);
  return row!.id;
}

export async function deactivateSchedulesFor(ctx: Ctx, originType: string, originId: string): Promise<void> {
  const rows = await ctx.db.select({ id: schedules.id }).from(schedules)
    .where(and(eq(schedules.originType, originType), eq(schedules.originId, originId)));
  if (!rows.length) return;
  const ids = rows.map((r) => r.id);
  await ctx.db.update(schedules).set({ active: false }).where(inArray(schedules.id, ids));
  // Cancel the outstanding instances, keep completed history.
  await ctx.db.update(tasks)
    .set({ status: 'cancelled', updatedBy: ctx.user?.id ?? null })
    .where(and(inArray(tasks.scheduleId, ids), inArray(tasks.status, [...OPEN_TASK_STATUS])));
}

/** Guards against a dependency cycle before inserting one (TASK-004). */
export async function wouldCycle(ctx: Ctx, taskId: string, blockedBy: string): Promise<boolean> {
  if (taskId === blockedBy) return true;
  const seen = new Set<string>([blockedBy]);
  let frontier = [blockedBy];
  for (let depth = 0; depth < 50 && frontier.length; depth++) {
    const rows = await ctx.db.select({ dep: taskDependencies.blockedByTaskId })
      .from(taskDependencies).where(inArray(taskDependencies.taskId, frontier));
    const next: string[] = [];
    for (const r of rows) {
      if (r.dep === taskId) return true;
      if (!seen.has(r.dep)) { seen.add(r.dep); next.push(r.dep); }
    }
    frontier = next;
  }
  return false;
}

export async function taskCounts(ctx: Ctx): Promise<{ dueToday: number; overdue: number }> {
  const r = await ctx.db.select({
    dueToday: sql<number>`sum(case when ${tasks.dueDate} = ${ctx.today} then 1 else 0 end)`,
    overdue: sql<number>`sum(case when ${tasks.dueDate} < ${ctx.today} then 1 else 0 end)`,
  }).from(tasks).where(and(
    isNull(tasks.deletedAt),
    inArray(tasks.status, [...OPEN_TASK_STATUS]),
  ));
  return { dueToday: Number(r[0]?.dueToday ?? 0), overdue: Number(r[0]?.overdue ?? 0) };
}
