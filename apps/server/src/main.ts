import { mkdirSync } from 'node:fs';
import { config } from './config.js';
import { openDb, runMigrations } from './db/index.js';
import { buildApp } from './app.js';
import { startScheduler } from './scheduler/index.js';
import { registerMaintenanceHooks } from './services/maintenance.js';
import { registerPetHooks } from './services/pets.js';
import { seedDefaults } from './seed/defaults.js';

async function main(): Promise<void> {
  mkdirSync(config.dataDir, { recursive: true });
  mkdirSync(config.filesDir, { recursive: true });

  const db = openDb(config.dbPath);
  runMigrations(db);
  await seedDefaults(db);

  registerMaintenanceHooks();
  registerPetHooks();

  const app = await buildApp(db);

  if (config.scheduler.enabled) {
    const handle = startScheduler(db, { tickSeconds: config.scheduler.tickSeconds, logger: app.log });
    app.addHook('onClose', async () => handle.stop());
  }

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'shutting down');
    await app.close();
    db.$client.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await app.listen({ host: config.host, port: config.port });
  app.log.info({ port: config.port, dataDir: config.dataDir }, 'homestead ready');
}

main().catch((err) => {
  console.error('failed to start:', err);
  process.exit(1);
});
