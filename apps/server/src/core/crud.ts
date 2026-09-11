/* eslint-disable @typescript-eslint/no-explicit-any */
import type { FastifyInstance } from 'fastify';
import { and, asc, desc, eq, gt, inArray, isNull, like, lt, or, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type { Page } from '@homestead/shared';
import { badRequest, conflict, notFound } from './errors.js';
import { logActivity } from './activity.js';
import { requireWrite } from './auth.js';
import type { Ctx } from './ctx.js';

export interface CrudHooks<Row = any> {
  /** Runs inside the request before insert; may mutate or reject the payload. */
  beforeCreate?: (values: any, ctx: Ctx) => Promise<any> | any;
  afterCreate?: (row: Row, ctx: Ctx) => Promise<void> | void;
  beforeUpdate?: (values: any, before: Row, ctx: Ctx) => Promise<any> | any;
  afterUpdate?: (row: Row, before: Row, ctx: Ctx) => Promise<void> | void;
  beforeDelete?: (row: Row, ctx: Ctx) => Promise<void> | void;
  /** Adds computed fields to rows on read. */
  decorate?: (rows: Row[], ctx: Ctx) => Promise<any[]> | any[];
  /** Extra always-applied WHERE, e.g. scoping to a parent. */
  scope?: (ctx: Ctx) => SQL | undefined;
}

export interface CrudConfig {
  table: any;
  entityType: string;
  label: string;
  create: z.ZodTypeAny;
  update: z.ZodTypeAny;
  searchColumns?: string[];
  filterColumns?: string[];
  sortColumns?: string[];
  defaultSort?: { column: string; dir: 'asc' | 'desc' };
  hooks?: CrudHooks;
  /** Set false for tables without a deleted_at column. */
  softDelete?: boolean;
  summary?: (row: any) => string;
}

const encodeCursor = (v: unknown, id: string) =>
  Buffer.from(JSON.stringify([v ?? null, id])).toString('base64url');
const decodeCursor = (c: string): [unknown, string] => {
  try {
    const parsed = JSON.parse(Buffer.from(c, 'base64url').toString('utf8'));
    if (!Array.isArray(parsed) || parsed.length !== 2) throw new Error('shape');
    return parsed as [unknown, string];
  } catch { throw badRequest('Invalid cursor'); }
};

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(50),
  cursor: z.string().optional(),
  q: z.string().trim().min(1).optional(),
  sort: z.string().optional(),
  dir: z.enum(['asc', 'desc']).optional(),
  includeDeleted: z.coerce.boolean().optional(),
  count: z.coerce.boolean().optional(),
}).passthrough();

export function columnsOf(table: any): Record<string, any> {
  return table as unknown as Record<string, any>;
}

/** Parses `?col=a,b` into an equality or IN predicate, handling nulls. */
function filterPredicate(col: any, raw: string): SQL | undefined {
  if (raw === '') return undefined;
  if (raw === 'null') return isNull(col);
  const parts = raw.split(',').filter(Boolean);
  if (parts.length === 0) return undefined;
  if (parts.length === 1) {
    const v = parts[0]!;
    if (v === 'true' || v === 'false') return eq(col, v === 'true');
    return eq(col, v);
  }
  return inArray(col, parts);
}

export interface CrudApi {
  list: (ctx: Ctx, query: Record<string, unknown>) => Promise<Page<any>>;
  get: (ctx: Ctx, id: string) => Promise<any>;
  create: (ctx: Ctx, body: unknown) => Promise<any>;
  update: (ctx: Ctx, id: string, body: unknown) => Promise<any>;
  remove: (ctx: Ctx, id: string) => Promise<{ id: string; deleted: true }>;
}

export function makeCrud(cfg: CrudConfig): CrudApi {
  const cols = columnsOf(cfg.table);
  const soft = cfg.softDelete !== false && 'deletedAt' in cols;
  const sortCols = cfg.sortColumns ?? ['createdAt', 'updatedAt', 'name', 'title', 'date'];
  const defaultSort = cfg.defaultSort ?? {
    column: 'name' in cols ? 'name' : 'title' in cols ? 'title' : 'createdAt',
    dir: 'asc' as const,
  };

  const baseWhere = (ctx: Ctx, includeDeleted = false): SQL | undefined => {
    const parts: (SQL | undefined)[] = [];
    if (soft && !includeDeleted) parts.push(isNull(cols.deletedAt));
    const scoped = cfg.hooks?.scope?.(ctx);
    if (scoped) parts.push(scoped);
    const kept = parts.filter(Boolean) as SQL[];
    return kept.length ? and(...kept) : undefined;
  };

  async function decorate(ctx: Ctx, rows: any[]): Promise<any[]> {
    if (!rows.length) return rows;
    return cfg.hooks?.decorate ? await cfg.hooks.decorate(rows, ctx) : rows;
  }

  async function fetchOne(ctx: Ctx, id: string, includeDeleted = false): Promise<any | null> {
    const w = baseWhere(ctx, includeDeleted);
    const rows = await ctx.db.select().from(cfg.table)
      .where(w ? and(eq(cols.id, id), w) : eq(cols.id, id)).limit(1);
    return rows[0] ?? null;
  }

  return {
    async list(ctx, rawQuery) {
      const parsed = listQuery.parse(rawQuery);
      const { limit, cursor, q, includeDeleted } = parsed;
      const sortKey = parsed.sort && sortCols.includes(parsed.sort) && cols[parsed.sort]
        ? parsed.sort : defaultSort.column;
      const dir = parsed.dir ?? defaultSort.dir;
      const sortCol = cols[sortKey] ?? cols.id;

      const where: SQL[] = [];
      const base = baseWhere(ctx, includeDeleted);
      if (base) where.push(base);

      if (q && cfg.searchColumns?.length) {
        const needle = `%${q.replace(/[%_]/g, (m) => `\\${m}`)}%`;
        const ors = cfg.searchColumns
          .filter((c) => cols[c])
          .map((c) => like(sql`lower(${cols[c]})`, needle.toLowerCase()));
        if (ors.length) where.push(or(...ors)!);
      }

      for (const key of cfg.filterColumns ?? []) {
        const raw = rawQuery[key];
        if (typeof raw !== 'string') continue;
        const p = filterPredicate(cols[key], raw);
        if (p) where.push(p);
      }
      // Range filters: ?dueDate_gte=2026-01-01&dueDate_lt=2026-02-01
      for (const [k, v] of Object.entries(rawQuery)) {
        if (typeof v !== 'string') continue;
        const m = k.match(/^(.+)_(gte|gt|lte|lt)$/);
        if (!m) continue;
        const col = cols[m[1]!];
        if (!col || !(cfg.filterColumns ?? []).includes(m[1]!)) continue;
        const op = m[2]!;
        where.push(op === 'gte' ? sql`${col} >= ${v}` : op === 'gt' ? sql`${col} > ${v}`
          : op === 'lte' ? sql`${col} <= ${v}` : sql`${col} < ${v}`);
      }

      if (cursor) {
        const [cv, cid] = decodeCursor(cursor);
        const cmp = dir === 'asc' ? gt : lt;
        // Keyset on (sort, id) so a stable page boundary survives inserts.
        where.push(cv === null
          ? cmp(cols.id, cid)
          : or(cmp(sortCol, cv as any), and(eq(sortCol, cv as any), cmp(cols.id, cid)))!);
      }

      const whereSql = where.length ? and(...where) : undefined;
      const order = dir === 'asc' ? [asc(sortCol), asc(cols.id)] : [desc(sortCol), desc(cols.id)];
      const rows = await ctx.db.select().from(cfg.table).where(whereSql).orderBy(...order).limit(limit + 1);

      const hasMore = rows.length > limit;
      const page = hasMore ? rows.slice(0, limit) : rows;
      const last = page[page.length - 1] as any;
      let total: number | undefined;
      if (parsed.count) {
        const r = await ctx.db.select({ n: sql<number>`count(*)` }).from(cfg.table).where(whereSql);
        total = Number(r[0]?.n ?? 0);
      }
      return {
        items: await decorate(ctx, page),
        nextCursor: hasMore && last ? encodeCursor(last[sortKey], last.id) : null,
        total,
      } satisfies Page<any>;
    },

    async get(ctx, id) {
      const row = await fetchOne(ctx, id, true);
      if (!row) throw notFound(cfg.label);
      return (await decorate(ctx, [row]))[0];
    },

    async create(ctx, body) {
      requireWrite(ctx.user);
      let values = cfg.create.parse(body) as Record<string, unknown>;
      if (cfg.hooks?.beforeCreate) values = await cfg.hooks.beforeCreate(values, ctx);
      const stamped = { ...values, createdBy: ctx.user?.id ?? null, updatedBy: ctx.user?.id ?? null };
      const inserted = await ctx.db.insert(cfg.table).values(stamped as any).returning() as any[];
      const row = inserted[0] as any;
      await logActivity(ctx.db, {
        userId: ctx.user?.id, action: 'create', entityType: cfg.entityType, entityId: row.id,
        summary: cfg.summary?.(row) ?? row.name ?? row.title,
      });
      await cfg.hooks?.afterCreate?.(row, ctx);
      return (await decorate(ctx, [row]))[0];
    },

    async update(ctx, id, body) {
      requireWrite(ctx.user);
      const before = await fetchOne(ctx, id);
      if (!before) throw notFound(cfg.label);
      const raw = (body ?? {}) as Record<string, unknown>;
      // Optimistic concurrency (API-005): a stale updatedAt loses.
      if (typeof raw.updatedAt === 'string' && before.updatedAt && raw.updatedAt !== before.updatedAt) {
        throw conflict('This record changed since you loaded it. Reload and try again.');
      }
      const { updatedAt: _ignored, ...rest } = raw;
      let values = cfg.update.parse(rest) as Record<string, unknown>;
      if (cfg.hooks?.beforeUpdate) values = await cfg.hooks.beforeUpdate(values, before, ctx);
      if (Object.keys(values).length === 0) return (await decorate(ctx, [before]))[0];
      const updated = await ctx.db.update(cfg.table)
        .set({ ...values, updatedBy: ctx.user?.id ?? null } as any)
        .where(eq(cols.id, id)).returning() as any[];
      const row = updated[0] as any;
      await logActivity(ctx.db, {
        userId: ctx.user?.id, action: 'update', entityType: cfg.entityType, entityId: id,
        summary: cfg.summary?.(row) ?? row.name ?? row.title, before, after: row,
      });
      await cfg.hooks?.afterUpdate?.(row, before, ctx);
      return (await decorate(ctx, [row]))[0];
    },

    async remove(ctx, id) {
      requireWrite(ctx.user);
      const row = await fetchOne(ctx, id);
      if (!row) throw notFound(cfg.label);
      await cfg.hooks?.beforeDelete?.(row, ctx);
      if (soft) {
        await ctx.db.update(cfg.table)
          .set({ deletedAt: new Date().toISOString(), updatedBy: ctx.user?.id ?? null } as any)
          .where(eq(cols.id, id));
      } else {
        await ctx.db.delete(cfg.table).where(eq(cols.id, id));
      }
      await logActivity(ctx.db, {
        userId: ctx.user?.id, action: 'delete', entityType: cfg.entityType, entityId: id,
        summary: cfg.summary?.(row) ?? row.name ?? row.title,
      });
      return { id, deleted: true as const };
    },
  };
}

/** Mounts the five standard routes plus restore for a CRUD config. */
export function crudRoutes(app: FastifyInstance, prefix: string, cfg: CrudConfig): CrudApi {
  const api = makeCrud(cfg);
  const cols = columnsOf(cfg.table);
  const soft = cfg.softDelete !== false && 'deletedAt' in cols;

  app.get(`${prefix}`, async (req) => api.list(req.ctx, req.query as Record<string, unknown>));
  app.get(`${prefix}/:id`, async (req) => api.get(req.ctx, (req.params as { id: string }).id));
  app.post(`${prefix}`, async (req, reply) => {
    const row = await api.create(req.ctx, req.body);
    reply.status(201);
    return row;
  });
  app.patch(`${prefix}/:id`, async (req) => api.update(req.ctx, (req.params as { id: string }).id, req.body));
  app.delete(`${prefix}/:id`, async (req) => api.remove(req.ctx, (req.params as { id: string }).id));

  if (soft) {
    app.post(`${prefix}/:id/restore`, async (req) => {
      requireWrite(req.ctx.user);
      const id = (req.params as { id: string }).id;
      const updated = await req.ctx.db.update(cfg.table)
        .set({ deletedAt: null, updatedBy: req.ctx.user?.id ?? null } as any)
        .where(eq(cols.id, id)).returning() as any[];
      if (!updated[0]) throw notFound(cfg.label);
      await logActivity(req.ctx.db, {
        userId: req.ctx.user?.id, action: 'restore', entityType: cfg.entityType, entityId: id,
      });
      return updated[0];
    });
  }
  return api;
}
