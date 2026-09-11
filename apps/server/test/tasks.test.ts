import { describe, it, expect, afterEach } from 'vitest';
import { makeHarness, makeHome, shift, today, type Harness } from './helpers.js';

let h: Harness;
afterEach(async () => { await h?.close(); });

describe('the task engine', () => {
  it('quick-adds with a natural language date', async () => {
    h = await makeHarness();
    const task = await h.api('POST', '/api/v1/tasks/quick', { text: 'Call the chimney sweep tomorrow !high' });
    expect(task.title).toBe('Call the chimney sweep');
    expect(task.dueDate).toBe(shift(1));
    expect(task.priority).toBe('high');
  });

  it('regenerates a fixed schedule on the calendar, not from the completion', async () => {
    h = await makeHarness();
    const home = await makeHome(h);
    const schedule = await h.api('POST', '/api/v1/schedules', {
      spec: { mode: 'fixed', rrule: 'FREQ=WEEKLY;BYDAY=TU', anchorDate: shift(-28) },
      template: { title: 'Trash', propertyId: home.propertyId },
    });
    const before = await h.api('GET', `/api/v1/tasks?scheduleId=${schedule.id}&sort=dueDate&limit=100`);
    expect(before.items.length).toBeGreaterThan(1);
    const oldest = before.items[0];

    const res = await h.api('POST', `/api/v1/tasks/${oldest.id}/complete`, {});
    // The next bin day is a Tuesday, regardless of when it actually went out.
    expect(new Date(res.next + 'T00:00:00Z').getUTCDay()).toBe(2);
  });

  it('regenerates a floating schedule from the day it was actually done', async () => {
    h = await makeHarness();
    const home = await makeHome(h);
    const schedule = await h.api('POST', '/api/v1/schedules', {
      spec: { mode: 'floating', every: { days: 90 }, anchorDate: shift(-100) },
      template: { title: 'Change the filter', propertyId: home.propertyId },
    });
    const list = await h.api('GET', `/api/v1/tasks?scheduleId=${schedule.id}`);
    expect(list.items).toHaveLength(1);

    const res = await h.api('POST', `/api/v1/tasks/${list.items[0].id}/complete`, {});
    expect(res.next).toBe(shift(90));

    const after = await h.api('GET', `/api/v1/tasks?scheduleId=${schedule.id}&status=open`);
    expect(after.items).toHaveLength(1);
    expect(after.items[0].dueDate).toBe(shift(90));
  });

  it('only ever has one floating instance outstanding', async () => {
    h = await makeHarness();
    const schedule = await h.api('POST', '/api/v1/schedules', {
      spec: { mode: 'floating', every: { days: 7 }, anchorDate: shift(-90) },
      template: { title: 'Water plants' },
    });
    await h.api('POST', '/api/v1/schedules/materialise');
    await h.api('POST', `/api/v1/schedules/${schedule.id}/materialise`);
    const open = await h.api('GET', `/api/v1/tasks?scheduleId=${schedule.id}&status=open`);
    expect(open.items).toHaveLength(1);
  });

  it('owes the latest missed occurrence, not the first the rule ever had', async () => {
    h = await makeHarness();
    // A yearly job anchored two years ago and never done.
    const schedule = await h.api('POST', '/api/v1/schedules', {
      spec: { mode: 'fixed', rrule: 'FREQ=YEARLY;BYMONTH=5;BYMONTHDAY=1', anchorDate: shift(-800) },
      template: { title: 'Flush the water heater' },
    });
    const open = await h.api('GET', `/api/v1/tasks?scheduleId=${schedule.id}&status=open&sort=dueDate`);
    const overdue = open.items.filter((t: any) => t.dueDate < today());
    expect(overdue).toHaveLength(1);
    // Whatever "this year's" occurrence is, it must be within a year of today,
    // not back at the anchor.
    expect(new Date(today()).getTime() - new Date(overdue[0].dueDate).getTime())
      .toBeLessThan(370 * 86400_000);
  });

  it('materialises idempotently, so a catch-up run creates nothing new', async () => {
    h = await makeHarness();
    await h.api('POST', '/api/v1/schedules', {
      spec: { mode: 'fixed', rrule: 'FREQ=DAILY', anchorDate: shift(-3) },
      template: { title: 'Scoop the litter' },
    });
    const first = await h.api('GET', '/api/v1/tasks?originType=manual&limit=200');
    const again = await h.api('POST', '/api/v1/schedules/materialise');
    expect(again.created).toBe(0);
    const second = await h.api('GET', '/api/v1/tasks?originType=manual&limit=200');
    expect(second.items.length).toBe(first.items.length);
  });

  it('refuses to complete a task with an unfinished blocker', async () => {
    h = await makeHarness();
    const a = await h.api('POST', '/api/v1/tasks', { title: 'Buy stain' });
    const b = await h.api('POST', '/api/v1/tasks', { title: 'Apply stain' });
    await h.api('POST', `/api/v1/tasks/${b.id}/dependencies`, { blockedByTaskId: a.id });

    await expect(h.api('POST', `/api/v1/tasks/${b.id}/complete`, {})).rejects.toThrow(/Blocked by/);

    await h.api('POST', `/api/v1/tasks/${a.id}/complete`, {});
    const done = await h.api('POST', `/api/v1/tasks/${b.id}/complete`, {});
    expect(done.task.status).toBe('done');
  });

  it('rejects a circular dependency', async () => {
    h = await makeHarness();
    const a = await h.api('POST', '/api/v1/tasks', { title: 'A' });
    const b = await h.api('POST', '/api/v1/tasks', { title: 'B' });
    await h.api('POST', `/api/v1/tasks/${b.id}/dependencies`, { blockedByTaskId: a.id });
    const code = await h.status('POST', `/api/v1/tasks/${a.id}/dependencies`, { blockedByTaskId: b.id });
    expect(code).toBe(400);
  });

  it('snoozes from today when already overdue', async () => {
    h = await makeHarness();
    const t = await h.api('POST', '/api/v1/tasks', { title: 'Late thing', dueDate: shift(-10) });
    const snoozed = await h.api('POST', `/api/v1/tasks/${t.id}/snooze`, { days: 2 });
    expect(snoozed.dueDate).toBe(shift(2));
  });

  it('serves the Today and Overdue views', async () => {
    h = await makeHarness();
    await h.api('POST', '/api/v1/tasks', { title: 'Due now', dueDate: today() });
    await h.api('POST', '/api/v1/tasks', { title: 'Late', dueDate: shift(-4) });
    await h.api('POST', '/api/v1/tasks', { title: 'Later', dueDate: shift(20) });

    const todayView = await h.api('GET', '/api/v1/tasks/views/today');
    expect(todayView.items.map((t: any) => t.title).sort()).toEqual(['Due now', 'Late']);

    const overdue = await h.api('GET', '/api/v1/tasks/views/overdue');
    expect(overdue.items).toHaveLength(1);
    expect(overdue.items[0].overdue).toBe(true);
  });

  it('moving a card to a Done lane completes the task', async () => {
    h = await makeHarness();
    const board = await h.api('POST', '/api/v1/boards', { name: 'House' });
    const view = await h.api('GET', `/api/v1/boards/${board.id}/view`);
    const doneLane = view.lanes.find((l: any) => l.statusMapping === 'done');
    const task = await h.api('POST', '/api/v1/tasks', { title: 'Hang the shelf' });

    await h.api('PUT', `/api/v1/boards/${board.id}/placements`, { taskId: task.id, laneId: doneLane.id });
    const after = await h.api('GET', `/api/v1/tasks/${task.id}`);
    expect(after.status).toBe('done');
    expect(after.completedAt).toBeTruthy();
  });

  it('enforces a WIP limit', async () => {
    h = await makeHarness();
    const board = await h.api('POST', '/api/v1/boards', { name: 'Limited' });
    const lane = await h.api('POST', `/api/v1/boards/${board.id}/lanes`, {
      name: 'Doing', statusMapping: 'in_progress', wipLimit: 1,
    });
    const a = await h.api('POST', '/api/v1/tasks', { title: 'One' });
    const b = await h.api('POST', '/api/v1/tasks', { title: 'Two' });
    await h.api('PUT', `/api/v1/boards/${board.id}/placements`, { taskId: a.id, laneId: lane.id });
    const code = await h.status('PUT', `/api/v1/boards/${board.id}/placements`, { taskId: b.id, laneId: lane.id });
    expect(code).toBe(400);
  });

  it('detects a stale write', async () => {
    h = await makeHarness();
    const t = await h.api('POST', '/api/v1/tasks', { title: 'Contested' });
    await h.api('PATCH', `/api/v1/tasks/${t.id}`, { title: 'First writer wins' });
    const code = await h.status('PATCH', `/api/v1/tasks/${t.id}`, {
      title: 'Second writer', updatedAt: t.updatedAt,
    });
    expect(code).toBe(409);
  });
});
