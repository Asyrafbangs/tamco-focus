import { describe, expect, it } from 'vitest';

import { IMPLAUSIBLE_YEARS_AHEAD, isImplausibleDate, latestPlausibleDate } from '@/domain/delivery';

const NOW = new Date('2026-08-31T04:00:00.000Z');

describe('isImplausibleDate', () => {
  it('accepts every date somebody would really commit to', () => {
    expect(isImplausibleDate(null, NOW)).toBe(false);
    expect(isImplausibleDate(undefined, NOW)).toBe(false);
    expect(isImplausibleDate('2026-09-15', NOW)).toBe(false);
    expect(isImplausibleDate('2030-01-01', NOW)).toBe(false);
    // The boundary itself is allowed: the check is for a slipped digit, not
    // an opinion about how far ahead anybody may plan.
    expect(isImplausibleDate(`${NOW.getUTCFullYear() + IMPLAUSIBLE_YEARS_AHEAD}-12-31`, NOW)).toBe(
      false,
    );
  });

  it('catches the year with a slipped digit', () => {
    // The one that reached a manager's backlog: 2926 for 2026. It is never
    // overdue and never due today, so nothing else in the product notices it.
    expect(isImplausibleDate('2926-09-15', NOW)).toBe(true);
    expect(isImplausibleDate(`${NOW.getUTCFullYear() + 11}-01-01`, NOW)).toBe(true);
  });

  it('does not reject text it cannot read as a date', () => {
    // Shape is somebody else's job; claiming a malformed string is "too far
    // ahead" would be a confusing answer to a different problem.
    expect(isImplausibleDate('not-a-date', NOW)).toBe(false);
  });
});

describe('latestPlausibleDate', () => {
  it('matches the boundary the server enforces, so a form cannot disagree', () => {
    const max = latestPlausibleDate(NOW);
    expect(max).toBe('2036-12-31');
    expect(isImplausibleDate(max, NOW)).toBe(false);
    expect(isImplausibleDate('2037-01-01', NOW)).toBe(true);
  });
});
