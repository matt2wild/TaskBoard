import type { FastifyInstance } from 'fastify';
import { openDb, runMigrations, type DB } from '../src/db/index.js';
import { buildApp } from '../src/app.js';
import { seedDefaults } from '../src/seed/defaults.js';
import { hashPassword } from '../src/core/auth.js';
import { households, users } from '../src/db/schema.js';
import { invalidateHousehold } from '../src/core/ctx.js';
import { registerMaintenanceHooks } from '../src/services/maintenance.js';
import { registerPetHooks } from '../src/services/pets.js';

process.env.NODE_ENV = 'test';

export interface Harness {
  app: FastifyInstance;
  db: DB;
  cookie: string;
  userId: string;
  api: <T = any>(method: string, url: string, body?: unknown, opts?: { raw?: boolean }) => Promise<T>;
  status: (method: string, url: string, body?: unknown) => Promise<number>;
  close: () => Promise<void>;
}

let hooksReady = false;

export async function makeHarness(opts: { timezone?: string } = {}): Promise<Harness> {
  if (!hooksReady) {
    registerMaintenanceHooks();
    registerPetHooks();
    hooksReady = true;
  }
  const db = openDb(':memory:');
  runMigrations(db);
  await db.insert(households).values({
    name: 'Test House', timezone: opts.timezone ?? 'UTC', currency: 'USD', unitSystem: 'imperial',
  });
  invalidateHousehold();
  const [user] = await db.insert(users).values({
    displayName: 'Tester', username: 'tester', email: 'tester@example.com',
    passwordHash: await hashPassword('password123'), role: 'admin',
  }).returning();
  await seedDefaults(db);

  const app = await buildApp(db);
  await app.ready();

  const login = await app.inject({
    method: 'POST', url: '/api/v1/auth/login',
    payload: { username: 'tester', password: 'password123' },
  });
  const setCookie = login.headers['set-cookie'];
  const cookie = (Array.isArray(setCookie) ? setCookie[0]! : String(setCookie)).split(';')[0]!;

  const api = async <T = any>(method: string, url: string, body?: unknown, o: { raw?: boolean } = {}): Promise<T> => {
    const res = await app.inject({
      method: method as any, url, headers: { cookie }, payload: body as any,
    });
    if (res.statusCode >= 400 && !o.raw) {
      throw new Error(`${method} ${url} -> ${res.statusCode}: ${res.body.slice(0, 400)}`);
    }
    if (o.raw) return res as unknown as T;
    return res.body ? JSON.parse(res.body) : (undefined as T);
  };

  const status = async (method: string, url: string, body?: unknown): Promise<number> => {
    const res = await app.inject({ method: method as any, url, headers: { cookie }, payload: body as any });
    return res.statusCode;
  };

  return {
    app, db, cookie, userId: user!.id, api, status,
    close: async () => { await app.close(); db.$client.close(); },
  };
}

/** A property with a couple of rooms, which nearly every test needs. */
export async function makeHome(h: Harness): Promise<{
  propertyId: string; roomId: string; pantryId: string; garageId: string;
}> {
  const property = await h.api('POST', '/api/v1/properties', { name: 'Home', isPrimary: true });
  const room = await h.api('POST', '/api/v1/locations', {
    propertyId: property.id, name: 'Utility room', type: 'room',
  });
  const pantry = await h.api('POST', '/api/v1/locations', {
    propertyId: property.id, name: 'Pantry', type: 'zone', holdsFood: true, temperatureClass: 'ambient',
  });
  const garage = await h.api('POST', '/api/v1/locations', {
    propertyId: property.id, name: 'Garage', type: 'room',
  });
  return { propertyId: property.id, roomId: room.id, pantryId: pantry.id, garageId: garage.id };
}

export const today = (): string => new Date().toISOString().slice(0, 10);
export function shift(days: number, from = today()): string {
  const d = new Date(from + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
