import { describe, expect, it } from 'vitest';

import {
  completedDay,
  completedTime,
  dayHeading,
  deliveredByPerson,
  deliveredDays,
  deliveredSummary,
  deliveredTally,
  readDeliveredView,
  type DeliveredRecord,
} from '@/domain/team-delivered';

const ZONE = 'Asia/Kuala_Lumpur';
const NOW = new Date('2026-10-01T04:00:00.000Z');

function record(overrides: Partial<DeliveredRecord> = {}): DeliveredRecord {
  return {
    id: 'r1',
    taskId: 't1',
    kind: 'owned',
    title: 'Monthly SHO Report',
    parentTitle: null,
    at: '2026-10-01T02:42:00.000Z',
    personId: 'amer',
    personName: 'Amer',
    ...overrides,
  };
}

describe('the week, newest first', () => {
  const days = deliveredDays(
    [
      record({ id: 'a', at: '2026-09-30T08:15:00Z' }),
      record({ id: 'b', at: '2026-10-01T01:28:00Z' }),
      record({ id: 'c', at: '2026-10-01T02:42:00Z' }),
      record({ id: 'd', at: null }),
    ],
    ZONE,
  );

  it('groups by the day the reader is in, newest day first', () => {
    expect(days.map((day) => day.day)).toEqual(['2026-10-01', '2026-09-30', '']);
  });

  it('runs newest first inside a day, because the order is the story', () => {
    expect(days[0]!.records.map((one) => one.id)).toEqual(['c', 'b']);
  });

  it('keeps a record with no completion time rather than filing it under today', () => {
    // Dropping it would understate the week; dating it would invent a fact.
    expect(days[days.length - 1]!.records.map((one) => one.id)).toEqual(['d']);
  });

  it('splits the day where the reader is, not where the server is', () => {
    // 17:00 UTC is already the next day in Kuala Lumpur.
    const split = deliveredDays(
      [
        record({ id: '1', at: '2026-09-30T15:00:00Z' }),
        record({ id: '2', at: '2026-09-30T17:00:00Z' }),
      ],
      ZONE,
    );
    expect(split.map((day) => day.day)).toEqual(['2026-10-01', '2026-09-30']);
  });
});

describe('the day headings', () => {
  it('says Today and Yesterday, and nothing vaguer', () => {
    expect(dayHeading('2026-10-01', NOW, ZONE)).toBe('Today');
    expect(dayHeading('2026-09-30', NOW, ZONE)).toBe('Yesterday');
  });

  it('names the weekday once relative words stop helping', () => {
    // "4 days ago" is a duration where a manager wants a place in the week.
    expect(dayHeading('2026-09-28', NOW, ZONE)).toBe('Monday 28 Sept');
  });

  it('says so when there is no date at all', () => {
    expect(dayHeading('', NOW, ZONE)).toBe('Date not recorded');
  });
});

describe('who closed what', () => {
  it('counts everybody, including the people who closed nothing', () => {
    const tally = deliveredTally(
      [record({ personId: 'amer' }), record({ id: 'r2', personId: 'amer' })],
      [
        { userId: 'fadli', fullName: 'Fadli' },
        { userId: 'amer', fullName: 'Amer' },
      ],
    );
    expect(tally).toEqual([
      { personId: 'amer', personName: 'Amer', count: 2 },
      { personId: 'fadli', personName: 'Fadli', count: 0 },
    ]);
  });
});

describe('the second view', () => {
  const people = [
    { userId: 'fadli', fullName: 'Fadli' },
    { userId: 'amer', fullName: 'Amer' },
  ];

  it('is the same records under the person who closed them', () => {
    const groups = deliveredByPerson(
      [
        record({ id: '1', personId: 'amer', personName: 'Amer', at: '2026-09-30T01:00:00Z' }),
        record({ id: '2', personId: 'amer', personName: 'Amer', at: '2026-10-01T01:00:00Z' }),
        record({ id: '3', personId: 'fadli', personName: 'Fadli' }),
      ],
      people,
    );
    expect(groups.map((group) => group.personName)).toEqual(['Amer', 'Fadli']);
    // Newest first inside a person, as in the timeline.
    expect(groups[0]!.records.map((one) => one.id)).toEqual(['2', '1']);
  });

  it('keeps a person who closed nothing, because the window explains as much as they do', () => {
    const groups = deliveredByPerson([], people);
    expect(groups.map((group) => group.records.length)).toEqual([0, 0]);
  });
});

describe('the summary line', () => {
  it('splits the total by kind, so it cannot read as a ranking', () => {
    const summary = deliveredSummary(
      [
        record({ id: '1', kind: 'owned' }),
        record({ id: '2', kind: 'owned' }),
        record({ id: '3', kind: 'shared' }),
        record({ id: '4', kind: 'routine' }),
      ],
      'in the last 7 days',
    );
    expect(summary).toBe('4 completed in the last 7 days · 2 owned · 1 contributed · 1 routine');
  });

  it('omits a kind nobody closed rather than printing a zero', () => {
    expect(deliveredSummary([record()], 'today')).toBe('1 completed today · 1 owned');
  });

  it('is plain about an empty window', () => {
    expect(deliveredSummary([], 'in the last 7 days')).toBe('Nothing closed in the last 7 days.');
  });
});

describe('the clock', () => {
  it('gives the time where the reader is', () => {
    expect(completedTime('2026-10-01T02:42:00Z', ZONE)).toBe('10:42');
  });

  it('says nothing when there is nothing to say', () => {
    expect(completedTime(null, ZONE)).toBeNull();
    expect(completedDay(null, ZONE)).toBeNull();
  });

  it('gives the day alone where the window already names the year', () => {
    expect(completedDay('2026-09-29T10:00:00Z', ZONE)).toBe('29 Sept');
  });
});

describe('the view in the address', () => {
  it('defaults to the timeline, which is the question the tab opens on', () => {
    expect(readDeliveredView(undefined)).toBe('timeline');
    expect(readDeliveredView('nonsense')).toBe('timeline');
    expect(readDeliveredView('person')).toBe('person');
  });
});
