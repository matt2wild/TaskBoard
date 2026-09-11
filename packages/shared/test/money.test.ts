import { describe, it, expect } from 'vitest';
import { parseMoney, formatMoney, splitEvenly, allocate, splitsBalance, monthlySetAside, sum } from '../src/money.js';

describe('money parsing', () => {
  it('parses the shapes people type', () => {
    expect(parseMoney('12.34')).toBe(1234);
    expect(parseMoney('$1,234.50')).toBe(123450);
    expect(parseMoney('-8')).toBe(-800);
    expect(parseMoney('0.005')).toBe(1); // rounds half up
    expect(parseMoney(19.99)).toBe(1999);
  });
  it('rejects junk', () => {
    expect(() => parseMoney('abc')).toThrow();
    expect(() => parseMoney('')).toThrow();
  });
  it('round-trips through formatting', () => {
    expect(formatMoney(123450, 'USD')).toBe('$1,234.50');
  });
});

describe('allocation never loses a cent', () => {
  it('splits evenly with the remainder distributed', () => {
    expect(splitEvenly(1000, 3)).toEqual([334, 333, 333]);
    expect(sum(splitEvenly(1000, 3))).toBe(1000);
    expect(splitEvenly(-1000, 3)).toEqual([-334, -333, -333]);
  });
  it('allocates proportionally and still sums exactly', () => {
    const parts = allocate(9640, [1, 1, 1, 7]);
    expect(sum(parts)).toBe(9640);
    const grocery = allocate(10000, [333, 333, 334]);
    expect(sum(grocery)).toBe(10000);
  });
  it('survives pathological weights', () => {
    for (const total of [1, 7, 99, 100003, -5001]) {
      for (const w of [[1], [1, 2], [0, 0, 1], [5, 5, 5, 5, 5, 5, 5]]) {
        expect(sum(allocate(total, w))).toBe(total);
      }
    }
  });
  it('validates transaction splits', () => {
    expect(splitsBalance(1000, [600, 400])).toBe(true);
    expect(splitsBalance(1000, [600, 399])).toBe(false);
  });
});

describe('sinking funds', () => {
  it('rounds the monthly set-aside up so the fund is never short', () => {
    expect(monthlySetAside(120000, 12)).toBe(10000);
    expect(monthlySetAside(100000, 12)).toBe(8334);
  });
});
