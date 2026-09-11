import { describe, it, expect, afterEach } from 'vitest';
import { makeHarness, makeHome, shift, today, type Harness } from './helpers.js';

let h: Harness;
afterEach(async () => { await h?.close(); });

const TONNE = 1_000_000;

describe('the shipped factor library', () => {
  it('arrives with the household and names its sources', async () => {
    h = await makeHarness();
    const res = await h.api('GET', '/api/v1/carbon/factors?limit=200');
    expect(res.items.length).toBeGreaterThan(50);
    expect(res.items.every((f: any) => f.source)).toBe(true);
    const grid = res.items.find((f: any) => f.key === 'electricity.grid' && f.region === 'US');
    expect(grid.scope).toBe(2);
    expect(grid.notes).toMatch(/correct this/i);
  });

  it('lets a household correct a factor for its own grid', async () => {
    h = await makeHarness();
    const res = await h.api('GET', '/api/v1/carbon/factors?key=electricity.grid');
    const grid = res.items.find((f: any) => f.region === 'US');
    await h.api('PATCH', `/api/v1/carbon/factors/${grid.id}`, { kgPerUnit: 0.05, confidence: 'high' });

    const activity = await h.api('POST', '/api/v1/carbon/activities', {
      type: 'electricity', amount: 1000, unit: 'kwh',
    });
    // 1000 kWh at 0.05 kg, plus the separate upstream losses factor.
    expect(activity.emissions.find((e: any) => e.factorKey === 'electricity.grid').gCo2e).toBe(50_000);
  });
});

describe('recording an activity', () => {
  it('applies every factor that bears on it, with its own scope', async () => {
    h = await makeHarness();
    const res = await h.api('POST', '/api/v1/carbon/activities', {
      type: 'natural_gas', amount: 100, unit: 'therm',
    });
    const keys = res.emissions.map((e: any) => e.factorKey).sort();
    expect(keys).toEqual(['gas.combustion', 'gas.upstream']);
    // Burning it is scope 1; getting it to the meter is scope 3.
    expect(res.emissions.find((e: any) => e.factorKey === 'gas.combustion').scope).toBe(1);
    expect(res.emissions.find((e: any) => e.factorKey === 'gas.upstream').scope).toBe(3);
    expect(res.gCo2e).toBe(531_000 + 102_000);
  });

  it('converts the quantity into the factor unit', async () => {
    h = await makeHarness();
    // The gas factor is published per therm; this meter reads in kWh.
    const res = await h.api('POST', '/api/v1/carbon/activities', {
      type: 'natural_gas', amount: 293.001, unit: 'kwh',
    });
    const combustion = res.emissions.find((e: any) => e.factorKey === 'gas.combustion');
    expect(combustion.quantityInFactorUnit).toBeCloseTo(10, 2);
    expect(combustion.gCo2e).toBeCloseTo(53_100, -2);
  });

  it('stores a snapshot of the factor so history cannot be rewritten', async () => {
    h = await makeHarness();
    const res = await h.api('POST', '/api/v1/carbon/activities', {
      type: 'heating_oil', amount: 200, unit: 'gal',
    });
    const before = res.gCo2e;
    const factors = await h.api('GET', '/api/v1/carbon/factors?key=oil.combustion');
    await h.api('PATCH', `/api/v1/carbon/factors/${factors.items[0].id}`, { kgPerUnit: 99 });

    const after = await h.api('GET', '/api/v1/carbon/activities');
    expect(after.items[0].gCo2e).toBe(before);
    expect(after.items[0].emissions[0].factorKgPerUnit).toBe(10.21);
  });

  it('refuses a dimensional mismatch rather than inventing a density', async () => {
    h = await makeHarness();
    const code = await h.status('POST', '/api/v1/carbon/activities', {
      type: 'food', amount: 2, unit: 'l', factorKey: 'food.beef',
    });
    expect(code).toBe(400);
  });

  it('counts generation as a credit, not a debit', async () => {
    h = await makeHarness();
    const res = await h.api('POST', '/api/v1/carbon/activities', {
      type: 'generation', amount: 500, unit: 'kwh',
    });
    expect(res.gCo2e).toBeLessThan(0);
  });
});

describe('recalculation is explicit, never silent (GHG-005)', () => {
  it('shows the diff before it writes anything', async () => {
    h = await makeHarness();
    await h.api('POST', '/api/v1/carbon/activities', {
      type: 'heating_oil', amount: 100, unit: 'gal', occurredOn: today(),
    });
    const factors = await h.api('GET', '/api/v1/carbon/factors?key=oil.combustion');
    await h.api('PATCH', `/api/v1/carbon/factors/${factors.items[0].id}`, { kgPerUnit: 12 });

    const preview = await h.api('POST', '/api/v1/carbon/recalculate', {
      from: shift(-5), to: today(), apply: false,
    });
    expect(preview.applied).toBe(false);
    expect(preview.changed).toHaveLength(1);
    expect(preview.changed[0]).toMatchObject({ was: 1_021_000, now: 1_200_000 });

    const untouched = await h.api('GET', '/api/v1/carbon/activities');
    expect(untouched.items[0].gCo2e).toBe(1_021_000 + 180_000);

    const applied = await h.api('POST', '/api/v1/carbon/recalculate', {
      from: shift(-5), to: today(), apply: true,
    });
    expect(applied.applied).toBe(true);
    const now = await h.api('GET', '/api/v1/carbon/activities');
    expect(now.items[0].gCo2e).toBe(1_200_000 + 180_000);
  });
});

describe('one ledger for both measures (INT-007)', () => {
  it('answers what a thing cost and what it emitted in one call', async () => {
    h = await makeHarness();
    const home = await makeHome(h);
    const boiler = await h.api('POST', '/api/v1/assets', {
      propertyId: home.propertyId, name: 'Oil boiler',
    });

    await h.api('POST', '/api/v1/transactions', {
      amount: 68_900, payeeName: 'Valley Fuel', memo: '212 gallons',
      attributions: [{ entityType: 'asset', entityId: boiler.id }],
    });
    await h.api('POST', '/api/v1/carbon/activities', {
      type: 'heating_oil', amount: 212, unit: 'gal',
      attributions: [{ entityType: 'asset', entityId: boiler.id }],
    });

    const ledger = await h.api('GET', `/api/v1/ledger/asset/${boiler.id}`);
    expect(ledger.cost).toBe(68_900);
    expect(ledger.transactions).toBe(1);
    expect(ledger.gCo2e).toBe(Math.round(212 * 10.21 * 1000) + Math.round(212 * 1.8 * 1000));
    expect(ledger.activities).toBe(1);

    // And the asset itself carries both.
    const asset = await h.api('GET', `/api/v1/assets/${boiler.id}`);
    expect(asset.totalCost).toBe(68_900);
    expect(asset.gCo2e).toBe(ledger.gCo2e);
  });

  it('kept the money attributions working after the ledger was unified', async () => {
    h = await makeHarness();
    const home = await makeHome(h);
    const project = await h.api('POST', '/api/v1/projects', {
      propertyId: home.propertyId, name: 'Bathroom', budgetAmount: 100_000,
    });
    await h.api('POST', '/api/v1/transactions', {
      amount: 40_000, payeeName: 'Hardware',
      attributions: [{ entityType: 'project', entityId: project.id }],
    });
    const overview = await h.api('GET', `/api/v1/projects/${project.id}/overview`);
    expect(overview.budget.spent).toBe(40_000);

    const report = await h.api('GET', '/api/v1/budget/reports/by-attribution');
    expect(report.items[0]).toMatchObject({ entityType: 'project', total: 40_000 });
  });
});

describe('meters (GHG-008)', () => {
  async function meteredHome() {
    h = await makeHarness();
    const home = await makeHome(h);
    const meter = await h.api('POST', '/api/v1/assets', {
      propertyId: home.propertyId, name: 'Electricity meter',
    });
    await h.api('PUT', `/api/v1/carbon/meters/${meter.id}`, {
      kind: 'electricity', unit: 'kwh', emissionFactorKey: 'electricity.grid', multiplier: 1,
    });
    return { home, meterId: meter.id };
  }

  it('says nothing about the first reading and differences the second', async () => {
    const { meterId } = await meteredHome();
    await h.api('POST', '/api/v1/readings', {
      assetId: meterId, metric: 'kwh', value: 10_000, takenAt: shift(-30),
    });
    expect((await h.api('GET', '/api/v1/carbon/activities')).items).toHaveLength(0);

    await h.api('POST', '/api/v1/readings', {
      assetId: meterId, metric: 'kwh', value: 10_412, takenAt: today(),
    });
    const activities = await h.api('GET', '/api/v1/carbon/activities');
    expect(activities.items).toHaveLength(1);
    expect(activities.items[0]).toMatchObject({ type: 'electricity', amount: 412, unit: 'kwh' });
    expect(activities.items[0].attributions[0].entityId).toBe(meterId);
  });

  it('does not double count when a bill covers a period the meter already recorded', async () => {
    const { meterId } = await meteredHome();
    await h.api('POST', '/api/v1/readings', { assetId: meterId, metric: 'kwh', value: 10_000, takenAt: shift(-30) });
    await h.api('POST', '/api/v1/readings', { assetId: meterId, metric: 'kwh', value: 10_412, takenAt: shift(-1) });

    const cats = await h.api('GET', '/api/v1/categories?limit=200');
    const electricity = cats.items.find((c: any) => c.name === 'Electricity');
    const bill = await h.api('POST', '/api/v1/bills', {
      name: 'Electricity', categoryId: electricity.id, amount: 8_000,
      meteredUnit: 'kwh', emissionFactorKey: 'electricity.grid', meterAssetId: meterId,
    });

    const paid = await h.api('POST', `/api/v1/bills/${bill.id}/pay`, { quantity: 412 });
    expect(paid.attachedToMeterReading).toBe(true);

    // Still one activity, now carrying the cost as well as the kilowatt hours.
    const activities = await h.api('GET', '/api/v1/carbon/activities');
    expect(activities.items).toHaveLength(1);
    expect(activities.items[0].transactionId).toBe(paid.transactionId);
  });

  it('records the bill quantity when no meter has covered the period', async () => {
    h = await makeHarness();
    const cats = await h.api('GET', '/api/v1/categories?limit=200');
    const gas = cats.items.find((c: any) => c.name === 'Gas/Heating');
    const bill = await h.api('POST', '/api/v1/bills', {
      name: 'Gas', categoryId: gas.id, amount: 9_000,
      meteredUnit: 'therm', emissionFactorKey: 'gas.combustion',
    });
    const paid = await h.api('POST', `/api/v1/bills/${bill.id}/pay`, { quantity: 62 });
    expect(paid.activityId).toBeTruthy();
    expect(paid.gCo2e).toBeGreaterThan(0);
  });
});

describe('the footprint (GHG-016)', () => {
  it('splits by scope and explains every number behind it', async () => {
    h = await makeHarness();
    const home = await makeHome(h);
    await h.api('POST', '/api/v1/carbon/activities', {
      type: 'heating_oil', amount: 200, unit: 'gal', propertyId: home.propertyId,
    });
    await h.api('POST', '/api/v1/carbon/activities', {
      type: 'electricity', amount: 900, unit: 'kwh', propertyId: home.propertyId,
    });
    await h.api('POST', '/api/v1/carbon/activities', {
      type: 'food', amount: 5, unit: 'kg', factorKey: 'food.beef',
    });

    const f = await h.api('GET', `/api/v1/carbon/footprint?from=${shift(-5)}&to=${today()}`);
    expect(f.total).toBeGreaterThan(2 * TONNE);
    expect(f.scopes.map((s: any) => s.scope)).toEqual([1, 2, 3]);
    expect(f.scopes.find((s: any) => s.scope === 1).label).toBe('Burned here');
    expect(f.byCategory.map((c: any) => c.category)).toContain('food');
    expect(f.intensity.perPerson).toBeGreaterThan(0);

    const explained = await h.api('GET', `/api/v1/carbon/explain?from=${shift(-5)}&to=${today()}`);
    expect(explained.items.length).toBeGreaterThanOrEqual(5);
    expect(explained.items.every((i: any) => i.factorKey && i.source)).toBe(true);
    const beef = explained.items.find((i: any) => i.factorKey === 'food.beef');
    expect(beef.factorKgPerUnit).toBe(60);
    expect(beef.gCo2e).toBe(300_000);
  });

  it('tracks a target and paces it across the year', async () => {
    h = await makeHarness();
    const year = today().slice(0, 4);
    await h.api('PUT', `/api/v1/carbon/target/${year}`, { gCo2e: '10 t' });
    await h.api('POST', '/api/v1/carbon/activities', { type: 'heating_oil', amount: 200, unit: 'gal' });

    const target = await h.api('GET', `/api/v1/carbon/target/${year}`);
    expect(target.gCo2e).toBe(10 * TONNE);
    expect(target.months).toHaveLength(12);
    expect(target.months.reduce((a: number, m: any) => a + m.budgeted, 0)).toBe(10 * TONNE);
    // Winter carries more of the budget than midsummer.
    expect(target.months[0].budgeted).toBeGreaterThan(target.months[6].budgeted);
    expect(target.pct).toBeGreaterThan(0);
  });
});

describe('food and waste carry a footprint (GHG-010, GHG-011)', () => {
  it('books embodied carbon when the shopping is put away', async () => {
    h = await makeHarness();
    const home = await makeHome(h);
    const beef = await h.api('POST', '/api/v1/products', {
      name: 'Ground beef', defaultUnit: 'lb', emissionFactorKey: 'food.beef',
    });
    const list = await h.api('POST', '/api/v1/shopping-lists', { name: 'Grocery', isDefault: true });
    const line = await h.api('POST', `/api/v1/shopping-lists/${list.id}/lines`, {
      productId: beef.id, quantity: 2,
    });

    const res = await h.api('POST', `/api/v1/shopping-lists/${list.id}/put-away`, {
      items: [{ lineId: line.id, quantity: 2, locationId: home.pantryId }],
      transaction: { total: 1_800, payeeName: 'Shaws' },
    });
    // Two pounds of beef is about a kilogram, at 60 kg CO2e per kilogram.
    expect(res.embodiedGCo2e).toBeCloseTo(54_431, -3);

    const activities = await h.api('GET', '/api/v1/carbon/activities');
    expect(activities.items[0].transactionId).toBe(res.transactionId);
  });

  it('counts binned food as wasted carbon, not just wasted money', async () => {
    h = await makeHarness();
    const home = await makeHome(h);
    const beef = await h.api('POST', '/api/v1/products', {
      name: 'Ground beef', defaultUnit: 'lb', emissionFactorKey: 'food.beef',
    });
    const lot = await h.api('POST', '/api/v1/stock', {
      productId: beef.id, quantity: 1, unit: 'lb', locationId: home.pantryId, unitPrice: 900,
    });
    const res = await h.api('POST', `/api/v1/stock/${lot.id}/adjust`, {
      action: 'waste', quantity: 1, wasteReason: 'spoiled',
    });
    expect(res.wastedGCo2e).toBeGreaterThan(20_000);

    const report = await h.api('GET', '/api/v1/food/waste');
    expect(report.totalCost).toBe(900);
    expect(report.totalGCo2e).toBe(res.wastedGCo2e);
  });

  it('inherits a factor from the product category when the product has none', async () => {
    h = await makeHarness();
    const cats = await h.api('GET', '/api/v1/product-categories?limit=200');
    const meat = cats.items.find((c: any) => c.slug === 'meat-seafood');
    expect(meat.emissionFactorKey).toBe('food.poultry');

    const home = await makeHome(h);
    const chicken = await h.api('POST', '/api/v1/products', {
      name: 'Chicken thighs', defaultUnit: 'kg', categoryId: meat.id,
    });
    const list = await h.api('POST', '/api/v1/shopping-lists', { name: 'Grocery', isDefault: true });
    const line = await h.api('POST', `/api/v1/shopping-lists/${list.id}/lines`, {
      productId: chicken.id, quantity: 1,
    });
    const res = await h.api('POST', `/api/v1/shopping-lists/${list.id}/put-away`, {
      items: [{ lineId: line.id, quantity: 1, locationId: home.pantryId }],
    });
    expect(res.embodiedGCo2e).toBe(9_900);
  });
});

describe('interventions (GHG-019/020/021)', () => {
  async function houseWithOil() {
    h = await makeHarness();
    const home = await makeHome(h);
    // A year of oil, and a year of electricity bills to price the replacement.
    for (let i = 0; i < 4; i++) {
      const tx = await h.api('POST', '/api/v1/transactions', {
        amount: 65_000, payeeName: 'Valley Fuel', date: shift(-30 * i * 3),
      });
      await h.api('POST', '/api/v1/carbon/activities', {
        type: 'heating_oil', amount: 200, unit: 'gal',
        occurredOn: shift(-30 * i * 3), transactionId: tx.id,
      });
    }
    for (let i = 0; i < 12; i++) {
      const tx = await h.api('POST', '/api/v1/transactions', {
        amount: 17_000, payeeName: 'Power Co', date: shift(-30 * i),
      });
      await h.api('POST', '/api/v1/carbon/activities', {
        type: 'electricity', amount: 850, unit: 'kwh',
        occurredOn: shift(-30 * i), transactionId: tx.id,
      });
    }
    return home;
  }

  it('computes the saving from what this house actually burns', async () => {
    await houseWithOil();
    const res = await h.api('GET', '/api/v1/carbon/interventions/candidates');
    const heatPump = res.items.find((i: any) => i.key === 'heat_pump');
    expect(heatPump.estimate.basis).toBe('measured');
    expect(heatPump.estimate.basisNote).toMatch(/800 gal of heating oil/);
    expect(heatPump.estimate.annualSavingGCo2e).toBeGreaterThan(4 * TONNE);
    expect(heatPump.payback.carbonYears).toBeLessThan(1);
    expect(res.electricityPricePerKwh).toBeGreaterThan(0);
  });

  it('says plainly when it is guessing', async () => {
    h = await makeHarness();
    const res = await h.api('GET', '/api/v1/carbon/interventions/candidates');
    const heatPump = res.items.find((i: any) => i.key === 'heat_pump');
    expect(heatPump.estimate.basis).toBe('estimated');
    expect(heatPump.estimate.basisNote).toMatch(/No measured heating oil use yet/);
    expect(heatPump.estimate.annualSavingGCo2e).toBe(0);
  });

  it('ranks by the cost of abatement', async () => {
    await houseWithOil();
    const res = await h.api('GET', '/api/v1/carbon/interventions/candidates');
    const costs = res.items
      .map((i: any) => i.payback.costPerTonne)
      .filter((c: number | null) => c != null);
    expect(costs).toEqual([...costs].sort((a, b) => a - b));
  });

  it('accepting one puts it in the project backlog with its numbers', async () => {
    const home = await houseWithOil();
    const created = await h.api('POST', '/api/v1/carbon/interventions', {
      templateKey: 'heat_pump', propertyId: home.propertyId,
    });
    expect(created.basis).toBe('measured');

    const accepted = await h.api('POST', `/api/v1/carbon/interventions/${created.id}/accept`, {});
    expect(accepted.projectId).toBeTruthy();

    const backlog = await h.api('GET', '/api/v1/projects/backlog');
    expect(backlog.items).toHaveLength(1);
    expect(backlog.items[0].name).toBe('Air-source heat pump');
    expect(backlog.items[0].estimateCost).toBe(1_400_000);
    expect(backlog.items[0].descriptionMd).toMatch(/Expected saving/);

    // And so it reaches the ten-year plan alongside the roof.
    const plan = await h.api('GET', '/api/v1/budget/long-range?years=10');
    const labels = plan.years.flatMap((y: any) => y.items.map((i: any) => i.label));
    expect(labels).toContain('Air-source heat pump');
  });
});

describe('renovation carries embodied carbon (GHG-012)', () => {
  it('estimates before purchase and records on purchase', async () => {
    h = await makeHarness();
    const home = await makeHome(h);
    const project = await h.api('POST', '/api/v1/projects', {
      propertyId: home.propertyId, name: 'Bathroom', budgetAmount: 1_000_000,
    });
    const tile = await h.api('POST', '/api/v1/project-materials', {
      projectId: project.id, description: 'Floor tile', quantity: 60, unit: 'ea',
      estUnitCost: 480, emissionFactorKey: 'material.tile', unitMassKg: 3.4,
    });

    const before = await h.api('GET', `/api/v1/projects/${project.id}/overview`);
    expect(before.carbon.estimatedGCo2e).toBe(Math.round(60 * 3.4 * 0.78 * 1000));
    expect(before.carbon.embodiedGCo2e).toBe(0);

    const purchase = await h.api('POST', '/api/v1/project-materials/purchase', {
      materialIds: [tile.id], total: 28_800, payeeName: 'Hardware',
    });
    expect(purchase.embodiedGCo2e).toBe(before.carbon.estimatedGCo2e);

    const after = await h.api('GET', `/api/v1/projects/${project.id}/overview`);
    expect(after.carbon.embodiedGCo2e).toBe(purchase.embodiedGCo2e);
    expect(after.budget.spent).toBe(28_800);
  });
});

describe('refrigerant is small in mass and large in effect (GHG-013)', () => {
  it('applies the global warming potential', async () => {
    h = await makeHarness();
    const home = await makeHome(h);
    const heatPump = await h.api('POST', '/api/v1/assets', {
      propertyId: home.propertyId, name: 'Mini-split',
    });
    const res = await h.api('POST', '/api/v1/maintenance/log', {
      targetType: 'asset', targetId: heatPump.id, title: 'Top up refrigerant',
      refrigerant: { type: 'R-410A', kg: 0.4 },
    });
    expect(res.record.title).toBe('Top up refrigerant');

    const ledger = await h.api('GET', `/api/v1/ledger/asset/${heatPump.id}`);
    // 0.4 kg of R-410A is 0.4 x 2088 = 835 kg CO2e.
    expect(ledger.gCo2e).toBe(835_200);
  });
});

describe('the dashboard carries carbon beside money (GHG-023)', () => {
  it('compares this month with the same month last year', async () => {
    h = await makeHarness();
    const month = today().slice(0, 7);
    const lastYear = `${Number(month.slice(0, 4)) - 1}${month.slice(4)}`;
    await h.api('POST', '/api/v1/carbon/activities', {
      type: 'heating_oil', amount: 100, unit: 'gal', occurredOn: `${month}-01`,
    });
    await h.api('POST', '/api/v1/carbon/activities', {
      type: 'heating_oil', amount: 200, unit: 'gal', occurredOn: `${lastYear}-01`,
    });

    const dash = await h.api('GET', '/api/v1/dashboard');
    expect(dash.carbon.gCo2e).toBeGreaterThan(0);
    expect(dash.carbon.changePct).toBe(-50);
    expect(dash.carbon.byScope.length).toBeGreaterThan(0);
  });
});
