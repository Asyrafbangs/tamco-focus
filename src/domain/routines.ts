/**
 * How a routine repeats, in words and in fields.
 *
 * `focus.next_occurrence_date` understands three frequencies and an interval:
 *
 *   daily    every `intervalCount` days
 *   weekly   the next `weekday`, then `intervalCount - 1` further weeks
 *   monthly  `intervalCount` months on, clamped to `dayOfMonth`
 *
 * Which means quarterly already worked — it is monthly with an interval of 3 —
 * and so did yearly and fortnightly. What was missing was any way to say so.
 * The interface had no routine setup at all, and the recurrence enum's three
 * bare values made it look as though monthly was the longest cycle possible.
 *
 * This is the only translation between the phrase somebody picks and the
 * columns stored, so the words on screen and the dates generated cannot drift.
 */

export type RecurrenceFrequency = 'daily' | 'weekly' | 'monthly';

export interface RoutineCadence {
  id: string;
  label: string;
  frequency: RecurrenceFrequency;
  intervalCount: number;
  /** Whether the person must also pick a weekday or a day of the month. */
  needs: 'weekday' | 'day_of_month' | 'nothing';
}

/**
 * Ordered by how often people actually need them, not by cycle length. Custom
 * is last because it is an escape hatch, not a starting point.
 */
export const ROUTINE_CADENCES: readonly RoutineCadence[] = [
  { id: 'daily', label: 'Every day', frequency: 'daily', intervalCount: 1, needs: 'nothing' },
  { id: 'weekly', label: 'Weekly', frequency: 'weekly', intervalCount: 1, needs: 'weekday' },
  {
    id: 'fortnightly',
    label: 'Every 2 weeks',
    frequency: 'weekly',
    intervalCount: 2,
    needs: 'weekday',
  },
  {
    id: 'monthly',
    label: 'Monthly',
    frequency: 'monthly',
    intervalCount: 1,
    needs: 'day_of_month',
  },
  {
    id: 'quarterly',
    label: 'Quarterly (every 3 months)',
    frequency: 'monthly',
    intervalCount: 3,
    needs: 'day_of_month',
  },
  {
    id: 'half_yearly',
    label: 'Every 6 months',
    frequency: 'monthly',
    intervalCount: 6,
    needs: 'day_of_month',
  },
  {
    id: 'yearly',
    label: 'Yearly',
    frequency: 'monthly',
    intervalCount: 12,
    needs: 'day_of_month',
  },
  {
    id: 'custom',
    label: 'Custom…',
    frequency: 'monthly',
    intervalCount: 1,
    needs: 'day_of_month',
  },
] as const;

export const WEEKDAY_LABELS: readonly { value: number; label: string }[] = [
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
  { value: 7, label: 'Sunday' },
];

/**
 * The stored schedule read back as the phrase somebody would recognise.
 *
 * Used on the routine list so a manager can see "Quarterly on the 15th" rather
 * than having to decode `monthly / 3 / 15`.
 */
export function describeCadence(schedule: {
  frequency: RecurrenceFrequency;
  intervalCount: number;
  weekday: number | null;
  dayOfMonth: number | null;
}): string {
  const { frequency, intervalCount, weekday, dayOfMonth } = schedule;

  if (frequency === 'daily') {
    return intervalCount === 1 ? 'Every day' : `Every ${intervalCount} days`;
  }

  if (frequency === 'weekly') {
    const day = WEEKDAY_LABELS.find((entry) => entry.value === weekday)?.label ?? 'a chosen day';
    return intervalCount === 1 ? `Weekly on ${day}` : `Every ${intervalCount} weeks on ${day}`;
  }

  const day = dayOfMonth ? `the ${ordinal(dayOfMonth)}` : 'a chosen date';
  const named: Record<number, string> = {
    1: 'Monthly',
    3: 'Quarterly',
    6: 'Every 6 months',
    12: 'Yearly',
  };
  const cycle = named[intervalCount] ?? `Every ${intervalCount} months`;
  return `${cycle} on ${day}`;
}

/** Matches a stored schedule back to a cadence option, or 'custom'. */
export function cadenceIdFor(schedule: {
  frequency: RecurrenceFrequency;
  intervalCount: number;
}): string {
  const match = ROUTINE_CADENCES.find(
    (cadence) =>
      cadence.id !== 'custom' &&
      cadence.frequency === schedule.frequency &&
      cadence.intervalCount === schedule.intervalCount,
  );
  return match?.id ?? 'custom';
}

function ordinal(value: number): string {
  const remainderTen = value % 10;
  const remainderHundred = value % 100;
  if (remainderTen === 1 && remainderHundred !== 11) return `${value}st`;
  if (remainderTen === 2 && remainderHundred !== 12) return `${value}nd`;
  if (remainderTen === 3 && remainderHundred !== 13) return `${value}rd`;
  return `${value}th`;
}
