import { describe, expect, it } from 'vitest';

import {
  defaultPattern,
  describeRecurrence,
  patternFromRow,
  patternToColumns,
  validatePattern,
  type RecurrencePattern,
} from '@/domain/routines';

function pattern(overrides: Partial<RecurrencePattern> = {}): RecurrencePattern {
  return { ...defaultPattern('2026-08-14'), ...overrides };
}

/**
 * The sentence and the stored columns, which have to agree.
 *
 * They stopped agreeing once before, and the result reached production: yearly
 * was stored as monthly with an interval of twelve, so the Routines list read
 * "Yearly on the 5th" — the 5th of no month in particular — and the first
 * occurrence landed a year out. Anything that describes a schedule one way and
 * stores it another produces exactly that class of bug.
 */
describe('describing a recurrence', () => {
  it('says every day, and every N days', () => {
    expect(describeRecurrence(pattern({ frequency: 'daily', intervalCount: 1 }))).toBe('Every day');
    expect(describeRecurrence(pattern({ frequency: 'daily', intervalCount: 3 }))).toBe(
      'Every 3 days',
    );
  });

  it('lists several weekdays readably', () => {
    expect(
      describeRecurrence(pattern({ frequency: 'weekly', intervalCount: 1, weekdays: [1, 4] })),
    ).toBe('Every week on Monday and Thursday');
    expect(
      describeRecurrence(pattern({ frequency: 'weekly', intervalCount: 2, weekdays: [5] })),
    ).toBe('Every 2 weeks on Friday');
  });

  it('distinguishes a day number from a weekday of the month', () => {
    expect(
      describeRecurrence(
        pattern({ frequency: 'monthly', monthlyMode: 'day_of_month', dayOfMonth: 5 }),
      ),
    ).toBe('Day 5 of every month');
    expect(
      describeRecurrence(
        pattern({
          frequency: 'monthly',
          monthlyMode: 'nth_weekday',
          nthWeekday: 1,
          nthWeekdayDow: 3,
        }),
      ),
    ).toBe('The first Wednesday of every month');
  });

  it('names the month for a yearly routine', () => {
    // The whole point of making yearly a frequency rather than twelve months.
    expect(
      describeRecurrence(
        pattern({
          frequency: 'yearly',
          intervalCount: 1,
          monthlyMode: 'day_of_month',
          dayOfMonth: 5,
          monthOfYear: 9,
        }),
      ),
    ).toBe('Every year on 5 September');
  });

  it('says how the series ends when it does', () => {
    expect(
      describeRecurrence(
        pattern({ frequency: 'daily', intervalCount: 1, endsMode: 'after', endsAfterCount: 10 }),
      ),
    ).toBe('Every day · 10 times');
    expect(
      describeRecurrence(
        pattern({
          frequency: 'daily',
          intervalCount: 1,
          endsMode: 'on_date',
          endsOnDate: '2026-12-31',
        }),
      ),
    ).toContain('until 31 Dec 2026');
  });
});

describe('translating a pattern to columns', () => {
  it('nulls the fields the chosen frequency does not use', () => {
    // A check constraint rejects a schedule described two ways at once, and it
    // is right to: "day 5" and "the first Wednesday" have no combined meaning.
    const columns = patternToColumns(
      pattern({
        frequency: 'monthly',
        monthlyMode: 'nth_weekday',
        nthWeekday: -1,
        nthWeekdayDow: 5,
      }),
    );
    expect(columns.dayOfMonth).toBeNull();
    expect(columns.weekdays).toBeNull();
    expect(columns.monthOfYear).toBeNull();
    expect(columns.nthWeekday).toBe(-1);
  });

  it('round-trips through a stored row', () => {
    const original = pattern({
      frequency: 'weekly',
      intervalCount: 2,
      weekdays: [2, 5],
      endsMode: 'after',
      endsAfterCount: 6,
    });
    const columns = patternToColumns(original);
    const back = patternFromRow({
      frequency: columns.frequency,
      intervalCount: columns.intervalCount,
      weekdays: columns.weekdays,
      weekday: null,
      monthlyMode: columns.monthlyMode,
      dayOfMonth: columns.dayOfMonth,
      nthWeekday: columns.nthWeekday,
      nthWeekdayDow: columns.nthWeekdayDow,
      monthOfYear: columns.monthOfYear,
      startDate: columns.startDate,
      endsMode: columns.endsMode,
      endsAfterCount: columns.endsAfterCount,
      endsOnDate: columns.endsOnDate,
    });
    expect(describeRecurrence(back)).toBe(describeRecurrence(original));
  });

  it('reads a routine stored before weekdays became a list', () => {
    // Rows written before v62 carry a single `weekday` and no array.
    const back = patternFromRow({
      frequency: 'weekly',
      intervalCount: 1,
      weekdays: null,
      weekday: 3,
      monthlyMode: null,
      dayOfMonth: null,
      nthWeekday: null,
      nthWeekdayDow: null,
      monthOfYear: null,
      startDate: '2026-08-01',
      endsMode: null,
      endsAfterCount: null,
      endsOnDate: null,
    });
    expect(back.weekdays).toEqual([3]);
    expect(describeRecurrence(back)).toBe('Every week on Wednesday');
  });
});

describe('validating a pattern', () => {
  it('accepts a workable schedule', () => {
    expect(validatePattern(pattern())).toBeNull();
  });

  it('refuses a weekly routine with no day', () => {
    expect(validatePattern(pattern({ frequency: 'weekly', weekdays: [] }))).toMatch(
      /at least one/i,
    );
  });

  it('refuses an end date before the start', () => {
    expect(
      validatePattern(
        pattern({ startDate: '2026-08-14', endsMode: 'on_date', endsOnDate: '2026-08-01' }),
      ),
    ).toMatch(/cannot be before/i);
  });

  it('refuses an end count that is not a count', () => {
    expect(validatePattern(pattern({ endsMode: 'after', endsAfterCount: null }))).toMatch(
      /how many times/i,
    );
  });
});
