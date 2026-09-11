import type { FastifyInstance } from 'fastify';
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { ROLES } from '@homestead/shared';
import { config } from '../config.js';
import type { DB } from '../db/index.js';
import { apiTokens, households, invites, sessions, users } from '../db/schema.js';
import {
  createSession, hashPassword, newToken, requireAdmin, requireWrite, sha256, verifyPassword,
} from '../core/auth.js';
import { invalidateHousehold } from '../core/ctx.js';
import { ApiError, badRequest, forbidden, notFound, unauthorized } from '../core/errors.js';
import { logActivity } from '../core/activity.js';

const COOKIE = 'homestead_session';

const loginBody = z.object({
  username: z.string().trim().min(1),
  password: z.string().min(1),
  remember: z.boolean().optional(),
});

const setupBody = z.object({
  household: z.object({
    name: z.string().trim().min(1),
    timezone: z.string().trim().min(1).default('UTC'),
    currency: z.string().trim().length(3).default('USD'),
    unitSystem: z.enum(['metric', 'imperial']).default('imperial'),
    locale: z.string().default('en-US'),
  }),
  admin: z.object({
    displayName: z.string().trim().min(1),
    username: z.string().trim().min(2).regex(/^[a-zA-Z0-9._-]+$/, 'letters, numbers, dot, dash or underscore'),
    email: z.string().email(),
    password: z.string().min(8, 'at least 8 characters'),
  }),
});

/** Simple in-memory backoff (AUTH-012). One household, one process. */
const attempts = new Map<string, { count: number; until: number }>();
function noteFailure(key: string): void {
  const rec = attempts.get(key) ?? { count: 0, until: 0 };
  rec.count += 1;
  if (rec.count >= 5) rec.until = Date.now() + Math.min(2 ** (rec.count - 5), 60) * 1000;
  attempts.set(key, rec);
}
function clearFailures(key: string): void { attempts.delete(key); }

export async function isSetupComplete(db: DB): Promise<boolean> {
  const h = await db.select({ id: households.id }).from(households).limit(1);
  const u = await db.select({ id: users.id }).from(users).limit(1);
  return h.length > 0 && u.length > 0;
}

export function authRoutes(app: FastifyInstance): void {
  app.get('/api/v1/auth/status', async (req) => {
    const setup = await isSetupComplete(req.ctx.db);
    return {
      setupComplete: setup,
      user: req.ctx.user,
      household: setup ? req.ctx.household : null,
    };
  });

  app.post('/api/v1/auth/setup', async (req, reply) => {
    if (await isSetupComplete(req.ctx.db)) throw forbidden('Setup has already been completed');
    const body = setupBody.parse(req.body);
    const [household] = await req.ctx.db.insert(households).values({
      name: body.household.name, timezone: body.household.timezone,
      currency: body.household.currency.toUpperCase(), unitSystem: body.household.unitSystem,
      locale: body.household.locale,
    }).returning();
    const [admin] = await req.ctx.db.insert(users).values({
      displayName: body.admin.displayName,
      username: body.admin.username.toLowerCase(),
      email: body.admin.email.toLowerCase(),
      passwordHash: await hashPassword(body.admin.password),
      role: 'admin',
    }).returning();
    invalidateHousehold();
    const { token } = await createSession(req.ctx.db, admin!.id, config.sessionDays, {
      ip: req.ip, userAgent: req.headers['user-agent'],
    });
    setCookie(reply, token, config.sessionDays);
    await logActivity(req.ctx.db, { userId: admin!.id, action: 'create', entityType: 'user', entityId: admin!.id, summary: 'Household created' });
    reply.status(201);
    return { household, user: { id: admin!.id, displayName: admin!.displayName, role: admin!.role } };
  });

  app.post('/api/v1/auth/login', async (req, reply) => {
    const body = loginBody.parse(req.body);
    const key = `${req.ip}:${body.username.toLowerCase()}`;
    const rec = attempts.get(key);
    if (rec && rec.until > Date.now()) {
      throw new ApiError(429, 'Too Many Requests', 'Too many failed attempts. Wait a moment and try again.');
    }
    const ident = body.username.trim().toLowerCase();
    const rows = await req.ctx.db.select().from(users)
      .where(and(isNull(users.deletedAt), eq(users.isActive, true))).limit(200);
    const user = rows.find((u) => u.username === ident || u.email === ident);
    if (!user?.passwordHash || !(await verifyPassword(user.passwordHash, body.password))) {
      noteFailure(key);
      throw unauthorized('Wrong username or password');
    }
    clearFailures(key);
    const days = body.remember ? config.sessionDays : 1;
    const { token } = await createSession(req.ctx.db, user.id, days, { ip: req.ip, userAgent: req.headers['user-agent'] });
    await req.ctx.db.update(users).set({ lastLoginAt: new Date().toISOString() }).where(eq(users.id, user.id));
    setCookie(reply, token, days);
    return { id: user.id, displayName: user.displayName, username: user.username, role: user.role, scope: 'write' };
  });

  app.post('/api/v1/auth/logout', async (req, reply) => {
    const token = req.cookies[COOKIE];
    if (token) await req.ctx.db.delete(sessions).where(eq(sessions.tokenHash, sha256(token)));
    reply.clearCookie(COOKIE, { path: config.basePath || '/' });
    return { ok: true };
  });

  app.get('/api/v1/auth/sessions', async (req) => {
    requireWrite(req.ctx.user);
    const rows = await req.ctx.db.select({
      id: sessions.id, createdAt: sessions.createdAt, lastSeenAt: sessions.lastSeenAt,
      expiresAt: sessions.expiresAt, ip: sessions.ip, userAgent: sessions.userAgent,
    }).from(sessions).where(eq(sessions.userId, req.ctx.user!.id));
    return { items: rows };
  });

  app.delete('/api/v1/auth/sessions/:id', async (req) => {
    requireWrite(req.ctx.user);
    const id = (req.params as { id: string }).id;
    await req.ctx.db.delete(sessions)
      .where(and(eq(sessions.id, id), eq(sessions.userId, req.ctx.user!.id)));
    return { ok: true };
  });

  app.post('/api/v1/auth/password', async (req) => {
    requireWrite(req.ctx.user);
    const body = z.object({ current: z.string(), next: z.string().min(8) }).parse(req.body);
    const rows = await req.ctx.db.select().from(users).where(eq(users.id, req.ctx.user!.id)).limit(1);
    const me = rows[0];
    if (!me?.passwordHash || !(await verifyPassword(me.passwordHash, body.current))) {
      throw badRequest('Current password is wrong');
    }
    await req.ctx.db.update(users)
      .set({ passwordHash: await hashPassword(body.next) }).where(eq(users.id, me.id));
    return { ok: true };
  });

  /* members and invites */

  app.get('/api/v1/members', async (req) => {
    const rows = await req.ctx.db.select({
      id: users.id, displayName: users.displayName, username: users.username, email: users.email,
      role: users.role, isActive: users.isActive, lastLoginAt: users.lastLoginAt,
    }).from(users).where(isNull(users.deletedAt));
    return { items: rows };
  });

  app.post('/api/v1/members/invites', async (req, reply) => {
    requireAdmin(req.ctx.user);
    const body = z.object({
      role: z.enum(ROLES).default('member'),
      email: z.string().email().optional(),
      days: z.number().int().min(1).max(30).default(7),
    }).parse(req.body ?? {});
    const token = newToken();
    const [invite] = await req.ctx.db.insert(invites).values({
      tokenHash: sha256(token), role: body.role, email: body.email,
      expiresAt: new Date(Date.now() + body.days * 86400_000).toISOString(),
      createdBy: req.ctx.user!.id,
    }).returning();
    reply.status(201);
    return { id: invite!.id, role: invite!.role, expiresAt: invite!.expiresAt, token, url: `/invite/${token}` };
  });

  app.get('/api/v1/members/invites', async (req) => {
    requireAdmin(req.ctx.user);
    const rows = await req.ctx.db.select({
      id: invites.id, role: invites.role, email: invites.email, expiresAt: invites.expiresAt,
      usedAt: invites.usedAt, createdAt: invites.createdAt,
    }).from(invites).where(isNull(invites.deletedAt));
    return { items: rows };
  });

  app.post('/api/v1/auth/accept-invite', async (req, reply) => {
    const body = z.object({
      token: z.string().min(10),
      displayName: z.string().trim().min(1),
      username: z.string().trim().min(2).regex(/^[a-zA-Z0-9._-]+$/),
      email: z.string().email(),
      password: z.string().min(8),
    }).parse(req.body);
    const rows = await req.ctx.db.select().from(invites)
      .where(and(eq(invites.tokenHash, sha256(body.token)), isNull(invites.usedAt), isNull(invites.deletedAt)))
      .limit(1);
    const invite = rows[0];
    if (!invite || invite.expiresAt < new Date().toISOString()) throw badRequest('That invite is not valid');
    const [user] = await req.ctx.db.insert(users).values({
      displayName: body.displayName, username: body.username.toLowerCase(),
      email: body.email.toLowerCase(), passwordHash: await hashPassword(body.password), role: invite.role,
    }).returning();
    await req.ctx.db.update(invites)
      .set({ usedAt: new Date().toISOString(), usedByUserId: user!.id }).where(eq(invites.id, invite.id));
    const { token } = await createSession(req.ctx.db, user!.id, config.sessionDays);
    setCookie(reply, token, config.sessionDays);
    reply.status(201);
    return { id: user!.id, displayName: user!.displayName, role: user!.role };
  });

  app.patch('/api/v1/members/:id', async (req) => {
    requireAdmin(req.ctx.user);
    const id = (req.params as { id: string }).id;
    const body = z.object({
      role: z.enum(ROLES).optional(),
      isActive: z.boolean().optional(),
      displayName: z.string().trim().min(1).optional(),
    }).parse(req.body);
    if (id === req.ctx.user!.id && (body.role && body.role !== 'admin' || body.isActive === false)) {
      throw badRequest('You cannot remove your own admin access');
    }
    const admins = await req.ctx.db.select({ id: users.id }).from(users)
      .where(and(eq(users.role, 'admin'), eq(users.isActive, true), isNull(users.deletedAt)));
    if (admins.length <= 1 && admins[0]?.id === id && (body.role && body.role !== 'admin' || body.isActive === false)) {
      throw badRequest('The household needs at least one admin');
    }
    const [row] = await req.ctx.db.update(users).set(body).where(eq(users.id, id)).returning();
    if (!row) throw notFound('Member');
    return { id: row.id, displayName: row.displayName, role: row.role, isActive: row.isActive };
  });

  /* api tokens */

  app.get('/api/v1/auth/tokens', async (req) => {
    requireWrite(req.ctx.user);
    const rows = await req.ctx.db.select({
      id: apiTokens.id, name: apiTokens.name, scope: apiTokens.scope,
      lastUsedAt: apiTokens.lastUsedAt, createdAt: apiTokens.createdAt, expiresAt: apiTokens.expiresAt,
    }).from(apiTokens).where(and(eq(apiTokens.userId, req.ctx.user!.id), isNull(apiTokens.deletedAt)));
    return { items: rows };
  });

  app.post('/api/v1/auth/tokens', async (req, reply) => {
    requireWrite(req.ctx.user);
    const body = z.object({
      name: z.string().trim().min(1), scope: z.enum(['read', 'write']).default('read'),
    }).parse(req.body);
    const token = newToken();
    const [row] = await req.ctx.db.insert(apiTokens).values({
      userId: req.ctx.user!.id, name: body.name, scope: body.scope,
      tokenHash: sha256(token), createdBy: req.ctx.user!.id,
    }).returning();
    reply.status(201);
    return { id: row!.id, name: row!.name, scope: row!.scope, token };
  });

  app.delete('/api/v1/auth/tokens/:id', async (req) => {
    requireWrite(req.ctx.user);
    const id = (req.params as { id: string }).id;
    await req.ctx.db.update(apiTokens).set({ deletedAt: new Date().toISOString() })
      .where(and(eq(apiTokens.id, id), eq(apiTokens.userId, req.ctx.user!.id)));
    return { ok: true };
  });
}

function setCookie(reply: { setCookie: (n: string, v: string, o: Record<string, unknown>) => void }, token: string, days: number): void {
  reply.setCookie(COOKIE, token, {
    httpOnly: true, sameSite: 'lax', secure: config.env === 'production',
    path: config.basePath || '/', maxAge: days * 86400,
  });
}

export const SESSION_COOKIE = COOKIE;
