/* eslint-disable no-console */
import { copyFile, mkdir, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { openDb, runMigrations } from './db/index.js';
import { seedDefaults } from './seed/defaults.js';
import { seedDemo } from './seed/demo.js';
import { hashPassword } from './core/auth.js';
import { users } from './db/schema.js';
import { eq } from 'drizzle-orm';
import { tick, purgeTrash } from './scheduler/index.js';
import { makeCtx } from './core/ctx.js';

const [, , command, ...args] = process.argv;

function arg(name: string, fallback?: string): string | undefined {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

async function open() {
  await mkdir(config.dataDir, { recursive: true });
  const db = openDb(config.dbPath);
  runMigrations(db);
  return db;
}

const COMMANDS: Record<string, () => Promise<void>> = {
  async migrate() {
    await open();
    console.log(`Migrations applied to ${config.dbPath}`);
  },

  async seed() {
    const db = await open();
    const res = await seedDefaults(db);
    console.log(res.seeded.length ? `Seeded: ${res.seeded.join(', ')}` : 'Nothing to seed; defaults already present.');
  },

  async 'seed-demo'() {
    const db = await open();
    const existing = await db.select().from(users).limit(1);
    if (existing.length && !args.includes('--force')) {
      console.error('This database already has users. Re-run with --force to seed anyway.');
      process.exit(1);
    }
    const res = await seedDemo(db, { password: arg('password') });
    console.log('Demo household created.\n');
    console.log('Sign in with:');
    for (const u of res.users) console.log(`  ${u.username} / ${u.password}`);
    console.log('\nRows created:');
    for (const [k, v] of Object.entries(res.counts)) console.log(`  ${k.padEnd(18)} ${v}`);
  },

  async 'create-user'() {
    const db = await open();
    const username = arg('username');
    const password = arg('password');
    const email = arg('email');
    const role = arg('role', 'member')!;
    if (!username || !password || !email) {
      console.error('Usage: homestead create-user --username=x --password=y --email=z [--role=admin]');
      process.exit(1);
    }
    const [row] = await db.insert(users).values({
      username: username.toLowerCase(), email: email.toLowerCase(),
      displayName: arg('name', username)!, passwordHash: await hashPassword(password), role,
    }).returning();
    console.log(`Created ${row!.username} (${row!.role})`);
  },

  async 'reset-password'() {
    const db = await open();
    const username = arg('username');
    const password = arg('password');
    if (!username || !password) {
      console.error('Usage: homestead reset-password --username=x --password=y');
      process.exit(1);
    }
    const res = await db.update(users).set({ passwordHash: await hashPassword(password) })
      .where(eq(users.username, username.toLowerCase())).returning();
    if (!res.length) { console.error(`No such user: ${username}`); process.exit(1); }
    console.log(`Password reset for ${username}`);
  },

  async promote() {
    const db = await open();
    const username = arg('username');
    if (!username) { console.error('Usage: homestead promote --username=x'); process.exit(1); }
    const res = await db.update(users).set({ role: 'admin' })
      .where(eq(users.username, username.toLowerCase())).returning();
    if (!res.length) { console.error(`No such user: ${username}`); process.exit(1); }
    console.log(`${username} is now an admin`);
  },

  async backup() {
    const db = await open();
    await mkdir(config.backupDir, { recursive: true });
    const name = `homestead-${new Date().toISOString().replace(/[:.]/g, '-')}.db`;
    const target = arg('out') ?? path.join(config.backupDir, name);
    await db.$client.backup(target);
    const size = (await stat(target)).size;
    console.log(`Backup written: ${target} (${(size / 1024 / 1024).toFixed(1)} MB)`);
  },

  async restore() {
    const source = arg('from') ?? args.find((a) => !a.startsWith('--'));
    if (!source) { console.error('Usage: homestead restore --from=<backup.db>'); process.exit(1); }
    if (!existsSync(source)) { console.error(`No such file: ${source}`); process.exit(1); }
    if (existsSync(config.dbPath) && !args.includes('--force')) {
      console.error(`${config.dbPath} already exists. Move it aside, or re-run with --force.`);
      process.exit(1);
    }
    await mkdir(path.dirname(config.dbPath), { recursive: true });
    await copyFile(source, config.dbPath);
    const db = openDb(config.dbPath);
    runMigrations(db);
    console.log(`Restored ${source} to ${config.dbPath}`);
  },

  async 'list-backups'() {
    try {
      const entries = (await readdir(config.backupDir)).filter((e) => e.endsWith('.db'));
      if (!entries.length) { console.log('No backups found.'); return; }
      for (const e of entries.sort().reverse()) {
        const s = await stat(path.join(config.backupDir, e));
        console.log(`${e}  ${(s.size / 1024 / 1024).toFixed(1)} MB  ${s.mtime.toISOString()}`);
      }
    } catch {
      console.log(`No backup directory at ${config.backupDir}`);
    }
  },

  async 'run-scheduler'() {
    const db = await open();
    const res = await tick(db);
    console.log(res.ran ? `Daily pass complete: ${JSON.stringify(res.stats, null, 2)}` : 'Already ran today.');
  },

  async 'purge-trash'() {
    const db = await open();
    const days = Number(arg('days', '30'));
    console.log(`Purged ${await purgeTrash(db, days)} rows deleted more than ${days} days ago.`);
  },

  async status() {
    const db = await open();
    const ctx = await makeCtx(db, null);
    const size = existsSync(config.dbPath) ? (await stat(config.dbPath)).size : 0;
    console.log(`Household: ${ctx.household.name}`);
    console.log(`Timezone:  ${ctx.household.timezone} (today is ${ctx.today})`);
    console.log(`Currency:  ${ctx.household.currency}`);
    console.log(`Database:  ${config.dbPath} (${(size / 1024 / 1024).toFixed(1)} MB)`);
    console.log(`Files:     ${config.filesDir}`);
  },
};

async function main(): Promise<void> {
  if (!command || command === 'help' || command === '--help') {
    console.log('homestead <command>\n');
    console.log('  migrate              Apply database migrations');
    console.log('  seed                 Insert the default categories and template library');
    console.log('  seed-demo            Create a demo household with realistic data');
    console.log('  create-user          --username --password --email [--role]');
    console.log('  reset-password       --username --password');
    console.log('  promote              --username');
    console.log('  backup               [--out=<path>]');
    console.log('  restore              --from=<path> [--force]');
    console.log('  list-backups');
    console.log('  run-scheduler        Run the daily reminder pass now');
    console.log('  purge-trash          [--days=30]');
    console.log('  status');
    return;
  }
  const fn = COMMANDS[command];
  if (!fn) { console.error(`Unknown command: ${command}`); process.exit(1); }
  await fn();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
