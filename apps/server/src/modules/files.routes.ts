import type { FastifyInstance } from 'fastify';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { and, desc, eq, isNull, like, sql } from 'drizzle-orm';
import { z } from 'zod';
import { DOC_TYPES, ENTITY_TYPES } from '@homestead/shared';
import { config } from '../config.js';
import { attachments, files } from '../db/schema.js';
import { requireWrite } from '../core/auth.js';
import { badRequest, notFound } from '../core/errors.js';
import { assertEntity } from '../core/registry.js';

/** Content-addressed: identical uploads share one blob on disk (DOC-005). */
function keyFor(sha: string, ext: string): string {
  return path.join(sha.slice(0, 2), sha.slice(2, 4), `${sha}${ext}`);
}

const SAFE_INLINE = new Set([
  'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf', 'text/plain',
]);

export function fileRoutes(app: FastifyInstance): void {
  app.post('/api/v1/files', async (req, reply) => {
    requireWrite(req.ctx.user);
    const part = await req.file({ limits: { fileSize: config.maxUploadBytes } });
    if (!part) throw badRequest('Send a multipart file field');
    const buf = await part.toBuffer();
    if (buf.length === 0) throw badRequest('Empty file');

    const sha = createHash('sha256').update(buf).digest('hex');
    const ext = path.extname(part.filename || '').slice(0, 12).toLowerCase();
    const storageKey = keyFor(sha, ext);
    const abs = path.join(config.filesDir, storageKey);
    await mkdir(path.dirname(abs), { recursive: true });
    try { await stat(abs); } catch { await writeFile(abs, buf); }

    const existing = await req.ctx.db.select().from(files)
      .where(and(eq(files.sha256, sha), eq(files.storageKey, storageKey))).limit(1);
    const file = existing[0] ?? (await req.ctx.db.insert(files).values({
      sha256: sha, size: buf.length, mime: part.mimetype || 'application/octet-stream',
      originalName: part.filename || 'upload', storageKey, createdBy: req.ctx.user!.id,
    }).returning())[0]!;

    // Fields arrive alongside the file part in the same multipart body.
    const fields = part.fields as Record<string, { value?: string } | undefined>;
    const entityType = fields.entityType?.value;
    const entityId = fields.entityId?.value;
    let attachment = null;
    if (entityType && entityId) {
      await assertEntity(req.ctx.db, entityType, entityId);
      const docType = fields.docType?.value;
      attachment = (await req.ctx.db.insert(attachments).values({
        fileId: file.id, entityType, entityId,
        docType: docType && (DOC_TYPES as readonly string[]).includes(docType) ? docType : 'other',
        title: fields.title?.value, createdBy: req.ctx.user!.id,
      }).returning())[0];
    }
    reply.status(201);
    return { file, attachment, url: `/api/v1/files/${file.id}/content` };
  });

  app.post('/api/v1/files/:id/attach', async (req, reply) => {
    requireWrite(req.ctx.user);
    const fileId = (req.params as { id: string }).id;
    const body = z.object({
      entityType: z.enum(ENTITY_TYPES), entityId: z.string().min(1),
      docType: z.enum(DOC_TYPES).default('other'), title: z.string().optional(),
    }).parse(req.body);
    const f = await req.ctx.db.select().from(files).where(eq(files.id, fileId)).limit(1);
    if (!f[0]) throw notFound('File');
    await assertEntity(req.ctx.db, body.entityType, body.entityId);
    const [row] = await req.ctx.db.insert(attachments).values({
      fileId, entityType: body.entityType, entityId: body.entityId,
      docType: body.docType, title: body.title, createdBy: req.ctx.user!.id,
    }).returning();
    reply.status(201);
    return row;
  });

  app.get('/api/v1/files/:id/content', async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const rows = await req.ctx.db.select().from(files)
      .where(and(eq(files.id, id), isNull(files.deletedAt))).limit(1);
    const file = rows[0];
    if (!file) throw notFound('File');
    const abs = path.join(config.filesDir, file.storageKey);
    try { await stat(abs); } catch { throw notFound('File content'); }
    const inline = SAFE_INLINE.has(file.mime);
    reply
      .type(file.mime)
      .header('x-content-type-options', 'nosniff')
      .header('cache-control', 'private, max-age=31536000, immutable')
      .header('content-disposition',
        `${inline ? 'inline' : 'attachment'}; filename="${file.originalName.replace(/[^\w. -]/g, '_')}"`);
    return reply.send(createReadStream(abs));
  });

  /** The document library (DOC-003). */
  app.get('/api/v1/documents', async (req) => {
    const q = z.object({
      q: z.string().trim().optional(),
      docType: z.string().optional(),
      entityType: z.string().optional(),
      entityId: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(200).default(50),
    }).parse(req.query);
    const where = [isNull(attachments.deletedAt)];
    if (q.docType) where.push(eq(attachments.docType, q.docType));
    if (q.entityType) where.push(eq(attachments.entityType, q.entityType));
    if (q.entityId) where.push(eq(attachments.entityId, q.entityId));
    if (q.q) {
      const n = `%${q.q.toLowerCase()}%`;
      where.push(sql`(lower(${files.originalName}) like ${n} or lower(coalesce(${attachments.title}, '')) like ${n})`);
    }
    const rows = await req.ctx.db.select({ a: attachments, f: files })
      .from(attachments).innerJoin(files, eq(files.id, attachments.fileId))
      .where(and(...where)).orderBy(desc(attachments.createdAt)).limit(q.limit);
    const { resolveLabels, ENTITIES, isEntityType } = await import('../core/registry.js');
    const labels = await resolveLabels(req.ctx.db, rows.map((r) => ({ type: r.a.entityType, id: r.a.entityId })));
    return {
      items: rows.map((r) => ({
        id: r.a.id, fileId: r.f.id, docType: r.a.docType,
        title: r.a.title ?? r.f.originalName, mime: r.f.mime, size: r.f.size,
        createdAt: r.a.createdAt, entityType: r.a.entityType, entityId: r.a.entityId,
        entityLabel: labels.get(`${r.a.entityType}:${r.a.entityId}`) ?? null,
        route: isEntityType(r.a.entityType) ? ENTITIES[r.a.entityType].route(r.a.entityId) : null,
        url: `/api/v1/files/${r.f.id}/content`,
      })),
    };
  });
}
