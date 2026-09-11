import { describe, it, expect } from 'vitest';
import {
  plantingSchedule, rotationConflict, seedViability, sowAdvice, successionDates,
} from '../src/garden.js';
import { cnBalance, amendmentToTarget, pileStatus } from '../src/compost.js';
import { avoidedByRepair, repairOrReplace, summariseCircularity } from '../src/circular.js';

const frost = { lastSpring: '05-12', firstAutumn: '10-08' };

describe('sowing windows move with the household own climate', () => {
  it('says how many days too early, rather than printing a range', () => {
    const advice = sowAdvice(
      { anchor: 'last_spring', startWeeks: -8, endWeeks: -4 }, frost, '2026-02-01');
    expect(advice.verdict).toBe('too_early');
    expect(advice.opensOn).toBe('2026-03-17');
    expect(advice.closesOn).toBe('2026-04-14');
    expect(advice.note).toMatch(/44 days/);
  });

  it('warns when a window is closing', () => {
    const advice = sowAdvice(
      { anchor: 'last_spring', startWeeks: -8, endWeeks: -4 }, frost, '2026-04-08');
    expect(advice.verdict).toBe('closing');
    expect(advice.note).toMatch(/Last chance/);
  });

  it('says so plainly when there are no frost dates to work from', () => {
    const advice = sowAdvice(
      { anchor: 'last_spring', startWeeks: -8, endWeeks: -4 },
      { lastSpring: null, firstAutumn: null }, '2026-02-01');
    expect(advice.verdict).toBe('unknown');
    expect(advice.note).toMatch(/frost dates/);
  });

  it('anchors autumn crops to the first frost instead', () => {
    const advice = sowAdvice(
      { anchor: 'first_autumn', startWeeks: -4, endWeeks: 2 }, frost, '2026-09-20');
    expect(advice.verdict).toBe('open');
    expect(advice.opensOn).toBe('2026-09-10');
  });
});

describe('seed viability is measured in seasons, and a test beats the calendar', () => {
  it('flags a lot past the variety typical viability', () => {
    const v = seedViability({ yearPacked: 2023, germinationRate: null }, 1, '2026-03-01');
    expect(v.seasons).toBe(3);
    expect(v.status).toBe('past');
    expect(v.note).toMatch(/germination test/);
  });

  it('lets a tested old lot outrank an untested new one', () => {
    const tested = seedViability({ yearPacked: 2020, germinationRate: 0.88 }, 3, '2026-03-01');
    expect(tested.status).toBe('good');
    expect(tested.note).toMatch(/88%/);
    const untested = seedViability({ yearPacked: 2026, germinationRate: null }, null, '2026-03-01');
    expect(untested.status).toBe('unknown');
  });

  it('calls a lot ageing before it is dead', () => {
    const v = seedViability({ yearPacked: 2023, germinationRate: null }, 4, '2026-03-01');
    expect(v.status).toBe('ageing');
    expect(v.note).toMatch(/Sow thickly/);
  });
});

describe('rotation is crude, known, and therefore worth automating', () => {
  const history = [
    { family: 'Solanaceae', sownOn: '2025-05-18', variety: "Tomato 'Amish Paste'" },
    { family: 'Fabaceae', sownOn: '2024-05-02', variety: 'Bush bean' },
  ];

  it('catches the same family going back within the window', () => {
    const c = rotationConflict('Solanaceae', history, '2026-04-01');
    expect(c!.seasonsAgo).toBe(1);
    expect(c!.variety).toMatch(/Amish Paste/);
  });

  it('lets a different family through, and forgets far enough back', () => {
    expect(rotationConflict('Brassicaceae', history, '2026-04-01')).toBeNull();
    expect(rotationConflict('Fabaceae', history, '2026-04-01')).toBeNull();
    expect(rotationConflict(null, history, '2026-04-01')).toBeNull();
  });
});

describe('a planting implies its own dates', () => {
  it('counts maturity from transplant for a crop started under cover', () => {
    const s = plantingSchedule({
      method: 'indoor', sownOn: '2026-03-20', daysToMaturity: 80, indoorWeeks: 6,
    });
    expect(s.transplantOn).toBe('2026-05-01');
    expect(s.hardenOffOn).toBe('2026-04-21');
    expect(s.firstHarvestOn).toBe('2026-07-20');
  });

  it('counts from sowing for a direct sowing', () => {
    const s = plantingSchedule({ method: 'direct', sownOn: '2026-05-20', daysToMaturity: 55 });
    expect(s.transplantOn).toBeNull();
    expect(s.firstHarvestOn).toBe('2026-07-14');
  });

  it('spaces a succession and stops at the date it was given', () => {
    expect(successionDates('2026-05-01', 14, 4)).toEqual(
      ['2026-05-01', '2026-05-15', '2026-05-29', '2026-06-12']);
    expect(successionDates('2026-05-01', 14, 9, '2026-06-01')).toHaveLength(3);
  });
});

describe('a compost pile balances on the ratio of the totals', () => {
  it('is not the average of the ratios, which is the sum people get wrong', () => {
    // Twenty kilos of sawdust at 400:1 and twenty of grass at 17:1.
    const b = cnBalance([{ kg: 20, cnRatio: 400 }, { kg: 20, cnRatio: 17 }]);
    // Averaging the ratios would say 208:1. The real answer is far lower,
    // because the sawdust brings almost no nitrogen to divide by.
    expect(b.ratio).toBeGreaterThan(30);
    expect(b.ratio).toBeLessThan(45);
  });

  it('tells a nitrogen-heavy pile to add browns, and how much would fix it', () => {
    const b = cnBalance([{ kg: 30, cnRatio: 20 }]);
    expect(b.status).toBe('too_wet');
    expect(b.advice).toMatch(/ammonia/);
    const leaves = amendmentToTarget(b, 60);
    expect(leaves).toBeGreaterThan(0);
    // Adding that much really does land it in the band.
    const after = cnBalance([{ kg: 30, cnRatio: 20 }, { kg: leaves!, cnRatio: 60 }]);
    expect(after.status).toBe('good');
  });

  it('says nothing confident about an empty pile', () => {
    expect(cnBalance([]).status).toBe('unknown');
  });
});

describe('a pile is read from its temperature', () => {
  it('knows cooking from stalled from finished', () => {
    const at = (f: number) => pileStatus({
      method: 'hot_pile', latestF: f, daysSinceReading: 1, daysSinceTurn: 2,
    }).health;
    expect(at(145)).toBe('cooking');
    expect(at(115)).toBe('cooling');
    expect(at(80)).toBe('stalled');
    expect(at(50)).toBe('cold');
  });

  it('warns when a pile is running too hot to be doing itself good', () => {
    const s = pileStatus({ method: 'hot_pile', latestF: 168, daysSinceReading: 1, daysSinceTurn: 1 });
    expect(s.note).toMatch(/cooks the microbes/);
  });

  it('does not pretend a worm bin is managed by temperature', () => {
    const s = pileStatus({ method: 'worm', latestF: null, daysSinceReading: null, daysSinceTurn: 30 });
    expect(s.health).toBe('unknown');
    expect(s.turnDue).toBe(true);
  });
});

describe('repair or replace compares per year of service', () => {
  it('finds repairing cheaper and cleaner for a cheap fix on an old machine', () => {
    const v = repairOrReplace({
      repairCost: 5_400, extendedLifeYears: 4,
      replacementCost: 90_000, replacementLifeYears: 10,
      replacementEmbodiedGCo2e: 350_000,
    });
    expect(v.repairCostPerYear).toBe(1_350);
    expect(v.replaceCostPerYear).toBe(9_000);
    expect(v.repairWins).toBe(true);
    expect(v.measuresDisagree).toBe(false);
  });

  it('names the case where money says one thing and carbon says another', () => {
    const v = repairOrReplace({
      repairCost: 60_000, extendedLifeYears: 1,
      replacementCost: 90_000, replacementLifeYears: 12,
      replacementEmbodiedGCo2e: 350_000,
    });
    expect(v.repairWins).toBe(false);
    expect(v.measuresDisagree).toBe(true);
    expect(v.note).toMatch(/judgement/);
  });

  it('pro-rates what a repair avoided rather than claiming a whole appliance', () => {
    const a = avoidedByRepair({
      extendedLifeYears: 4, replacementCost: 90_000,
      replacementLifeYears: 10, replacementEmbodiedGCo2e: 350_000,
      label: 'A mid-range dishwasher',
    });
    expect(a.gCo2e100).toBe(140_000);
    expect(a.cost).toBe(36_000);
    expect(a.counterfactual).toMatch(/40% of its embodied carbon/);
    expect(a.basis).toBe('estimated');
  });

  it('never claims more than one replacement, however long the repair bought', () => {
    const a = avoidedByRepair({
      extendedLifeYears: 30, replacementCost: 90_000,
      replacementLifeYears: 10, replacementEmbodiedGCo2e: 350_000,
    });
    expect(a.gCo2e100).toBe(350_000);
  });
});

describe('the circularity summary', () => {
  it('counts a failed repair as a repair and credits it with nothing', () => {
    const s = summariseCircularity({
      repairs: [
        { outcome: 'fixed', avoidedCost: 36_000, avoidedGCo2e: 140_000 },
        { outcome: 'failed', avoidedCost: null, avoidedGCo2e: null },
      ],
      events: [{ kind: 'given', value: 4_000, avoidedGCo2e: null }],
    });
    expect(s.repairs).toBe(2);
    expect(s.repairsFixed).toBe(1);
    expect(s.successRate).toBe(0.5);
    expect(s.moneyAvoided).toBe(40_000);
    expect(s.gCo2eAvoided100).toBe(140_000);
    expect(s.itemsCirculated).toBe(1);
  });
});
