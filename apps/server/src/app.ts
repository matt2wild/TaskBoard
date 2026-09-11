import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import type { DB } from './db/index.js';
import { installErrorHandler } from './core/errors.js';
import { makeCtx } from './core/ctx.js';
import { resolveApiToken, resolveSession, type AuthUser } from './core/auth.js';
import { authRoutes, SESSION_COOKIE } from './modules/auth.routes.js';
import { coreRoutes } from './modules/core.routes.js';
import { fileRoutes } from './modules/files.routes.js';
import { registryRoutes } from './modules/registry.routes.js';
import { taskRoutes } from './modules/tasks.routes.js';
import { maintenanceRoutes } from './modules/maintenance.routes.js';
import { projectRoutes } from './modules/projects.routes.js';
import { budgetRoutes } from './modules/budget.routes.js';
import { carbonRoutes } from './modules/carbon.routes.js';
import { foodRoutes } from './modules/food.routes.js';
import { storageRoutes } from './modules/storage.routes.js';
import { toolRoutes } from './modules/tools.routes.js';
import { petRoutes } from './modules/pets.routes.js';
import { contactRoutes } from './modules/contacts.routes.js';
import { dashboardRoutes } from './modules/dashboard.routes.js';
import { notificationRoutes } from './modules/notifications.routes.js';
import { adminRoutes } from './modules/admin.routes.js';
import { openApiRoutes } from './modules/openapi.routes.js';

/** Endpoints reachable without a session. Everything else needs one (SEC-001). */
const PUBLIC = [
  '/api/v1/auth/status', '/api/v1/auth/login', '/api/v1/auth/setup',
  '/api/v1/auth/accept-invite', '/healthz', '/readyz', '/api/v1/openapi.json',
];

export async function buildApp(db: DB): Promise<FastifyInstance> {
  const app = Fastify({
    logger: config.env === 'test'
      ? false
      : { level: process.env.LOG_LEVEL ?? 'info', redact: ['req.headers.cookie', 'req.headers.authorization'] },
    trustProxy: config.trustProxy,
    bodyLimit: 8 * 1024 * 1024,
    genReqId: () => Math.random().toString(36).slice(2, 12),
  });

  await app.register(cookie);
  await app.register(multipart, { limits: { fileSize: config.maxUploadBytes, files: 1 } });

  // Zod failures become 422 Problem Details with per-field detail (API-006).
  installErrorHandler(app);

  app.addHook('onRequest', async (req, reply) => {
    let user: AuthUser | null = null;
    const auth = req.headers.authorization;
    if (auth?.startsWith('Bearer ')) {
      user = await resolveApiToken(db, auth.slice(7).trim());
    } else {
      const token = req.cookies[SESSION_COOKIE];
      if (token) user = await resolveSession(db, token);
    }
    req.ctx = await makeCtx(db, user);

    const url = req.url.split('?')[0] ?? '';
    const stripped = config.basePath && url.startsWith(config.basePath)
      ? url.slice(config.basePath.length) || '/'
      : url;
    if (!stripped.startsWith('/api/') && !stripped.startsWith('/healthz') && !stripped.startsWith('/readyz')) return;
    if (PUBLIC.includes(stripped)) return;
    if (!user) {
      reply.status(401).type('application/problem+json').send({
        type: 'about:blank', title: 'Unauthorized', status: 401,
        detail: 'Sign in to continue', instance: req.url,
      });
    }
  });


  app.get('/healthz', async () => ({ ok: true }));
  app.get('/readyz', async () => {
    db.$client.prepare('select 1').get();
    return { ok: true };
  });

  // Registered first so its onRoute hook observes every route below it.
  openApiRoutes(app);
  authRoutes(app);
  coreRoutes(app);
  fileRoutes(app);
  registryRoutes(app);
  taskRoutes(app);
  maintenanceRoutes(app);
  projectRoutes(app);
  budgetRoutes(app);
  carbonRoutes(app);
  foodRoutes(app);
  storageRoutes(app);
  toolRoutes(app);
  petRoutes(app);
  contactRoutes(app);
  dashboardRoutes(app);
  notificationRoutes(app);
  adminRoutes(app);

  // Scanning a QR label lands here; the SPA takes it from there.
  app.get('/s/:code', async (_req, reply) => reply.redirect('/#/scan'));

  const webDir = path.resolve(config.webDir);
  if (existsSync(path.join(webDir, 'index.html'))) {
    await app.register(fastifyStatic, { root: webDir, prefix: `${config.basePath}/`, index: false });
    // Static serving would answer "/" with a 403 rather than falling through,
    // so the SPA entry point gets its own route.
    app.get(`${config.basePath}/`, async (_req, reply) => reply.type('text/html').sendFile('index.html'));
    app.setNotFoundHandler(async (req, reply) => {
      if (req.url.startsWith(`${config.basePath}/api/`)) {
        return reply.status(404).type('application/problem+json')
          .send({ type: 'about:blank', title: 'Not Found', status: 404, instance: req.url });
      }
      return reply.type('text/html').sendFile('index.html');
    });
  }

  return app;
}
