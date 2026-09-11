import { describe, it, expect } from 'vitest';
import {
  nextDue, occurrences, dueStatus, describeSchedule, addInterval, outstandingDue, type ScheduleSpec,
} from '../src/recurrence.js';

const today = '2026-03-01';

describe('fixed schedules follow the calendar', () => {
  const trash: ScheduleSpec = { mode: 'fixed', rrule: 'FREQ=WEEKLY;BYDAY=TU', anchorDate: '2026-01-06' };

  it('finds the next occurrence after a date', () => {
    expect(nextDue(trash, { today, after: '2026-03-01' })).toBe('2026-03-03');
    expect(nextDue(trash, { today, after: '2026-03-03' })).toBe('2026-03-10');
  });

  it('does not shift when a week is missed', () => {
    // Completed late on Thursday; the next bin day is still the following Tuesday.
    expect(nextDue(trash, { today, after: '2026-03-05', lastCompletedAt: '2026-03-05' })).toBe('2026-03-10');
  });

  it('materialises a horizon', () => {
    expect(occurrences(trash, '2026-03-01', '2026-03-31')).toEqual([
      '2026-03-03', '2026-03-10', '2026-03-17', '2026-03-24', '2026-03-31',
    ]);
  });

  it('honours UNTIL', () => {
    const s = { ...trash, untilDate: '2026-03-11' };
    expect(nextDue(s, { today, after: '2026-03-10' })).toBeNull();
  });

  it('handles month-end without skipping months', () => {
    const s: ScheduleSpec = { mode: 'fixed', rrule: 'FREQ=MONTHLY;BYMONTHDAY=-1', anchorDate: '2026-01-31' };
    expect(occurrences(s, '2026-01-01', '2026-04-30')).toEqual([
      '2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30',
    ]);
  });

  it('handles a yearly two-month schedule (gutters, spring and fall)', () => {
    const s: ScheduleSpec = { mode: 'fixed', rrule: 'FREQ=YEARLY;BYMONTH=4,10;BYMONTHDAY=1', anchorDate: '2026-04-01' };
    expect(occurrences(s, '2026-01-01', '2027-12-31')).toEqual([
      '2026-04-01', '2026-10-01', '2027-04-01', '2027-10-01',
    ]);
  });
});

describe('floating schedules follow the completion', () => {
  const filter: ScheduleSpec = { mode: 'floating', every: { days: 90 }, anchorDate: '2026-01-01' };

  it('uses the anchor before any completion', () => {
    expect(nextDue(filter, { today })).toBe('2026-01-01');
  });

  it('counts from the actual completion, not the due date', () => {
    // Due Jan 1, actually changed Jan 20 -> next is 90 days after Jan 20.
    expect(nextDue(filter, { today, lastCompletedAt: '2026-01-20' })).toBe('2026-04-20');
  });

  it('does not pile up missed occurrences', () => {
    const late = nextDue(filter, { today: '2026-09-01', lastCompletedAt: '2026-01-20' });
    expect(late).toBe('2026-04-20'); // one outstanding instance, not five
  });

  it('never regenerates into the past', () => {
    expect(nextDue(filter, { today, lastCompletedAt: '2025-01-01', after: '2026-03-01' })).toBe('2026-03-27');
  });

  it('clamps month arithmetic at month end', () => {
    expect(addInterval('2026-01-31', { months: 1 })).toBe('2026-02-28');
    expect(addInterval('2024-01-31', { months: 1 })).toBe('2024-02-29');
    expect(addInterval('2026-03-31', { months: 6 })).toBe('2026-09-30');
  });
});

describe('one-off and on-demand', () => {
  it('one-off is finished once completed', () => {
    const s: ScheduleSpec = { mode: 'one_off', anchorDate: '2026-02-14' };
    expect(nextDue(s, { today })).toBe('2026-02-14');
    expect(nextDue(s, { today, lastCompletedAt: '2026-02-14' })).toBeNull();
  });

  it('on-demand comes straight back', () => {
    const s: ScheduleSpec = { mode: 'on_demand' };
    expect(nextDue(s, { today, lastCompletedAt: '2026-03-01' })).toBe('2026-03-01');
  });
});

describe('due status', () => {
  it('classifies relative to today with a grace window', () => {
    expect(dueStatus('2026-03-20', today)).toBe('upcoming');
    expect(dueStatus('2026-03-05', today)).toBe('due_soon');
    expect(dueStatus('2026-03-01', today)).toBe('due');
    expect(dueStatus('2026-02-27', today)).toBe('overdue');
    expect(dueStatus('2026-02-27', today, { graceDays: 5 })).toBe('grace');
    expect(dueStatus(null, today)).toBe('none');
  });
});

describe('descriptions', () => {
  it('reads back in English', () => {
    expect(describeSchedule({ mode: 'fixed', rrule: 'FREQ=WEEKLY;BYDAY=TU', anchorDate: today }))
      .toBe('Every week on Tuesday');
    expect(describeSchedule({ mode: 'floating', every: { days: 90 } }))
      .toBe('Every 90 days after it is done');
    expect(describeSchedule({ mode: 'fixed', rrule: 'FREQ=MONTHLY;INTERVAL=3', anchorDate: today }))
      .toBe('Every 3 months');
  });
});

describe('what is actually outstanding', () => {
  const yearly: ScheduleSpec = {
    mode: 'fixed', rrule: 'FREQ=YEARLY;BYMONTH=5;BYMONTHDAY=1', anchorDate: '2024-05-01',
  };

  it('owes the most recent missed occurrence, not the first one ever', () => {
    expect(outstandingDue(yearly, { today: '2026-09-11' })).toBe('2026-05-01');
  });

  it('does not reach back past the last completion', () => {
    expect(outstandingDue(yearly, { today: '2026-09-11', lastCompletedAt: '2026-05-03' })).toBeNull();
    expect(outstandingDue(yearly, { today: '2026-09-11', lastCompletedAt: '2025-05-03' })).toBe('2026-05-01');
  });

  it('returns nothing when the schedule has not come round yet', () => {
    expect(outstandingDue(yearly, { today: '2024-04-30' })).toBeNull();
  });

  it('finds the last bin day for a weekly rule', () => {
    const weekly: ScheduleSpec = { mode: 'fixed', rrule: 'FREQ=WEEKLY;BYDAY=TU', anchorDate: '2026-01-06' };
    // 2026-09-11 is a Friday; the last Tuesday was the 8th.
    expect(outstandingDue(weekly, { today: '2026-09-11' })).toBe('2026-09-08');
  });

  it('reports a floating schedule only once it is actually due', () => {
    const floating: ScheduleSpec = { mode: 'floating', every: { days: 90 }, anchorDate: '2026-06-15' };
    expect(outstandingDue(floating, { today: '2026-09-11' })).toBe('2026-06-15');
    expect(outstandingDue(floating, { today: '2026-06-01' })).toBeNull();
  });
});
