import { describe, it, expect } from 'vitest';
import { addDays, addMonths, diffDays, zonedToUtc, todayInZone, seasonOf, endOfMonth } from '../src/date.js';

describe('calendar arithmetic', () => {
  it('adds days across month and year ends', () => {
    expect(addDays('2026-02-27', 2)).toBe('2026-03-01');
    expect(addDays('2024-02-27', 2)).toBe('2024-02-29');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
  it('clamps month addition', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2026-08-31', -1)).toBe('2026-07-31');
    expect(addMonths('2026-03-15', 12)).toBe('2027-03-15');
  });
  it('diffs days', () => {
    expect(diffDays('2026-03-10', '2026-03-01')).toBe(9);
    expect(diffDays('2026-03-01', '2026-03-10')).toBe(-9);
  });
  it('finds the end of the month', () => {
    expect(endOfMonth('2026-02-10')).toBe('2026-02-28');
    expect(endOfMonth('2024-02-10')).toBe('2024-02-29');
  });
});

describe('timezone conversion', () => {
  it('resolves wall-clock time to the right instant across DST', () => {
    // US DST began 2026-03-08. 08:00 New York is 13:00 UTC after, 13:00 UTC before.
    expect(zonedToUtc('2026-03-07', '08:00', 'America/New_York').toISOString()).toBe('2026-03-07T13:00:00.000Z');
    expect(zonedToUtc('2026-03-09', '08:00', 'America/New_York').toISOString()).toBe('2026-03-09T12:00:00.000Z');
    expect(zonedToUtc('2026-07-04', '20:00', 'America/Chicago').toISOString()).toBe('2026-07-05T01:00:00.000Z');
    expect(zonedToUtc('2026-01-15', '09:30', 'Europe/London').toISOString()).toBe('2026-01-15T09:30:00.000Z');
    expect(zonedToUtc('2026-06-15', '09:30', 'Europe/London').toISOString()).toBe('2026-06-15T08:30:00.000Z');
  });
  it('reports the local calendar date', () => {
    // 03:00 UTC is still the previous day in New York.
    expect(todayInZone('America/New_York', new Date('2026-03-02T03:00:00Z'))).toBe('2026-03-01');
    expect(todayInZone('UTC', new Date('2026-03-02T03:00:00Z'))).toBe('2026-03-02');
  });
});

describe('seasons', () => {
  it('groups maintenance by season', () => {
    expect(seasonOf('2026-01-15')).toBe('winter');
    expect(seasonOf('2026-04-15')).toBe('spring');
    expect(seasonOf('2026-10-15')).toBe('fall');
  });
});
