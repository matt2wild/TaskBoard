/* eslint-disable @typescript-eslint/no-explicit-any */
import type { FastifyInstance } from 'fastify';
import { mkdir, readFile, stat, readdir } from 'node:fs/promises';
import path from 'node:path';
import { desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { config } from '../config.js';
import * as schema from '../db/schema.js';
import { files, jobRuns, notificationDeliveries, sessions, households } from '../db/schema.js';
import { requireAdmin } from '../core/auth.js';
import { invalidateHousehold } from '../core/ctx.js';
import { ZipWriter, toCsv, toJsonl } from '../services/archive.js';
import { tick, purgeTrash } from '../scheduler/index.js';
import { badRequest } from '../core/errors.js';

const TABLES: Array<[string, any]> = Object.entries(schema)
  .filter(([, v]) => v && typeof v === 'object' && Symbol.for('drizzle:Name') in (v as object))
  .map(([k, v]) => [k, v]);

async function dirSize(dir: string): Promise<number> {
  let total = 0;
  try {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) total += await dirSize(full);
      else total += (await stat(full)).size;
    }
  } catch { /* the directory may not exist yet */ }
  return total;
}

export function adminRoutes(app: FastifyInstance): void {
  /** The admin console (OPS-030). */
  app.get('/api/v1/admin/status', async (req) => {
    requireAdmin(req.ctx.user);
    const dbFile = config.dbPath;
    let dbSize = 0;
    try { dbSize = (await stat(dbFile)).size; } catch { /* in-memory */ }
    const [runs, failures, activeSessions, fileStats] = await Promise.all([
      req.ctx.db.select().from(jobRuns).orderBy(desc(jobRuns.startedAt)).limit(10),
      req.ctx.db.select({ n: sql<number>`count(*)` }).from(notificationDeliveries)
        .where(eq(notificationDeliveries.status, 'failed')),
      req.ctx.db.select({ n: sql<number>`count(*)` }).from(sessions),
      req.ctx.db.select({
        n: sql<number>`count(*)`, bytes: sql<number>`coalesce(sum(${files.size}), 0)`,
      }).from(files),
    ]);
    const counts: Record<string, number> = {};
    for (const [name, table] of TABLES) {
      try {
        const r = await req.ctx.db.select({ n: sql<number>`count(*)` }).from(table);
        counts[name] = Number(r[0]?.n ?? 0);
      } catch { /* skip views or tables without a simple count */ }
    }
    return {
      version: '0.1.0',
      today: req.ctx.today,
      timezone: req.ctx.household.timezone,
      database: { path: dbFile, bytes: dbSize },
      fileStorage: {
        path: config.filesDir,
        count: Number(fileStats[0]?.n ?? 0),
        bytes: Number(fileStats[0]?.bytes ?? 0),
        onDisk: await dirSize(config.filesDir),
      },
      scheduler: {
        enabled: config.scheduler.enabled,
        lastRuns: runs,
        lastSuccessful: runs.find((r) => r.status === 'ok')?.ranForDate ?? null,
      },
      notifications: { failedDeliveries: Number(failures[0]?.n ?? 0) },
      sessions: Number(activeSessions[0]?.n ?? 0),
      rowCounts: counts,
      demoMode: config.demo,
      externalLookups: config.externalLookups,
    };
  });

  app.patch('/api/v1/admin/household', async (req) => {
    requireAdmin(req.ctx.user);
    const body = z.object({
      name: z.string().trim().min(1).optional(),
      timezone: z.string().trim().min(1).optional(),
      currency: z.string().length(3).optional(),
      locale: z.string().optional(),
      unitSystem: z.enum(['metric', 'imperial']).optional(),
    }).parse(req.body);
    if (body.timezone) {
      try { new Intl.DateTimeFormat('en', { timeZone: body.timezone }); }
      catch { throw badRequest(`Unknown timezone: ${body.timezone}`); }
    }
    const [row] = await req.ctx.db.update(households)
      .set({ ...body, currency: body.currency?.toUpperCase(), updatedBy: req.ctx.user!.id })
      .where(eq(households.id, req.ctx.household.id)).returning();
    invalidateHousehold();
    return row;
  });

  /** Complete export: every table as CSV and JSONL, plus the files (OPS-020). */
  app.get('/api/v1/admin/export', async (req, reply) => {
    const q = z.object({ includeFiles: z.coerce.boolean().default(true) }).parse(req.query);
    const zip = new ZipWriter();
    const manifest: Record<string, number> = {};

    for (const [name, table] of TABLES) {
      let rows: Array<Record<string, unknown>>;
      try { rows = await req.ctx.db.select().from(table); } catch { continue; }
      manifest[name] = rows.length;
      if (!rows.length) continue;
      zip.add(`data/csv/${name}.csv`, toCsv(rows));
      zip.add(`data/jsonl/${name}.jsonl`, toJsonl(rows));
    }

    if (q.includeFiles) {
      const fileRows = await req.ctx.db.select().from(files);
      for (const f of fileRows) {
        try {
          const buf = await readFile(path.join(config.filesDir, f.storageKey));
          zip.add(`files/${f.storageKey}`, buf, { compress: false });
        } catch { /* a missing blob should not fail the whole export */ }
      }
    }

    zip.add('schema.json', JSON.stringify({
      application: 'homestead',
      version: '0.1.0',
      exportedAt: new Date().toISOString(),
      household: req.ctx.household,
      tables: manifest,
      notes: 'CSV and JSONL hold identical data. Money is integer minor units. Dates are ISO 8601.',
    }, null, 2));

    const buf = zip.finish();
    reply
      .type('application/zip')
      .header('content-disposition', `attachment; filename="homestead-export-${req.ctx.today}.zip"`);
    return reply.send(buf);
  });

  /** Backup: a consistent database snapshot taken through SQLite (OPS-010). */
  app.post('/api/v1/admin/backup', async (req) => {
    requireAdmin(req.ctx.user);
    await mkdir(config.backupDir, { recursive: true });
    const name = `homestead-${new Date().toISOString().replace(/[:.]/g, '-')}.db`;
    const target = path.join(config.backupDir, name);
    await req.ctx.db.$client.backup(target);
    const size = (await stat(target)).size;
    return { file: name, path: target, bytes: size, takenAt: new Date().toISOString() };
  });

  app.get('/api/v1/admin/backups', async (req) => {
    requireAdmin(req.ctx.user);
    try {
      const entries = await readdir(config.backupDir);
      const items = [];
      for (const name of entries.filter((e) => e.endsWith('.db'))) {
        const s = await stat(path.join(config.backupDir, name));
        items.push({ name, bytes: s.size, takenAt: s.mtime.toISOString() });
      }
      return { items: items.sort((a, b) => b.takenAt.localeCompare(a.takenAt)), dir: config.backupDir };
    } catch {
      return { items: [], dir: config.backupDir };
    }
  });

  app.post('/api/v1/admin/scheduler/run', async (req) => {
    requireAdmin(req.ctx.user);
    const body = z.object({ force: z.boolean().default(false) }).parse(req.body ?? {});
    if (body.force) {
      await req.ctx.db.delete(jobRuns).where(eq(jobRuns.ranForDate, req.ctx.today));
    }
    return tick(req.ctx.db);
  });

  app.post('/api/v1/admin/purge-trash', async (req) => {
    requireAdmin(req.ctx.user);
    const body = z.object({ days: z.number().int().min(1).max(3650).default(30) }).parse(req.body ?? {});
    return { purged: await purgeTrash(req.ctx.db, body.days) };
  });

  app.post('/api/v1/admin/vacuum', async (req) => {
    requireAdmin(req.ctx.user);
    req.ctx.db.$client.exec('VACUUM');
    req.ctx.db.$client.exec('ANALYZE');
    return { ok: true };
  });
}
