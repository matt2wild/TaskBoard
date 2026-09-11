import { describe, it, expect, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeHarness, makeHome, shift, today, type Harness } from './helpers.js';
import { tick, runDailyPass } from '../src/scheduler/index.js';
import { makeCtx } from '../src/core/ctx.js';
import { jobRuns, notifications } from '../src/db/schema.js';

let h: Harness;
afterEach(async () => { await h?.close(); });

/**
 * A reminder that fires twice, or not at all, is a critical bug (principle 7).
 * These tests hold that line.
 */
describe('the reminder pass', () => {
  it('sends one reminder per task per day, however many times it runs', async () => {
    h = await makeHarness();
    await h.api('POST', '/api/v1/tasks', { title: 'Take the bins out', dueDate: today() });

    await tick(h.db);
    const first = await h.api('GET', '/api/v1/notifications');
    const dueNotices = first.items.filter((n: any) => n.eventType === 'task.due');
    expect(dueNotices).toHaveLength(1);

    // A second tick the same day is a no-op.
    const again = await tick(h.db);
    expect(again.ran).toBe(false);

    // Even forcing the pass to run again does not duplicate the notification.
    const ctx = await makeCtx(h.db, null);
    await runDailyPass(ctx);
    const second = await h.api('GET', '/api/v1/notifications');
    expect(second.items.filter((n: any) => n.eventType === 'task.due')).toHaveLength(1);
  });

  it('catches up after the container was down, without a flood', async () => {
    h = await makeHarness();
    await h.api('POST', '/api/v1/tasks', { title: 'Overdue chore', dueDate: shift(-3) });

    // Pretend yesterday's pass ran and today's has not.
    await h.db.insert(jobRuns).values({
      jobKey: 'daily', ranForDate: shift(-1), status: 'ok', finishedAt: new Date().toISOString(),
    });

    const res = await tick(h.db);
    expect(res.ran).toBe(true);

    const notes = await h.api('GET', '/api/v1/notifications');
    const overdue = notes.items.filter((n: any) => n.eventType === 'task.overdue');
    expect(overdue).toHaveLength(1);
    expect(overdue[0].title).toContain('Overdue chore');
  });

  it('records the run so an admin can see it happened', async () => {
    h = await makeHarness();
    await tick(h.db);
    const runs = await h.db.select().from(jobRuns).where(eq(jobRuns.ranForDate, today()));
    expect(runs[0]?.status).toBe('ok');
    expect(runs[0]?.detail).toBeTruthy();

    const status = await h.api('GET', '/api/v1/admin/status');
    expect(status.scheduler.lastSuccessful).toBe(today());
  });

  it('generates the maintenance, expiry, low stock and warranty reminders', async () => {
    h = await makeHarness();
    const home = await makeHome(h);

    const asset = await h.api('POST', '/api/v1/assets', {
      propertyId: home.propertyId, name: 'Water heater',
    });
    await h.api('POST', '/api/v1/warranties', { assetId: asset.id, endDate: shift(30) });
    await h.api('POST', '/api/v1/maintenance/plans/full', {
      plan: { targetType: 'asset', targetId: asset.id, title: 'Flush the tank' },
      schedule: { mode: 'fixed', rrule: 'FREQ=YEARLY', anchorDate: shift(-365) },
    });
    const milk = await h.api('POST', '/api/v1/products', {
      name: 'Milk', defaultUnit: 'bottle', minQuantity: 5,
    });
    await h.api('POST', '/api/v1/stock', {
      productId: milk.id, quantity: 1, locationId: home.pantryId, expiryDate: shift(2),
    });

    await tick(h.db);
    const notes = await h.api('GET', '/api/v1/notifications');
    const kinds = notes.items.map((n: any) => n.eventType);
    expect(kinds).toContain('maintenance.due');
    expect(kinds).toContain('food.expiring');
    expect(kinds).toContain('stock.low');
    expect(kinds).toContain('warranty.expiring');
  });

  it('warns once per budget threshold crossed, not once per pass', async () => {
    h = await makeHarness();
    const cats = await h.api('GET', '/api/v1/categories?limit=200');
    const groceries = cats.items.find((c: any) => c.name === 'Groceries');
    const p = today().slice(0, 7);
    await h.api('PUT', `/api/v1/budget/${p}/allocations`, {
      allocations: [{ categoryId: groceries.id, amount: 10000 }],
    });
    await h.api('POST', '/api/v1/transactions', {
      amount: 9000, categoryId: groceries.id, date: today(), payeeName: 'Shop',
    });

    const ctx = await makeCtx(h.db, null);
    await runDailyPass(ctx);
    await runDailyPass(ctx);
    const notes = await h.api('GET', '/api/v1/notifications');
    expect(notes.items.filter((n: any) => n.eventType === 'budget.threshold')).toHaveLength(1);

    // Going over 100% is a new occasion and does warrant a second warning.
    await h.api('POST', '/api/v1/transactions', {
      amount: 3000, categoryId: groceries.id, date: today(), payeeName: 'Shop',
    });
    await runDailyPass(ctx);
    const after = await h.api('GET', '/api/v1/notifications');
    const budgetNotes = after.items.filter((n: any) => n.eventType === 'budget.threshold');
    expect(budgetNotes).toHaveLength(2);
    expect(budgetNotes.some((n: any) => n.title.startsWith('Over budget'))).toBe(true);
  });

  it('flags a dose nobody gave', async () => {
    h = await makeHarness();
    const pet = await h.api('POST', '/api/v1/pets', { name: 'Pepper', speciesCode: 'cat' });
    await h.api('POST', '/api/v1/pet-medications', {
      petId: pet.id, name: 'Methimazole', timesOfDay: ['00:01'], startDate: shift(-1),
    });
    const ctx = await makeCtx(h.db, null, new Date(Date.now() + 12 * 3600_000));
    const stats = await runDailyPass(ctx);
    expect(stats.dosesMissed).toBeGreaterThan(0);

    const doses = await h.api('GET', `/api/v1/pet-doses?petId=${pet.id}&status=missed`);
    expect(doses.items.length).toBeGreaterThan(0);
  });

  it('marks in-app notifications read', async () => {
    h = await makeHarness();
    await h.api('POST', '/api/v1/tasks', { title: 'Something', dueDate: today() });
    await tick(h.db);
    const before = await h.api('GET', '/api/v1/notifications');
    expect(before.unread).toBeGreaterThan(0);
    const res = await h.api('POST', '/api/v1/notifications/read', {});
    expect(res.unread).toBe(0);
    const rows = await h.db.select().from(notifications);
    expect(rows.every((r) => r.readAt)).toBe(true);
  });
});

describe('export and backup', () => {
  it('exports every table as CSV and JSONL in one archive', async () => {
    h = await makeHarness();
    const home = await makeHome(h);
    await h.api('POST', '/api/v1/assets', { propertyId: home.propertyId, name: 'Furnace' });

    const res: any = await h.api('GET', '/api/v1/admin/export?includeFiles=false', undefined, { raw: true });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/zip');
    const buf = res.rawPayload as Buffer;
    // Local file header magic, then the manifest and a known table.
    expect(buf.subarray(0, 4).toString('hex')).toBe('504b0304');
    const text = buf.toString('latin1');
    expect(text).toContain('schema.json');
    expect(text).toContain('data/csv/assets.csv');
    expect(text).toContain('data/jsonl/assets.jsonl');
  });

  it('reports database and storage size to an admin', async () => {
    h = await makeHarness();
    const status = await h.api('GET', '/api/v1/admin/status');
    expect(status.rowCounts.assetCategories).toBeGreaterThan(0);
    expect(status.rowCounts.maintenanceTemplates).toBeGreaterThan(20);
  });

  it('describes itself in OpenAPI', async () => {
    h = await makeHarness();
    const spec = await h.api('GET', '/api/v1/openapi.json');
    expect(spec.openapi).toBe('3.1.0');
    expect(Object.keys(spec.paths).length).toBeGreaterThan(80);
    expect(spec.paths['/api/v1/tasks'].get).toBeTruthy();
    expect(spec.paths['/api/v1/pets/{id}/care-sheet'].get).toBeTruthy();
  });
});
