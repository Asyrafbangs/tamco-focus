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

/**
 * How far the zone is from UTC at a given instant, in milliseconds.
 *
 * Read from `Intl` rather than kept in a table, so it is right across a
 * daylight-saving boundary in the zones that have one.
 */
function zoneOffsetMs(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(utcMs));
  const field = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? '0');
  const asUtc = Date.UTC(
    field('year'),
    field('month') - 1,
    field('day'),
    field('hour') % 24,
    field('minute'),
    field('second'),
  );
  return asUtc - utcMs;
}

/**
 * The instant a local wall-clock time happens.
 *
 * Every boundary here used to be built with `Date.UTC`, which is only correct
 * for somebody in UTC. In Malaysia that shifted every period by eight hours:
 * a range "1 Jan to 31 Mar" actually ran from 08:00 on 1 January to 08:00 on
 * 1 April, so work closed on the morning of the first day was missing and work
 * closed on the morning after the last was counted. The report was wrong at
 * both ends, quietly, and only by a few items.
 *
 * Resolved twice because the offset depends on the instant, which is what is
 * being computed; the second pass settles a daylight-saving boundary.
 */
function zonedInstant(
  timeZone: string,
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
  ms = 0,
): number {
  const naive = Date.UTC(year, month, day, hour, minute, second, ms);
  const first = naive - zoneOffsetMs(naive, timeZone);
  return naive - zoneOffsetMs(first, timeZone);
}

/** Today's date in the viewer's zone, as year / month / day. */
function zonedToday(now: Date, timeZone: string) {
  const shifted = new Date(now.getTime() + zoneOffsetMs(now.getTime(), timeZone));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
  };
}

function preset(key: PeriodPresetKey): Preset {
  return PERIOD_PRESETS.find((entry) => entry.key === key)!;
}

function rangeOf(
  key: PeriodPresetKey,
  now: Date,
  timeZone: string,
): { since: string; until: string | null } {
  const { year, month } = zonedToday(now, timeZone);
  const at = (y: number, m: number, d: number) =>
    new Date(zonedInstant(timeZone, y, m, d)).toISOString();
  /** The last millisecond before the given local midnight. */
  const endOfDayBefore = (y: number, m: number, d: number) =>
    new Date(zonedInstant(timeZone, y, m, d) - 1).toISOString();

  switch (key) {
    case 'all':
      // Not "no filter": a resolved period always has a lower bound, so every
      // caller can read `since` without asking which kind of period it is.
      return { since: new Date(0).toISOString(), until: null };
    case 'this-month':
      return { since: at(year, month, 1), until: null };
    case 'last-month':
      return { since: at(year, month - 1, 1), until: endOfDayBefore(year, month, 1) };
    case 'this-year':
      return { since: at(year, 0, 1), until: null };
    case 'last-year':
      return { since: at(year - 1, 0, 1), until: endOfDayBefore(year, 0, 1) };
    default:
      // Rolling counts run back from this instant, not from a local midnight:
      // "the last 30 days" means the last 30 days.
      return { since: new Date(now.getTime() - Number(key) * DAY_MS).toISOString(), until: null };
  }
}

/** The zone a period is read in when a caller has not said. */
export const DEFAULT_TIME_ZONE = 'Asia/Kuala_Lumpur';

/** Day and month, or the full date when it is not this year. */
function dayWords(date: string, timeZone: string, now: Date): string {
  const at = new Date(`${date}T12:00:00.000Z`);
  const sameYear =
    new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric' }).format(at) ===
    new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric' }).format(now);
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  }).format(at);
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
  timeZone: string = DEFAULT_TIME_ZONE,
): ResolvedPeriod {
  if (key === 'custom' && (isDate(from) || isDate(to))) {
    /*
     * Two dates make a range; which box each was typed into does not.
     *
     * A range entered the wrong way round used to be honoured literally, so
     * `since` came after `until` and the query could not match anything. The
     * screen then reported "0 completed" — a statement about the team, made
     * from a period that cannot contain anything. Ordering them says what the
     * person meant, and the control's label shows which range was applied.
     *
     * One date alone is a real question too: everything since a day, or
     * everything up to one. Which it is comes from which box it was in.
     */
    const both = isDate(from) && isDate(to);
    const ordered = both ? [from!, to!].sort() : null;
    const opensOn = ordered ? ordered[0]! : isDate(from) ? from : null;
    const closesOn = ordered ? ordered[1]! : isDate(to) ? to : null;

    const dayStart = (date: string) =>
      new Date(
        zonedInstant(
          timeZone,
          Number(date.slice(0, 4)),
          Number(date.slice(5, 7)) - 1,
          Number(date.slice(8, 10)),
        ),
      ).toISOString();
    /* The last millisecond of the closing day: a range ending "31 March" that
       stopped at its midnight would drop everything closed that day. */
    const dayEnd = (date: string) =>
      new Date(
        zonedInstant(
          timeZone,
          Number(date.slice(0, 4)),
          Number(date.slice(5, 7)) - 1,
          Number(date.slice(8, 10)) + 1,
        ) - 1,
      ).toISOString();

    const opensWords = opensOn ? dayWords(opensOn, timeZone, now) : null;
    const closesWords = closesOn ? dayWords(closesOn, timeZone, now) : null;
    const label =
      opensWords && closesWords
        ? `${opensWords} to ${closesWords}`
        : opensWords
          ? `${opensWords} onwards`
          : `up to ${closesWords}`;

    return {
      key: 'custom',
      label,
      short: label,
      phrase:
        opensWords && closesWords
          ? `between ${opensWords} and ${closesWords}`
          : opensWords
            ? `since ${opensWords}`
            : `up to ${closesWords}`,
      since: opensOn ? dayStart(opensOn) : new Date(0).toISOString(),
      until: closesOn ? dayEnd(closesOn) : null,
      from: opensOn,
      to: closesOn,
    };
  }

  const match = PERIOD_PRESETS.find((entry) => entry.key === key) ?? preset(fallback);
  const { since, until } = rangeOf(match.key, now, timeZone);
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
