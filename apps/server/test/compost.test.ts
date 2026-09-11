import { describe, it, expect, afterEach } from 'vitest';
import { makeHarness, makeHome, shift, today, type Harness } from './helpers.js';

let h: Harness;
afterEach(async () => { await h?.close(); });

const makePile = (method = 'hot_pile') =>
  h.api('POST', '/api/v1/compost/systems', { name: 'The heap', method, capacity: 40 });

describe('the material library (COMP-003)', () => {
  it('ships C:N ratios that name their source, and says what does not belong', async () => {
    h = await makeHarness();
    const res = await h.api('GET', '/api/v1/compost/materials');
    expect(res.items.length).toBeGreaterThan(20);
    expect(res.items.every((m: any) => m.source)).toBe(true);

    const sawdust = res.items.find((m: any) => m.key === 'sawdust');
    expect(sawdust.cnRatio).toBe(400);
    expect(sawdust.kind).toBe('brown');

    const cat = res.items.find((m: any) => m.key === 'pet_waste_cat');
    expect(cat.acceptable).toBe(false);
    expect(cat.caution).toMatch(/Toxoplasma/);
    expect(res.targets.cn).toEqual({ low: 25, high: 30 });
  });

  it('refuses what should not go in a domestic pile, and says why', async () => {
    h = await makeHarness();
    const pile = await makePile();
    const code = await h.status('POST', `/api/v1/compost/systems/${pile.id}/inputs`, {
      materialKey: 'meat', quantity: 2,
    });
    expect(code).toBe(400);
  });
});

describe('the balance is the ratio of the totals, not of the ratios (COMP-005)', () => {
  it('computes C:N correctly and advises when it is out of band', async () => {
    h = await makeHarness();
    const pile = await makePile();

    // Twenty kilos of sawdust at 400:1 and twenty of grass at 17:1 do not make
    // a pile at 208:1 — the sawdust brings almost no nitrogen to divide by.
    await h.api('POST', `/api/v1/compost/systems/${pile.id}/inputs`, {
      materialKey: 'sawdust', quantity: 20, unit: 'kg',
    });
    const res = await h.api('POST', `/api/v1/compost/systems/${pile.id}/inputs`, {
      materialKey: 'grass_clippings', quantity: 20, unit: 'kg',
    });
    expect(res.balance.ratio).toBeGreaterThan(30);
    expect(res.balance.ratio).toBeLessThan(45);
    expect(res.balance.status).toBe('too_dry');
    expect(res.balance.advice).toMatch(/add greens/i);
  });

  it('says to add browns when the pile is nitrogen-heavy, and how much', async () => {
    h = await makeHarness();
    const pile = await makePile();
    await h.api('POST', `/api/v1/compost/systems/${pile.id}/inputs`, {
      materialKey: 'kitchen_scraps', quantity: 30, unit: 'kg',
    });
    const advice = await h.api('GET', `/api/v1/compost/systems/${pile.id}/advice`);
    expect(advice.balance.status).toBe('too_wet');
    expect(advice.balance.advice).toMatch(/add browns/i);
    expect(advice.suggestion).not.toBeNull();
    expect(advice.suggestion.kg).toBeGreaterThan(0);
  });

  it('reports a balanced pile as balanced', async () => {
    h = await makeHarness();
    const pile = await makePile();
    await h.api('POST', `/api/v1/compost/systems/${pile.id}/inputs`, {
      materialKey: 'kitchen_scraps', quantity: 20, unit: 'kg',
    });
    // Twenty kilos of scraps needs about thirteen of leaves to land in the
    // band — a good deal more than the "a bit of both" people assume.
    const res = await h.api('POST', `/api/v1/compost/systems/${pile.id}/inputs`, {
      materialKey: 'dry_leaves', quantity: 13, unit: 'kg',
    });
    expect(res.balance.status).toBe('good');
    expect(res.balance.ratio).toBeGreaterThanOrEqual(25);
    expect(res.balance.ratio).toBeLessThanOrEqual(30);
  });
});

describe('managing the pile by temperature (COMP-007, COMP-008)', () => {
  it('reads the pile from its last temperature and turn', async () => {
    h = await makeHarness();
    const pile = await makePile();
    await h.api('POST', `/api/v1/compost/systems/${pile.id}/inputs`, {
      materialKey: 'kitchen_scraps', quantity: 10, unit: 'kg',
    });
    await h.api('POST', `/api/v1/compost/systems/${pile.id}/events`, {
      kind: 'temperature', temperatureF: 148, occurredOn: today(),
    });
    const detail = await h.api('GET', `/api/v1/compost/systems/${pile.id}/detail`);
    expect(detail.status.health).toBe('cooking');
    expect(detail.status.note).toMatch(/thermophilic/i);

    // A hot pile wants turning every few days.
    await h.api('POST', `/api/v1/compost/systems/${pile.id}/events`, {
      kind: 'turned', occurredOn: shift(-9),
    });
    const due = await h.api('GET', '/api/v1/compost/turns-due');
    expect(due.items).toHaveLength(1);
    expect(due.items[0].daysSinceTurn).toBe(9);
  });

  it('says a stalled pile is stalled rather than leaving it looking fine', async () => {
    h = await makeHarness();
    const pile = await makePile();
    await h.api('POST', `/api/v1/compost/systems/${pile.id}/events`, {
      kind: 'temperature', temperatureF: 82, occurredOn: today(),
    });
    const detail = await h.api('GET', `/api/v1/compost/systems/${pile.id}/detail`);
    expect(detail.status.health).toBe('stalled');
    expect(detail.status.note).toMatch(/too dry|nitrogen/i);
  });
});

describe('the methane, which is the point (COMP-012, COMP-013, COMP-014)', () => {
  it('books the pile own emissions rather than pretending it is free', async () => {
    h = await makeHarness();
    const pile = await makePile();
    const res = await h.api('POST', `/api/v1/compost/systems/${pile.id}/inputs`, {
      materialKey: 'kitchen_scraps', quantity: 100, unit: 'kg',
    });
    // A hundred kilos on a managed pile is about a kilo of CO2e — small, and
    // not zero, and the module says so.
    expect(res.gCo2e).toBeGreaterThan(0);
    expect(res.gCo2e).toBeLessThan(5_000);

    const foot = await h.api('GET', `/api/v1/carbon/footprint?year=${today().slice(0, 4)}`);
    expect(foot.total).toBe(res.gCo2e);
  });

  it('reports the landfill it avoided, at both horizons, apart from the footprint', async () => {
    h = await makeHarness();
    const pile = await makePile();
    const res = await h.api('POST', `/api/v1/compost/systems/${pile.id}/inputs`, {
      materialKey: 'kitchen_scraps', quantity: 100, unit: 'kg',
    });
    expect(res.avoided).not.toBeNull();
    expect(res.avoided.counterfactual).toMatch(/to landfill instead of the pile/);
    // Landfill methane is far worse over twenty years than a hundred.
    expect(res.avoided.gCo2e20 / res.avoided.gCo2e100).toBeGreaterThan(2.5);

    const foot = await h.api('GET', `/api/v1/carbon/footprint?year=${today().slice(0, 4)}`);
    // Avoided is reported beside the total, never inside it.
    expect(foot.avoided.total100).toBe(res.avoided.gCo2e100);
    expect(foot.total).toBe(res.gCo2e);
    expect(foot.avoided.note).toMatch(/never subtracted/i);
  });

  it('gives an unturned cold pile the anaerobic factor it has earned', async () => {
    h = await makeHarness();
    const hot = await makePile('hot_pile');
    const cold = await makePile('cold_pile');
    const hotRes = await h.api('POST', `/api/v1/compost/systems/${hot.id}/inputs`, {
      materialKey: 'kitchen_scraps', quantity: 100, unit: 'kg',
    });
    const coldRes = await h.api('POST', `/api/v1/compost/systems/${cold.id}/inputs`, {
      materialKey: 'kitchen_scraps', quantity: 100, unit: 'kg',
    });
    // A wet, compacted, never-turned heap really does make more methane.
    expect(coldRes.gCo2e).toBeGreaterThan(hotRes.gCo2e * 5);
    expect(coldRes.avoided.gCo2e100).toBeLessThan(hotRes.avoided.gCo2e100);
  });
});

describe('binning food offers the pile instead (COMP-004, INT-010)', () => {
  it('turns one waste action into a stock movement, a compost input and both carbon figures', async () => {
    h = await makeHarness();
    const home = await makeHome(h);
    const pile = await makePile();
    const beef = await h.api('POST', '/api/v1/products', {
      name: 'Ground beef', defaultUnit: 'lb', emissionFactorKey: 'food.beef',
    });
    const lot = await h.api('POST', '/api/v1/stock', {
      productId: beef.id, quantity: 2, unit: 'lb', locationId: home.pantryId, unitPrice: 900,
    });

    const res = await h.api('POST', `/api/v1/stock/${lot.id}/adjust`, {
      action: 'waste', quantity: 1, wasteReason: 'spoiled', route: 'compost',
    });

    // The embodied footprint it carried, reported and not re-emitted.
    expect(res.wastedGCo2e).toBeGreaterThan(20_000);
    // The pile's own small emission, which is the genuinely new one.
    expect(res.disposalGCo2e).toBeGreaterThan(0);
    expect(res.disposalGCo2e).toBeLessThan(1_000);
    expect(res.composted.balance.ratio).toBeGreaterThan(0);
    expect(res.avoided.counterfactual).toMatch(/landfill/);

    const detail = await h.api('GET', `/api/v1/compost/systems/${pile.id}/detail`);
    expect(detail.inputs).toHaveLength(1);
    expect(detail.inputs[0].sourceType).toBe('waste_log');
  });

  it('does not count the food footprint twice when it is binned', async () => {
    h = await makeHarness();
    const home = await makeHome(h);
    const beef = await h.api('POST', '/api/v1/products', {
      name: 'Ground beef', defaultUnit: 'lb', emissionFactorKey: 'food.beef',
    });
    const list = await h.api('POST', '/api/v1/shopping-lists', { name: 'Grocery', isDefault: true });
    const line = await h.api('POST', `/api/v1/shopping-lists/${list.id}/lines`, {
      productId: beef.id, quantity: 2,
    });
    const bought = await h.api('POST', `/api/v1/shopping-lists/${list.id}/put-away`, {
      items: [{ lineId: line.id, quantity: 2, locationId: home.pantryId }],
    });
    const afterBuying = await h.api('GET', `/api/v1/carbon/footprint?year=${today().slice(0, 4)}`);
    expect(afterBuying.total).toBe(bought.embodiedGCo2e);

    const stock = await h.api('GET', '/api/v1/stock?limit=10');
    const res = await h.api('POST', `/api/v1/stock/${stock.items[0].id}/adjust`, {
      action: 'waste', quantity: 2, wasteReason: 'spoiled', route: 'bin',
    });

    // Binning it adds the landfill emission and *only* that. The beef's
    // embodied carbon was counted when it was bought; counting it again here
    // would double the household footprint for the same two pounds.
    const after = await h.api('GET', `/api/v1/carbon/footprint?year=${today().slice(0, 4)}`);
    expect(after.total).toBe(afterBuying.total + res.disposalGCo2e);
    expect(res.wastedGCo2e).toBeGreaterThan(res.disposalGCo2e * 10);

    const report = await h.api('GET', '/api/v1/food/waste');
    expect(report.embodiedGCo2e).toBeGreaterThan(0);
    expect(report.disposalGCo2e).toBe(res.disposalGCo2e);
    expect(report.carbonNote).toMatch(/already counted when you bought it/);
  });
});

describe('compost reaches the beds (COMP-011, INT-011)', () => {
  it('records one output that is both a pile output and a bed input', async () => {
    h = await makeHarness();
    await makeHome(h);
    const bed = await h.api('POST', '/api/v1/garden/beds', { name: 'Bed 1', areaSqft: 32 });
    const pile = await makePile();
    const res = await h.api('POST', `/api/v1/compost/systems/${pile.id}/outputs`, {
      quantity: 6, unit: 'cuft', bedId: bed.id,
    });
    expect(res.output.bedId).toBe(bed.id);
    expect(res.bed.name).toBe('Bed 1');
    // Six cubic feet of bought compost is about thirty dollars.
    expect(res.displaced).toBe(3000);

    const overview = await h.api('GET', '/api/v1/compost/overview');
    expect(overview.year.outputs).toBe(6);
    expect(overview.year.displacedCost).toBe(3000);
    expect(overview.avoided.note).toMatch(/never subtracted/i);
  });
});
