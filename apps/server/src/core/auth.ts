import { hash as argonHash, verify as argonVerify, Algorithm } from '@node-rs/argon2';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { ROLE_RANK, type Role } from '@homestead/shared';
import type { DB } from '../db/index.js';
import { apiTokens, sessions, users } from '../db/schema.js';
import { forbidden, unauthorized } from './errors.js';

export async function hashPassword(plain: string): Promise<string> {
  return argonHash(plain, { algorithm: Algorithm.Argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
}
export async function verifyPassword(stored: string, plain: string): Promise<boolean> {
  try { return await argonVerify(stored, plain); } catch { return false; }
}

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
export const newToken = () => randomBytes(32).toString('base64url');

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a); const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export interface AuthUser {
  id: string; role: Role; displayName: string; username: string; email: string;
  /** api tokens may be read-only even for an admin */
  scope: 'read' | 'write';
}

export async function createSession(
  db: DB, userId: string, days: number, meta: { ip?: string; userAgent?: string } = {},
): Promise<{ token: string; expiresAt: string }> {
  const token = newToken();
  const expiresAt = new Date(Date.now() + days * 86400_000).toISOString();
  await db.insert(sessions).values({
    userId, tokenHash: sha256(token), expiresAt, ip: meta.ip, userAgent: meta.userAgent,
  });
  return { token, expiresAt };
}

export async function resolveSession(db: DB, token: string): Promise<AuthUser | null> {
  const rows = await db.select({ u: users, s: sessions })
    .from(sessions).innerJoin(users, eq(users.id, sessions.userId))
    .where(and(
      eq(sessions.tokenHash, sha256(token)),
      gt(sessions.expiresAt, new Date().toISOString()),
      eq(users.isActive, true),
      isNull(users.deletedAt),
    )).limit(1);
  const row = rows[0];
  if (!row) return null;
  await db.update(sessions).set({ lastSeenAt: new Date().toISOString() }).where(eq(sessions.id, row.s.id));
  return {
    id: row.u.id, role: row.u.role as Role, displayName: row.u.displayName,
    username: row.u.username, email: row.u.email, scope: 'write',
  };
}

export async function resolveApiToken(db: DB, token: string): Promise<AuthUser | null> {
  const rows = await db.select({ u: users, t: apiTokens })
    .from(apiTokens).innerJoin(users, eq(users.id, apiTokens.userId))
    .where(and(eq(apiTokens.tokenHash, sha256(token)), isNull(apiTokens.deletedAt), eq(users.isActive, true)))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  if (row.t.expiresAt && row.t.expiresAt < new Date().toISOString()) return null;
  await db.update(apiTokens).set({ lastUsedAt: new Date().toISOString() }).where(eq(apiTokens.id, row.t.id));
  return {
    id: row.u.id, role: row.u.role as Role, displayName: row.u.displayName,
    username: row.u.username, email: row.u.email,
    scope: row.t.scope === 'write' ? 'write' : 'read',
  };
}

export function requireRole(user: AuthUser | null, min: Role): AuthUser {
  if (!user) throw unauthorized();
  if (ROLE_RANK[user.role] < ROLE_RANK[min]) throw forbidden(`Requires the ${min} role`);
  return user;
}

/** Any mutation needs a write scope and at least member; limited users write
 *  only through the narrow endpoints that check their own sharing rules. */
export function requireWrite(user: AuthUser | null): AuthUser {
  if (!user) throw unauthorized();
  if (user.scope !== 'write') throw forbidden('This token is read-only');
  if (user.role === 'readonly') throw forbidden('Your account is read-only');
  return user;
}

export function requireAdmin(user: AuthUser | null): AuthUser {
  return requireRole(requireWrite(user), 'admin');
}
