/* eslint-disable @typescript-eslint/no-explicit-any */
import type { FastifyInstance } from 'fastify';
import { and, asc, desc, eq, inArray, isNull, lt, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  OPEN_TASK_STATUS, PRIORITY, TASK_ORIGIN, TASK_STATUS, addDays, describeSchedule, dueStatus,
} from '@homestead/shared';
import {
  boardTasks, boards, checklistItems, lanes, schedules, taskAssignees, taskDependencies, tasks, timeEntries,
} from '../db/schema.js';
import { crudRoutes } from '../core/crud.js';
import { requireWrite } from '../core/auth.js';
import { badRequest, notFound } from '../core/errors.js';
import {
  completeTask, materialiseAll, materialiseSchedule, specOf, uncompleteTask, upsertSchedule, wouldCycle,
} from '../services/tasks.js';
import { parseNaturalDue } from '../services/natural-date.js';

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const timeStr = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

const scheduleSpec = z.object({
  mode: z.enum(['one_off', 'fixed', 'floating', 'on_demand']),
  rrule: z.string().nullable().optional(),
  anchorDate: dateStr.nullable().optional(),
  every: z.object({
    days: z.number().int().positive().optional(),
    weeks: z.number().int().positive().optional(),
    months: z.number().int().positive().optional(),
    years: z.number().int().positive().optional(),
  }).nullable().optional(),
  timeOfDay: timeStr.nullable().optional(),
  graceDays: z.number().int().min(0).max(90).nullable().optional(),
  untilDate: dateStr.nullable().optional(),
  count: z.number().int().positive().nullable().optional(),
});

export function taskRoutes(app: FastifyInstance): void {
  const taskCrud = crudRoutes(app, '/api/v1/tasks', {
    table: tasks, entityType: 'task', label: 'Task',
    create: z.object({
      title: z.string().trim().min(1),
      descriptionMd: z.string().nullable().optional(),
      status: z.enum(TASK_STATUS).default('open'),
      priority: z.enum(PRIORITY).default('normal'),
      dueDate: dateStr.nullable().optional(),
      dueTime: timeStr.nullable().optional(),
      startDate: dateStr.nullable().optional(),
      parentTaskId: z.string().nullable().optional(),
      originType: z.enum(TASK_ORIGIN).default('manual'),
      originId: z.string().nullable().optional(),
      propertyId: z.string().nullable().optional(),
      locationId: z.string().nullable().optional(),
      projectId: z.string().nullable().optional(),
      phaseId: z.string().nullable().optional(),
      estimateMin: z.number().int().nullable().optional(),
      visibility: z.enum(['household', 'private']).default('household'),
      sortKey: z.number().optional(),
    }),
    update: z.object({
      title: z.string().trim().min(1).optional(),
      descriptionMd: z.string().nullable().optional(),
      status: z.enum(TASK_STATUS).optional(),
      priority: z.enum(PRIORITY).optional(),
      dueDate: dateStr.nullable().optional(),
      dueTime: timeStr.nullable().optional(),
      startDate: dateStr.nullable().optional(),
      parentTaskId: z.string().nullable().optional(),
      propertyId: z.string().nullable().optional(),
      locationId: z.string().nullable().optional(),
      projectId: z.string().nullable().optional(),
      phaseId: z.string().nullable().optional(),
      estimateMin: z.number().int().nullable().optional(),
      actualMin: z.number().int().nullable().optional(),
      visibility: z.enum(['household', 'private']).optional(),
      sortKey: z.number().optional(),
    }),
    searchColumns: ['title', 'descriptionMd'],
    filterColumns: ['status', 'priority', 'originType', 'originId', 'projectId', 'phaseId', 'propertyId', 'locationId', 'scheduleId', 'dueDate'],
    sortColumns: ['dueDate', 'priority', 'createdAt', 'title', 'sortKey'],
    defaultSort: { column: 'dueDate', dir: 'asc' },
    hooks: { decorate: decorateTasks },
  });

  /** Quick add with natural-language dates (TASK-001). */
  app.post('/api/v1/tasks/quick', async (req, reply) => {
    requireWrite(req.ctx.user);
    const body = z.object({
      text: z.string().trim().min(1),
      assignToMe: z.boolean().optional(),
      projectId: z.string().nullable().optional(),
    }).parse(req.body);
    const parsed = parseNaturalDue(body.text, req.ctx.today);
    const row = await taskCrud.create(req.ctx, {
      title: parsed.title,
      dueDate: parsed.dueDate ?? undefined,
      dueTime: parsed.dueTime ?? undefined,
      priority: parsed.priority ?? 'normal',
      projectId: body.projectId ?? undefined,
    });
    if (body.assignToMe) {
      await req.ctx.db.insert(taskAssignees)
        .values({ taskId: row.id, userId: req.ctx.user!.id }).onConflictDoNothing();
    }
    reply.status(201);
    return { ...row, parsed };
  });

  /* ── the views people actually live in (TASK-008) ── */

  app.get('/api/v1/tasks/views/:view', async (req) => {
    const view = (req.params as { view: string }).view;
    const q = z.object({
      days: z.coerce.number().int().min(1).max(90).default(14),
      assignee: z.string().optional(),
      includeOrigins: z.string().optional(),
    }).parse(req.query);

    const where = [isNull(tasks.deletedAt), inArray(tasks.status, [...OPEN_TASK_STATUS])];
    if (view === 'today') where.push(lte(tasks.dueDate, req.ctx.today));
    else if (view === 'overdue') where.push(lt(tasks.dueDate, req.ctx.today));
    else if (view === 'upcoming') where.push(and(
      sql`${tasks.dueDate} is not null`,
      lte(tasks.dueDate, addDays(req.ctx.today, q.days)),
    )!);
    else if (view === 'unscheduled') where.push(isNull(tasks.dueDate));
    else if (view !== 'all') throw badRequest(`Unknown view: ${view}`);

    if (q.includeOrigins) where.push(inArray(tasks.originType, q.includeOrigins.split(',')));

    let rows = await req.ctx.db.select().from(tasks).where(and(...where))
      .orderBy(asc(sql`coalesce(${tasks.dueDate}, '9999-12-31')`), desc(tasks.priority), asc(tasks.title))
      .limit(500);

    if (q.assignee) {
      const mine = await req.ctx.db.select({ taskId: taskAssignees.taskId })
        .from(taskAssignees).where(eq(taskAssignees.userId, q.assignee));
      const set = new Set(mine.map((m) => m.taskId));
      rows = rows.filter((r) => set.has(r.id));
    }
    const decorated = await decorateTasks(rows, req.ctx);
    return { items: decorated, today: req.ctx.today, view };
  });

  /** Calendar feed: every dated thing, one colour per module (TASK-010). */
  app.get('/api/v1/calendar', async (req) => {
    const q = z.object({ from: dateStr, to: dateStr }).parse(req.query);
    const rows = await req.ctx.db.select().from(tasks).where(and(
      isNull(tasks.deletedAt),
      sql`${tasks.dueDate} >= ${q.from}`,
      sql`${tasks.dueDate} <= ${q.to}`,
    )).orderBy(asc(tasks.dueDate)).limit(1000);
    return {
      items: rows.map((t) => ({
        id: t.id, title: t.title, date: t.dueDate, time: t.dueTime,
        module: t.originType, status: t.status, priority: t.priority,
        projectId: t.projectId, originId: t.originId,
      })),
    };
  });

  /* ── completion and rescheduling ── */

  app.post('/api/v1/tasks/:id/complete', async (req) => {
    requireWrite(req.ctx.user);
    const body = z.object({
      completedAt: dateStr.optional(),
      note: z.string().optional(),
      actualMin: z.number().int().positive().optional(),
      extra: z.record(z.unknown()).optional(),
    }).parse(req.body ?? {});
    return completeTask(req.ctx, (req.params as { id: string }).id, body);
  });

  app.post('/api/v1/tasks/:id/reopen', async (req) => {
    requireWrite(req.ctx.user);
    return uncompleteTask(req.ctx, (req.params as { id: string }).id);
  });

  app.post('/api/v1/tasks/:id/snooze', async (req) => {
    requireWrite(req.ctx.user);
    const id = (req.params as { id: string }).id;
    const body = z.object({ days: z.number().int().min(1).max(365).optional(), until: dateStr.optional() })
      .parse(req.body ?? {});
    const current = (await req.ctx.db.select().from(tasks).where(eq(tasks.id, id)).limit(1))[0];
    if (!current) throw notFound('Task');
    const base = current.dueDate && current.dueDate > req.ctx.today ? current.dueDate : req.ctx.today;
    const next = body.until ?? addDays(base, body.days ?? 1);
    const [row] = await req.ctx.db.update(tasks).set({
      dueDate: next, snoozedFrom: current.dueDate, updatedBy: req.ctx.user!.id,
    }).where(eq(tasks.id, id)).returning();
    return row;
  });

  app.post('/api/v1/tasks/bulk', async (req) => {
    requireWrite(req.ctx.user);
    const body = z.object({
      ids: z.array(z.string()).min(1).max(500),
      action: z.enum(['complete', 'reschedule', 'assign', 'status', 'delete', 'priority']),
      dueDate: dateStr.optional(),
      userId: z.string().optional(),
      status: z.enum(TASK_STATUS).optional(),
      priority: z.enum(PRIORITY).optional(),
    }).parse(req.body);
    let affected = 0;
    for (const id of body.ids) {
      try {
        switch (body.action) {
          case 'complete': await completeTask(req.ctx, id); break;
          case 'reschedule':
            if (!body.dueDate) throw badRequest('dueDate is required');
            await req.ctx.db.update(tasks).set({ dueDate: body.dueDate, updatedBy: req.ctx.user!.id }).where(eq(tasks.id, id));
            break;
          case 'assign':
            if (!body.userId) throw badRequest('userId is required');
            await req.ctx.db.insert(taskAssignees).values({ taskId: id, userId: body.userId }).onConflictDoNothing();
            break;
          case 'status':
            if (!body.status) throw badRequest('status is required');
            await req.ctx.db.update(tasks).set({ status: body.status, updatedBy: req.ctx.user!.id }).where(eq(tasks.id, id));
            break;
          case 'priority':
            if (!body.priority) throw badRequest('priority is required');
            await req.ctx.db.update(tasks).set({ priority: body.priority, updatedBy: req.ctx.user!.id }).where(eq(tasks.id, id));
            break;
          case 'delete':
            await req.ctx.db.update(tasks).set({ deletedAt: new Date().toISOString() }).where(eq(tasks.id, id));
            break;
        }
        affected++;
      } catch { /* skip rows that cannot take the action; report the count */ }
    }
    return { affected, requested: body.ids.length };
  });

  /* ── assignees, dependencies, checklists ── */

  app.put('/api/v1/tasks/:id/assignees', async (req) => {
    requireWrite(req.ctx.user);
    const id = (req.params as { id: string }).id;
    const body = z.object({ userIds: z.array(z.string()) }).parse(req.body);
    await req.ctx.db.delete(taskAssignees).where(eq(taskAssignees.taskId, id));
    if (body.userIds.length) {
      await req.ctx.db.insert(taskAssignees)
        .values(body.userIds.map((userId) => ({ taskId: id, userId }))).onConflictDoNothing();
    }
    return { taskId: id, userIds: body.userIds };
  });

  app.post('/api/v1/tasks/:id/dependencies', async (req, reply) => {
    requireWrite(req.ctx.user);
    const id = (req.params as { id: string }).id;
    const body = z.object({ blockedByTaskId: z.string() }).parse(req.body);
    if (await wouldCycle(req.ctx, id, body.blockedByTaskId)) {
      throw badRequest('That would create a circular dependency');
    }
    await req.ctx.db.insert(taskDependencies)
      .values({ taskId: id, blockedByTaskId: body.blockedByTaskId }).onConflictDoNothing();
    reply.status(201);
    return { taskId: id, blockedByTaskId: body.blockedByTaskId };
  });

  app.delete('/api/v1/tasks/:id/dependencies/:blockerId', async (req) => {
    requireWrite(req.ctx.user);
    const { id, blockerId } = req.params as { id: string; blockerId: string };
    await req.ctx.db.delete(taskDependencies)
      .where(and(eq(taskDependencies.taskId, id), eq(taskDependencies.blockedByTaskId, blockerId)));
    return { ok: true };
  });

  app.get('/api/v1/tasks/:id/detail', async (req) => {
    const id = (req.params as { id: string }).id;
    const task = (await req.ctx.db.select().from(tasks).where(eq(tasks.id, id)).limit(1))[0];
    if (!task) throw notFound('Task');
    const [assignees, checklist, blockers, blocking, children, times] = await Promise.all([
      req.ctx.db.select().from(taskAssignees).where(eq(taskAssignees.taskId, id)),
      req.ctx.db.select().from(checklistItems).where(eq(checklistItems.taskId, id)).orderBy(asc(checklistItems.sort)),
      req.ctx.db.select({ t: tasks }).from(taskDependencies)
        .innerJoin(tasks, eq(tasks.id, taskDependencies.blockedByTaskId))
        .where(eq(taskDependencies.taskId, id)),
      req.ctx.db.select({ t: tasks }).from(taskDependencies)
        .innerJoin(tasks, eq(tasks.id, taskDependencies.taskId))
        .where(eq(taskDependencies.blockedByTaskId, id)),
      req.ctx.db.select().from(tasks).where(and(eq(tasks.parentTaskId, id), isNull(tasks.deletedAt))),
      req.ctx.db.select().from(timeEntries).where(eq(timeEntries.taskId, id)),
    ]);
    const schedule = task.scheduleId
      ? (await req.ctx.db.select().from(schedules).where(eq(schedules.id, task.scheduleId)).limit(1))[0]
      : null;
    const decorated = (await decorateTasks([task], req.ctx))[0];
    return {
      ...decorated,
      assignees: assignees.map((a) => a.userId),
      checklist,
      blockedBy: blockers.map((b) => b.t),
      blocking: blocking.map((b) => b.t),
      children,
      timeEntries: times,
      schedule: schedule ? { ...schedule, description: describeSchedule(specOf(schedule)) } : null,
    };
  });

  app.post('/api/v1/tasks/:id/checklist', async (req, reply) => {
    requireWrite(req.ctx.user);
    const id = (req.params as { id: string }).id;
    const body = z.object({ text: z.string().trim().min(1), sort: z.number().int().optional() }).parse(req.body);
    const [row] = await req.ctx.db.insert(checklistItems)
      .values({ taskId: id, text: body.text, sort: body.sort ?? 0 }).returning();
    reply.status(201);
    return row;
  });

  app.patch('/api/v1/checklist-items/:id', async (req) => {
    requireWrite(req.ctx.user);
    const body = z.object({
      done: z.boolean().optional(), text: z.string().trim().min(1).optional(), sort: z.number().int().optional(),
    }).parse(req.body);
    const [row] = await req.ctx.db.update(checklistItems).set(body)
      .where(eq(checklistItems.id, (req.params as { id: string }).id)).returning();
    if (!row) throw notFound('Checklist item');
    return row;
  });

  app.delete('/api/v1/checklist-items/:id', async (req) => {
    requireWrite(req.ctx.user);
    await req.ctx.db.delete(checklistItems).where(eq(checklistItems.id, (req.params as { id: string }).id));
    return { ok: true };
  });

  /* ── time tracking (TASK-014) ── */

  app.post('/api/v1/tasks/:id/time', async (req, reply) => {
    requireWrite(req.ctx.user);
    const id = (req.params as { id: string }).id;
    const body = z.object({
      minutes: z.number().int().positive().optional(),
      startedAt: z.string().optional(),
      endedAt: z.string().optional(),
      note: z.string().optional(),
    }).parse(req.body ?? {});
    const [row] = await req.ctx.db.insert(timeEntries).values({
      taskId: id, userId: req.ctx.user!.id,
      startedAt: body.startedAt ?? new Date().toISOString(),
      endedAt: body.endedAt ?? null, minutes: body.minutes ?? null, note: body.note,
      createdBy: req.ctx.user!.id,
    }).returning();
    const total = await req.ctx.db.select({ n: sql<number>`coalesce(sum(${timeEntries.minutes}), 0)` })
      .from(timeEntries).where(eq(timeEntries.taskId, id));
    await req.ctx.db.update(tasks).set({ actualMin: Number(total[0]?.n ?? 0) }).where(eq(tasks.id, id));
    reply.status(201);
    return row;
  });

  /* ── schedules ── */

  app.get('/api/v1/schedules', async (req) => {
    const q = z.object({ originType: z.string().optional(), active: z.coerce.boolean().optional() }).parse(req.query);
    const where = [isNull(schedules.deletedAt)];
    if (q.originType) where.push(eq(schedules.originType, q.originType));
    if (q.active !== undefined) where.push(eq(schedules.active, q.active));
    const rows = await req.ctx.db.select().from(schedules).where(and(...where)).orderBy(asc(schedules.nextDue));
    return {
      items: rows.map((r) => ({
        ...r, description: describeSchedule(specOf(r)),
        status: dueStatus(r.nextDue, req.ctx.today, { graceDays: r.graceDays }),
      })),
    };
  });

  app.post('/api/v1/schedules', async (req, reply) => {
    requireWrite(req.ctx.user);
    const body = z.object({
      spec: scheduleSpec,
      originType: z.enum(TASK_ORIGIN).default('manual'),
      originId: z.string().default(''),
      template: z.object({
        title: z.string().trim().min(1),
        descriptionMd: z.string().nullable().optional(),
        priority: z.enum(PRIORITY).optional(),
        estimateMin: z.number().int().nullable().optional(),
        assignees: z.array(z.string()).optional(),
        checklist: z.array(z.string()).optional(),
        propertyId: z.string().nullable().optional(),
        locationId: z.string().nullable().optional(),
        projectId: z.string().nullable().optional(),
      }),
      horizonDays: z.number().int().min(1).max(365).optional(),
    }).parse(req.body);
    const id = await upsertSchedule(req.ctx, {
      spec: body.spec, originType: body.originType, originId: body.originId || 'manual',
      template: body.template, horizonDays: body.horizonDays,
    });
    reply.status(201);
    const row = (await req.ctx.db.select().from(schedules).where(eq(schedules.id, id)).limit(1))[0];
    return { ...row, description: describeSchedule(specOf(row!)) };
  });

  app.patch('/api/v1/schedules/:id', async (req) => {
    requireWrite(req.ctx.user);
    const id = (req.params as { id: string }).id;
    const body = z.object({
      spec: scheduleSpec.optional(),
      template: z.record(z.unknown()).optional(),
      active: z.boolean().optional(),
      horizonDays: z.number().int().min(1).max(365).optional(),
    }).parse(req.body);
    const current = (await req.ctx.db.select().from(schedules).where(eq(schedules.id, id)).limit(1))[0];
    if (!current) throw notFound('Schedule');
    await upsertSchedule(req.ctx, {
      id,
      spec: body.spec ?? specOf(current),
      originType: current.originType as any,
      originId: current.originId ?? 'manual',
      template: { ...(current.template ?? {}), ...(body.template ?? {}) } as any,
      horizonDays: body.horizonDays ?? current.horizonDays,
      active: body.active ?? current.active,
    });
    const row = (await req.ctx.db.select().from(schedules).where(eq(schedules.id, id)).limit(1))[0];
    return { ...row, description: describeSchedule(specOf(row!)) };
  });

  app.post('/api/v1/schedules/materialise', async (req) => {
    requireWrite(req.ctx.user);
    return materialiseAll(req.ctx);
  });

  app.post('/api/v1/schedules/:id/materialise', async (req) => {
    requireWrite(req.ctx.user);
    return materialiseSchedule(req.ctx, (req.params as { id: string }).id);
  });

  /* ── boards (TASK-009) ── */

  crudRoutes(app, '/api/v1/boards', {
    table: boards, entityType: 'task', label: 'Board',
    create: z.object({
      name: z.string().trim().min(1),
      propertyId: z.string().nullable().optional(),
      filter: z.record(z.unknown()).nullable().optional(),
      shared: z.boolean().optional(),
      sort: z.number().int().optional(),
    }),
    update: z.object({
      name: z.string().trim().min(1).optional(),
      filter: z.record(z.unknown()).nullable().optional(),
      shared: z.boolean().optional(),
      sort: z.number().int().optional(),
    }),
    searchColumns: ['name'],
    hooks: {
      afterCreate: async (row, ctx) => {
        const defaults = [
          { name: 'To do', statusMapping: 'open' },
          { name: 'Doing', statusMapping: 'in_progress' },
          { name: 'Done', statusMapping: 'done' },
        ];
        await ctx.db.insert(lanes).values(
          defaults.map((l, i) => ({ boardId: row.id, name: l.name, statusMapping: l.statusMapping, sort: i, createdBy: ctx.user?.id ?? null })),
        );
      },
    },
  });

  app.get('/api/v1/boards/:id/view', async (req) => {
    const id = (req.params as { id: string }).id;
    const board = (await req.ctx.db.select().from(boards).where(eq(boards.id, id)).limit(1))[0];
    if (!board) throw notFound('Board');
    const laneRows = await req.ctx.db.select().from(lanes)
      .where(and(eq(lanes.boardId, id), isNull(lanes.deletedAt))).orderBy(asc(lanes.sort));
    const placements = await req.ctx.db.select({ p: boardTasks, t: tasks })
      .from(boardTasks).innerJoin(tasks, eq(tasks.id, boardTasks.taskId))
      .where(and(eq(boardTasks.boardId, id), isNull(tasks.deletedAt)))
      .orderBy(asc(boardTasks.sort));
    const decorated = await decorateTasks(placements.map((p) => p.t), req.ctx);
    const byTask = new Map(decorated.map((t: any) => [t.id, t]));
    return {
      board,
      lanes: laneRows.map((lane) => ({
        ...lane,
        tasks: placements
          .filter((p) => p.p.laneId === lane.id)
          .map((p) => ({ ...byTask.get(p.t.id), sort: p.p.sort })),
      })),
    };
  });

  app.post('/api/v1/boards/:id/lanes', async (req, reply) => {
    requireWrite(req.ctx.user);
    const id = (req.params as { id: string }).id;
    const body = z.object({
      name: z.string().trim().min(1),
      statusMapping: z.enum(TASK_STATUS).nullable().optional(),
      wipLimit: z.number().int().positive().nullable().optional(),
      sort: z.number().int().optional(),
    }).parse(req.body);
    const [row] = await req.ctx.db.insert(lanes)
      .values({ boardId: id, ...body, createdBy: req.ctx.user!.id }).returning();
    reply.status(201);
    return row;
  });

  /** Drag-and-drop: place a task in a lane at a fractional sort key. */
  app.put('/api/v1/boards/:id/placements', async (req) => {
    requireWrite(req.ctx.user);
    const boardId = (req.params as { id: string }).id;
    const body = z.object({
      taskId: z.string(), laneId: z.string(), sort: z.number().optional(),
    }).parse(req.body);
    const lane = (await req.ctx.db.select().from(lanes).where(eq(lanes.id, body.laneId)).limit(1))[0];
    if (!lane || lane.boardId !== boardId) throw badRequest('That lane is not on this board');
    if (lane.wipLimit != null && lane.statusMapping !== 'done') {
      const n = await req.ctx.db.select({ c: sql<number>`count(*)` })
        .from(boardTasks).where(and(eq(boardTasks.laneId, body.laneId), sql`${boardTasks.taskId} <> ${body.taskId}`));
      if (Number(n[0]?.c ?? 0) >= lane.wipLimit) throw badRequest(`"${lane.name}" is at its limit of ${lane.wipLimit}`);
    }
    const sort = body.sort ?? Date.now();
    await req.ctx.db.insert(boardTasks)
      .values({ boardId, laneId: body.laneId, taskId: body.taskId, sort })
      .onConflictDoUpdate({
        target: [boardTasks.boardId, boardTasks.taskId],
        set: { laneId: body.laneId, sort },
      });
    // Moving into a status-mapped lane is the same act as setting the status.
    if (lane.statusMapping) {
      if (lane.statusMapping === 'done') {
        const t = (await req.ctx.db.select().from(tasks).where(eq(tasks.id, body.taskId)).limit(1))[0];
        if (t && t.status !== 'done') await completeTask(req.ctx, body.taskId);
      } else {
        await req.ctx.db.update(tasks)
          .set({ status: lane.statusMapping, updatedBy: req.ctx.user!.id }).where(eq(tasks.id, body.taskId));
      }
    }
    return { boardId, taskId: body.taskId, laneId: body.laneId, sort };
  });

  app.delete('/api/v1/boards/:id/placements/:taskId', async (req) => {
    requireWrite(req.ctx.user);
    const { id, taskId } = req.params as { id: string; taskId: string };
    await req.ctx.db.delete(boardTasks)
      .where(and(eq(boardTasks.boardId, id), eq(boardTasks.taskId, taskId)));
    return { ok: true };
  });
}

/** Adds the things every task list needs: blockers, progress, due status. */
export async function decorateTasks(rows: any[], ctx: any): Promise<any[]> {
  if (!rows.length) return rows;
  const ids = rows.map((r) => r.id);
  const [assignees, deps, checks, kids] = await Promise.all([
    ctx.db.select().from(taskAssignees).where(inArray(taskAssignees.taskId, ids)),
    ctx.db.select({ taskId: taskDependencies.taskId, status: tasks.status })
      .from(taskDependencies).innerJoin(tasks, eq(tasks.id, taskDependencies.blockedByTaskId))
      .where(inArray(taskDependencies.taskId, ids)),
    ctx.db.select({ taskId: checklistItems.taskId, done: checklistItems.done })
      .from(checklistItems).where(inArray(checklistItems.taskId, ids)),
    ctx.db.select({ parentTaskId: tasks.parentTaskId, status: tasks.status })
      .from(tasks).where(and(inArray(tasks.parentTaskId, ids), isNull(tasks.deletedAt))),
  ]);

  const byTask = <T extends { taskId: string }>(list: T[]) => {
    const m = new Map<string, T[]>();
    for (const r of list) { const a = m.get(r.taskId) ?? []; a.push(r); m.set(r.taskId, a); }
    return m;
  };
  const aMap = byTask(assignees as Array<{ taskId: string; userId: string }>);
  const dMap = byTask(deps as Array<{ taskId: string; status: string }>);
  const cMap = byTask(checks as Array<{ taskId: string; done: boolean }>);
  const kMap = new Map<string, Array<{ status: string }>>();
  for (const k of kids as Array<{ parentTaskId: string | null; status: string }>) {
    if (!k.parentTaskId) continue;
    const a = kMap.get(k.parentTaskId) ?? []; a.push(k); kMap.set(k.parentTaskId, a);
  }

  return rows.map((r) => {
    const blockers = dMap.get(r.id) ?? [];
    const openBlockers = blockers.filter((b) => (OPEN_TASK_STATUS as readonly string[]).includes(b.status)).length;
    const cl = cMap.get(r.id) ?? [];
    const ch = kMap.get(r.id) ?? [];
    return {
      ...r,
      assignees: (aMap.get(r.id) ?? []).map((a) => (a as any).userId),
      blockedBy: openBlockers,
      isBlocked: openBlockers > 0,
      checklistDone: cl.filter((c) => c.done).length,
      checklistTotal: cl.length,
      childrenDone: ch.filter((c) => c.status === 'done').length,
      childrenTotal: ch.length,
      dueStatus: dueStatus(r.dueDate, ctx.today),
      overdue: !!r.dueDate && r.dueDate < ctx.today && (OPEN_TASK_STATUS as readonly string[]).includes(r.status),
    };
  });
}
