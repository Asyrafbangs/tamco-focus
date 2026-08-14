/**
 * How a routine repeats, in words and in fields.
 *
 * This replaced a list of fixed cadences — Weekly, Monthly, Quarterly, Yearly,
 * Custom — each of which was a frequency and an interval in disguise. It read
 * simply and could not express what people actually schedule. "The first
 * Wednesday of every month" had no representation at all, and Yearly was
 * stored as monthly with an interval of twelve, which produced a schedule that
 * described itself as "Yearly on the 5th": the 5th of no particular month.
 *
 * The model here is the one people already know from a calendar client: a
 * pattern, a start, and an end. `focus.next_occurrence_date` reads exactly
 * these fields, so the sentence on screen and the dates generated are the same
 * description twice rather than two descriptions that can drift.
 */

export type RecurrenceFrequency = 'daily' | 'weekly' | 'monthly' | 'yearly';

/** "Day 5 of the month" versus "the first Wednesday of the month". */
export type MonthlyMode = 'day_of_month' | 'nth_weekday';

export type EndsMode = 'never' | 'after' | 'on_date';

export interface RecurrencePattern {
  frequency: RecurrenceFrequency;
  /** Every N days / weeks / months / years. */
  intervalCount: number;
  /** ISO weekdays, 1 = Monday. Weekly can repeat on several. */
  weekdays: number[];
  monthlyMode: MonthlyMode;
  dayOfMonth: number;
  /** 1-4, or -1 for last. */
  nthWeekday: number;
  nthWeekdayDow: number;
  /** 1-12, for yearly. */
  monthOfYear: number;
  startDate: string;
  endsMode: EndsMode;
  endsAfterCount: number | null;
  endsOnDate: string | null;
}

export const WEEKDAY_LABELS: readonly string[] = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
];

export const WEEKDAY_SHORT: readonly string[] = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export const MONTH_LABELS: readonly string[] = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/**
 * "Last" is deliberately not "fifth". Not every month has a fifth Wednesday,
 * but every month has a last one, so they are different promises.
 */
export const NTH_OPTIONS: readonly { value: number; label: string }[] = [
  { value: 1, label: 'first' },
  { value: 2, label: 'second' },
  { value: 3, label: 'third' },
  { value: 4, label: 'fourth' },
  { value: -1, label: 'last' },
];

export const FREQUENCY_LABELS: Record<RecurrenceFrequency, string> = {
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
  yearly: 'Yearly',
};

function nthLabel(value: number): string {
  return NTH_OPTIONS.find((option) => option.value === value)?.label ?? 'first';
}

function weekdayList(days: number[]): string {
  const names = [...days]
    .sort((a, b) => a - b)
    .map((day) => WEEKDAY_LABELS[day - 1] ?? '')
    .filter(Boolean);
  if (names.length === 0) return 'no day';
  if (names.length === 1) return names[0]!;
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

function everyPhrase(count: number, unit: string): string {
  return count === 1 ? `every ${unit}` : `every ${count} ${unit}s`;
}

/** Today in the browser's local zone, as `YYYY-MM-DD`. */
export function todayIso(): string {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

export function defaultPattern(startDate = todayIso()): RecurrencePattern {
  const start = new Date(`${startDate}T12:00:00Z`);
  const isoDow = ((start.getUTCDay() + 6) % 7) + 1;
  return {
    frequency: 'weekly',
    intervalCount: 1,
    weekdays: [isoDow],
    monthlyMode: 'day_of_month',
    dayOfMonth: start.getUTCDate(),
    nthWeekday: Math.min(Math.ceil(start.getUTCDate() / 7), 4),
    nthWeekdayDow: isoDow,
    monthOfYear: start.getUTCMonth() + 1,
    startDate,
    endsMode: 'never',
    endsAfterCount: null,
    endsOnDate: null,
  };
}

/** The recurrence as a sentence, without the ending. */
export function describePattern(pattern: RecurrencePattern): string {
  const { frequency, intervalCount: every } = pattern;

  if (frequency === 'daily') {
    return every === 1 ? 'Every day' : `Every ${every} days`;
  }

  if (frequency === 'weekly') {
    return `${capitalise(everyPhrase(every, 'week'))} on ${weekdayList(pattern.weekdays)}`;
  }

  const monthUnit = frequency === 'yearly' ? 'year' : 'month';
  const cycle = everyPhrase(every, monthUnit);

  if (pattern.monthlyMode === 'nth_weekday') {
    const which = `the ${nthLabel(pattern.nthWeekday)} ${WEEKDAY_LABELS[pattern.nthWeekdayDow - 1] ?? 'Monday'}`;
    return frequency === 'yearly'
      ? `${capitalise(which)} of ${MONTH_LABELS[pattern.monthOfYear - 1]}, ${cycle}`
      : `${capitalise(which)} of ${cycle}`;
  }

  return frequency === 'yearly'
    ? `${capitalise(cycle)} on ${pattern.dayOfMonth} ${MONTH_LABELS[pattern.monthOfYear - 1]}`
    : `Day ${pattern.dayOfMonth} of ${cycle}`;
}

function capitalise(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatDate(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/** How the series ends, or an empty string when it does not. */
export function describeEnding(pattern: RecurrencePattern): string {
  if (pattern.endsMode === 'after' && pattern.endsAfterCount) {
    return `${pattern.endsAfterCount} time${pattern.endsAfterCount === 1 ? '' : 's'}`;
  }
  if (pattern.endsMode === 'on_date' && pattern.endsOnDate) {
    return `until ${formatDate(pattern.endsOnDate)}`;
  }
  return '';
}

/** The whole recurrence, as one line for a list row or a preview. */
export function describeRecurrence(pattern: RecurrencePattern): string {
  const ending = describeEnding(pattern);
  return ending ? `${describePattern(pattern)} · ${ending}` : describePattern(pattern);
}

/**
 * What the stored columns look like for this pattern.
 *
 * Fields belonging to a frequency that is not selected are sent as null rather
 * than left over from an earlier choice, because a check constraint rejects a
 * schedule that is described two ways at once — and rightly: a routine that is
 * both "day 5" and "the first Wednesday" has no single meaning.
 */
export function patternToColumns(pattern: RecurrencePattern) {
  const monthly = pattern.frequency === 'monthly' || pattern.frequency === 'yearly';
  const byWeekday = monthly && pattern.monthlyMode === 'nth_weekday';
  return {
    frequency: pattern.frequency,
    intervalCount: pattern.intervalCount,
    weekdays: pattern.frequency === 'weekly' ? [...pattern.weekdays].sort((a, b) => a - b) : null,
    monthlyMode: monthly ? pattern.monthlyMode : null,
    dayOfMonth: monthly && !byWeekday ? pattern.dayOfMonth : null,
    nthWeekday: byWeekday ? pattern.nthWeekday : null,
    nthWeekdayDow: byWeekday ? pattern.nthWeekdayDow : null,
    monthOfYear: pattern.frequency === 'yearly' ? pattern.monthOfYear : null,
    startDate: pattern.startDate,
    endsMode: pattern.endsMode,
    endsAfterCount: pattern.endsMode === 'after' ? pattern.endsAfterCount : null,
    endsOnDate: pattern.endsMode === 'on_date' ? pattern.endsOnDate : null,
  };
}

/** The reverse, for opening an existing routine in the editor. */
export function patternFromRow(row: {
  frequency: string;
  intervalCount: number;
  weekdays: number[] | null;
  weekday: number | null;
  monthlyMode: string | null;
  dayOfMonth: number | null;
  nthWeekday: number | null;
  nthWeekdayDow: number | null;
  monthOfYear: number | null;
  startDate: string | null;
  endsMode: string | null;
  endsAfterCount: number | null;
  endsOnDate: string | null;
}): RecurrencePattern {
  const base = defaultPattern(row.startDate ?? todayIso());
  return {
    ...base,
    frequency: (row.frequency as RecurrenceFrequency) ?? 'weekly',
    intervalCount: row.intervalCount || 1,
    weekdays: row.weekdays?.length ? row.weekdays : row.weekday ? [row.weekday] : base.weekdays,
    monthlyMode: (row.monthlyMode as MonthlyMode) ?? 'day_of_month',
    dayOfMonth: row.dayOfMonth ?? base.dayOfMonth,
    nthWeekday: row.nthWeekday ?? base.nthWeekday,
    nthWeekdayDow: row.nthWeekdayDow ?? base.nthWeekdayDow,
    monthOfYear: row.monthOfYear ?? base.monthOfYear,
    endsMode: (row.endsMode as EndsMode) ?? 'never',
    endsAfterCount: row.endsAfterCount,
    endsOnDate: row.endsOnDate,
  };
}

/** The first thing wrong with this pattern, or null. Mirrors the server check. */
export function validatePattern(pattern: RecurrencePattern): string | null {
  if (
    !Number.isInteger(pattern.intervalCount) ||
    pattern.intervalCount < 1 ||
    pattern.intervalCount > 99
  ) {
    return 'Repeat every must be between 1 and 99.';
  }
  if (pattern.frequency === 'weekly' && pattern.weekdays.length === 0) {
    return 'Choose at least one day of the week.';
  }
  if (
    (pattern.frequency === 'monthly' || pattern.frequency === 'yearly') &&
    pattern.monthlyMode === 'day_of_month' &&
    (pattern.dayOfMonth < 1 || pattern.dayOfMonth > 31)
  ) {
    return 'Choose which day of the month this repeats on.';
  }
  if (pattern.endsMode === 'after' && (!pattern.endsAfterCount || pattern.endsAfterCount < 1)) {
    return 'Enter how many times this should happen.';
  }
  if (pattern.endsMode === 'on_date') {
    if (!pattern.endsOnDate) return 'Choose the date the series ends on.';
    if (pattern.endsOnDate < pattern.startDate) {
      return 'The end date cannot be before the start date.';
    }
  }
  return null;
}
