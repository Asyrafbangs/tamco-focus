import { describe, expect, it } from 'vitest';

import {
  ageChips,
  calendarDaysSince,
  currentStateAgeMs,
  dueInputValue,
  endOfLocalDay,
  formatCompactDuration,
  formatDue,
  localDateTimeToInstant,
  localDateString,
  openAgeMs,
  overdueAgeMs,
  overdueDays,
  staleAgeMs,
  startOfLocalDay,
  timeZoneOffsetMs,
} from '@/domain/duration';
import { makeTask, NOW } from './fixtures';

const KL = 'Asia/Kuala_Lumpur';
const DAY = 86_400_000;

describe('time zone arithmetic', () => {
  it('reports the organisation offset as UTC+8', () => {
    expect(timeZoneOffsetMs(KL, new Date('2026-08-05T00:00:00Z'))).toBe(8 * 3_600_000);
  });

  it('handles a zone that observes daylight saving', () => {
    // London is UTC+1 in August and UTC+0 in January.
    expect(timeZoneOffsetMs('Europe/London', new Date('2026-08-05T12:00:00Z'))).toBe(3_600_000);
    expect(timeZoneOffsetMs('Europe/London', new Date('2026-01-05T12:00:00Z'))).toBe(0);
  });
});

describe('endOfLocalDay — the one-day overdue trap (section 31B.7)', () => {
  it('ends a date-only commitment at local midnight, not UTC midnight', () => {
    const end = endOfLocalDay('2026-08-12', KL);

    // 23:59:59.999 on 12 August in KL is 15:59:59.999 UTC on the same date.
    expect(end.toISOString()).toBe('2026-08-12T15:59:59.999Z');
  });

  it('does not treat a task as overdue during the afternoon of its due date', () => {
    // 18:00 local on the due date. UTC midnight has long passed, and a naive
    // implementation would already call this overdue.
    const duringDueDate = new Date('2026-08-12T10:00:00.000Z');
    expect(endOfLocalDay('2026-08-12', KL).getTime()).toBeGreaterThan(duringDueDate.getTime());
  });

  it('does treat it as overdue once the local day has ended', () => {
    const nextMorning = new Date('2026-08-13T01:00:00.000Z');
    expect(endOfLocalDay('2026-08-12', KL).getTime()).toBeLessThan(nextMorning.getTime());
  });

  it('rejects a malformed date rather than silently guessing', () => {
    expect(() => endOfLocalDay('12/08/2026', KL)).toThrow(RangeError);
  });
});

describe('local day helpers', () => {
  it('starts the local day at 16:00 UTC the previous date', () => {
    expect(startOfLocalDay(new Date('2026-08-12T10:00:00Z'), KL).toISOString()).toBe(
      '2026-08-11T16:00:00.000Z',
    );
  });

  it('reports the local calendar date', () => {
    // 23:00 UTC is already the next day in Kuala Lumpur.
    expect(localDateString(new Date('2026-08-11T23:00:00Z'), KL)).toBe('2026-08-12');
  });
});

describe('editable due values', () => {
  it('converts an organisation-local time to one absolute commitment', () => {
    expect(localDateTimeToInstant('2026-08-12T12:00', KL).toISOString()).toBe(
      '2026-08-12T04:00:00.000Z',
    );
  });

  it('round-trips date-only and timed values for native controls', () => {
    expect(dueInputValue('2026-08-12T15:59:59.999Z', true, KL)).toBe('2026-08-12');
    expect(dueInputValue('2026-08-12T04:00:00.000Z', false, KL)).toBe('2026-08-12T12:00');
  });

  it('rejects ambiguous date-time text', () => {
    expect(() => localDateTimeToInstant('12/08/2026 12:00', KL)).toThrow(RangeError);
  });
});

describe('the four ages (section 31B.5)', () => {
  it('measures open age from creation and does not reset on a state change', () => {
    const task = makeTask({
      createdAt: new Date(NOW.getTime() - 18 * DAY).toISOString(),
      stateEnteredAt: new Date(NOW.getTime() - 2 * DAY).toISOString(),
    });

    expect(openAgeMs(task, NOW)).toBe(18 * DAY);
    expect(currentStateAgeMs(task, NOW)).toBe(2 * DAY);
  });

  it('caps open age at completion rather than running forever', () => {
    const task = makeTask({
      status: 'completed',
      createdAt: new Date(NOW.getTime() - 30 * DAY).toISOString(),
      completedAt: new Date(NOW.getTime() - 10 * DAY).toISOString(),
    });

    expect(openAgeMs(task, NOW)).toBe(20 * DAY);
  });

  it('reports zero overdue age before the due instant', () => {
    const task = makeTask({ dueAt: new Date(NOW.getTime() + DAY).toISOString() });
    expect(overdueAgeMs(task, NOW)).toBe(0);
  });

  it('measures overdue age from the due instant', () => {
    const task = makeTask({ dueAt: new Date(NOW.getTime() - 2 * DAY).toISOString() });
    expect(overdueAgeMs(task, NOW)).toBe(2 * DAY);
  });

  it('stops overdue age once the work is completed', () => {
    const task = makeTask({
      status: 'completed',
      dueAt: new Date(NOW.getTime() - 5 * DAY).toISOString(),
      completedAt: new Date(NOW.getTime() - 4 * DAY).toISOString(),
    });

    expect(overdueAgeMs(task, NOW)).toBe(0);
  });

  it('measures stale age for Active work only', () => {
    const stale = { lastMeaningfulUpdateAt: new Date(NOW.getTime() - 9 * DAY).toISOString() };

    expect(staleAgeMs(makeTask({ status: 'active', ...stale }), NOW)).toBe(9 * DAY);
    expect(staleAgeMs(makeTask({ status: 'backlog', ...stale }), NOW)).toBe(0);
    expect(staleAgeMs(makeTask({ status: 'paused', ...stale }), NOW)).toBe(0);
  });
});

describe('compact duration formatting', () => {
  it.each([
    [30_000, '1m'],
    [45 * 60_000, '45m'],
    [4 * 3_600_000, '4h'],
    [18 * DAY, '18d'],
    [90 * DAY, '3mo'],
    // Months stay readable well past a year; years take over only once the
    // month count would become unwieldy.
    [400 * DAY, '13mo'],
    [800 * DAY, '2y'],
  ])('formats %i ms as %s', (ms, expected) => {
    expect(formatCompactDuration(ms)).toBe(expected);
  });

  it('never renders a negative duration', () => {
    expect(formatCompactDuration(-5000)).toBe('1m');
  });
});

describe('age chips (section 31B.6)', () => {
  it('always shows open and current-state chips', () => {
    const chips = ageChips(makeTask(), { now: NOW });

    expect(chips.map((chip) => chip.label)).toEqual(['Open 10d', 'Active 5d']);
    expect(chips[0]!.tone).toBe('neutral');
    expect(chips[1]!.tone).toBe('blue');
  });

  it('adds a red overdue chip only when genuinely overdue', () => {
    const chips = ageChips(
      makeTask({ isOverdue: true, dueAt: new Date(NOW.getTime() - 2 * DAY).toISOString() }),
      { now: NOW },
    );

    const overdue = chips.find((chip) => chip.label.startsWith('Overdue'));
    expect(overdue).toBeDefined();
    expect(overdue!.tone).toBe('red');
    expect(overdue!.label).toBe('Overdue 2d');
  });

  it('adds an amber no-update chip when the stale threshold is crossed', () => {
    const chips = ageChips(
      makeTask({
        isStale: true,
        lastMeaningfulUpdateAt: new Date(NOW.getTime() - 7 * DAY).toISOString(),
      }),
      { now: NOW },
    );

    const stale = chips.find((chip) => chip.label.startsWith('No update'));
    expect(stale).toBeDefined();
    expect(stale!.tone).toBe('amber');
  });

  it('gives every chip an explanation, so colour is never the only signal', () => {
    const chips = ageChips(makeTask({ isOverdue: true, isStale: true }), { now: NOW });

    expect(chips).not.toHaveLength(0);
    for (const chip of chips) {
      expect(chip.explanation.length).toBeGreaterThan(20);
    }
  });

  it('explains that viewing does not reset the stale clock', () => {
    const chips = ageChips(makeTask({ isStale: true }), { now: NOW });
    const stale = chips.find((chip) => chip.label.startsWith('No update'));

    expect(stale!.explanation).toContain('Viewing the task does not count as an update');
  });
});

describe('due date presentation', () => {
  it('shows a date only for a date-only commitment', () => {
    expect(formatDue('2026-08-12T15:59:59.999Z', true, KL)).toBe('12 Aug 2026');
  });

  it('shows the time for a date-time commitment, in the organisation zone', () => {
    expect(formatDue('2026-08-12T04:00:00.000Z', false, KL)).toBe('12 Aug, 12:00');
  });

  it('says so plainly when there is no date', () => {
    expect(formatDue(null, true, KL)).toBe('No date yet');
  });
});

describe('days late, one count for every screen (v185)', () => {
  const at = new Date('2026-09-15T03:07:00Z'); // 11:07 on 15 September in Kuala Lumpur
  const work = (dueAt: string, status: 'active' | 'completed' = 'active') =>
    makeTask({
      dueAt,
      status,
      isOverdue: status === 'active',
      completedAt: status === 'completed' ? at.toISOString() : null,
    });

  it('counts calendar days from a date-only due date, not elapsed time', () => {
    // Due 12 September ends at 23:59:59.999 local: 2 days 11 hours ago, 3 days late.
    const dueTwelfth = endOfLocalDay('2026-09-12', KL).toISOString();
    expect(calendarDaysSince(dueTwelfth, KL, at)).toBe(3);
    expect(overdueDays(work(dueTwelfth), KL, at)).toBe(3);
    // Due yesterday is a day late, eleven hours after it ended.
    expect(overdueDays(work(endOfLocalDay('2026-09-14', KL).toISOString()), KL, at)).toBe(1);
  });

  it('is zero for work due today, a due time passed earlier today, or finished work', () => {
    expect(overdueDays(work(endOfLocalDay('2026-09-15', KL).toISOString()), KL, at)).toBe(0);
    expect(overdueDays(work('2026-09-15T01:07:00Z'), KL, at)).toBe(0);
    expect(
      overdueDays(work(endOfLocalDay('2026-09-12', KL).toISOString(), 'completed'), KL, at),
    ).toBe(0);
  });

  it('reads the day in the viewer’s zone', () => {
    // 20:00 UTC on the 14th is already the 15th in Kuala Lumpur, still the 14th in London.
    expect(calendarDaysSince('2026-09-14T20:00:00Z', KL, new Date('2026-09-16T01:00:00Z'))).toBe(1);
    expect(
      calendarDaysSince('2026-09-14T20:00:00Z', 'Europe/London', new Date('2026-09-16T01:00:00Z')),
    ).toBe(2);
  });

  it('labels the age chip in days once a day has passed, and in hours on the day', () => {
    const late = ageChips(work(endOfLocalDay('2026-09-14', KL).toISOString()), {
      now: at,
      timeZone: KL,
    });
    expect(late.find((chip) => chip.tone === 'red')!.label).toBe('Overdue 1d');
    const hours = ageChips(work('2026-09-15T01:07:00Z'), { now: at, timeZone: KL });
    expect(hours.find((chip) => chip.tone === 'red')!.label).toBe('Overdue 2h');
  });
});
