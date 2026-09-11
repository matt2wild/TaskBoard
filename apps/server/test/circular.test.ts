import { describe, it, expect, afterEach } from 'vitest';
import { makeHarness, makeHome, shift, today, type Harness } from './helpers.js';

let h: Harness;
afterEach(async () => { await h?.close(); });

async function makeDishwasher(): Promise<any> {
  const home = await makeHome(h);
  const cats = await h.api('GET', '/api/v1/asset-categories?limit=300');
  const dishwasher = cats.items.find((c: any) => c.slug === 'dishwasher');
  return h.api('POST', '/api/v1/assets', {
    propertyId: home.propertyId,
    name: 'Dishwasher',
    categoryId: dishwasher?.id ?? null,
    purchaseDate: shift(-365 * 9),
    purchasePrice: 90_000,
    expectedLifespanYears: 10,
    replacementCostEstimate: 90_000,
  });
}

describe('a repair is the maintenance that avoided a replacement (CIRC-001..004)', () => {
  it('books the cost, extends the life and names what was not manufactured', async () => {
    h = await makeHarness();
    const asset = await makeDishwasher();

    const res = await h.api('POST', '/api/v1/repairs', {
      targetType: 'asset', targetId: asset.id,
      symptom: 'Not draining', workDone: 'Replaced the drain pump',
      partsCost: 5_400, timeMin: 90, outcome: 'fixed', extendedLifeYears: 4,
    });

    expect(res.repair.outcome).toBe('fixed');
    expect(res.repair.extendedLifeYears).toBe(4);
    // Four years of a ten-year machine, so four tenths of its embodied carbon
    // — not the whole appliance, which would be the usual overstatement.
    expect(res.avoided.gCo2e).toBe(140_000);
    expect(res.avoided.cost).toBe(36_000);
    expect(res.avoided.counterfactual).toMatch(/not bought/);
    expect(res.avoided.counterfactual).toMatch(/40%/);

    // The cost lands on the thing repaired, like any maintenance.
    const ledger = await h.api('GET', `/api/v1/ledger/asset/${asset.id}`);
    expect(ledger.cost).toBe(5_400);
  });

  it('pushes the replacement forecast out by what the repair bought (INT-012)', async () => {
    h = await makeHarness();
    const asset = await makeDishwasher();
    const before = await h.api('GET', `/api/v1/assets/${asset.id}`);
    const originalYear = before.replacementYear;

    await h.api('POST', '/api/v1/repairs', {
      targetType: 'asset', targetId: asset.id,
      symptom: 'Not draining', partsCost: 5_400, outcome: 'fixed', extendedLifeYears: 4,
    });

    const after = await h.api('GET', `/api/v1/assets/${asset.id}`);
    expect(after.lifeExtendedYears).toBe(4);
    expect(after.replacementYear).toBe(originalYear + 4);

    // …and the ten-year plan stops reserving for it next year.
    const plan = await h.api('GET', '/api/v1/budget/long-range?years=10');
    const line = plan.years.flatMap((y: any) => y.items)
      .find((i: any) => i.kind === 'asset_replacement' && /Dishwasher/.test(i.label));
    expect(line.label).toMatch(/deferred 4y by repair/);
  });

  it('records a failed repair as a failure, and does not credit it with anything', async () => {
    h = await makeHarness();
    const asset = await makeDishwasher();
    const res = await h.api('POST', '/api/v1/repairs', {
      targetType: 'asset', targetId: asset.id,
      symptom: 'Not draining', workDone: 'New pump; still leaking from the sump',
      partsCost: 5_400, outcome: 'failed',
    });
    expect(res.avoided).toBeNull();
    expect(res.repair.avoidedGCo2e).toBeNull();

    const after = await h.api('GET', `/api/v1/assets/${asset.id}`);
    expect(after.lifeExtendedYears).toBe(0);
  });

  it('repairs something that is not in the registry at all', async () => {
    h = await makeHarness();
    const res = await h.api('POST', '/api/v1/repairs', {
      targetText: 'Kitchen chair', symptom: 'Loose back leg',
      workDone: 'Re-glued and clamped', partsCost: 0, outcome: 'fixed',
    });
    expect(res.repair.targetText).toBe('Kitchen chair');
    const list = await h.api('GET', '/api/v1/repairs');
    expect(list.items[0].targetLabel).toBe('Kitchen chair');
  });
});

describe('repair or replace, per year of service (CIRC-005)', () => {
  it('compares in both units and says plainly what it assumed', async () => {
    h = await makeHarness();
    const asset = await makeDishwasher();
    const res = await h.api(
      'GET', `/api/v1/assets/${asset.id}/repair-or-replace?repairCost=5400&extendedLifeYears=4`);

    // $54 over four years against $900 over ten: repairing is far cheaper per
    // year of service, which is the comparison that actually means something.
    expect(res.verdict.repairCostPerYear).toBe(1_350);
    expect(res.verdict.replaceCostPerYear).toBe(9_000);
    expect(res.verdict.repairWins).toBe(true);
    // Repairing manufactures nothing, so it wins on carbon too.
    expect(res.verdict.repairGCo2ePerYear).toBe(0);
    expect(res.verdict.replaceGCo2ePerYear).toBe(35_000);
    expect(res.verdict.measuresDisagree).toBe(false);
    expect(res.assumptions.join(' ')).toMatch(/embodied carbon/);
  });

  it('surfaces the case where money and carbon disagree', async () => {
    h = await makeHarness();
    const asset = await makeDishwasher();
    // An expensive repair that buys one year, against a replacement that runs
    // no cleaner: replacing is cheaper per year but manufactures a machine.
    const res = await h.api(
      'GET', `/api/v1/assets/${asset.id}/repair-or-replace?repairCost=40000&extendedLifeYears=1`);
    expect(res.verdict.repairWins).toBe(false);
    expect(res.verdict.measuresDisagree).toBe(true);
    expect(res.verdict.note).toMatch(/judgement, not a calculation/);
  });
});

describe('circulation without duplication (CIRC-008, INT-013)', () => {
  it('logs what was kept in circulation and by what route', async () => {
    h = await makeHarness();
    await h.api('POST', '/api/v1/circulation', {
      kind: 'given', itemText: 'Two boxes of tile offcuts', value: 4_000,
    });
    await h.api('POST', '/api/v1/circulation', {
      kind: 'repurposed', itemText: 'Pallet into a compost bay',
    });
    await h.api('POST', '/api/v1/circulation', {
      kind: 'swapped', itemText: 'Runner bean seed', occurredOn: today(),
    });

    const res = await h.api('GET', '/api/v1/circularity');
    expect(res.circulation.count).toBe(3);
    expect(res.circulation.byKind.map((k: any) => k.kind).sort())
      .toEqual(['given', 'repurposed', 'swapped']);
  });

  it('reads existing loans as circulation rather than asking for them twice', async () => {
    h = await makeHarness();
    const home = await makeHome(h);
    const item = await h.api('POST', '/api/v1/storage-items', {
      name: 'Extension ladder', locationId: home.garageId,
    });
    await h.api('POST', '/api/v1/loans', {
      itemType: 'storage_item', itemId: item.id, contactName: 'Dave next door',
      lentAt: today(),
    });
    const res = await h.api('GET', '/api/v1/circularity');
    // Not re-entered anywhere: it is a loan, and a loan is circulation.
    expect(res.circulation.loansOut).toBe(1);
    expect(res.circulation.count).toBe(0);
  });
});

describe('the circularity report (CIRC-017, CIRC-018)', () => {
  it('totals repairs, routes and avoided emissions, each with its counterfactual', async () => {
    h = await makeHarness();
    const asset = await makeDishwasher();
    await h.api('POST', '/api/v1/repairs', {
      targetType: 'asset', targetId: asset.id, symptom: 'Not draining',
      partsCost: 5_400, outcome: 'fixed', extendedLifeYears: 4,
    });
    await h.api('POST', '/api/v1/repairs', {
      targetType: 'asset', targetId: asset.id, symptom: 'Door catch',
      partsCost: 1_200, outcome: 'failed',
    });

    const res = await h.api('GET', '/api/v1/circularity');
    expect(res.repairs.count).toBe(2);
    expect(res.repairs.fixed).toBe(1);
    expect(res.repairs.failed).toBe(1);
    expect(res.repairs.successRate).toBe(0.5);
    expect(res.repairs.partsCost).toBe(6_600);

    expect(res.avoided.total100).toBe(140_000);
    expect(res.avoided.items[0].counterfactual).toMatch(/not bought/);
    expect(res.avoided.note).toMatch(/never subtracted from it/);
  });

  it('keeps avoided emissions out of the household footprint', async () => {
    h = await makeHarness();
    const asset = await makeDishwasher();
    await h.api('POST', '/api/v1/repairs', {
      targetType: 'asset', targetId: asset.id, symptom: 'Not draining',
      partsCost: 5_400, outcome: 'fixed', extendedLifeYears: 4,
    });
    const foot = await h.api('GET', `/api/v1/carbon/footprint?year=${today().slice(0, 4)}`);
    // The repair avoided 140 kg. The household still emitted nothing, because
    // an avoided tonne is not an emitted tonne.
    expect(foot.avoided.total100).toBe(140_000);
    expect(foot.total).toBe(0);

    const avoided = await h.api('GET', '/api/v1/avoided');
    expect(avoided.total100).toBe(140_000);
    expect(avoided.note).toMatch(/counterfactuals, not reductions/);
  });

  it('shows an asset what its repairs saved it', async () => {
    h = await makeHarness();
    const asset = await makeDishwasher();
    await h.api('POST', '/api/v1/repairs', {
      targetType: 'asset', targetId: asset.id, symptom: 'Not draining',
      partsCost: 5_400, outcome: 'fixed', extendedLifeYears: 4,
    });
    const res = await h.api('GET', `/api/v1/assets/${asset.id}/circularity`);
    expect(res.repairs).toHaveLength(1);
    expect(res.extendedLifeYears).toBe(4);
    expect(res.embodied.grams).toBe(350_000);
    expect(res.embodied.basis).toMatch(/dishwasher/i);
    expect(res.avoidedCost).toBe(36_000);
  });
});
