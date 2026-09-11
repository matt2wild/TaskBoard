import { eq } from 'drizzle-orm';
import { todayInZone } from '@homestead/shared';
import type { DB } from '../db/index.js';
import { households } from '../db/schema.js';
import type { AuthUser } from './auth.js';

export interface Household {
  id: string; name: string; timezone: string; currency: string; locale: string; unitSystem: string;
}

export interface Ctx {
  db: DB;
  user: AuthUser | null;
  household: Household;
  /** Today's calendar date in the household timezone. */
  today: string;
  now: Date;
}

let cached: Household | null = null;

export async function loadHousehold(db: DB): Promise<Household> {
  if (cached) return cached;
  const rows = await db.select().from(households).limit(1);
  const h = rows[0];
  cached = h
    ? { id: h.id, name: h.name, timezone: h.timezone, currency: h.currency, locale: h.locale, unitSystem: h.unitSystem }
    : { id: 'unset', name: 'Homestead', timezone: 'UTC', currency: 'USD', locale: 'en-US', unitSystem: 'imperial' };
  return cached;
}
export function invalidateHousehold(): void { cached = null; }

export async function makeCtx(db: DB, user: AuthUser | null, now = new Date()): Promise<Ctx> {
  const household = await loadHousehold(db);
  return { db, user, household, today: todayInZone(household.timezone, now), now };
}

export async function householdById(db: DB, id: string): Promise<Household | null> {
  const rows = await db.select().from(households).where(eq(households.id, id)).limit(1);
  const h = rows[0];
  return h ? { id: h.id, name: h.name, timezone: h.timezone, currency: h.currency, locale: h.locale, unitSystem: h.unitSystem } : null;
}
