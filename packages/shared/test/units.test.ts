import { describe, it, expect } from 'vitest';
import { parseQuantity, parseDimensions, convert, areCompatible, normaliseUnit, formatQuantity } from '../src/units.js';

describe('quantity parsing', () => {
  it('handles the ways people write amounts', () => {
    expect(parseQuantity('2.5 kg')).toEqual({ value: 2.5, unit: 'kg' });
    expect(parseQuantity('750ml')).toEqual({ value: 750, unit: 'ml' });
    expect(parseQuantity('3')).toEqual({ value: 3, unit: 'ea' });
    expect(parseQuantity('1 1/2 cups')).toEqual({ value: 1.5, unit: 'cup' });
    expect(parseQuantity('2 cans')).toEqual({ value: 2, unit: 'can' });
    expect(parseQuantity('1 lb')).toEqual({ value: 1, unit: 'lb' });
  });
  it('normalises aliases', () => {
    expect(normaliseUnit('pounds')).toBe('lb');
    expect(normaliseUnit('Tablespoons')).toBe('tbsp');
    expect(normaliseUnit('tablets')).toBe('dose');
  });
});

describe('dimensions', () => {
  it('parses a furnace filter size', () => {
    expect(parseDimensions('16x25x1 in')).toEqual({ values: [16, 25, 1], unit: 'in' });
    expect(parseDimensions('20 x 20 x 4')).toEqual({ values: [20, 20, 4], unit: 'in' });
  });
});

describe('conversion', () => {
  it('converts within a dimension', () => {
    expect(convert(1, 'kg', 'g')).toBe(1000);
    expect(convert(1, 'lb', 'oz')).toBeCloseTo(16, 6);
    expect(convert(1, 'gal', 'l')).toBeCloseTo(3.785411784, 6);
    expect(convert(12, 'in', 'ft')).toBeCloseTo(1, 9);
  });
  it('refuses across dimensions', () => {
    expect(() => convert(1, 'kg', 'l')).toThrow();
    expect(areCompatible('kg', 'lb')).toBe(true);
    expect(areCompatible('kg', 'ml')).toBe(false);
  });
  it('formats counts without a noisy unit', () => {
    expect(formatQuantity({ value: 3, unit: 'ea' })).toBe('3');
    expect(formatQuantity({ value: 2.5, unit: 'kg' })).toBe('2.5 kg');
  });
});

describe('energy and distance', () => {
  it('converts between the units utilities actually bill in', () => {
    expect(convert(1, 'kwh', 'mj')).toBeCloseTo(3.6, 9);
    expect(convert(1, 'therm', 'kwh')).toBeCloseTo(29.3001, 3);
    expect(convert(1, 'mmbtu', 'therm')).toBeCloseTo(10, 2);
    expect(convert(1000, 'wh', 'kwh')).toBeCloseTo(1, 9);
    expect(convert(1, 'gj', 'mj')).toBeCloseTo(1000, 9);
  });
  it('parses meter units people type', () => {
    expect(parseQuantity('412 kWh')).toEqual({ value: 412, unit: 'kwh' });
    expect(parseQuantity('78 therms')).toEqual({ value: 78, unit: 'therm' });
  });
  it('converts distance for transport factors', () => {
    expect(convert(1, 'mi', 'km')).toBeCloseTo(1.609344, 6);
    expect(convert(5, 'km', 'mi')).toBeCloseTo(3.106856, 5);
  });
  it('keeps energy and mass apart', () => {
    expect(areCompatible('kwh', 'therm')).toBe(true);
    expect(areCompatible('kwh', 'kg')).toBe(false);
  });
});

describe('cubic measures, which utilities bill water and gas in', () => {
  it('converts cubic metres and cubic feet', () => {
    expect(convert(1, 'm3', 'l')).toBeCloseTo(1000, 6);
    expect(convert(1, 'ft3', 'gal')).toBeCloseTo(7.48052, 4);
    expect(parseQuantity('41 m3')).toEqual({ value: 41, unit: 'm3' });
  });
});
