import { describe, expect, it } from 'vitest';

import {
  DEFAULT_PERIOD,
  PERIOD_PRESETS,
  RECORD_PERIODS,
  ROUTINE_PERIODS,
  STANDARD_PERIODS,
  periodParams,
  resolvePeriod,
  todayIso,
  type PeriodPresetKey,
} from '@/domain/period';

/**
 * The one period model, which four screens now share.
 *
 * Most of what is asserted here was previously spread across three
 * implementations that disagreed: My Team's window could only ever run up to
 * now, so it had no upper bound at all and "Last year" was not offered because
 * it could not have been expressed.
 */

const NOW = new Date('2026-08-31T04:00:00.000Z');
/** The fixtures are read by people in Malaysia, eight hours ahead of UTC. */
const KL = 'Asia/Kuala_Lumpur';

describe('resolvePeriod', () => {
  it('falls back to the default rather than showing nothing', () => {
    // A junk parameter comes from a URL somebody kept. It should not produce
    // an empty list, which reads as "you have completed nothing".
    expect(resolvePeriod(undefined, undefined, undefined, NOW).key).toBe(DEFAULT_PERIOD);
    expect(resolvePeriod('all-time', undefined, undefined, NOW).key).toBe(DEFAULT_PERIOD);
    expect(resolvePeriod('', undefined, undefined, NOW).key).toBe(DEFAULT_PERIOD);
    expect(resolvePeriod('90', undefined, undefined, NOW).key).toBe('90');
  });

  it('rolls day counts back from now, so a list is never empty at 00:05', () => {
    expect(resolvePeriod('30', undefined, undefined, NOW).since).toBe('2026-08-01T04:00:00.000Z');
    expect(resolvePeriod('90', undefined, undefined, NOW).since).toBe('2026-06-02T04:00:00.000Z');
    // Open-ended: a rolling count runs up to now.
    expect(resolvePeriod('30', undefined, undefined, NOW).until).toBeNull();
  });

  it('closes the periods that have an end, which the old window could not', () => {
    /*
     * This is the bug the shared model fixes rather than inherits. My Team
     * resolved a window to a single `since`, so had it offered "Last year" the
     * figure would have meant "everything since last January" — twenty months
     * of work under a label promising twelve.
     */
    const lastYear = resolvePeriod('last-year', undefined, undefined, NOW, DEFAULT_PERIOD, KL);
    expect(lastYear.since).toBe('2024-12-31T16:00:00.000Z');
    expect(lastYear.until).toBe('2025-12-31T15:59:59.999Z');

    const lastMonth = resolvePeriod('last-month', undefined, undefined, NOW, DEFAULT_PERIOD, KL);
    expect(lastMonth.since).toBe('2026-06-30T16:00:00.000Z');
    expect(lastMonth.until).toBe('2026-07-31T15:59:59.999Z');
  });

  it('starts a calendar period at local midnight, not at UTC midnight', () => {
    /*
     * Every boundary was built with `Date.UTC`, which is only right for
     * somebody in UTC. Eight hours east that shifted the whole period: "this
     * year" began at 08:00 on 1 January, so work closed that morning was
     * missing from it, and the extra eight hours came off the far end instead.
     */
    const thisYear = resolvePeriod('this-year', undefined, undefined, NOW, DEFAULT_PERIOD, KL);
    expect(thisYear.since).toBe('2025-12-31T16:00:00.000Z');
    expect(thisYear.until).toBeNull();

    const thisMonth = resolvePeriod('this-month', undefined, undefined, NOW, DEFAULT_PERIOD, KL);
    expect(thisMonth.since).toBe('2026-07-31T16:00:00.000Z');
  });

  it('takes a custom range whole, both ends inclusive, in the viewer zone', () => {
    const range = resolvePeriod('custom', '2026-03-01', '2026-03-31', NOW, DEFAULT_PERIOD, KL);
    expect(range.key).toBe('custom');
    // Local midnight on 1 March, which is 16:00 the day before in UTC.
    expect(range.since).toBe('2026-02-28T16:00:00.000Z');
    // To the last millisecond of the closing day: a range ending "31 March"
    // that stopped at midnight would silently drop everything closed that day.
    expect(range.until).toBe('2026-03-31T15:59:59.999Z');
    // Written the way every other date in the product is written.
    expect(range.label).toBe('1 Mar to 31 Mar');
  });

  it('allows an open-ended custom range', () => {
    const range = resolvePeriod('custom', '2026-03-01', undefined, NOW, DEFAULT_PERIOD, KL);
    expect(range.until).toBeNull();
    expect(range.label).toBe('1 Mar onwards');
  });

  it('reads a range entered the wrong way round as the range it describes', () => {
    /*
     * Typing the later date into "From" used to be honoured literally, so
     * `since` came after `until` and nothing could match. The screen then
     * reported "0 completed" — a claim about the team, made from a period that
     * cannot contain anything.
     */
    const backwards = resolvePeriod('custom', '2026-03-31', '2026-01-01', NOW, DEFAULT_PERIOD, KL);
    const forwards = resolvePeriod('custom', '2026-01-01', '2026-03-31', NOW, DEFAULT_PERIOD, KL);
    expect(backwards.since).toBe(forwards.since);
    expect(backwards.until).toBe(forwards.until);
    expect(backwards.since < backwards.until!).toBe(true);
    // And the control says which range was applied, rather than echoing the
    // order the boxes were filled in.
    expect(backwards.label).toBe(forwards.label);
  });

  it('reads one date as the question it is, from either box', () => {
    // "To" alone used to be refused by the form, and the message explaining
    // that was destroyed with the menu on the same click.
    const upTo = resolvePeriod('custom', undefined, '2026-03-31', NOW, DEFAULT_PERIOD, KL);
    expect(upTo.key).toBe('custom');
    expect(upTo.until).toBe('2026-03-31T15:59:59.999Z');
    expect(upTo.label).toBe('up to 31 Mar');

    const since = resolvePeriod('custom', '2026-03-01', undefined, NOW, DEFAULT_PERIOD, KL);
    expect(since.since).toBe('2026-02-28T16:00:00.000Z');
    expect(since.until).toBeNull();
    expect(since.label).toBe('1 Mar onwards');
  });

  it('refuses a custom range it cannot read, rather than showing an empty one', () => {
    // Falling back names a period the reader can see. Rendering an empty list
    // would say "nothing was completed", which is a claim, not an error.
    expect(resolvePeriod('custom', undefined, undefined, NOW).key).toBe(DEFAULT_PERIOD);
    expect(resolvePeriod('custom', 'last tuesday', undefined, NOW).key).toBe(DEFAULT_PERIOD);
    expect(resolvePeriod('custom', '01/03/2026', undefined, NOW).key).toBe(DEFAULT_PERIOD);
  });
});

describe('periodParams', () => {
  it('says nothing when the period is the default, so URLs stay clean', () => {
    expect(periodParams(resolvePeriod(undefined, undefined, undefined, NOW))).toEqual({});
  });

  it('carries a preset, and a range with both its dates', () => {
    expect(periodParams(resolvePeriod('90', undefined, undefined, NOW))).toEqual({ period: '90' });
    expect(periodParams(resolvePeriod('custom', '2026-03-01', '2026-03-31', NOW))).toEqual({
      period: 'custom',
      period_from: '2026-03-01',
      period_to: '2026-03-31',
    });
  });

  it('round-trips, so a period survives every link that carries it', () => {
    // The failure this guards: opening a person from My Team dropped the
    // window, and the drawer then said "Last 30 days" under a strip saying 90.
    for (const key of [...STANDARD_PERIODS, ...ROUTINE_PERIODS]) {
      const period = resolvePeriod(key, undefined, undefined, NOW);
      const carried = periodParams(period);
      const again = resolvePeriod(
        carried.period ?? undefined,
        carried.period_from,
        carried.period_to,
        NOW,
      );
      expect(again.key).toBe(period.key);
      expect(again.since).toBe(period.since);
      expect(again.until).toBe(period.until);
    }
  });
});

describe('the offered sets', () => {
  it('name every key they offer', () => {
    for (const key of [...STANDARD_PERIODS, ...ROUTINE_PERIODS]) {
      expect(PERIOD_PRESETS.some((entry) => entry.key === key)).toBe(true);
    }
  });

  it('stay short enough to read', () => {
    // A menu of every preset is a menu nobody reads.
    expect(STANDARD_PERIODS.length).toBeLessThanOrEqual(5);
    expect(ROUTINE_PERIODS.length).toBeLessThanOrEqual(5);
  });
});

describe('a screen never opens on a period its own menu does not offer', () => {
  /*
   * The defect this exists for: Routine → Completed defaulted to a rolling
   * thirty days while its menu offered months, so the button read "Last 30
   * days" above a list where nothing was marked as current — a control that
   * disagreed with itself at rest.
   */
  const DEFAULTS: Array<[string, PeriodPresetKey, readonly PeriodPresetKey[]]> = [
    ['My Team', DEFAULT_PERIOD, STANDARD_PERIODS],
    ['My Work → Completed', DEFAULT_PERIOD, STANDARD_PERIODS],
    ['Routine', 'this-month', ROUTINE_PERIODS],
    ['Records', 'all', RECORD_PERIODS],
  ];

  it.each(DEFAULTS)('%s opens on a period it offers', (_name, fallback, offered) => {
    expect(offered).toContain(fallback);
  });
});

describe('todayIso', () => {
  it('is the latest date a report may be asked about', () => {
    expect(todayIso(NOW)).toBe('2026-08-31');
  });
});
