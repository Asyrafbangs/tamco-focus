import { describe, expect, it } from 'vitest';

import {
  DEFAULT_DELIVERY_WINDOW,
  IMPLAUSIBLE_YEARS_AHEAD,
  deliveryWindow,
  deliveryWindowSince,
  isImplausibleDate,
  latestPlausibleDate,
} from '@/domain/delivery';

const NOW = new Date('2026-08-31T04:00:00.000Z');

describe('deliveryWindow', () => {
  it('falls back to the default rather than showing nothing', () => {
    // A junk parameter should not produce an empty screen that reads as
    // "this person has delivered nothing".
    expect(deliveryWindow(undefined).key).toBe(DEFAULT_DELIVERY_WINDOW);
    expect(deliveryWindow('all-time').key).toBe(DEFAULT_DELIVERY_WINDOW);
    expect(deliveryWindow('').key).toBe(DEFAULT_DELIVERY_WINDOW);
    expect(deliveryWindow('90').key).toBe('90');
  });

  it('rolls day counts back from now, and bounds the year to the calendar', () => {
    // Rolling, so a list is never nearly empty because the day just started.
    expect(deliveryWindowSince('30', NOW)).toBe('2026-08-01T04:00:00.000Z');
    expect(deliveryWindowSince('90', NOW)).toBe('2026-06-02T04:00:00.000Z');
    // "This year" means the year, which is what the words say.
    expect(deliveryWindowSince('year', NOW)).toBe('2026-01-01T00:00:00.000Z');
  });
});

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
