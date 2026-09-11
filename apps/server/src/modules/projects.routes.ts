/* eslint-disable @typescript-eslint/no-explicit-any */
import type { FastifyInstance } from 'fastify';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  ACTIVE_PROJECT_STATUS, MATERIAL_STATUS, PERMIT_STATUS, PRIORITY, PROJECT_COST_BUCKETS,
  PROJECT_STATUS, QUOTE_STATUS,
} from '@homestead/shared';
import {
  assets, decisions, inspections, permits, projectLocations, projectMaterials, projectPhases,
  projectTemplates, projectToolWishes, projectTools, projects, quotes, storageItems, tasks, toolProfiles,
} from '../db/schema.js';
import { crudRoutes } from '../core/crud.js';
import { requireWrite } from '../core/auth.js';
import { badRequest, notFound } from '../core/errors.js';
import { attachCost, spentOn, spentOnMany } from '../services/budget.js';
import { emittedBy, emittedByMany, estimateEmbodied, tryRecordActivity } from '../services/carbon.js';
import { addToShoppingList } from '../services/stock.js';
import { decorateTasks } from './tasks.routes.js';

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export function projectRoutes(app: FastifyInstance): void {
  const projectShape = {
    propertyId: z.string().min(1),
    name: z.string().trim().min(1),
    descriptionMd: z.string().nullable().optional(),
    status: z.enum(PROJECT_STATUS).default('idea'),
    ownerUserId: z.string().nullable().optional(),
    priority: z.enum(PRIORITY).default('normal'),
    targetStart: dateStr.nullable().optional(),
    targetEnd: dateStr.nullable().optional(),
    actualStart: dateStr.nullable().optional(),
    actualEnd: dateStr.nullable().optional(),
    budgetAmount: z.number().int().nullable().optional(),
    budgetBreakdown: z.record(z.number().int()).nullable().optional(),
    estimateCost: z.number().int().nullable().optional(),
  };

  const projectCrud = crudRoutes(app, '/api/v1/projects', {
    table: projects, entityType: 'project', label: 'Project',
    create: z.object(projectShape),
    update: z.object(projectShape).partial(),
    searchColumns: ['name', 'descriptionMd'],
    filterColumns: ['status', 'propertyId', 'ownerUserId', 'priority'],
    sortColumns: ['name', 'targetStart', 'targetEnd', 'createdAt', 'status'],
    hooks: { decorate: decorateProjects },
  });

  app.get('/api/v1/projects/:id/overview', async (req) => {
    const id = (req.params as { id: string }).id;
    const project = (await req.ctx.db.select().from(projects).where(eq(projects.id, id)).limit(1))[0];
    if (!project) throw notFound('Project');

    const [phases, materials, taskRows, quoteRows, permitRows, decisionRows, toolRows, locs] = await Promise.all([
      req.ctx.db.select().from(projectPhases)
        .where(and(eq(projectPhases.projectId, id), isNull(projectPhases.deletedAt))).orderBy(asc(projectPhases.sort)),
      req.ctx.db.select().from(projectMaterials)
        .where(and(eq(projectMaterials.projectId, id), isNull(projectMaterials.deletedAt))).orderBy(asc(projectMaterials.createdAt)),
      req.ctx.db.select().from(tasks)
        .where(and(eq(tasks.projectId, id), isNull(tasks.deletedAt))).orderBy(asc(tasks.dueDate)),
      req.ctx.db.select().from(quotes)
        .where(and(eq(quotes.projectId, id), isNull(quotes.deletedAt))).orderBy(desc(quotes.quotedAt)),
      req.ctx.db.select().from(permits)
        .where(and(eq(permits.projectId, id), isNull(permits.deletedAt))),
      req.ctx.db.select().from(decisions)
        .where(and(eq(decisions.projectId, id), isNull(decisions.deletedAt))).orderBy(desc(decisions.decidedAt)),
      req.ctx.db.select({ pt: projectTools, asset: assets, profile: toolProfiles })
        .from(projectTools)
        .innerJoin(assets, eq(assets.id, projectTools.assetId))
        .leftJoin(toolProfiles, eq(toolProfiles.assetId, projectTools.assetId))
        .where(eq(projectTools.projectId, id)),
      req.ctx.db.select().from(projectLocations).where(eq(projectLocations.projectId, id)),
    ]);

    const [spend, carbon] = await Promise.all([
      spentOn(req.ctx, 'project', id),
      emittedBy(req.ctx, 'project', id),
    ]);
    const committed = quoteRows
      .filter((q) => q.status === 'accepted')
      .reduce((a, b) => a + (b.amount ?? 0), 0)
      + materials.filter((m) => m.status === 'ordered').reduce((a, b) => a + estimatedTotal(b), 0);

    const wishes = await req.ctx.db.select().from(projectToolWishes)
      .where(and(eq(projectToolWishes.projectId, id), isNull(projectToolWishes.deletedAt)));

    const decorated = await decorateTasks(taskRows, req.ctx);
    const budget = project.budgetAmount ?? null;
    return {
      project,
      phases: phases.map((p) => ({
        ...p,
        taskTotal: taskRows.filter((t) => t.phaseId === p.id).length,
        taskDone: taskRows.filter((t) => t.phaseId === p.id && t.status === 'done').length,
      })),
      tasks: decorated,
      materials: materials.map((m) => ({ ...m, estimatedTotal: estimatedTotal(m) })),
      tools: toolRows.map((t) => ({
        assetId: t.asset.id, name: t.asset.name,
        status: t.profile?.status ?? 'available',
        available: (t.profile?.status ?? 'available') === 'available',
        checkedOutAt: t.pt.checkedOutAt, checkedInAt: t.pt.checkedInAt,
      })),
      toolWishes: wishes,
      quotes: quoteRows,
      permits: permitRows,
      decisions: decisionRows,
      locationIds: locs.map((l) => l.locationId),
      budget: {
        amount: budget,
        breakdown: project.budgetBreakdown ?? null,
        spent: spend.total,
        committed,
        remaining: budget != null ? budget - spend.total - committed : null,
        pct: budget && budget > 0 ? Math.round((spend.total / budget) * 100) : null,
        materialsEstimate: materials.reduce((a, b) => a + estimatedTotal(b), 0),
        materialsActual: materials.reduce((a, b) => a + (b.actualCost ?? 0), 0),
        currency: req.ctx.household.currency,
      },
      carbon: {
        /** What the materials actually bought have emitted. */
        embodiedGCo2e: carbon.total,
        activities: carbon.count,
        /** What the full materials list would emit, for planning. */
        estimatedGCo2e: await estimateEmbodied(req.ctx, materials),
      },
      progress: {
        taskTotal: taskRows.length,
        taskDone: taskRows.filter((t) => t.status === 'done').length,
        blocked: decorated.filter((t: any) => t.isBlocked).length,
        hours: Math.round(taskRows.reduce((a, b) => a + (b.actualMin ?? 0), 0) / 6) / 10,
      },
    };
  });

  /* ── phases ── */

  app.post('/api/v1/projects/:id/phases', async (req, reply) => {
    requireWrite(req.ctx.user);
    const id = (req.params as { id: string }).id;
    const body = z.object({
      name: z.string().trim().min(1), sort: z.number().int().optional(),
      targetStart: dateStr.nullable().optional(), targetEnd: dateStr.nullable().optional(),
      status: z.string().default('planning'),
    }).parse(req.body);
    const [row] = await req.ctx.db.insert(projectPhases)
      .values({ projectId: id, ...body, createdBy: req.ctx.user!.id }).returning();
    reply.status(201);
    return row;
  });

  app.patch('/api/v1/project-phases/:id', async (req) => {
    requireWrite(req.ctx.user);
    const body = z.object({
      name: z.string().trim().min(1).optional(), sort: z.number().int().optional(),
      targetStart: dateStr.nullable().optional(), targetEnd: dateStr.nullable().optional(),
      status: z.string().optional(),
    }).parse(req.body);
    const [row] = await req.ctx.db.update(projectPhases).set({ ...body, updatedBy: req.ctx.user!.id })
      .where(eq(projectPhases.id, (req.params as { id: string }).id)).returning();
    if (!row) throw notFound('Phase');
    return row;
  });

  app.delete('/api/v1/project-phases/:id', async (req) => {
    requireWrite(req.ctx.user);
    const id = (req.params as { id: string }).id;
    await req.ctx.db.update(tasks).set({ phaseId: null }).where(eq(tasks.phaseId, id));
    await req.ctx.db.update(projectPhases).set({ deletedAt: new Date().toISOString() })
      .where(eq(projectPhases.id, id));
    return { ok: true };
  });

  /* ── materials (RENO-004) ── */

  crudRoutes(app, '/api/v1/project-materials', {
    table: projectMaterials, entityType: 'project_material', label: 'Material',
    create: z.object({
      projectId: z.string().min(1),
      phaseId: z.string().nullable().optional(),
      productId: z.string().nullable().optional(),
      description: z.string().trim().min(1),
      quantity: z.number().positive().default(1),
      unit: z.string().default('ea'),
      estUnitCost: z.number().int().nullable().optional(),
      status: z.enum(MATERIAL_STATUS).default('needed'),
      supplierContactId: z.string().nullable().optional(),
      emissionFactorKey: z.string().nullable().optional(),
      unitMassKg: z.number().positive().nullable().optional(),
    }),
    update: z.object({
      phaseId: z.string().nullable().optional(),
      description: z.string().trim().min(1).optional(),
      quantity: z.number().positive().optional(),
      unit: z.string().optional(),
      estUnitCost: z.number().int().nullable().optional(),
      actualCost: z.number().int().nullable().optional(),
      status: z.enum(MATERIAL_STATUS).optional(),
      supplierContactId: z.string().nullable().optional(),
      storageItemId: z.string().nullable().optional(),
      emissionFactorKey: z.string().nullable().optional(),
      unitMassKg: z.number().positive().nullable().optional(),
    }),
    searchColumns: ['description'],
    filterColumns: ['projectId', 'phaseId', 'status', 'supplierContactId', 'productId'],
  });

  /** Record a materials purchase: one transaction, many project lines (RENO-016). */
  app.post('/api/v1/project-materials/purchase', async (req, reply) => {
    requireWrite(req.ctx.user);
    const body = z.object({
      materialIds: z.array(z.string()).min(1),
      total: z.number().int().positive(),
      date: dateStr.optional(),
      payeeName: z.string().optional(),
      categoryId: z.string().optional(),
      accountId: z.string().optional(),
      memo: z.string().optional(),
      status: z.enum(MATERIAL_STATUS).default('received'),
    }).parse(req.body);

    const rows = await req.ctx.db.select().from(projectMaterials)
      .where(inArray(projectMaterials.id, body.materialIds));
    if (!rows.length) throw badRequest('No such materials');

    const { allocate } = await import('@homestead/shared');
    const weights = rows.map((r) => Math.max(estimatedTotal(r), 1));
    const shares = allocate(body.total, weights);

    // One transaction, split per project so each project's actuals stay true.
    const byProject = new Map<string, number>();
    rows.forEach((r, i) => byProject.set(r.projectId, (byProject.get(r.projectId) ?? 0) + (shares[i] ?? 0)));
    const { transaction } = await attachCost(req.ctx, {
      amount: body.total,
      date: body.date ?? req.ctx.today,
      payeeName: body.payeeName ?? null,
      accountId: body.accountId ?? null,
      memo: body.memo ?? 'Project materials',
      splits: [...byProject].map(([projectId, amount]) => ({
        amount, categoryId: body.categoryId ?? null,
        attributions: [{ entityType: 'project', entityId: projectId }],
      })),
    });

    let embodied = 0;
    for (const [i, r] of rows.entries()) {
      // Materials arrive with a footprint as well as a price (GHG-012).
      let activityId: string | null = null;
      if (r.emissionFactorKey) {
        const amount = r.unitMassKg ? r.quantity * r.unitMassKg : r.quantity;
        const unit = r.unitMassKg ? 'kg' : r.unit;
        const carbon = await tryRecordActivity(req.ctx, {
          type: 'material', amount, unit,
          occurredOn: body.date ?? req.ctx.today,
          factorKey: r.emissionFactorKey,
          transactionId: transaction.id,
          sourceType: 'project_material', sourceId: r.id,
          note: r.description,
          attributions: [{ entityType: 'project', entityId: r.projectId }],
        });
        if (carbon) { activityId = carbon.activity.id; embodied += carbon.gCo2e; }
      }
      await req.ctx.db.update(projectMaterials).set({
        actualCost: shares[i] ?? 0, status: body.status,
        transactionId: transaction.id, activityId, updatedBy: req.ctx.user!.id,
      }).where(eq(projectMaterials.id, r.id));
    }
    reply.status(201);
    return {
      transactionId: transaction.id, updated: rows.length,
      byProject: [...byProject], embodiedGCo2e: embodied,
    };
  });

  app.post('/api/v1/projects/:id/materials/to-shopping-list', async (req) => {
    requireWrite(req.ctx.user);
    const id = (req.params as { id: string }).id;
    const rows = await req.ctx.db.select().from(projectMaterials).where(and(
      eq(projectMaterials.projectId, id), eq(projectMaterials.status, 'needed'), isNull(projectMaterials.deletedAt),
    ));
    const added = [];
    for (const m of rows) {
      await addToShoppingList(req.ctx, {
        productId: m.productId ?? null, text: m.description, quantity: m.quantity, unit: m.unit,
        sourceType: 'project_material', sourceId: m.id, storeContactId: m.supplierContactId ?? null,
      });
      added.push(m.description);
    }
    return { added };
  });

  /* ── tools needed (RENO-005) ── */

  app.put('/api/v1/projects/:id/tools', async (req) => {
    requireWrite(req.ctx.user);
    const id = (req.params as { id: string }).id;
    const body = z.object({ assetIds: z.array(z.string()) }).parse(req.body);
    await req.ctx.db.delete(projectTools).where(eq(projectTools.projectId, id));
    if (body.assetIds.length) {
      await req.ctx.db.insert(projectTools).values(body.assetIds.map((assetId) => ({ projectId: id, assetId })));
    }
    return { projectId: id, assetIds: body.assetIds };
  });

  /* ── quotes (RENO-007) ── */

  crudRoutes(app, '/api/v1/quotes', {
    table: quotes, entityType: 'quote', label: 'Quote',
    create: z.object({
      projectId: z.string().min(1),
      contactId: z.string().nullable().optional(),
      scope: z.string().trim().min(1),
      amount: z.number().int().nullable().optional(),
      quotedAt: dateStr.nullable().optional(),
      validUntil: dateStr.nullable().optional(),
      status: z.enum(QUOTE_STATUS).default('requested'),
      notesMd: z.string().nullable().optional(),
      lines: z.array(z.object({ description: z.string(), amount: z.number().int() })).nullable().optional(),
    }),
    update: z.object({
      scope: z.string().trim().min(1).optional(),
      amount: z.number().int().nullable().optional(),
      quotedAt: dateStr.nullable().optional(),
      validUntil: dateStr.nullable().optional(),
      status: z.enum(QUOTE_STATUS).optional(),
      notesMd: z.string().nullable().optional(),
      contactId: z.string().nullable().optional(),
    }),
    searchColumns: ['scope', 'notesMd'],
    filterColumns: ['projectId', 'contactId', 'status'],
    sortColumns: ['quotedAt', 'amount', 'createdAt'],
  });

  app.post('/api/v1/quotes/:id/accept', async (req) => {
    requireWrite(req.ctx.user);
    const id = (req.params as { id: string }).id;
    const quote = (await req.ctx.db.select().from(quotes).where(eq(quotes.id, id)).limit(1))[0];
    if (!quote) throw notFound('Quote');
    await req.ctx.db.update(quotes)
      .set({ status: 'accepted', updatedBy: req.ctx.user!.id }).where(eq(quotes.id, id));
    // Competing quotes for the same scope lose by default.
    await req.ctx.db.update(quotes).set({ status: 'rejected' }).where(and(
      eq(quotes.projectId, quote.projectId), eq(quotes.scope, quote.scope),
      sql`${quotes.id} <> ${id}`, inArray(quotes.status, ['requested', 'received']),
    ));
    const [task] = await req.ctx.db.insert(tasks).values({
      title: `Schedule: ${quote.scope}`,
      projectId: quote.projectId, originType: 'project', originId: quote.projectId,
      priority: 'high', createdBy: req.ctx.user!.id, updatedBy: req.ctx.user!.id,
    }).returning();
    return { quoteId: id, taskId: task!.id, committed: quote.amount ?? 0 };
  });

  app.get('/api/v1/projects/:id/quote-comparison', async (req) => {
    const id = (req.params as { id: string }).id;
    const rows = await req.ctx.db.select().from(quotes)
      .where(and(eq(quotes.projectId, id), isNull(quotes.deletedAt)));
    const byScope = new Map<string, typeof rows>();
    for (const q of rows) {
      const g = byScope.get(q.scope) ?? [];
      g.push(q);
      byScope.set(q.scope, g);
    }
    return {
      groups: [...byScope].map(([scope, list]) => {
        const priced = list.filter((q) => q.amount != null);
        const amounts = priced.map((q) => q.amount!);
        return {
          scope,
          quotes: list.sort((a, b) => (a.amount ?? Infinity) - (b.amount ?? Infinity)),
          lowest: amounts.length ? Math.min(...amounts) : null,
          highest: amounts.length ? Math.max(...amounts) : null,
          spread: amounts.length > 1 ? Math.max(...amounts) - Math.min(...amounts) : null,
        };
      }),
    };
  });

  /* ── permits and inspections (RENO-010) ── */

  crudRoutes(app, '/api/v1/permits', {
    table: permits, entityType: 'permit', label: 'Permit',
    create: z.object({
      projectId: z.string().min(1),
      authorityContactId: z.string().nullable().optional(),
      name: z.string().trim().min(1),
      permitNumber: z.string().nullable().optional(),
      appliedAt: dateStr.nullable().optional(),
      issuedAt: dateStr.nullable().optional(),
      expiresAt: dateStr.nullable().optional(),
      status: z.enum(PERMIT_STATUS).default('applied'),
      notesMd: z.string().nullable().optional(),
    }),
    update: z.object({
      name: z.string().trim().min(1).optional(),
      permitNumber: z.string().nullable().optional(),
      appliedAt: dateStr.nullable().optional(),
      issuedAt: dateStr.nullable().optional(),
      expiresAt: dateStr.nullable().optional(),
      status: z.enum(PERMIT_STATUS).optional(),
      notesMd: z.string().nullable().optional(),
    }),
    searchColumns: ['name', 'permitNumber'],
    filterColumns: ['projectId', 'status'],
  });

  app.post('/api/v1/permits/:id/inspections', async (req, reply) => {
    requireWrite(req.ctx.user);
    const id = (req.params as { id: string }).id;
    const body = z.object({
      name: z.string().trim().min(1),
      scheduledAt: z.string().nullable().optional(),
      notes: z.string().nullable().optional(),
    }).parse(req.body);
    const permit = (await req.ctx.db.select().from(permits).where(eq(permits.id, id)).limit(1))[0];
    if (!permit) throw notFound('Permit');
    let taskId: string | null = null;
    if (body.scheduledAt) {
      const [task] = await req.ctx.db.insert(tasks).values({
        title: `Inspection: ${body.name}`,
        dueDate: body.scheduledAt.slice(0, 10),
        projectId: permit.projectId, originType: 'project', originId: permit.projectId,
        priority: 'high', createdBy: req.ctx.user!.id, updatedBy: req.ctx.user!.id,
      }).returning();
      taskId = task!.id;
    }
    const [row] = await req.ctx.db.insert(inspections)
      .values({ permitId: id, ...body, taskId, createdBy: req.ctx.user!.id }).returning();
    reply.status(201);
    return row;
  });

  /* ── decision log (RENO-011) ── */

  crudRoutes(app, '/api/v1/decisions', {
    table: decisions, entityType: 'project', label: 'Decision',
    create: z.object({
      projectId: z.string().min(1),
      decidedAt: dateStr,
      title: z.string().trim().min(1),
      rationaleMd: z.string().nullable().optional(),
      alternativesMd: z.string().nullable().optional(),
      decidedBy: z.string().nullable().optional(),
    }),
    update: z.object({
      title: z.string().trim().min(1).optional(),
      rationaleMd: z.string().nullable().optional(),
      alternativesMd: z.string().nullable().optional(),
    }),
    searchColumns: ['title', 'rationaleMd'],
    filterColumns: ['projectId'],
    sortColumns: ['decidedAt'],
    defaultSort: { column: 'decidedAt', dir: 'desc' },
  });

  /* ── templates (RENO-013) ── */

  app.get('/api/v1/project-templates', async (req) => {
    const rows = await req.ctx.db.select().from(projectTemplates)
      .where(isNull(projectTemplates.deletedAt)).orderBy(asc(projectTemplates.name));
    return { items: rows };
  });

  app.post('/api/v1/projects/from-template/:templateId', async (req, reply) => {
    requireWrite(req.ctx.user);
    const templateId = (req.params as { templateId: string }).templateId;
    const body = z.object({
      name: z.string().trim().min(1),
      propertyId: z.string().min(1),
      targetStart: dateStr.optional(),
      budgetAmount: z.number().int().nullable().optional(),
    }).parse(req.body);
    const t = (await req.ctx.db.select().from(projectTemplates)
      .where(eq(projectTemplates.id, templateId)).limit(1))[0];
    if (!t) throw notFound('Project template');

    const project = await projectCrud.create(req.ctx, {
      name: body.name, propertyId: body.propertyId, status: 'planning',
      targetStart: body.targetStart, budgetAmount: body.budgetAmount ?? null,
      budgetBreakdown: t.budgetBreakdown ?? null, descriptionMd: t.descriptionMd ?? null,
    });

    for (const [i, phase] of (t.phases ?? []).entries()) {
      const [row] = await req.ctx.db.insert(projectPhases)
        .values({ projectId: project.id, name: phase.name, sort: i, createdBy: req.ctx.user!.id }).returning();
      for (const title of phase.tasks ?? []) {
        await req.ctx.db.insert(tasks).values({
          title, projectId: project.id, phaseId: row!.id,
          originType: 'project', originId: project.id,
          createdBy: req.ctx.user!.id, updatedBy: req.ctx.user!.id,
        });
      }
    }
    if (t.materials?.length) {
      await req.ctx.db.insert(projectMaterials).values(t.materials.map((m) => ({
        projectId: project.id, description: m.description, quantity: m.quantity, unit: m.unit,
        estUnitCost: m.estUnitCost ?? null, createdBy: req.ctx.user!.id, updatedBy: req.ctx.user!.id,
      })));
    }
    for (const name of t.permits ?? []) {
      await req.ctx.db.insert(permits).values({
        projectId: project.id, name, status: 'applied', createdBy: req.ctx.user!.id, updatedBy: req.ctx.user!.id,
      });
    }
    for (const tool of t.tools ?? []) {
      await req.ctx.db.insert(projectToolWishes).values({
        projectId: project.id, description: tool, rentOrBuy: 'buy', createdBy: req.ctx.user!.id,
      });
    }
    reply.status(201);
    return projectCrud.get(req.ctx, project.id);
  });

  /* ── completion and retrospective (RENO-014) ── */

  app.post('/api/v1/projects/:id/complete', async (req) => {
    requireWrite(req.ctx.user);
    const id = (req.params as { id: string }).id;
    const body = z.object({
      actualEnd: dateStr.optional(),
      wentWell: z.string().optional(),
      wentPoorly: z.string().optional(),
      leftovers: z.array(z.object({
        description: z.string(), locationId: z.string().nullable().optional(), quantity: z.number().positive().default(1),
      })).optional(),
      createAssets: z.array(z.object({
        name: z.string(), categoryId: z.string().nullable().optional(),
        locationId: z.string().nullable().optional(), purchasePrice: z.number().int().nullable().optional(),
        warrantyExpiry: dateStr.nullable().optional(), installedDate: dateStr.nullable().optional(),
      })).optional(),
    }).parse(req.body ?? {});

    const project = (await req.ctx.db.select().from(projects).where(eq(projects.id, id)).limit(1))[0];
    if (!project) throw notFound('Project');
    const [spend, carbon] = await Promise.all([
      spentOn(req.ctx, 'project', id),
      emittedBy(req.ctx, 'project', id),
    ]);

    const createdAssets: string[] = [];
    for (const a of body.createAssets ?? []) {
      const [row] = await req.ctx.db.insert(assets).values({
        propertyId: project.propertyId, name: a.name, categoryId: a.categoryId ?? null,
        locationId: a.locationId ?? null, purchasePrice: a.purchasePrice ?? null,
        warrantyExpiry: a.warrantyExpiry ?? null, installedDate: a.installedDate ?? body.actualEnd ?? req.ctx.today,
        createdBy: req.ctx.user!.id, updatedBy: req.ctx.user!.id,
      }).returning();
      createdAssets.push(row!.id);
    }

    const filed: string[] = [];
    for (const l of body.leftovers ?? []) {
      const [row] = await req.ctx.db.insert(storageItems).values({
        name: l.description, locationId: l.locationId ?? null, quantity: l.quantity,
        projectId: id, notesMd: `Left over from ${project.name}`,
        createdBy: req.ctx.user!.id, updatedBy: req.ctx.user!.id,
      }).returning();
      filed.push(row!.id);
    }

    const [updated] = await req.ctx.db.update(projects).set({
      status: 'complete',
      actualEnd: body.actualEnd ?? req.ctx.today,
      retrospective: {
        finalCost: spend.total,
        budget: project.budgetAmount ?? null,
        variance: project.budgetAmount != null ? spend.total - project.budgetAmount : null,
        wentWell: body.wentWell ?? null,
        wentPoorly: body.wentPoorly ?? null,
        completedAt: body.actualEnd ?? req.ctx.today,
        createdAssets, filedLeftovers: filed,
      },
      updatedBy: req.ctx.user!.id,
    }).where(eq(projects.id, id)).returning();

    // Check any tools back in; the project is over.
    const heldTools = await req.ctx.db.select().from(projectTools)
      .where(and(eq(projectTools.projectId, id), isNull(projectTools.checkedInAt)));
    for (const t of heldTools) {
      await req.ctx.db.update(toolProfiles).set({ status: 'available' }).where(eq(toolProfiles.assetId, t.assetId));
      await req.ctx.db.update(projectTools).set({ checkedInAt: new Date().toISOString() })
        .where(and(eq(projectTools.projectId, id), eq(projectTools.assetId, t.assetId)));
    }
    return { project: updated, spend, createdAssets, filedLeftovers: filed };
  });

  /** The ideas backlog feeds long-range budget planning (RENO-015, BUD-030). */
  app.get('/api/v1/projects/backlog', async (req) => {
    const rows = await req.ctx.db.select().from(projects)
      .where(and(eq(projects.status, 'idea'), isNull(projects.deletedAt)))
      .orderBy(desc(projects.priority), asc(projects.createdAt));
    return {
      items: rows,
      totalEstimate: rows.reduce((a, b) => a + (b.estimateCost ?? b.budgetAmount ?? 0), 0),
      currency: req.ctx.household.currency,
    };
  });

  /** Timeline data for the Gantt view (RENO-012). */
  app.get('/api/v1/projects/:id/timeline', async (req) => {
    const id = (req.params as { id: string }).id;
    const [phases, taskRows] = await Promise.all([
      req.ctx.db.select().from(projectPhases)
        .where(and(eq(projectPhases.projectId, id), isNull(projectPhases.deletedAt))).orderBy(asc(projectPhases.sort)),
      req.ctx.db.select().from(tasks)
        .where(and(eq(tasks.projectId, id), isNull(tasks.deletedAt))),
    ]);
    return {
      phases: phases.map((p) => {
        const inPhase = taskRows.filter((t) => t.phaseId === p.id);
        const dates = inPhase.map((t) => t.dueDate).filter(Boolean).sort() as string[];
        return {
          ...p,
          derivedStart: p.targetStart ?? dates[0] ?? null,
          derivedEnd: p.targetEnd ?? dates.at(-1) ?? null,
          taskTotal: inPhase.length,
          taskDone: inPhase.filter((t) => t.status === 'done').length,
        };
      }),
      tasks: taskRows.map((t) => ({
        id: t.id, title: t.title, phaseId: t.phaseId,
        start: t.startDate ?? t.dueDate, end: t.dueDate, status: t.status,
      })),
    };
  });
}

function estimatedTotal(m: { quantity: number; estUnitCost: number | null }): number {
  return Math.round((m.estUnitCost ?? 0) * m.quantity);
}


async function decorateProjects(rows: any[], ctx: any): Promise<any[]> {
  const ids = rows.map((r) => r.id);
  if (!ids.length) return rows;
  const [spend, carbon, taskRows] = await Promise.all([
    spentOnMany(ctx, 'project', ids),
    emittedByMany(ctx, 'project', ids),
    ctx.db.select({ projectId: tasks.projectId, status: tasks.status })
      .from(tasks).where(and(inArray(tasks.projectId, ids), isNull(tasks.deletedAt))),
  ]);
  const counts = new Map<string, { total: number; done: number }>();
  for (const t of taskRows as Array<{ projectId: string | null; status: string }>) {
    if (!t.projectId) continue;
    const c = counts.get(t.projectId) ?? { total: 0, done: 0 };
    c.total += 1;
    if (t.status === 'done') c.done += 1;
    counts.set(t.projectId, c);
  }
  return rows.map((r) => {
    const spent = spend.get(r.id) ?? 0;
    const c = counts.get(r.id) ?? { total: 0, done: 0 };
    return {
      ...r,
      spent,
      gCo2e: carbon.get(r.id) ?? 0,
      taskTotal: c.total,
      taskDone: c.done,
      pctBudget: r.budgetAmount && r.budgetAmount > 0 ? Math.round((spent / r.budgetAmount) * 100) : null,
      pctTasks: c.total > 0 ? Math.round((c.done / c.total) * 100) : null,
      isActive: (ACTIVE_PROJECT_STATUS as readonly string[]).includes(r.status),
    };
  });
}

export { PROJECT_COST_BUCKETS };
