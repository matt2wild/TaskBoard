import { describe, it, expect, afterEach } from 'vitest';
import { makeHarness, makeHome, shift, today, type Harness } from './helpers.js';

let h: Harness;
afterEach(async () => { await h?.close(); });

/** C.2 from the requirements: the bathroom remodel. */
describe('C.2 renovation project', () => {
  it('builds a project from the shipped template with phases, tasks and materials', async () => {
    h = await makeHarness();
    const home = await makeHome(h);
    const templates = await h.api('GET', '/api/v1/project-templates');
    const bathroom = templates.items.find((t: any) => t.name === 'Bathroom remodel');
    expect(bathroom).toBeTruthy();

    const project = await h.api('POST', `/api/v1/projects/from-template/${bathroom.id}`, {
      name: 'Main bathroom remodel', propertyId: home.propertyId, budgetAmount: 1200000,
    });
    const overview = await h.api('GET', `/api/v1/projects/${project.id}/overview`);
    expect(overview.phases.map((p: any) => p.name)).toEqual(['Demo', 'Rough-in', 'Inspection', 'Tile', 'Finish']);
    expect(overview.tasks.length).toBeGreaterThan(15);
    expect(overview.materials.length).toBeGreaterThan(5);
    expect(overview.permits.map((p: any) => p.name)).toContain('Plumbing permit');
    expect(overview.budget.amount).toBe(1200000);
  });

  it('rolls actual spend up against the budget and flags the overrun', async () => {
    h = await makeHarness();
    const home = await makeHome(h);
    const project = await h.api('POST', '/api/v1/projects', {
      propertyId: home.propertyId, name: 'Bathroom', status: 'in_progress', budgetAmount: 1000000,
    });
    for (const amount of [289400, 160000, 41500]) {
      await h.api('POST', '/api/v1/transactions', {
        amount, payeeName: 'Hardware', attributions: [{ entityType: 'project', entityId: project.id }],
      });
    }
    const overview = await h.api('GET', `/api/v1/projects/${project.id}/overview`);
    expect(overview.budget.spent).toBe(490900);
    expect(overview.budget.pct).toBe(49);
    expect(overview.budget.remaining).toBe(1000000 - 490900);
  });

  it('splits one materials receipt across the projects it was for', async () => {
    h = await makeHarness();
    const home = await makeHome(h);
    const a = await h.api('POST', '/api/v1/projects', { propertyId: home.propertyId, name: 'Bathroom' });
    const b = await h.api('POST', '/api/v1/projects', { propertyId: home.propertyId, name: 'Deck' });
    const m1 = await h.api('POST', '/api/v1/project-materials', {
      projectId: a.id, description: 'Tile', quantity: 60, unit: 'ea', estUnitCost: 480,
    });
    const m2 = await h.api('POST', '/api/v1/project-materials', {
      projectId: b.id, description: 'Screws', quantity: 5, unit: 'box', estUnitCost: 1200,
    });

    const res = await h.api('POST', '/api/v1/project-materials/purchase', {
      materialIds: [m1.id, m2.id], total: 40000, payeeName: 'Hardware',
    });
    expect(res.updated).toBe(2);

    const aSpend = await h.api('GET', `/api/v1/projects/${a.id}/overview`);
    const bSpend = await h.api('GET', `/api/v1/projects/${b.id}/overview`);
    expect(aSpend.budget.spent + bSpend.budget.spent).toBe(40000);
    // Split in proportion to the estimates: tile 28800, screws 6000.
    expect(aSpend.budget.spent).toBeGreaterThan(bSpend.budget.spent);
  });

  it('reports tool availability and blocks on a loan', async () => {
    h = await makeHarness();
    const home = await makeHome(h);
    const project = await h.api('POST', '/api/v1/projects', { propertyId: home.propertyId, name: 'Bathroom' });
    const tool = await h.api('POST', '/api/v1/tools', { propertyId: home.propertyId, name: 'Multi-tool' });
    await h.api('PUT', `/api/v1/projects/${project.id}/tools`, { assetIds: [tool.id] });
    await h.api('POST', '/api/v1/loans', { itemType: 'asset', itemId: tool.id, contactName: 'Dave' });

    const overview = await h.api('GET', `/api/v1/projects/${project.id}/overview`);
    expect(overview.tools[0]).toMatchObject({ name: 'Multi-tool', available: false, status: 'loaned_out' });
  });

  it('accepts one quote and rejects the competition for the same scope', async () => {
    h = await makeHarness();
    const home = await makeHome(h);
    const project = await h.api('POST', '/api/v1/projects', { propertyId: home.propertyId, name: 'Bathroom' });
    const a = await h.api('POST', '/api/v1/contacts', { name: 'Ridgeline Plumbing', type: 'contractor' });
    const b = await h.api('POST', '/api/v1/contacts', { name: 'Green Mountain', type: 'contractor' });
    const q1 = await h.api('POST', '/api/v1/quotes', {
      projectId: project.id, contactId: a.id, scope: 'Plumbing rough-in', amount: 320000, status: 'received',
    });
    await h.api('POST', '/api/v1/quotes', {
      projectId: project.id, contactId: b.id, scope: 'Plumbing rough-in', amount: 412000, status: 'received',
    });

    const comparison = await h.api('GET', `/api/v1/projects/${project.id}/quote-comparison`);
    expect(comparison.groups[0]).toMatchObject({ lowest: 320000, highest: 412000, spread: 92000 });

    await h.api('POST', `/api/v1/quotes/${q1.id}/accept`);
    const quotes = await h.api('GET', `/api/v1/quotes?projectId=${project.id}`);
    const statuses = Object.fromEntries(quotes.items.map((q: any) => [q.amount, q.status]));
    expect(statuses[320000]).toBe('accepted');
    expect(statuses[412000]).toBe('rejected');
  });

  it('turns materials that are still needed into a shopping list', async () => {
    h = await makeHarness();
    const home = await makeHome(h);
    const project = await h.api('POST', '/api/v1/projects', { propertyId: home.propertyId, name: 'Bathroom' });
    await h.api('POST', '/api/v1/project-materials', {
      projectId: project.id, description: 'Grout, charcoal', quantity: 2, unit: 'bag', status: 'needed',
    });
    await h.api('POST', '/api/v1/project-materials', {
      projectId: project.id, description: 'Tile', quantity: 60, unit: 'ea', status: 'received',
    });
    const res = await h.api('POST', `/api/v1/projects/${project.id}/materials/to-shopping-list`);
    expect(res.added).toEqual(['Grout, charcoal']);
  });

  it('on completion files leftovers, creates the new asset and records the variance', async () => {
    h = await makeHarness();
    const home = await makeHome(h);
    const project = await h.api('POST', '/api/v1/projects', {
      propertyId: home.propertyId, name: 'Bathroom', status: 'in_progress', budgetAmount: 1200000,
    });
    await h.api('POST', '/api/v1/transactions', {
      amount: 1294000, payeeName: 'Everyone', attributions: [{ entityType: 'project', entityId: project.id }],
    });
    const tool = await h.api('POST', '/api/v1/tools', { propertyId: home.propertyId, name: 'Tile saw' });
    await h.api('POST', `/api/v1/tools/${tool.id}/checkout`, { projectId: project.id });

    const res = await h.api('POST', `/api/v1/projects/${project.id}/complete`, {
      wentWell: 'Tile went faster than expected.',
      leftovers: [{ description: 'Leftover bathroom tile', locationId: home.garageId, quantity: 14 }],
      createAssets: [{ name: 'Bathroom exhaust fan', locationId: home.roomId, purchasePrice: 13900 }],
    });
    expect(res.project.status).toBe('complete');
    expect(res.project.retrospective.variance).toBe(1294000 - 1200000);
    expect(res.createdAssets).toHaveLength(1);
    expect(res.filedLeftovers).toHaveLength(1);

    const stored = await h.api('GET', `/api/v1/storage-items?projectId=${project.id}`);
    expect(stored.items[0].name).toBe('Leftover bathroom tile');

    // The tile saw comes back to the rack when the project ends.
    const availability = await h.api('POST', '/api/v1/tools/availability', { assetIds: [tool.id] });
    expect(availability.items[0].available).toBe(true);
  });

  it('keeps the ideas backlog separate and totals it', async () => {
    h = await makeHarness();
    const home = await makeHome(h);
    await h.api('POST', '/api/v1/projects', {
      propertyId: home.propertyId, name: 'Replace the deck', status: 'idea', estimateCost: 900000,
    });
    await h.api('POST', '/api/v1/projects', {
      propertyId: home.propertyId, name: 'Bathroom', status: 'in_progress',
    });
    const backlog = await h.api('GET', '/api/v1/projects/backlog');
    expect(backlog.items).toHaveLength(1);
    expect(backlog.totalEstimate).toBe(900000);
  });
});
