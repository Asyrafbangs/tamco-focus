import { describe, expect, it } from 'vitest';

import {
  groupByDay,
  peopleInvolved,
  sortUpdates,
  updateDetail,
  updatesSummary,
  type TeamUpdate,
} from '@/domain/team-updates';

function update(overrides: Partial<TeamUpdate> = {}): TeamUpdate {
  return {
    id: 'a',
    kind: 'update',
    at: '2026-10-01T09:00:00.000Z',
    personId: 'p1',
    personName: 'Amer',
    taskId: 't1',
    taskTitle: 'Fire extinguisher mapping',
    parentTitle: null,
    body: null,
    ...overrides,
  };
}

describe('ordering the feed', () => {
  it('puts the newest first', () => {
    const sorted = sortUpdates([
      update({ id: 'old', at: '2026-09-28T09:00:00.000Z' }),
      update({ id: 'new', at: '2026-10-01T09:00:00.000Z' }),
    ]);
    expect(sorted.map((one) => one.id)).toEqual(['new', 'old']);
  });

  it('does not shuffle two things written in the same transaction', () => {
    // Completing from the drawer writes the update and the completion at the
    // same instant; without a tie-break they swap places between renders.
    const same = [update({ id: 'b' }), update({ id: 'a' })];
    expect(sortUpdates(same).map((one) => one.id)).toEqual(['b', 'a']);
    expect(sortUpdates([...same].reverse()).map((one) => one.id)).toEqual(['b', 'a']);
  });

  it("leaves the caller's array alone", () => {
    const given = [update({ id: 'x', at: '2026-09-01T09:00:00.000Z' }), update({ id: 'y' })];
    sortUpdates(given);
    expect(given.map((one) => one.id)).toEqual(['x', 'y']);
  });
});

describe('the line under the headline', () => {
  it('is what they wrote', () => {
    expect(updateDetail(update({ body: '  Replaced   the   unit.  ' }))).toBe('Replaced the unit.');
  });

  it('trims a long one rather than filling the page', () => {
    const detail = updateDetail(update({ body: 'x'.repeat(400) }), 40);
    expect(detail).toHaveLength(40);
    expect(detail?.endsWith('…')).toBe(true);
  });

  it('says nothing when there is nothing to say', () => {
    expect(updateDetail(update({ body: null }))).toBeNull();
    expect(updateDetail(update({ body: '   ' }))).toBeNull();
  });

  it('names the parent for a contribution instead of a body', () => {
    expect(
      updateDetail(
        update({ kind: 'contribution', parentTitle: 'Annual audit', body: 'ignored here' }),
      ),
    ).toBe('on Annual audit');
  });
});

describe('the summary above the list', () => {
  it('is honest about an empty fortnight', () => {
    expect(updatesSummary([], 'in the last 14 days')).toBe(
      'Nobody recorded anything in the last 14 days.',
    );
  });

  it('counts people, not entries', () => {
    const updates = [
      update({ id: '1', personId: 'p1' }),
      update({ id: '2', personId: 'p1' }),
      update({ id: '3', personId: 'p2' }),
    ];
    expect(peopleInvolved(updates)).toBe(2);
    expect(updatesSummary(updates, 'in the last 14 days')).toBe(
      '3 updates from 2 people in the last 14 days.',
    );
  });

  it('calls out how much of it was finished work', () => {
    const updates = [
      update({ id: '1' }),
      update({ id: '2', kind: 'completed' }),
      update({ id: '3', kind: 'contribution' }),
    ];
    expect(updatesSummary(updates, 'this month')).toBe(
      '3 updates from 1 person this month, 2 of them completions.',
    );
  });

  it('uses the singular where it should', () => {
    expect(updatesSummary([update({ kind: 'completed' })], 'today')).toBe(
      '1 update from 1 person today, 1 of them a completion.',
    );
  });
});

describe('grouping by day', () => {
  it('runs newest day first, with each day in order', () => {
    const days = groupByDay(
      [
        update({ id: 'mon-early', at: '2026-09-28T01:00:00.000Z' }),
        update({ id: 'wed', at: '2026-09-30T01:00:00.000Z' }),
        update({ id: 'mon-late', at: '2026-09-28T09:00:00.000Z' }),
      ],
      'UTC',
    );
    expect(days.map((day) => day.day)).toEqual(['2026-09-30', '2026-09-28']);
    expect(days[1]?.updates.map((one) => one.id)).toEqual(['mon-late', 'mon-early']);
  });

  it("splits the day in the reader's zone, not the server's", () => {
    // 23:30 UTC is already the next morning in Kuala Lumpur.
    const days = groupByDay([update({ at: '2026-09-30T23:30:00.000Z' })], 'Asia/Kuala_Lumpur');
    expect(days[0]?.day).toBe('2026-10-01');
  });
});
