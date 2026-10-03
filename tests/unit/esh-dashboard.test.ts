import { describe, expect, it } from 'vitest';

import {
  ageBars,
  backlogTrend,
  TREND_MINIMUM_EVENTS,
  headline,
  onTimeRate,
  riskBars,
  type ClosureFacts,
  type MonthPoint,
} from '@/domain/esh-dashboard';

function months(...pairs: Array<[number, number]>): MonthPoint[] {
  return pairs.map(([opened, closed], index) => ({
    month: `2026-0${index + 1}`,
    opened,
    closed,
  }));
}

function closure(overrides: Partial<ClosureFacts> = {}): ClosureFacts {
  return { closed: 0, onTime: 0, late: 0, medianDays: 0, ...overrides };
}

describe('whether the backlog is growing', () => {
  it('ignores the current month, which is not over yet', () => {
    // Five complete months at parity, then a quiet start to this one.
    const trend = backlogTrend(months([4, 4], [4, 4], [4, 4], [4, 4], [4, 4], [0, 3]));
    expect(trend.opened).toBe(20);
    expect(trend.closed).toBe(20);
    expect(trend.direction).toBe('level');
  });

  it('says so plainly when more came in than went out', () => {
    const trend = backlogTrend(months([10, 2], [8, 3], [0, 0]));
    expect(trend.direction).toBe('growing');
    expect(trend.words).toBe(
      'The backlog grew over the last 2 complete months: 18 recorded against 5 closed.',
    );
  });

  it('and when it is coming down', () => {
    const trend = backlogTrend(months([2, 9], [1, 6], [0, 0]));
    expect(trend.direction).toBe('shrinking');
    expect(trend.words).toContain('The backlog shrank');
  });

  it('refuses a direction while nothing has closed', () => {
    /*
     * The sign-in-free page led with "The backlog grew over the last 5
     * complete months: 5 recorded against 0 closed", in amber, to everybody in
     * the company. It was arithmetic about a young register, not a finding
     * about how the work is going: with nothing closed there is no rate to
     * compare the recordings against.
     */
    const trend = backlogTrend(months([2, 0], [3, 0], [0, 0]));
    expect(trend.direction).toBe('too-early');
    expect(trend.words).toBe(
      '5 recorded over the last 2 complete months, and nothing has closed yet.',
    );
    // The figures are not hidden — only the verdict drawn from one of them.
    expect(trend.opened).toBe(5);
    expect(trend.closed).toBe(0);
  });

  it('calls it growing once there is something to compare against', () => {
    const trend = backlogTrend(months([10, 1], [8, 1], [0, 0]));
    expect(trend.direction).toBe('growing');
  });

  it('will not call a direction that one more closure would reverse', () => {
    /*
     * The same fault as the nothing-closed case, one step along: "the backlog
     * grew: 3 recorded against 2 closed" is arithmetic about five events. One
     * closure the following week turns it into shrank, so the first sentence
     * on the sign-in-free page would swing month to month while the work
     * itself was unchanged.
     */
    const trend = backlogTrend(months([3, 2], [0, 0]));
    expect(trend.direction).toBe('too-early');
    expect(trend.words).toBe(
      '3 recorded and 2 closed over the last 1 complete month, which is too few to call a direction.',
    );
    // Stated in full, as ever: it is the verdict that is withheld, not the figures.
    expect(trend.opened).toBe(3);
    expect(trend.closed).toBe(2);
  });

  it('calls the direction as soon as the floor is reached', () => {
    // Exactly TREND_MINIMUM_EVENTS, so the boundary is asserted rather than
    // assumed: an off-by-one here would silence a register that has earned a
    // verdict.
    const trend = backlogTrend(months([6, 4], [0, 0]));
    expect(trend.opened + trend.closed).toBe(TREND_MINIMUM_EVENTS);
    expect(trend.direction).toBe('growing');
  });

  it('still keeps pace at low volume, because that claims no direction', () => {
    const trend = backlogTrend(months([2, 2], [0, 0]));
    expect(trend.direction).toBe('level');
    expect(trend.words).toBe('Keeping pace over the last 1 complete month: 2 recorded, 2 closed.');
  });

  it('claims nothing from an empty register', () => {
    const trend = backlogTrend(months([0, 0], [0, 0]));
    expect(trend.direction).toBe('level');
    expect(trend.words).toBe('Nothing recorded or closed yet.');
  });

  it('survives a single month, which is all a new deployment has', () => {
    expect(backlogTrend(months([3, 1])).words).toBe('Nothing recorded or closed yet.');
  });
});

describe('the on-time rate', () => {
  it('is not a score until something has closed', () => {
    expect(onTimeRate(closure())).toBeNull();
  });

  it('counts only what met the date first promised', () => {
    expect(onTimeRate(closure({ closed: 10, onTime: 7, late: 3 }))).toBe(70);
  });

  it('can be zero, and zero is a number not a blank', () => {
    expect(onTimeRate(closure({ closed: 4, onTime: 0, late: 4 }))).toBe(0);
  });
});

describe('the one line worth reading', () => {
  it('is cheerful only when it should be', () => {
    expect(headline({ openFindings: 0, overdueActions: 0 })).toBe('Nothing is open.');
    expect(headline({ openFindings: 14, overdueActions: 0 })).toBe(
      '14 findings open, none overdue.',
    );
  });

  it('leads with the overdue when there is any', () => {
    expect(headline({ openFindings: 14, overdueActions: 3 })).toBe(
      '14 findings open, 3 past their due date.',
    );
    expect(headline({ openFindings: 1, overdueActions: 1 })).toBe(
      '1 finding open, 1 past its due date.',
    );
  });
});

describe('the bars', () => {
  it('orders risk by severity and skips what is empty', () => {
    const bars = riskBars({ low: 1, critical: 2, high: 1, medium: 0 });
    expect(bars.map((bar) => bar.key)).toEqual(['critical', 'high', 'low']);
    expect(bars[0]?.share).toBe(50);
  });

  it('does not divide by zero on an empty register', () => {
    expect(riskBars({})).toEqual([]);
  });

  it('puts the oldest work first, and flags only that', () => {
    const bars = ageBars({ under30: 5, from30to90: 2, over90: 1 });
    expect(bars.map((bar) => bar.label)).toEqual([
      'Over 90 days',
      '30 to 90 days',
      'Under 30 days',
    ]);
    expect(bars[0]?.exception).toBe(true);
    expect(bars[1]?.exception).toBe(false);
  });

  it('flags nothing when nothing is old', () => {
    expect(ageBars({ under30: 5, from30to90: 0, over90: 0 })[0]?.exception).toBe(false);
  });
});
