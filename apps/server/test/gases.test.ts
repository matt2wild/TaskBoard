import { describe, it, expect, afterEach } from 'vitest';
import { makeHarness, makeHome, today, type Harness } from './helpers.js';

let h: Harness;
afterEach(async () => { await h?.close(); });

const KG = 1_000;

describe('gases, not just their equivalence (GHG-031, GHG-032)', () => {
  it('ships a registry with both horizons and says where the values came from', async () => {
    h = await makeHarness();
    const res = await h.api('GET', '/api/v1/carbon/gases');
    const ch4 = res.items.find((g: any) => g.key === 'ch4_fossil');
    expect(ch4.gwp100).toBe(29.8);
    expect(ch4.gwp20).toBe(82.5);
    expect(ch4.source).toMatch(/AR6/);
    // The whole reason to track methane separately.
    expect(ch4.horizonRatio).toBeGreaterThan(2.5);

    const co2 = res.items.find((g: any) => g.key === 'co2');
    expect(co2.gwp100).toBe(1);
    expect(co2.gwp20).toBe(1);

    // Nitrous oxide is long-lived, so the horizon barely moves it.
    const n2o = res.items.find((g: any) => g.key === 'n2o');
    expect(n2o.horizonRatio).toBe(1);
  });

  it('records one row per gas, each with the mass of the gas itself', async () => {
    h = await makeHarness();
    const res = await h.api('POST', '/api/v1/carbon/activities', {
      type: 'natural_gas', amount: 100, unit: 'therm',
    });
    const combustion = res.emissions.filter((e: any) => e.factorKey === 'gas.combustion');
    expect(combustion.map((e: any) => e.gas).sort()).toEqual(['ch4_fossil', 'co2', 'n2o']);

    const co2 = combustion.find((e: any) => e.gas === 'co2');
    // 100 therms at 5.306 kg of CO2 each, in milligrams.
    expect(co2.massMg).toBe(530_600_000);
    expect(co2.gCo2e).toBe(530_600);
    expect(co2.gwp).toBe(1);

    const ch4 = combustion.find((e: any) => e.gas === 'ch4_fossil');
    expect(ch4.massMg).toBe(10_000);       // 0.01 kg of methane
    expect(ch4.gwp).toBe(29.8);
    expect(ch4.gCo2e).toBe(298);
    expect(ch4.gwpHorizon).toBe(100);
  });

  it('records a factor with no published composition as an unspecified mixture', async () => {
    h = await makeHarness();
    const home = await makeHome(h);
    const product = await h.api('POST', '/api/v1/products', {
      name: 'Coffee', defaultUnit: 'kg', emissionFactorKey: 'food.coffee',
    });
    await h.api('POST', '/api/v1/stock', {
      productId: product.id, quantity: 1, unit: 'kg', locationId: home.pantryId,
    });
    const res = await h.api('POST', '/api/v1/carbon/activities', {
      type: 'food', amount: 1, unit: 'kg', factorKey: 'food.coffee',
    });
    // Poore & Nemecek publish a CO2e figure and no split, so the system does
    // not invent one — it says the number is a mixture.
    expect(res.emissions).toHaveLength(1);
    expect(res.emissions[0].gas).toBe('co2e');
    expect(res.emissions[0].gCo2e).toBe(28_500);
  });

  it('splits beef into its enteric methane, because that is where beef is', async () => {
    h = await makeHarness();
    const res = await h.api('POST', '/api/v1/carbon/activities', {
      type: 'food', amount: 10, unit: 'kg', factorKey: 'food.beef',
    });
    const byGas = Object.fromEntries(res.byGas.map((g: any) => [g.gas, g.gCo2e]));
    expect(Object.keys(byGas).sort()).toEqual(['ch4_bio', 'co2', 'n2o']);
    // Roughly a third of beef's footprint is methane from the animal.
    expect(byGas.ch4_bio / res.gCo2e).toBeGreaterThan(0.3);
  });
});

describe('the horizon is a reading, never a rewrite (GHG-034)', () => {
  it('reports the same stored record at either horizon', async () => {
    h = await makeHarness();
    await h.api('POST', '/api/v1/carbon/activities', {
      type: 'waste', amount: 100, unit: 'kg', factorKey: 'waste.food_landfill',
      occurredOn: today(),
    });

    const at100 = await h.api('GET', `/api/v1/carbon/footprint?year=${today().slice(0, 4)}&horizon=100`);
    const at20 = await h.api('GET', `/api/v1/carbon/footprint?year=${today().slice(0, 4)}&horizon=20`);

    expect(at100.horizon).toBe(100);
    expect(at20.horizon).toBe(20);
    // Landfill is nearly all biogenic methane, so twenty years is far worse.
    expect(at20.total / at100.total).toBeGreaterThan(2.5);

    // Nothing was written: the stored gas masses are identical either way.
    const ch4At100 = at100.gases.find((g: any) => g.gas === 'ch4_bio');
    const ch4At20 = at20.gases.find((g: any) => g.gas === 'ch4_bio');
    expect(ch4At20.massMg).toBe(ch4At100.massMg);
    expect(ch4At20.total).toBeGreaterThan(ch4At100.total);
  });

  it('says how much of a total could be re-read at all', async () => {
    h = await makeHarness();
    // Coffee has no published split, so it cannot move with the horizon.
    await h.api('POST', '/api/v1/carbon/activities', {
      type: 'food', amount: 10, unit: 'kg', factorKey: 'food.coffee',
    });
    const res = await h.api('GET', `/api/v1/carbon/footprint?year=${today().slice(0, 4)}`);
    expect(res.atOtherHorizon.reEvaluablePct).toBe(0);
    expect(res.atOtherHorizon.ratio).toBe(1);
    expect(res.gases[0].gas).toBe('co2e');
  });

  it('breaks a footprint down by gas with its share of the total', async () => {
    h = await makeHarness();
    await h.api('POST', '/api/v1/carbon/activities', { type: 'natural_gas', amount: 200, unit: 'therm' });
    const res = await h.api('GET', `/api/v1/carbon/footprint?year=${today().slice(0, 4)}`);
    const co2 = res.gases.find((g: any) => g.gas === 'co2');
    expect(co2.pct).toBeGreaterThan(80);
    expect(res.gases.every((g: any) => g.name)).toBe(true);
    const ch4 = res.gases.find((g: any) => g.gas === 'ch4_fossil');
    expect(ch4.horizonSensitive).toBe(true);
  });

  it('is an editorial choice, recorded with its reason', async () => {
    h = await makeHarness();
    const res = await h.api('PUT', '/api/v1/carbon/horizon', {
      horizon: 20, reason: 'We care about the next twenty years, not the next hundred.',
    });
    expect(res.horizon).toBe(20);
    expect(res.note).toMatch(/methane-heavy/i);
    const gases = await h.api('GET', '/api/v1/carbon/gases');
    expect(gases.horizon).toBe(20);
  });
});

describe('refrigerant is a gas, and benefits most from being one', () => {
  it('re-reads a leak at twenty years without a second factor', async () => {
    h = await makeHarness();
    await h.api('POST', '/api/v1/carbon/activities', {
      type: 'refrigerant', amount: 1, unit: 'kg', factorKey: 'refrigerant.r410a',
    });
    const at100 = await h.api('GET', `/api/v1/carbon/footprint?year=${today().slice(0, 4)}&horizon=100`);
    const at20 = await h.api('GET', `/api/v1/carbon/footprint?year=${today().slice(0, 4)}&horizon=20`);
    expect(at100.total).toBe(2256 * KG);
    expect(at20.total).toBe(4715 * KG);
    expect(at100.gases[0].gas).toBe('r410a');
    expect(at100.gases[0].massMg).toBe(1_000_000);
  });
});
