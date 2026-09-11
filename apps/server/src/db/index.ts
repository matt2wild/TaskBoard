import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as schema from './schema.js';

export type DB = BetterSQLite3Database<typeof schema> & { $client: Database.Database };

const here = path.dirname(fileURLToPath(import.meta.url));

/** The migrations live beside the source in development and beside the bundle
 *  in the image, so the path is resolved rather than assumed. */
export function migrationsDir(): string {
  const fromEnv = process.env.HOMESTEAD_MIGRATIONS_DIR;
  const candidates = [
    ...(fromEnv ? [fromEnv] : []),
    path.resolve(here, 'migrations'),        // bundled: dist/migrations
    path.resolve(here, '../migrations'),     // dist/x -> dist/../migrations
    path.resolve(here, '../../migrations'),  // src/db -> apps/server/migrations
    path.resolve(process.cwd(), 'migrations'),
  ];
  for (const dir of candidates) {
    if (existsSync(path.join(dir, 'meta', '_journal.json'))) return dir;
  }
  throw new Error(`Could not find the migrations directory. Looked in:\n  ${candidates.join('\n  ')}`);
}

export function openDb(file: string): DB {
  if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true });
  const sqlite = new Database(file);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
  // Financial and stock writes must survive a power cut (NFR-004).
  sqlite.pragma('synchronous = FULL');
  return drizzle(sqlite, { schema }) as DB;
}

export function runMigrations(db: DB): void {
  migrate(db, { migrationsFolder: migrationsDir() });
}

export { schema };
export * from './schema.js';
