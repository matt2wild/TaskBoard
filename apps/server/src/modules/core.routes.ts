/* eslint-disable @typescript-eslint/no-explicit-any */
import type { FastifyInstance } from 'fastify';
import { and, desc, eq, inArray, isNull, like, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { DOC_TYPES, ENTITY_TYPES, TAG_COLOURS } from '@homestead/shared';
import {
  activityLog, attachments, comments, entityLinks, entityTags, files, labelCodes, locations, settings, tags,
} from '../db/schema.js';
import { crudRoutes } from '../core/crud.js';
import { requireAdmin, requireWrite } from '../core/auth.js';
import { badRequest, notFound } from '../core/errors.js';
import { ENTITIES, assertEntity, entityDef, isEntityType, resolveLabels } from '../core/registry.js';
import { logActivity } from '../core/activity.js';

const entityRef = z.object({
  entityType: z.enum(ENTITY_TYPES),
  entityId: z.string().min(1),
});

export function coreRoutes(app: FastifyInstance): void {
  /* ── tags ── */
  crudRoutes(app, '/api/v1/tags', {
    table: tags, entityType: 'category', label: 'Tag',
    create: z.object({
      name: z.string().trim().min(1),
      colour: z.enum(TAG_COLOURS).default('slate'),
      description: z.string().optional(),
    }),
    update: z.object({
      name: z.string().trim().min(1).optional(),
      colour: z.enum(TAG_COLOURS).optional(),
      description: z.string().nullable().optional(),
    }),
    searchColumns: ['name'],
  });

  app.get('/api/v1/tags/:id/items', async (req) => {
    const id = (req.params as { id: string }).id;
    const rows = await req.ctx.db.select().from(entityTags).where(eq(entityTags.tagId, id));
    const labels = await resolveLabels(req.ctx.db, rows.map((r) => ({ type: r.entityType, id: r.entityId })));
    return {
      items: rows.map((r) => ({
        type: r.entityType, id: r.entityId,
        label: labels.get(`${r.entityType}:${r.entityId}`) ?? r.entityId,
        route: isEntityType(r.entityType) ? ENTITIES[r.entityType].route(r.entityId) : null,
      })),
    };
  });

  app.post('/api/v1/entities/:type/:id/tags', async (req, reply) => {
    requireWrite(req.ctx.user);
    const { type, id } = req.params as { type: string; id: string };
    const body = z.object({ tagId: z.string().optional(), name: z.string().trim().min(1).optional() }).parse(req.body);
    entityDef(type);
    await assertEntity(req.ctx.db, type, id);
    let tagId = body.tagId;
    if (!tagId) {
      if (!body.name) throw badRequest('Give a tagId or a name');
      const found = await req.ctx.db.select().from(tags)
        .where(and(eq(tags.name, body.name), isNull(tags.deletedAt))).limit(1);
      tagId = found[0]?.id
        ?? (await req.ctx.db.insert(tags).values({ name: body.name, createdBy: req.ctx.user!.id }).returning())[0]!.id;
    }
    await req.ctx.db.insert(entityTags)
      .values({ tagId, entityType: type, entityId: id }).onConflictDoNothing();
    reply.status(201);
    return { tagId, entityType: type, entityId: id };
  });

  app.delete('/api/v1/entities/:type/:id/tags/:tagId', async (req) => {
    requireWrite(req.ctx.user);
    const { type, id, tagId } = req.params as { type: string; id: string; tagId: string };
    await req.ctx.db.delete(entityTags).where(and(
      eq(entityTags.tagId, tagId), eq(entityTags.entityType, type), eq(entityTags.entityId, id),
    ));
    return { ok: true };
  });

  app.get('/api/v1/entities/:type/:id/tags', async (req) => {
    const { type, id } = req.params as { type: string; id: string };
    const rows = await req.ctx.db.select({ tag: tags })
      .from(entityTags).innerJoin(tags, eq(tags.id, entityTags.tagId))
      .where(and(eq(entityTags.entityType, type), eq(entityTags.entityId, id)));
    return { items: rows.map((r) => r.tag) };
  });

  /* ── links: the "Related" panel on every entity (INT-003) ── */

  app.get('/api/v1/entities/:type/:id/links', async (req) => {
    const { type, id } = req.params as { type: string; id: string };
    entityDef(type);
    const rows = await req.ctx.db.select().from(entityLinks).where(or(
      and(eq(entityLinks.fromType, type), eq(entityLinks.fromId, id)),
      and(eq(entityLinks.toType, type), eq(entityLinks.toId, id)),
    ));
    const refs = rows.map((r) => (r.fromType === type && r.fromId === id)
      ? { type: r.toType, id: r.toId, linkId: r.id, relation: r.relation, direction: 'out' as const }
      : { type: r.fromType, id: r.fromId, linkId: r.id, relation: r.relation, direction: 'in' as const });
    const labels = await resolveLabels(req.ctx.db, refs);
    return {
      items: refs.map((r) => ({
        ...r,
        label: labels.get(`${r.type}:${r.id}`) ?? r.id,
        route: isEntityType(r.type) ? ENTITIES[r.type].route(r.id) : null,
        icon: isEntityType(r.type) ? ENTITIES[r.type].icon : 'link',
      })),
    };
  });

  app.post('/api/v1/entities/:type/:id/links', async (req, reply) => {
    requireWrite(req.ctx.user);
    const { type, id } = req.params as { type: string; id: string };
    const body = entityRef.extend({ relation: z.string().default('related'), note: z.string().optional() }).parse(req.body);
    await assertEntity(req.ctx.db, type, id);
    await assertEntity(req.ctx.db, body.entityType, body.entityId);
    const [row] = await req.ctx.db.insert(entityLinks).values({
      fromType: type, fromId: id, toType: body.entityType, toId: body.entityId,
      relation: body.relation, note: body.note, createdBy: req.ctx.user!.id,
    }).onConflictDoNothing().returning();
    reply.status(201);
    return row ?? { ok: true, duplicate: true };
  });

  app.delete('/api/v1/links/:linkId', async (req) => {
    requireWrite(req.ctx.user);
    await req.ctx.db.delete(entityLinks).where(eq(entityLinks.id, (req.params as { linkId: string }).linkId));
    return { ok: true };
  });

  /* ── comments ── */

  app.get('/api/v1/entities/:type/:id/comments', async (req) => {
    const { type, id } = req.params as { type: string; id: string };
    const rows = await req.ctx.db.select().from(comments)
      .where(and(eq(comments.entityType, type), eq(comments.entityId, id), isNull(comments.deletedAt)))
      .orderBy(comments.createdAt);
    return { items: rows };
  });

  app.post('/api/v1/entities/:type/:id/comments', async (req, reply) => {
    requireWrite(req.ctx.user);
    const { type, id } = req.params as { type: string; id: string };
    const body = z.object({ bodyMd: z.string().trim().min(1), parentCommentId: z.string().optional() }).parse(req.body);
    await assertEntity(req.ctx.db, type, id);
    const [row] = await req.ctx.db.insert(comments).values({
      entityType: type, entityId: id, userId: req.ctx.user!.id,
      bodyMd: body.bodyMd, parentCommentId: body.parentCommentId, createdBy: req.ctx.user!.id,
    }).returning();
    reply.status(201);
    return row;
  });

  app.delete('/api/v1/comments/:id', async (req) => {
    requireWrite(req.ctx.user);
    const id = (req.params as { id: string }).id;
    const rows = await req.ctx.db.select().from(comments).where(eq(comments.id, id)).limit(1);
    if (!rows[0]) throw notFound('Comment');
    if (rows[0].userId !== req.ctx.user!.id && req.ctx.user!.role !== 'admin') {
      throw badRequest('You can only delete your own comments');
    }
    await req.ctx.db.update(comments).set({ deletedAt: new Date().toISOString() }).where(eq(comments.id, id));
    return { ok: true };
  });

  /* ── activity (GEN-009) ── */

  app.get('/api/v1/entities/:type/:id/activity', async (req) => {
    const { type, id } = req.params as { type: string; id: string };
    const rows = await req.ctx.db.select().from(activityLog)
      .where(and(eq(activityLog.entityType, type), eq(activityLog.entityId, id)))
      .orderBy(desc(activityLog.ts)).limit(200);
    return { items: rows };
  });

  app.get('/api/v1/activity', async (req) => {
    const q = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) }).parse(req.query);
    const rows = await req.ctx.db.select().from(activityLog).orderBy(desc(activityLog.ts)).limit(q.limit);
    const labels = await resolveLabels(req.ctx.db, rows.map((r) => ({ type: r.entityType, id: r.entityId })));
    return {
      items: rows.map((r) => ({
        ...r,
        label: r.summary ?? labels.get(`${r.entityType}:${r.entityId}`) ?? r.entityId,
        route: isEntityType(r.entityType) ? ENTITIES[r.entityType].route(r.entityId) : null,
      })),
    };
  });

  /* ── attachments metadata (upload lives in files.routes) ── */

  app.get('/api/v1/entities/:type/:id/attachments', async (req) => {
    const { type, id } = req.params as { type: string; id: string };
    const rows = await req.ctx.db.select({ a: attachments, f: files })
      .from(attachments).innerJoin(files, eq(files.id, attachments.fileId))
      .where(and(eq(attachments.entityType, type), eq(attachments.entityId, id), isNull(attachments.deletedAt)))
      .orderBy(attachments.sort, attachments.createdAt);
    return {
      items: rows.map((r) => ({
        ...r.a, mime: r.f.mime, size: r.f.size, originalName: r.f.originalName,
        url: `/api/v1/files/${r.f.id}/content`,
      })),
    };
  });

  app.patch('/api/v1/attachments/:id', async (req) => {
    requireWrite(req.ctx.user);
    const id = (req.params as { id: string }).id;
    const body = z.object({
      docType: z.enum(DOC_TYPES).optional(),
      title: z.string().nullable().optional(),
      description: z.string().nullable().optional(),
      isPrimary: z.boolean().optional(),
      sort: z.number().int().optional(),
    }).parse(req.body);
    const [row] = await req.ctx.db.update(attachments).set(body).where(eq(attachments.id, id)).returning();
    if (!row) throw notFound('Attachment');
    if (body.isPrimary) {
      await req.ctx.db.update(attachments).set({ isPrimary: false }).where(and(
        eq(attachments.entityType, row.entityType), eq(attachments.entityId, row.entityId),
        sql`${attachments.id} <> ${id}`,
      ));
    }
    return row;
  });

  app.delete('/api/v1/attachments/:id', async (req) => {
    requireWrite(req.ctx.user);
    const id = (req.params as { id: string }).id;
    await req.ctx.db.update(attachments).set({ deletedAt: new Date().toISOString() }).where(eq(attachments.id, id));
    return { ok: true };
  });

  /* ── global search (GEN-008) ── */

  app.get('/api/v1/search', async (req) => {
    const q = z.object({
      q: z.string().trim().min(1),
      types: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(50).default(20),
    }).parse(req.query);
    const wanted = q.types ? new Set(q.types.split(',')) : null;
    const needle = `%${q.q.toLowerCase().replace(/[%_]/g, (m) => `\\${m}`)}%`;
    const results: Array<{ type: string; id: string; label: string; sub?: string; route: string; icon: string }> = [];

    for (const [type, def] of Object.entries(ENTITIES)) {
      if (!def.searchable) continue;
      if (wanted && !wanted.has(type)) continue;
      if (results.length >= q.limit * 3) break;
      const cols = def.table as unknown as Record<string, any>;
      const labelCol = cols[def.labelColumn];
      if (!labelCol) continue;
      const where: any[] = [like(sql`lower(${labelCol})`, needle)];
      if ('deletedAt' in cols) where.push(isNull(cols.deletedAt));
      const rows = await req.ctx.db.select({ id: cols.id, label: labelCol })
        .from(def.table).where(and(...where)).limit(q.limit);
      for (const r of rows as Array<{ id: string; label: string | null }>) {
        results.push({
          type, id: r.id, label: r.label ?? r.id, route: def.route(r.id), icon: def.icon,
        });
      }
    }

    // Storage items carry a location breadcrumb: "where is X" is the point (STOR-003).
    const storageHits = results.filter((r) => r.type === 'storage_item' || r.type === 'asset');
    if (storageHits.length) {
      const { storageItems, assets } = await import('../db/schema.js');
      const ids = storageHits.map((r) => r.id);
      const locs = new Map<string, string>();
      for (const table of [storageItems, assets]) {
        const rows = await req.ctx.db.select({ id: (table as any).id, locationId: (table as any).locationId })
          .from(table as any).where(inArray((table as any).id, ids));
        for (const r of rows as Array<{ id: string; locationId: string | null }>) {
          if (r.locationId) locs.set(r.id, r.locationId);
        }
      }
      const paths = await locationPaths(req.ctx.db, [...new Set([...locs.values()])]);
      for (const hit of storageHits) {
        const lid = locs.get(hit.id);
        if (lid) hit.sub = paths.get(lid);
      }
    }
    return { items: results.slice(0, q.limit), query: q.q };
  });

  /* ── QR labels (STOR-020) ── */

  app.get('/api/v1/labels/resolve/:code', async (req) => {
    const code = (req.params as { code: string }).code.toUpperCase();
    const rows = await req.ctx.db.select().from(labelCodes)
      .where(and(eq(labelCodes.code, code), isNull(labelCodes.deletedAt))).limit(1);
    const row = rows[0];
    if (!row) throw notFound('Label');
    if (!row.entityType || !row.entityId) return { code, assigned: false };
    const labels = await resolveLabels(req.ctx.db, [{ type: row.entityType, id: row.entityId }]);
    return {
      code, assigned: true, entityType: row.entityType, entityId: row.entityId,
      label: labels.get(`${row.entityType}:${row.entityId}`),
      route: isEntityType(row.entityType) ? ENTITIES[row.entityType].route(row.entityId) : null,
    };
  });

  app.post('/api/v1/labels', async (req, reply) => {
    requireWrite(req.ctx.user);
    const body = z.object({
      count: z.number().int().min(1).max(200).default(1),
      entityType: z.enum(ENTITY_TYPES).optional(),
      entityId: z.string().optional(),
      prefix: z.string().trim().max(4).default('H'),
    }).parse(req.body ?? {});
    if (body.entityType && body.entityId) await assertEntity(req.ctx.db, body.entityType, body.entityId);
    const made: string[] = [];
    for (let i = 0; i < body.count; i++) {
      const code = await uniqueCode(req.ctx.db, body.prefix.toUpperCase());
      await req.ctx.db.insert(labelCodes).values({
        code,
        entityType: body.entityType ?? null,
        entityId: body.entityId ?? null,
        assignedAt: body.entityId ? new Date().toISOString() : null,
        createdBy: req.ctx.user!.id,
      });
      made.push(code);
    }
    reply.status(201);
    return { codes: made };
  });

  app.post('/api/v1/labels/:code/assign', async (req) => {
    requireWrite(req.ctx.user);
    const code = (req.params as { code: string }).code.toUpperCase();
    const body = entityRef.parse(req.body);
    await assertEntity(req.ctx.db, body.entityType, body.entityId);
    const [row] = await req.ctx.db.update(labelCodes).set({
      entityType: body.entityType, entityId: body.entityId, assignedAt: new Date().toISOString(),
    }).where(eq(labelCodes.code, code)).returning();
    if (!row) throw notFound('Label');
    return row;
  });

  app.get('/api/v1/labels/:code/qr.svg', async (req, reply) => {
    const code = (req.params as { code: string }).code.toUpperCase();
    const { toString } = await import('qrcode');
    const base = req.ctx.household ? '' : '';
    const url = `${base}/s/${code}`;
    const svg = await toString(url, { type: 'svg', margin: 1, width: 256 });
    reply.type('image/svg+xml').header('cache-control', 'public, max-age=86400');
    return svg;
  });

  app.get('/api/v1/labels', async (req) => {
    const rows = await req.ctx.db.select().from(labelCodes)
      .where(isNull(labelCodes.deletedAt)).orderBy(desc(labelCodes.createdAt)).limit(500);
    const labels = await resolveLabels(
      req.ctx.db,
      rows.filter((r) => r.entityType && r.entityId).map((r) => ({ type: r.entityType!, id: r.entityId! })),
    );
    return {
      items: rows.map((r) => ({
        ...r,
        label: r.entityType && r.entityId ? labels.get(`${r.entityType}:${r.entityId}`) ?? null : null,
      })),
    };
  });

  /* ── settings ── */

  app.get('/api/v1/settings', async (req) => {
    const rows = await req.ctx.db.select().from(settings);
    return { items: Object.fromEntries(rows.map((r) => [r.key, r.value])) };
  });

  app.put('/api/v1/settings/:key', async (req) => {
    requireAdmin(req.ctx.user);
    const key = (req.params as { key: string }).key;
    const body = z.object({ value: z.unknown() }).parse(req.body);
    await req.ctx.db.insert(settings)
      .values({ key, value: body.value, updatedAt: new Date().toISOString() })
      .onConflictDoUpdate({ target: settings.key, set: { value: body.value, updatedAt: new Date().toISOString() } });
    await logActivity(req.ctx.db, { userId: req.ctx.user!.id, action: 'update', entityType: 'user', entityId: key, summary: `setting ${key}` });
    return { key, value: body.value };
  });
}

async function uniqueCode(db: any, prefix: string): Promise<string> {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1: these get hand-typed
  for (let attempt = 0; attempt < 20; attempt++) {
    let body = '';
    for (let i = 0; i < 5; i++) body += alphabet[Math.floor(Math.random() * alphabet.length)];
    const code = `${prefix}${body}`;
    const existing = await db.select({ id: labelCodes.id }).from(labelCodes).where(eq(labelCodes.code, code)).limit(1);
    if (!existing.length) return code;
  }
  throw badRequest('Could not allocate a label code');
}

/** Breadcrumb path for locations, e.g. "Garage › Shelf 3 › Bin 12". */
export async function locationPaths(db: any, ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!ids.length) return out;
  const all = await db.select({ id: locations.id, name: locations.name, parentId: locations.parentId }).from(locations);
  const byId = new Map<string, { id: string; name: string; parentId: string | null }>(
    (all as Array<{ id: string; name: string; parentId: string | null }>).map((r) => [r.id, r]),
  );
  for (const id of ids) {
    const parts: string[] = [];
    let cur = byId.get(id);
    let guard = 0;
    while (cur && guard++ < 30) {
      parts.unshift(cur.name);
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    if (parts.length) out.set(id, parts.join(' › '));
  }
  return out;
}
