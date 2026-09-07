/**
 * One vocabulary for "over what period", used by every screen that reports.
 *
 * The app had grown four of these. My Work → Completed offered five presets and
 * a custom range; My Team offered four presets as a segmented strip with no
 * custom range and no "Last year"; Routine → Team offered a fifth set built
 * around months; and Records offered two bare date boxes and no presets at all.
 * Same question on four screens, four answers, and a manager who had learned
 * one of them had learned nothing about the others.
 *
 * A period is a preset key or a custom pair of dates, and it resolves to an
 * ISO half-open range. `until` is null for a period that runs up to now, which
 * every caller reads as "no upper bound".
 */

export type PeriodPresetKey =
  'all' | '30' | '60' | '90' | 'this-month' | 'last-month' | 'this-year' | 'last-year';

export type PeriodKey = PeriodPresetKey | 'custom';

interface Preset {
  key: PeriodPresetKey;
  /** In the menu, and on the button that opens it. */
  label: string;
  /** Beside a figure, where the button label would be too long. */
  short: string;
  /** Inside a sentence: "what your team closed in the last 30 days". */
  phrase: string;
}

/**
 * Rolling day counts first, then the calendar.
 *
 * The day counts roll back from now rather than snapping to midnight, so a
 * list is never nearly empty because the day has only just started. The
 * calendar periods mean what the words mean.
 */
export const PERIOD_PRESETS: readonly Preset[] = [
  { key: 'all', label: 'All time', short: 'all time', phrase: 'in total' },
  { key: '30', label: 'Last 30 days', short: '30 days', phrase: 'in the last 30 days' },
  { key: '60', label: 'Last 60 days', short: '60 days', phrase: 'in the last 60 days' },
  { key: '90', label: 'Last 90 days', short: '90 days', phrase: 'in the last 90 days' },
  { key: 'this-month', label: 'This month', short: 'this month', phrase: 'this month' },
  { key: 'last-month', label: 'Last month', short: 'last month', phrase: 'last month' },
  { key: 'this-year', label: 'This year', short: 'this year', phrase: 'this year' },
  { key: 'last-year', label: 'Last year', short: 'last year', phrase: 'last year' },
];

/**
 * What most screens offer, in this order.
 *
 * Deliberately not every preset: a menu that lists all seven is a menu nobody
 * reads. Months are the exception below, because a routine is scheduled by the
 * month and "this month" is the question its manager actually asks.
 */
export const STANDARD_PERIODS: readonly PeriodPresetKey[] = [
  '30',
  '60',
  '90',
  'this-year',
  'last-year',
];

/**
 * Records is the archive, and the only screen where "all time" belongs.
 *
 * Everywhere else it is deliberately absent: a lifetime figure flatters
 * whoever has been here longest and buries this month under three years of
 * everything. An archive is the exception, because finding one old record is
 * the entire reason to open it — so narrowing it by default would break the
 * screen rather than focus it.
 */
export const RECORD_PERIODS: readonly PeriodPresetKey[] = [
  'all',
  '30',
  '90',
  'this-year',
  'last-year',
];

/** Routine reports on a monthly rhythm, so it leads with months. */
export const ROUTINE_PERIODS: readonly PeriodPresetKey[] = [
  'this-month',
  'last-month',
  '90',
  'this-year',
  'last-year',
];

export const DEFAULT_PERIOD: PeriodPresetKey = '30';

/** A resolved period: what to call it, and the range to read. */
export interface ResolvedPeriod {
  key: PeriodKey;
  label: string;
  short: string;
  phrase: string;
  /** Inclusive lower bound, ISO. */
  since: string;
  /** Inclusive upper bound, ISO, or null for "up to now". */
  until: string | null;
  /** The dates a custom range was built from, so a form can show them again. */
  from: string | null;
  to: string | null;
}

const DAY_MS = 86_400_000;

function isDate(value: string | null | undefined): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function preset(key: PeriodPresetKey): Preset {
  return PERIOD_PRESETS.find((entry) => entry.key === key)!;
}

function rangeOf(key: PeriodPresetKey, now: Date): { since: string; until: string | null } {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  switch (key) {
    case 'all':
      // Not "no filter": a resolved period always has a lower bound, so every
      // caller can read `since` without asking which kind of period it is.
      return { since: new Date(0).toISOString(), until: null };
    case 'this-month':
      return { since: new Date(Date.UTC(year, month, 1)).toISOString(), until: null };
    case 'last-month':
      return {
        since: new Date(Date.UTC(year, month - 1, 1)).toISOString(),
        until: new Date(Date.UTC(year, month, 1) - 1).toISOString(),
      };
    case 'this-year':
      return { since: new Date(Date.UTC(year, 0, 1)).toISOString(), until: null };
    case 'last-year':
      return {
        since: new Date(Date.UTC(year - 1, 0, 1)).toISOString(),
        until: new Date(Date.UTC(year, 0, 1) - 1).toISOString(),
      };
    default:
      return { since: new Date(now.getTime() - Number(key) * DAY_MS).toISOString(), until: null };
  }
}

/**
 * The period a request is asking for, or the default when it asks for nonsense.
 *
 * A junk key falls back rather than erroring: the parameter comes from a URL,
 * and an old bookmark should show a sensible screen rather than a failure.
 *
 * `custom` with no usable `from` also falls back. It used to render as an empty
 * list, which reads as "you have completed nothing" rather than "that range
 * was not understood" — the one thing a report must never say by accident.
 */
export function resolvePeriod(
  key: string | undefined,
  from?: string,
  to?: string,
  now: Date = new Date(),
  fallback: PeriodPresetKey = DEFAULT_PERIOD,
): ResolvedPeriod {
  if (key === 'custom' && isDate(from)) {
    const until = isDate(to) ? new Date(`${to}T23:59:59.999Z`).toISOString() : null;
    return {
      key: 'custom',
      label: isDate(to) ? `${from} to ${to}` : `${from} onwards`,
      short: isDate(to) ? `${from} to ${to}` : `${from} onwards`,
      phrase: isDate(to) ? `between ${from} and ${to}` : `since ${from}`,
      since: new Date(`${from}T00:00:00.000Z`).toISOString(),
      until,
      from,
      to: isDate(to) ? to : null,
    };
  }

  const match = PERIOD_PRESETS.find((entry) => entry.key === key) ?? preset(fallback);
  const { since, until } = rangeOf(match.key, now);
  return {
    key: match.key,
    label: match.label,
    short: match.short,
    phrase: match.phrase,
    since,
    until,
    from: null,
    to: null,
  };
}

/**
 * The query parameter names a period travels under.
 *
 * `period_from` rather than `from`, because Work already uses `from` for the
 * screen a task was opened from — two meanings for one parameter is the kind
 * of collision that reads fine until somebody bookmarks a custom range.
 */
export const PERIOD_PARAM = 'period';
export const PERIOD_FROM_PARAM = 'period_from';
export const PERIOD_TO_PARAM = 'period_to';

/**
 * The period parameters to carry on a link, omitting the default.
 *
 * A URL that says nothing means "the default", so the common case stays clean
 * and `/work?scope=team` keeps working as the address of My Team.
 */
export function periodParams(period: ResolvedPeriod): Record<string, string> {
  if (period.key === DEFAULT_PERIOD) return {};
  if (period.key !== 'custom') return { [PERIOD_PARAM]: period.key };
  const carried: Record<string, string> = { [PERIOD_PARAM]: 'custom' };
  if (period.from) carried[PERIOD_FROM_PARAM] = period.from;
  if (period.to) carried[PERIOD_TO_PARAM] = period.to;
  return carried;
}

/** Today as `yyyy-mm-dd`, the latest date a report may be asked about. */
export function todayIso(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}
