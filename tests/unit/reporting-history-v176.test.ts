import { describe, expect, it } from 'vitest';

import { managerOnDate, type ReportingChange } from '@/domain/reporting-history';

/**
 * v176 — "who was this person's manager in March?", answered from the record.
 *
 * The cases that matter are the edges a naive lookup gets wrong: a date before
 * anything was recorded, two changes effective the same day, and a dotted-line
 * change that must not be mistaken for the reporting line.
 */

const change = (
  effectiveDate: string,
  previousManagerId: string | null,
  newManagerId: string | null,
  overrides: Partial<ReportingChange> = {},
): ReportingChange => ({
  relationship: 'primary',
  previousManagerId,
  newManagerId,
  effectiveDate,
  changedAt: `${effectiveDate}T09:00:00Z`,
  ...overrides,
});

describe('managerOnDate', () => {
  const history = [
    change('2026-09-01', 'izzul', 'fadli'),
    change('2026-03-15', null, 'izzul'),
    change('2026-06-10', 'fadli', 'amer', { relationship: 'functional' }),
  ];

  it('answers from the change in effect on the date', () => {
    expect(managerOnDate(history, 'fadli', '2026-04-02')).toEqual({
      basis: 'recorded',
      managerId: 'izzul',
      since: '2026-03-15',
    });
    expect(managerOnDate(history, 'fadli', '2026-09-01')).toEqual({
      basis: 'recorded',
      managerId: 'fadli',
      since: '2026-09-01',
    });
  });

  it('before the record starts, gives the line the first change replaced and says so', () => {
    expect(managerOnDate(history, 'fadli', '2026-01-20')).toEqual({
      basis: 'before_record',
      managerId: null,
      recordStarts: '2026-03-15',
    });
  });

  it('does not read a dotted-line change as the reporting line', () => {
    const found = managerOnDate(history, 'fadli', '2026-07-01');
    expect(found).toMatchObject({ managerId: 'izzul' });
  });

  it('orders two changes effective the same day by when they were entered', () => {
    const sameDay = [
      change('2026-05-01', 'b', 'c', { changedAt: '2026-05-03T10:00:00Z' }),
      change('2026-05-01', 'a', 'b', { changedAt: '2026-05-02T10:00:00Z' }),
    ];
    expect(managerOnDate(sameDay, 'c', '2026-05-01')).toMatchObject({ managerId: 'c' });
  });

  it('with nothing recorded, can only say what the line is now', () => {
    expect(managerOnDate([], 'izzul', '2026-03-01')).toEqual({
      basis: 'no_record',
      managerId: 'izzul',
    });
  });

  it('reads the dotted line when asked for it', () => {
    expect(managerOnDate(history, null, '2026-07-01', 'functional')).toMatchObject({
      basis: 'recorded',
      managerId: 'amer',
    });
  });
});
