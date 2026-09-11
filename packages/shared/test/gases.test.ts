import { describe, it, expect } from 'vitest';
import {
  GASES, gwpFor, horizonSensitivity, isHorizonSensitive, sumByGas, toCo2e, totalCo2e,
  vectorToKgCo2e, formatGasMass,
} from '../src/gases.js';
import { applyFactorGases } from '../src/carbon.js';

describe('the gas registry', () => {
  it('gives methane a twenty-year potential far above its hundred-year one', () => {
    expect(GASES.ch4_fossil!.gwp100).toBe(29.8);
    expect(GASES.ch4_fossil!.gwp20).toBe(82.5);
    expect(isHorizonSensitive('ch4_fossil')).toBe(true);
    // Nitrous oxide outlives the twenty-year window, so it barely moves.
    expect(isHorizonSensitive('n2o')).toBe(false);
    expect(isHorizonSensitive('co2')).toBe(false);
  });

  it('distinguishes fossil methane from biogenic, which is not pedantry', () => {
    // Fossil methane oxidises to fossil CO2, so it carries slightly more.
    expect(GASES.ch4_fossil!.gwp100).toBeGreaterThan(GASES.ch4_bio!.gwp100);
    expect(GASES.ch4_bio!.biogenic).toBe(true);
  });

  it('returns null for a gas it does not know rather than assuming carbon dioxide', () => {
    // Silently treating an unknown gas as CO2 would understate it by whatever
    // factor it actually is, which for a refrigerant is thousands.
    expect(gwpFor('nonsense')).toBeNull();
    expect(gwpFor('r410a', 20)).toBe(4715);
  });
});

describe('equivalence is derived, never stored on the way in', () => {
  it('converts the same masses differently at each horizon', () => {
    const masses = [
      { gas: 'co2', massMg: 1_000_000 },      // 1 kg
      { gas: 'ch4_bio', massMg: 100_000 },    // 100 g
    ];
    expect(totalCo2e(masses, 100)).toBe(1000 + 2700);
    expect(totalCo2e(masses, 20)).toBe(1000 + 7970);
    // A pile of mostly methane roughly triples over the shorter horizon.
    expect(horizonSensitivity(masses)).toBeCloseTo(8970 / 3700, 2);
  });

  it('leaves an unspecified mixture alone, because it cannot be re-read', () => {
    const mixed = [{ gas: 'co2e', massMg: 5_000_000 }];
    expect(totalCo2e(mixed, 100)).toBe(5000);
    expect(totalCo2e(mixed, 20)).toBe(5000);
    expect(horizonSensitivity(mixed)).toBe(1);
  });

  it('sums by gas across many emissions', () => {
    const summed = sumByGas([
      { gas: 'co2', massMg: 100 }, { gas: 'ch4_bio', massMg: 5 }, { gas: 'co2', massMg: 200 },
    ]);
    expect(summed).toEqual([{ gas: 'co2', massMg: 300 }, { gas: 'ch4_bio', massMg: 5 }]);
  });

  it('reports each gas with the potential it was given', () => {
    const [co2, ch4] = toCo2e(
      [{ gas: 'co2', massMg: 1_000_000 }, { gas: 'ch4_fossil', massMg: 1_000_000 }], 20,
    );
    expect(co2!.gwp).toBe(1);
    expect(ch4!.gwp).toBe(82.5);
    expect(ch4!.gCo2e).toBe(82_500);
  });
});

describe('applying a factor as a vector of gases', () => {
  const gasFactor = {
    activityUnit: 'therm', kgPerUnit: 5.31,
    gases: { co2: 5.306, ch4_fossil: 0.0001, n2o: 0.00001 },
  };

  it('produces one amount per gas, in milligrams of the gas itself', () => {
    const res = applyFactorGases(100, 'therm', gasFactor);
    expect(res.gases.map((g) => g.gas)).toEqual(['co2', 'ch4_fossil', 'n2o']);
    expect(res.gases[0]!.massMg).toBe(530_600_000);
    expect(res.totalGCo2e).toBe(530_600 + 298 + 273);
  });

  it('keeps trace gases honest, which whole grams would not', () => {
    // 0.67 g of nitrous oxide is 184 g of CO2e. Rounded to a whole gram it
    // would read 273 — half again as much, on a gas with a potential of 273.
    const trace = { activityUnit: 'kwh', kgPerUnit: 0.371, gases: { n2o: 0.0000005 } };
    const res = applyFactorGases(1350, 'kwh', trace);
    expect(res.gases[0]!.massMg).toBe(675);
    expect(res.gases[0]!.gCo2e).toBe(184);
  });

  it('falls back to an unspecified mixture when the source published no split', () => {
    const res = applyFactorGases(2, 'kg', { activityUnit: 'kg', kgPerUnit: 28.5, gases: null });
    expect(res.gases).toHaveLength(1);
    expect(res.gases[0]!.gas).toBe('co2e');
    expect(res.totalGCo2e).toBe(57_000);
  });

  it('converts the quantity into the factor unit before splitting', () => {
    const res = applyFactorGases(293.001, 'kwh', gasFactor);
    expect(res.quantityInFactorUnit).toBeCloseTo(10, 2);
    expect(res.totalGCo2e).toBeCloseTo(53_100, -2);
  });

  it('keeps a vector and its headline figure in step', () => {
    expect(vectorToKgCo2e(gasFactor.gases, 100)).toBeCloseTo(5.31, 2);
  });
});

describe('formatting a gas mass', () => {
  it('never shows a mass of gas as though it were a mass of CO2e', () => {
    expect(formatGasMass(675)).toBe('675 mg');
    expect(formatGasMass(45_000)).toBe('45 g');
    expect(formatGasMass(2_400_000)).toBe('2 kg');
    expect(formatGasMass(3_500_000_000)).toBe('3.5 t');
    expect(formatGasMass(null)).toBe('—');
  });
});
