import { describe, it, expect } from 'vitest';
import {
  applyFactor, resolveFactor, formatCo2e, parseCo2eInput, payback, rankByAbatement,
  consumptionBetween, monthlyPacing, fuelEnergyMj, KG, TONNE, type EmissionFactor,
} from '../src/carbon.js';

const factor = (over: Partial<EmissionFactor> = {}): EmissionFactor => ({
  id: 'f', key: 'k', name: 'n', activityUnit: 'kwh', kgPerUnit: 0.37, scope: 2,
  region: null, validFrom: null, validTo: null, ...over,
});

describe('applying a factor', () => {
  it('multiplies and rounds to whole grams', () => {
    const { grams } = applyFactor(412, 'kwh', factor());
    expect(grams).toBe(Math.round(412 * 0.37 * 1000));
    expect(Number.isInteger(grams)).toBe(true);
  });

  it('converts the quantity into the factor unit first', () => {
    // A gas factor published per therm, a meter that reads in kWh.
    const gas = factor({ activityUnit: 'therm', kgPerUnit: 5.3, scope: 1 });
    const { grams, quantityInFactorUnit } = applyFactor(293.001, 'kwh', gas);
    expect(quantityInFactorUnit).toBeCloseTo(10, 2);
    expect(grams).toBeCloseTo(53_000, -2);
  });

  it('converts pounds to kilograms for a food factor', () => {
    const beef = factor({ activityUnit: 'kg', kgPerUnit: 60, scope: 3 });
    const { grams } = applyFactor(2, 'lb', beef);
    expect(grams).toBe(Math.round(0.90718474 * 60 * 1000));
  });

  it('refuses a dimensional mismatch rather than guessing', () => {
    const perKg = factor({ activityUnit: 'kg', kgPerUnit: 1 });
    expect(() => applyFactor(1, 'l', perKg)).toThrow(/Cannot apply a factor measured per kg/);
  });
});

describe('choosing a factor', () => {
  const candidates: EmissionFactor[] = [
    factor({ id: 'global', kgPerUnit: 0.44, region: null }),
    factor({ id: 'us', kgPerUnit: 0.37, region: 'US' }),
    factor({ id: 'us-2020', kgPerUnit: 0.42, region: 'US', validFrom: '2020-01-01', validTo: '2022-12-31' }),
  ];

  it('prefers the household region over the global default', () => {
    expect(resolveFactor(candidates, { on: '2026-03-01', region: 'US' })?.id).toBe('us');
  });

  it('falls back to the global default for an unknown region', () => {
    expect(resolveFactor(candidates, { on: '2026-03-01', region: 'NZ' })?.id).toBe('global');
  });

  it('honours the validity window', () => {
    expect(resolveFactor(candidates, { on: '2021-06-01', region: 'US' })?.id).toBe('us-2020');
  });

  it('returns null when nothing applies', () => {
    const expired = [factor({ validTo: '2020-01-01' })];
    expect(resolveFactor(expired, { on: '2026-01-01' })).toBeNull();
  });
});

describe('formatting', () => {
  it('scales to a unit a person can hold in their head', () => {
    expect(formatCo2e(820)).toBe('820 g');
    expect(formatCo2e(12 * KG)).toBe('12 kg');
    expect(formatCo2e(2.4 * TONNE)).toBe('2.4 t');
    expect(formatCo2e(1.5 * KG * 1000)).toBe('1.5 t');
    expect(formatCo2e(null)).toBe('—');
  });
  it('parses what a person types', () => {
    expect(parseCo2eInput('2.4t')).toBe(2_400_000);
    expect(parseCo2eInput('500 kg')).toBe(500_000);
    expect(parseCo2eInput('900')).toBe(900_000); // kg is the natural default
    expect(parseCo2eInput('rubbish')).toBeNull();
  });
});

describe('payback', () => {
  it('answers both questions for a heat pump', () => {
    const result = payback({
      capitalCost: 1_400_000,          // $14,000
      embodiedGrams: 1.9 * TONNE,
      annualSavingCost: 90_000,        // $900 a year
      annualSavingGrams: 11.7 * TONNE,
      lifetimeYears: 18,
    });
    expect(result.financialYears).toBeCloseTo(15.56, 1);
    expect(result.carbonYears).toBeCloseTo(0.16, 2);
    expect(result.lifetimeSavingGrams).toBe(11.7 * TONNE * 18);
    expect(result.costPerTonne).toBeLessThan(0); // it pays for itself over its life
  });

  it('reports null rather than infinity when nothing is saved', () => {
    const result = payback({
      capitalCost: 100_000, embodiedGrams: 500_000,
      annualSavingCost: 0, annualSavingGrams: 0,
    });
    expect(result.financialYears).toBeNull();
    expect(result.carbonYears).toBeNull();
    expect(result.costPerTonne).toBeNull();
  });

  it('ranks the cheapest abatement first and puts unknowns last', () => {
    const mk = (costPerTonne: number | null) => ({ payback: { costPerTonne } as any });
    const ranked = rankByAbatement([mk(300), mk(null), mk(-50), mk(120)]);
    expect(ranked.map((r) => r.payback.costPerTonne)).toEqual([-50, 120, 300, null]);
  });
});

describe('meter readings', () => {
  it('differences two readings', () => {
    expect(consumptionBetween({ value: 10_420 }, { value: 10_832 })).toBe(412);
  });
  it('applies a meter multiplier', () => {
    expect(consumptionBetween({ value: 100 }, { value: 110 }, { multiplier: 10 })).toBe(100);
  });
  it('handles a rollover instead of reporting a negative', () => {
    expect(consumptionBetween({ value: 99_800 }, { value: 300 }, { rolloverAt: 100_000 })).toBe(500);
  });
  it('refuses to guess when a meter goes backwards with no rollover set', () => {
    expect(consumptionBetween({ value: 500 }, { value: 300 })).toBeNull();
  });
  it('does not difference across a meter replacement', () => {
    expect(consumptionBetween({ value: 9_000, meterId: 'a' }, { value: 12, meterId: 'b' })).toBeNull();
  });
  it('has nothing to say about the first reading', () => {
    expect(consumptionBetween(null, { value: 100 })).toBeNull();
  });
});

describe('budget pacing', () => {
  it('splits a year into months that add back up', () => {
    const months = monthlyPacing(10 * TONNE);
    expect(months).toHaveLength(12);
    expect(months.reduce((a, b) => a + b, 0)).toBe(10 * TONNE);
  });
  it('weights the heating season more heavily and still adds up', () => {
    const weights = [1.6, 1.5, 1.2, 0.9, 0.7, 0.6, 0.6, 0.6, 0.7, 0.9, 1.3, 1.6];
    const months = monthlyPacing(7 * TONNE + 13, weights);
    expect(months.reduce((a, b) => a + b, 0)).toBe(7 * TONNE + 13);
    expect(months[0]!).toBeGreaterThan(months[6]!);
  });
});

describe('fuel energy content', () => {
  it('passes energy units straight through', () => {
    expect(fuelEnergyMj(10, 'therm', 'natural_gas')).toBeCloseTo(1054.8, 1);
    expect(fuelEnergyMj(100, 'kwh', 'electricity')).toBeCloseTo(360, 6);
  });
  it('bridges volume to energy for fuels sold by the gallon', () => {
    expect(fuelEnergyMj(1, 'gal', 'heating_oil')).toBeCloseTo(146.1, 1);
    expect(fuelEnergyMj(2, 'gal', 'propane')).toBeCloseTo(193, 1);
  });
  it('converts into the density unit first', () => {
    // Four quarts is a gallon.
    expect(fuelEnergyMj(4, 'qt', 'heating_oil')).toBeCloseTo(146.1, 1);
  });
  it('gives up rather than guessing for an unknown fuel', () => {
    expect(fuelEnergyMj(1, 'gal', 'unicorn_tears')).toBeNull();
  });
});
