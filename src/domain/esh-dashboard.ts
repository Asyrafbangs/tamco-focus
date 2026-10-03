/**
 * What the dashboards actually say (v230, §33).
 *
 * Counters are not a dashboard. "14 open" means nothing without whether that
 * is more or fewer than last month, how long the oldest has been waiting, and
 * whether what closes, closes on time. The arithmetic behind those sentences
 * lives here so it can be argued with in a test rather than in a browser.
 */

export interface MonthPoint {
  month: string;
  opened: number;
  closed: number;
}

export interface ClosureFacts {
  closed: number;
  onTime: number;
  late: number;
  medianDays: number;
}

export interface DashboardData {
  asOf: string;
  openFindings: number;
  overdueActions: number;
  awaitingVerification: number;
  oldestOpenDays: number;
  openByRisk: Record<string, number>;
  openByAge: { under30: number; from30to90: number; over90: number };
  closure: ClosureFacts;
  monthly: MonthPoint[];
  byDepartment: Array<{ name: string; openFindings: number; overdue: number }>;
}

/** The public page carries the same figures without the department table. */
export type PublicDashboardData = Omit<
  DashboardData,
  'byDepartment' | 'awaitingVerification' | 'oldestOpenDays'
>;

export const RISK_ORDER = ['critical', 'high', 'medium', 'low', 'not_assessed'] as const;

export const RISK_LABELS: Record<string, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  not_assessed: 'Not assessed',
};

/** Risks in severity order, skipping the ones nothing is sitting in. */
export function riskBars(openByRisk: Record<string, number>): Array<{
  key: string;
  label: string;
  count: number;
  share: number;
}> {
  const total = Object.values(openByRisk).reduce((sum, n) => sum + n, 0);
  return RISK_ORDER.filter((key) => (openByRisk[key] ?? 0) > 0).map((key) => {
    const count = openByRisk[key] ?? 0;
    return {
      key,
      label: RISK_LABELS[key] ?? key,
      count,
      share: total === 0 ? 0 : Math.round((count / total) * 100),
    };
  });
}

/**
 * Whether the backlog is growing, over the months shown.
 *
 * Deliberately the whole period rather than the latest month: one quiet month
 * is weather, and a dashboard that swings between "improving" and "worsening"
 * every time somebody records a finding teaches people to ignore it. The
 * current month is excluded because it is not over — comparing eleven days
 * against a full month always reads as improvement.
 */
/**
 * How many recordings and closures a direction needs behind it.
 *
 * A product judgement rather than a derived figure, kept here so it can be
 * changed in one place: below this many events a single closure flips the
 * direction, and a public sentence that reverses month to month without the
 * work changing is worse than no sentence.
 */
export const TREND_MINIMUM_EVENTS = 10;
export function backlogTrend(monthly: MonthPoint[]): {
  opened: number;
  closed: number;
  direction: 'growing' | 'shrinking' | 'level' | 'too-early';
  words: string;
} {
  const complete = monthly.slice(0, -1);
  const opened = complete.reduce((sum, point) => sum + point.opened, 0);
  const closed = complete.reduce((sum, point) => sum + point.closed, 0);
  const months = complete.length;
  if (months === 0 || (opened === 0 && closed === 0)) {
    return { opened, closed, direction: 'level', words: 'Nothing recorded or closed yet.' };
  }
  const span = `over the last ${months} complete month${months === 1 ? '' : 's'}`;
  /*
   * A direction needs both sides to have happened.
   *
   * With nothing closed there is no rate to compare one against, so "the
   * backlog grew" is not a finding about how the work is going — it is the
   * arithmetic of a register that is young. On the sign-in-free page it was
   * the first sentence everybody in the company read, in amber, about five
   * recordings and no closures.
   *
   * The same rule `onTimeRate` already follows: a figure computed from no
   * closures is not a measurement, and showing one is how a dashboard starts
   * lying on its first day. The fact is still stated, plainly and in full.
   */
  if (closed === 0) {
    return {
      opened,
      closed,
      direction: 'too-early',
      words: `${opened} recorded ${span}, and nothing has closed yet.`,
    };
  }
  if (opened === closed) {
    return {
      opened,
      closed,
      direction: 'level',
      words: `Keeping pace ${span}: ${opened} recorded, ${closed} closed.`,
    };
  }
  /*
   * A direction also needs enough behind it to survive one more closure.
   *
   * "The backlog grew: 3 recorded against 2 closed" is arithmetic, not a
   * trend: one late closure the following week reverses it, so the sentence
   * everybody reads on the sign-in-free page would swing between grew and
   * shrank while the work itself was unchanged. Below the floor the two
   * numbers are still stated in full - nothing is hidden, and no direction is
   * claimed on their behalf.
   *
   * Ten is a judgement, not a measurement, which is why it is a named
   * constant: change it in one place. It was chosen because below it a single
   * event moves the difference by more than a tenth of the total.
   */
  if (opened + closed < TREND_MINIMUM_EVENTS) {
    return {
      opened,
      closed,
      direction: 'too-early',
      words: `${opened} recorded and ${closed} closed ${span}, which is too few to call a direction.`,
    };
  }
  const growing = opened > closed;
  return {
    opened,
    closed,
    direction: growing ? 'growing' : 'shrinking',
    words: growing
      ? `The backlog grew ${span}: ${opened} recorded against ${closed} closed.`
      : `The backlog shrank ${span}: ${closed} closed against ${opened} recorded.`,
  };
}

/**
 * How much closed by the date first promised.
 *
 * Returns null rather than 100% when nothing has closed: a rate computed from
 * no closures is not a good score, and showing one is how a dashboard starts
 * lying on its first day.
 */
export function onTimeRate(closure: ClosureFacts): number | null {
  if (closure.closed === 0) return null;
  return Math.round((closure.onTime / closure.closed) * 100);
}

/** The one line worth reading if somebody reads nothing else. */
export function headline(data: Pick<DashboardData, 'openFindings' | 'overdueActions'>): string {
  if (data.openFindings === 0) return 'Nothing is open.';
  const open = `${data.openFindings} finding${data.openFindings === 1 ? '' : 's'} open`;
  if (data.overdueActions === 0) return `${open}, none overdue.`;
  return `${open}, ${data.overdueActions} past ${data.overdueActions === 1 ? 'its' : 'their'} due date.`;
}

/** Ageing, worst first, because the oldest is the one that needs explaining. */
export function ageBars(openByAge: DashboardData['openByAge']): Array<{
  label: string;
  count: number;
  exception: boolean;
}> {
  return [
    { label: 'Over 90 days', count: openByAge.over90, exception: openByAge.over90 > 0 },
    { label: '30 to 90 days', count: openByAge.from30to90, exception: false },
    { label: 'Under 30 days', count: openByAge.under30, exception: false },
  ];
}
