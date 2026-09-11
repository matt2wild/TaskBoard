import { describe, it, expect, afterEach } from 'vitest';
import { makeHarness, makeHome, shift, today, type Harness } from './helpers.js';

let h: Harness;
afterEach(async () => { await h?.close(); });

/** Frost dates make the sowing advice mean something. */
async function setUpGarden(): Promise<{ bedId: string; pantryId: string }> {
  const home = await makeHome(h);
  await h.api('PUT', '/api/v1/garden/frost-dates', { lastSpring: '05-12', firstAutumn: '10-08' });
  const bed = await h.api('POST', '/api/v1/garden/beds', {
    name: 'Bed 4', method: 'raised', areaSqft: 32, sun: 'full',
  });
  return { bedId: bed.id, pantryId: home.pantryId };
}

const varietyNamed = async (name: string, cultivar?: string) => {
  const res = await h.api('GET', '/api/v1/garden/varieties?limit=200');
  return res.items.find((v: any) => v.name === name && (!cultivar || v.cultivar === cultivar));
};

describe('the seed drawer (GARD-008, GARD-009, GARD-010)', () => {
  it('ships a variety library with the botanical family rotation needs', async () => {
    h = await makeHarness();
    const res = await h.api('GET', '/api/v1/garden/varieties?limit=200');
    expect(res.items.length).toBeGreaterThan(20);
    expect(res.items.every((v: any) => v.family)).toBe(true);
    const tomato = res.items.find((v: any) => v.cultivar === 'Amish Paste');
    expect(tomato.family).toBe('Solanaceae');
    expect(tomato.openPollinated).toBe(true);
    const sungold = res.items.find((v: any) => v.cultivar === 'Sungold');
    expect(sungold.openPollinated).toBe(false);
  });

  it('ages a lot in seasons and flags the ones past their viability', async () => {
    h = await makeHarness();
    await setUpGarden();
    const parsnip = await varietyNamed('Parsnip');
    expect(parsnip.seedViabilityYears).toBe(1);

    await h.api('POST', '/api/v1/garden/seeds', {
      varietyId: parsnip.id, quantity: 200, yearPacked: Number(today().slice(0, 4)) - 3,
    });
    const drawer = await h.api('GET', '/api/v1/garden/seeds');
    const lot = drawer.items[0];
    expect(lot.viability.seasons).toBe(3);
    expect(lot.viability.status).toBe('past');
    expect(lot.viability.note).toMatch(/germination test/i);
  });

  it('lets a germination test beat the calendar', async () => {
    h = await makeHarness();
    await setUpGarden();
    const parsnip = await varietyNamed('Parsnip');
    const lot = await h.api('POST', '/api/v1/garden/seeds', {
      varietyId: parsnip.id, quantity: 200, yearPacked: Number(today().slice(0, 4)) - 3,
    });
    const tested = await h.api('POST', `/api/v1/garden/seeds/${lot.id}/germination-test`, {
      tested: 20, germinated: 17,
    });
    // A tested old lot is worth more than an untested new one.
    expect(tested.germinationRate).toBe(0.85);
    expect(tested.viability.status).toBe('good');
    expect(tested.viability.note).toMatch(/85%/);
  });

  it('advises on the sowing window from the household own frost dates', async () => {
    h = await makeHarness();
    await setUpGarden();
    const tomato = await varietyNamed('Tomato', 'Amish Paste');
    // Eight to four weeks before a 12 May frost is mid-March to mid-April.
    expect(tomato.sow.opensOn).toBe(`${today().slice(0, 4)}-03-17`);
    expect(tomato.sow.closesOn).toBe(`${today().slice(0, 4)}-04-14`);
    expect(['too_early', 'open', 'closing', 'too_late']).toContain(tomato.sow.verdict);
  });
});

describe('plantings and rotation (GARD-004, GARD-012, GARD-013)', () => {
  it('warns when the same family goes back in the same ground', async () => {
    h = await makeHarness();
    const { bedId } = await setUpGarden();
    const tomato = await varietyNamed('Tomato', 'Amish Paste');
    const pepper = await varietyNamed('Pepper');

    await h.api('POST', '/api/v1/garden/plantings', {
      varietyId: tomato.id, bedId, sownOn: shift(-30),
    });
    // Peppers are Solanaceae too, which is exactly the trap.
    const check = await h.api('GET', `/api/v1/garden/rotation-check?bedId=${bedId}&varietyId=${pepper.id}`);
    expect(check.conflict).not.toBeNull();
    expect(check.conflict.family).toBe('Solanaceae');
    expect(check.conflict.variety).toMatch(/Amish Paste/);

    // A different family is fine.
    const bean = await varietyNamed('Bush bean');
    const ok = await h.api('GET', `/api/v1/garden/rotation-check?bedId=${bedId}&varietyId=${bean.id}`);
    expect(ok.conflict).toBeNull();
  });

  it('generates the work a planting implies, dated from days to maturity', async () => {
    h = await makeHarness();
    const { bedId } = await setUpGarden();
    const tomato = await varietyNamed('Tomato', 'Amish Paste');
    const res = await h.api('POST', '/api/v1/garden/plantings', {
      varietyId: tomato.id, bedId, method: 'indoor', sownOn: shift(-10), quantity: 12,
    });
    const planting = res.items[0];
    // Six weeks under cover, then eighty days to maturity from transplant.
    expect(planting.schedule.transplantOn).toBe(shift(32));
    expect(planting.schedule.hardenOffOn).toBe(shift(22));
    expect(planting.expectedHarvestOn).toBe(shift(112));

    const tasks = await h.api('GET', '/api/v1/tasks?limit=100');
    const titles = tasks.items.map((t: any) => t.title);
    expect(titles.some((t: string) => /Harden off/.test(t))).toBe(true);
    expect(titles.some((t: string) => /Transplant/.test(t))).toBe(true);
    expect(titles.some((t: string) => /First harvest expected/.test(t))).toBe(true);
  });

  it('sows a succession as separate plantings, not one vague entry', async () => {
    h = await makeHarness();
    const { bedId } = await setUpGarden();
    const lettuce = await varietyNamed('Lettuce');
    const res = await h.api('POST', '/api/v1/garden/plantings', {
      varietyId: lettuce.id, bedId, sownOn: today(), quantity: 10,
      succession: { everyDays: 14, count: 4 },
    });
    expect(res.items).toHaveLength(4);
    expect(res.items.map((p: any) => p.sownOn)).toEqual([today(), shift(14), shift(28), shift(42)]);
  });

  it('decrements the lot it was sown from', async () => {
    h = await makeHarness();
    const { bedId } = await setUpGarden();
    const bean = await varietyNamed('Bush bean');
    const lot = await h.api('POST', '/api/v1/garden/seeds', { varietyId: bean.id, quantity: 100 });
    await h.api('POST', '/api/v1/garden/plantings', {
      varietyId: bean.id, bedId, seedLotId: lot.id, quantity: 30,
    });
    const drawer = await h.api('GET', '/api/v1/garden/seeds');
    expect(drawer.items.find((l: any) => l.id === lot.id).quantity).toBe(70);
  });

  it('records why a planting failed, because a record that flatters is useless', async () => {
    h = await makeHarness();
    const { bedId } = await setUpGarden();
    const squash = await varietyNamed('Winter squash');
    const res = await h.api('POST', '/api/v1/garden/plantings', { varietyId: squash.id, bedId });
    await h.api('PATCH', `/api/v1/garden/plantings/${res.items[0].id}`, {
      status: 'failed', failureReason: 'Squash vine borer. Whole row.', removedOn: today(),
    });
    const detail = await h.api('GET', `/api/v1/garden/plantings/${res.items[0].id}`);
    expect(detail.status).toBe('failed');
    expect(detail.failureReason).toMatch(/vine borer/);
  });
});

describe('harvest reaches the pantry (GARD-018, INT-009)', () => {
  it('becomes ordinary stock, valued from the household own prices', async () => {
    h = await makeHarness();
    const { bedId, pantryId } = await setUpGarden();
    const tomato = await varietyNamed('Tomato', 'Amish Paste');
    const planting = (await h.api('POST', '/api/v1/garden/plantings', {
      varietyId: tomato.id, bedId, sownOn: shift(-90), quantity: 12,
    })).items[0];

    const res = await h.api('POST', `/api/v1/garden/plantings/${planting.id}/harvest`, {
      quantity: 8, unit: 'lb', toPantry: { locationId: pantryId },
    });
    expect(res.harvest.quantity).toBe(8);
    // $2.80 a pound from the shipped typical price, and it says so.
    expect(res.harvest.estValue).toBe(2240);
    expect(res.harvest.valueBasis).toMatch(/shipped typical price/);
    expect(res.stockItem).not.toBeNull();
    expect(res.stockItem.quantity).toBe(8);

    const stock = await h.api('GET', '/api/v1/stock?limit=50');
    expect(stock.items.some((s: any) => s.quantity === 8)).toBe(true);

    // The planting moves itself on rather than waiting to be told.
    const detail = await h.api('GET', `/api/v1/garden/plantings/${planting.id}`);
    expect(detail.status).toBe('harvesting');
    expect(detail.totals.harvested).toBe(8);
  });

  it('reports what the bought equivalent would have emitted, apart from the footprint', async () => {
    h = await makeHarness();
    const { bedId, pantryId } = await setUpGarden();
    const tomato = await varietyNamed('Tomato', 'Amish Paste');
    const planting = (await h.api('POST', '/api/v1/garden/plantings', {
      varietyId: tomato.id, bedId, sownOn: shift(-90),
    })).items[0];
    const res = await h.api('POST', `/api/v1/garden/plantings/${planting.id}/harvest`, {
      quantity: 10, unit: 'lb', toPantry: { locationId: pantryId },
    });
    expect(res.avoided).not.toBeNull();
    expect(res.avoided.counterfactual).toMatch(/not bought/);

    // Avoided, not emitted: the household footprint is untouched by it.
    const foot = await h.api('GET', `/api/v1/carbon/footprint?year=${today().slice(0, 4)}`);
    expect(foot.avoided.total100).toBeGreaterThan(0);
    expect(foot.total).toBe(0);
  });
});

describe('the seed cycle closes (CIRC-013, CIRC-014, INT-015)', () => {
  it('links saved seed back to the plant it came from, and forward again', async () => {
    h = await makeHarness();
    const { bedId } = await setUpGarden();
    const tomato = await varietyNamed('Tomato', 'Amish Paste');
    const first = (await h.api('POST', '/api/v1/garden/plantings', {
      varietyId: tomato.id, bedId, sownOn: shift(-120),
    })).items[0];

    const saved = await h.api('POST', `/api/v1/garden/plantings/${first.id}/save-seed`, {
      quantity: 60, notes: 'Best plant in the row.',
    });
    expect(saved.origin).toBe('saved');
    expect(saved.savedFromPlantingId).toBe(first.id);
    expect(saved.warning).toBeNull();

    // Sow next year from that lot, and the chain is traversable both ways.
    const second = (await h.api('POST', '/api/v1/garden/plantings', {
      varietyId: tomato.id, bedId, seedLotId: saved.id, quantity: 12,
    })).items[0];

    const backwards = await h.api('GET', `/api/v1/garden/plantings/${second.id}`);
    expect(backwards.sownFrom.id).toBe(saved.id);
    expect(backwards.sownFrom.savedFromPlantingId).toBe(first.id);

    const forwards = await h.api('GET', `/api/v1/garden/plantings/${first.id}`);
    expect(forwards.savedSeed.map((l: any) => l.id)).toContain(saved.id);
  });

  it('warns that an F1 will not come true, and saves it anyway', async () => {
    h = await makeHarness();
    const { bedId } = await setUpGarden();
    const sungold = await varietyNamed('Tomato', 'Sungold');
    const planting = (await h.api('POST', '/api/v1/garden/plantings', {
      varietyId: sungold.id, bedId, sownOn: shift(-120),
    })).items[0];

    const saved = await h.api('POST', `/api/v1/garden/plantings/${planting.id}/save-seed`, { quantity: 40 });
    expect(saved.warning).toMatch(/F1 hybrid/);
    expect(saved.warning).toMatch(/will not come true/);
    // Saved regardless: plenty of people do it on purpose.
    expect(saved.id).toBeTruthy();
    expect(saved.quantity).toBe(40);
  });

  it('reports seed self-sufficiency', async () => {
    h = await makeHarness();
    const { bedId } = await setUpGarden();
    const bean = await varietyNamed('Bush bean');
    const bought = await h.api('POST', '/api/v1/garden/seeds', {
      varietyId: bean.id, quantity: 100, origin: 'bought',
    });
    const swapped = await h.api('POST', '/api/v1/garden/seeds', {
      varietyId: bean.id, quantity: 50, origin: 'swapped',
    });
    await h.api('POST', '/api/v1/garden/plantings', { varietyId: bean.id, bedId, seedLotId: bought.id, quantity: 10 });
    await h.api('POST', '/api/v1/garden/plantings', { varietyId: bean.id, bedId, seedLotId: swapped.id, quantity: 10 });

    const res = await h.api('GET', '/api/v1/circularity');
    expect(res.seeds.total).toBe(2);
    expect(res.seeds.circular).toBe(1);
    expect(res.seeds.pct).toBe(50);
  });
});

describe('the garden overview', () => {
  it('says what is growing and what the year came to', async () => {
    h = await makeHarness();
    const { bedId, pantryId } = await setUpGarden();
    const chard = await varietyNamed('Chard');
    const planting = (await h.api('POST', '/api/v1/garden/plantings', {
      varietyId: chard.id, bedId, sownOn: shift(-60),
    })).items[0];
    await h.api('POST', `/api/v1/garden/plantings/${planting.id}/harvest`, {
      quantity: 4, unit: 'lb', toPantry: { locationId: pantryId },
    });

    const res = await h.api('GET', '/api/v1/garden/overview');
    expect(res.beds).toHaveLength(1);
    expect(res.plantings).toHaveLength(1);
    expect(res.frost.lastSpring).toBe('05-12');
    expect(res.year.harvests).toBe(1);
    expect(res.year.value).toBe(1600);
    // With no inputs recorded it says the comparison is not a real one.
    expect(res.year.note).toMatch(/no garden inputs/i);
  });
});
