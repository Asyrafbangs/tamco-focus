import { describe, expect, it } from 'vitest';

import {
  activitySummary,
  cardChanges,
  groupByDay,
  matchesFilter,
  mergeActivity,
  perPerson,
  type ActivityEvent,
} from '@/domain/team-activity';

const ZONE = 'Asia/Kuala_Lumpur';

function event(overrides: Partial<ActivityEvent> = {}): ActivityEvent {
  return {
    id: 'e1',
    kind: 'note',
    at: '2026-10-01T02:00:00.000Z',
    personId: 'amer',
    personName: 'Amer',
    taskId: 'task-1',
    taskTitle: 'Fire Fighting System Improvement',
    parentTitle: null,
    body: null,
    progressAfter: null,
    progressBefore: null,
    dueFrom: null,
    dueTo: null,
    priorityFrom: null,
    priorityTo: null,
    stepName: null,
    ...overrides,
  };
}

describe('merging an afternoon into one card', () => {
  it('turns six events on one task into a single activity', () => {
    // The example from the design review: one person, one task, one afternoon.
    const cards = mergeActivity(
      [
        event({
          id: '1',
          kind: 'note',
          at: '2026-10-01T02:02:00Z',
          body: 'Vendor inspection done.',
        }),
        event({ id: '2', kind: 'step', at: '2026-10-01T02:04:00Z', progressAfter: 50 }),
        event({ id: '3', kind: 'evidence', at: '2026-10-01T02:07:00Z' }),
        event({ id: '4', kind: 'step', at: '2026-10-01T02:20:00Z', progressAfter: 60 }),
        event({ id: '5', kind: 'evidence', at: '2026-10-01T03:16:00Z' }),
        event({
          id: '6',
          kind: 'note',
          at: '2026-10-01T03:17:00Z',
          body: 'Quotation received.',
          progressAfter: 70,
        }),
      ].map((one, index) => (index === 0 ? { ...one, progressBefore: 40 } : one)),
      ZONE,
    );

    expect(cards).toHaveLength(1);
    const card = cards[0]!;
    expect(card.steps).toBe(2);
    expect(card.files).toBe(2);
    expect(card.progressFrom).toBe(40);
    expect(card.progressTo).toBe(70);
    // The latest thing they wrote, not the first.
    expect(card.note).toBe('Quotation received.');
    // The card is stamped with the last thing that happened.
    expect(card.at).toBe('2026-10-01T03:17:00Z');
  });

  it('keeps separate days separate, so a stalled task shows as stalled', () => {
    const cards = mergeActivity(
      [
        event({ id: '1', kind: 'step', at: '2026-09-29T02:00:00Z' }),
        event({ id: '2', kind: 'step', at: '2026-10-01T02:00:00Z' }),
      ],
      ZONE,
    );
    expect(cards).toHaveLength(2);
  });

  it('keeps two people on one task apart', () => {
    const cards = mergeActivity(
      [
        event({ id: '1', personId: 'amer', personName: 'Amer' }),
        event({ id: '2', personId: 'naga', personName: 'Naga' }),
      ],
      ZONE,
    );
    expect(cards).toHaveLength(2);
  });

  it("splits the day in the reader's zone", () => {
    // 17:00 UTC is already the next day in Kuala Lumpur.
    const cards = mergeActivity(
      [
        event({ id: '1', at: '2026-09-30T15:00:00Z' }),
        event({ id: '2', at: '2026-09-30T17:00:00Z' }),
      ],
      ZONE,
    );
    expect(cards).toHaveLength(2);
  });

  it('puts the newest card first', () => {
    const cards = mergeActivity(
      [
        event({ id: '1', taskId: 'old', at: '2026-10-01T01:00:00Z' }),
        event({ id: '2', taskId: 'new', at: '2026-10-01T05:00:00Z' }),
      ],
      ZONE,
    );
    expect(cards.map((card) => card.taskId)).toEqual(['new', 'old']);
  });
});

describe('never overstating a change', () => {
  it('shows only the result when the starting point is unknown', () => {
    const cards = mergeActivity([event({ kind: 'step', progressAfter: 70 })], ZONE);
    expect(cards[0]!.progressFrom).toBeNull();
    expect(cardChanges(cards[0]!)).toContain('Progress 70%');
    expect(cardChanges(cards[0]!).join(' ')).not.toContain('→');
  });

  it('shows the arrow once the starting point is known', () => {
    const cards = mergeActivity(
      [event({ kind: 'step', progressAfter: 70, progressBefore: 40 })],
      ZONE,
    );
    expect(cardChanges(cards[0]!)).toContain('Progress 40% → 70%');
  });

  it('does not claim a change when nothing moved', () => {
    const cards = mergeActivity(
      [event({ kind: 'step', progressAfter: 40, progressBefore: 40 })],
      ZONE,
    );
    expect(cards[0]!.progressFrom).toBeNull();
    expect(cardChanges(cards[0]!)).toContain('Progress 40%');
  });

  it('says what the due date moved from and to', () => {
    const cards = mergeActivity([event({ kind: 'due', dueFrom: '25 Sep', dueTo: '9 Oct' })], ZONE);
    expect(cardChanges(cards[0]!)).toContain('Due 25 Sep → 9 Oct');
  });

  it('leads with a blockage, because that is the thing to act on', () => {
    const cards = mergeActivity(
      [
        event({ id: '1', kind: 'step', progressAfter: 50 }),
        event({ id: '2', kind: 'blocked', at: '2026-10-01T04:00:00Z' }),
      ],
      ZONE,
    );
    expect(cardChanges(cards[0]!)[0]).toBe('Blocked');
  });
});

describe('the summary line', () => {
  it('is honest about an empty week', () => {
    expect(activitySummary([], 'in the last 7 days')).toBe('Nothing recorded in the last 7 days.');
  });

  it('counts completions and progress separately', () => {
    const cards = mergeActivity(
      [
        event({ id: '1', taskId: 't1', kind: 'completed' }),
        event({ id: '2', taskId: 't2', kind: 'step', progressAfter: 20 }),
        event({ id: '3', taskId: 't3', kind: 'evidence' }),
      ],
      ZONE,
    );
    expect(activitySummary(cards, 'in the last 7 days')).toBe(
      '3 activities · 1 completed · 1 progressed · 1 with evidence in the last 7 days.',
    );
  });

  it('does not count a completed card as progressed as well', () => {
    const cards = mergeActivity(
      [event({ id: '1', kind: 'completed' }), event({ id: '2', kind: 'step', progressAfter: 100 })],
      ZONE,
    );
    expect(activitySummary(cards, 'today')).toBe('1 activity · 1 completed today.');
  });
});

describe('who contributed', () => {
  it('lists everybody, including those with nothing', () => {
    const cards = mergeActivity([event({ personId: 'amer', personName: 'Amer' })], ZONE);
    const rows = perPerson(cards, [
      { userId: 'amer', fullName: 'Amer' },
      { userId: 'izzul', fullName: 'Izzul' },
    ]);
    expect(rows).toEqual([
      { personId: 'amer', personName: 'Amer', count: 1 },
      { personId: 'izzul', personName: 'Izzul', count: 0 },
    ]);
  });

  it('orders by how much, then by name', () => {
    const cards = mergeActivity(
      [
        event({ id: '1', taskId: 't1', personId: 'a', personName: 'Amer' }),
        event({ id: '2', taskId: 't2', personId: 'a', personName: 'Amer' }),
        event({ id: '3', taskId: 't3', personId: 'b', personName: 'Bala' }),
      ],
      ZONE,
    );
    expect(
      perPerson(cards, [
        { userId: 'b', fullName: 'Bala' },
        { userId: 'a', fullName: 'Amer' },
      ]).map((row) => row.personName),
    ).toEqual(['Amer', 'Bala']);
  });
});

describe('filtering', () => {
  const cards = mergeActivity(
    [
      event({ id: '1', taskId: 'done', kind: 'completed' }),
      event({ id: '2', taskId: 'moved', kind: 'step', progressAfter: 30 }),
      event({ id: '3', taskId: 'said', kind: 'note', body: 'Waiting on the vendor.' }),
      event({ id: '4', taskId: 'shot', kind: 'evidence' }),
      event({ id: '5', taskId: 'stuck', kind: 'blocked' }),
    ],
    ZONE,
  );

  it('matches each kind to its own filter', () => {
    const only = (filter: Parameters<typeof matchesFilter>[1]) =>
      cards.filter((card) => matchesFilter(card, filter)).map((card) => card.taskId);
    expect(only('all')).toHaveLength(5);
    expect(only('completed')).toEqual(['done']);
    expect(only('progress')).toEqual(['moved']);
    expect(only('notes')).toEqual(['said']);
    expect(only('evidence')).toEqual(['shot']);
    expect(only('blocked')).toEqual(['stuck']);
  });
});

describe('grouping into days', () => {
  it('runs newest day first', () => {
    const cards = mergeActivity(
      [
        event({ id: '1', taskId: 'a', at: '2026-09-29T02:00:00Z' }),
        event({ id: '2', taskId: 'b', at: '2026-10-01T02:00:00Z' }),
      ],
      ZONE,
    );
    expect(groupByDay(cards, ZONE).map((day) => day.day)).toEqual(['2026-10-01', '2026-09-29']);
  });
});
