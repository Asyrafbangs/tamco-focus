/**
 * Task age calculation and presentation.
 *
 * Implements MASTER_PRODUCT_SPEC.md sections 31B.5-31B.7 and
 * PRODUCTION_LOGIC.md section 15.
 *
 * This module is the single place durations are calculated. Section 15.4
 * requires desktop, mobile, email, and exports to produce identical values, so
 * every one of those surfaces imports from here rather than doing its own date
 * arithmetic. Nothing here reads a counter: every value is derived from stored
 * timestamps (section 15.1).
 */

import type { TaskOverview } from './types';

export const DEFAULT_ORG_TIMEZONE = 'Asia/Kuala_Lumpur';

/** The visual weight a chip carries. Section 31B.6 reserves red for genuinely
 * overdue or actionable conditions. */
export type AgeTone = 'neutral' | 'blue' | 'red' | 'amber';

export interface AgeChip {
  /** Compact label, e.g. `Open 18d`. */
  label: string;
  tone: AgeTone;
  /** Full sentence explaining how the duration was calculated, used as the
   * accessible label and the tooltip (section 31B.6). */
  explanation: string;
  /** Raw duration, so callers can sort without re-parsing the label. */
  milliseconds: number;
}

// ---------------------------------------------------------------------------
// Time zone arithmetic
// ---------------------------------------------------------------------------

/**
 * The offset of `timeZone` from UTC at a given instant, in milliseconds.
 *
 * Derived from `Intl` rather than a hard-coded `+08:00` so the calculation stays
 * correct if the organisation timezone is ever changed to one that observes
 * daylight saving.
 */
export function timeZoneOffsetMs(timeZone: string, at: Date): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const parts = formatter.formatToParts(at);
  const read = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value ?? '0');

  // `formatToParts` renders hour 24 for midnight in some engines; normalise it.
  const hour = read('hour') % 24;

  const asUtc = Date.UTC(
    read('year'),
    read('month') - 1,
    read('day'),
    hour,
    read('minute'),
    read('second'),
  );

  // Discard sub-second noise: the wall-clock reading has no milliseconds.
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/**
 * The instant at which a date-only commitment becomes overdue.
 *
 * Section 31B.7: a date-only commitment becomes overdue only after the
 * organisation-local END of that date, not at UTC midnight. Getting this wrong
 * is exactly the "accidental one-day overdue" the specification calls out.
 *
 * @param isoDate calendar date as `YYYY-MM-DD`
 */
export function endOfLocalDay(isoDate: string, timeZone = DEFAULT_ORG_TIMEZONE): Date {
  const [year, month, day] = isoDate.split('-').map(Number);

  if (!year || !month || !day) {
    throw new RangeError(`Expected a YYYY-MM-DD date, received "${isoDate}"`);
  }

  const wallClock = Date.UTC(year, month - 1, day, 23, 59, 59, 999);

  // Solve for the instant whose local reading is that wall clock. One
  // correction pass is enough away from a DST boundary; the second settles the
  // case where the first guess lands on the other side of one.
  let instant = wallClock - timeZoneOffsetMs(timeZone, new Date(wallClock));
  instant = wallClock - timeZoneOffsetMs(timeZone, new Date(instant));

  return new Date(instant);
}

/** The start of the local day containing `at`, as a UTC instant. */
export function startOfLocalDay(at: Date, timeZone = DEFAULT_ORG_TIMEZONE): Date {
  const offset = timeZoneOffsetMs(timeZone, at);
  const local = new Date(at.getTime() + offset);

  const wallClock = Date.UTC(
    local.getUTCFullYear(),
    local.getUTCMonth(),
    local.getUTCDate(),
    0,
    0,
    0,
    0,
  );

  let instant = wallClock - timeZoneOffsetMs(timeZone, new Date(wallClock));
  instant = wallClock - timeZoneOffsetMs(timeZone, new Date(instant));

  return new Date(instant);
}

/** The local calendar date of `at`, as `YYYY-MM-DD`. */
export function localDateString(at: Date, timeZone = DEFAULT_ORG_TIMEZONE): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}

/** Converts an organisation-local `datetime-local` value into an absolute
 * instant. Browser date-time inputs carry no zone, so interpreting them in the
 * device zone would let two editors save different commitments. */
export function localDateTimeToInstant(value: string, timeZone = DEFAULT_ORG_TIMEZONE): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) {
    throw new RangeError(`Expected a YYYY-MM-DDTHH:mm value, received "${value}"`);
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const wallClock = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  let instant = wallClock - timeZoneOffsetMs(timeZone, new Date(wallClock));
  instant = wallClock - timeZoneOffsetMs(timeZone, new Date(instant));
  return new Date(instant);
}

/** Value for a date or datetime-local control, expressed in the organisation
 * time zone rather than the viewer's device time zone. */
export function dueInputValue(
  dueAt: string | null,
  dueIsDateOnly: boolean,
  timeZone = DEFAULT_ORG_TIMEZONE,
): string {
  const due = parse(dueAt);
  if (!due) return '';
  if (dueIsDateOnly) return localDateString(due, timeZone);

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(due);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';
  return `${read('year')}-${read('month')}-${read('day')}T${read('hour')}:${read('minute')}`;
}

// ---------------------------------------------------------------------------
// Duration formatting
// ---------------------------------------------------------------------------

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Compact duration for a chip: `4h`, `18d`, `3mo`.
 *
 * Deliberately coarse. A chip that reads `18d 4h 12m` is noise in a task row,
 * and the exact instant is available in the explanation.
 */
export function formatCompactDuration(milliseconds: number): string {
  const ms = Math.max(0, milliseconds);

  if (ms < HOUR) return `${Math.max(1, Math.floor(ms / MINUTE))}m`;
  if (ms < DAY) return `${Math.floor(ms / HOUR)}h`;

  const days = Math.floor(ms / DAY);
  if (days < 60) return `${days}d`;

  const months = Math.floor(days / 30);
  if (months < 24) return `${months}mo`;

  return `${Math.floor(days / 365)}y`;
}

/** Longer form for explanations and email: `18 days`, `1 day`, `4 hours`. */
export function formatDurationWords(milliseconds: number): string {
  const ms = Math.max(0, milliseconds);

  if (ms < HOUR) {
    const minutes = Math.max(1, Math.floor(ms / MINUTE));
    return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  }

  if (ms < DAY) {
    const hours = Math.floor(ms / HOUR);
    return `${hours} hour${hours === 1 ? '' : 's'}`;
  }

  const days = Math.floor(ms / DAY);
  return `${days} day${days === 1 ? '' : 's'}`;
}

// ---------------------------------------------------------------------------
// The four ages (section 31B.5)
// ---------------------------------------------------------------------------

function parse(value: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** The instant a task stopped accruing age: completion, or cancellation. */
function terminalInstant(task: Pick<TaskOverview, 'completedAt' | 'cancelledAt'>): Date | null {
  return parse(task.completedAt) ?? parse(task.cancelledAt);
}

/**
 * Open age — calendar time from creation until completion or cancellation.
 * It does NOT reset when the task changes state.
 */
export function openAgeMs(
  task: Pick<TaskOverview, 'createdAt' | 'completedAt' | 'cancelledAt'>,
  now: Date = new Date(),
): number {
  const created = parse(task.createdAt);
  if (!created) return 0;

  const end = terminalInstant(task) ?? now;
  return Math.max(0, end.getTime() - created.getTime());
}

/**
 * Current-state age — time since the task entered its present state. Resets on
 * each valid state transition, and only on a state transition.
 */
export function currentStateAgeMs(
  task: Pick<TaskOverview, 'stateEnteredAt' | 'completedAt' | 'cancelledAt'>,
  now: Date = new Date(),
): number {
  const entered = parse(task.stateEnteredAt);
  if (!entered) return 0;

  const end = terminalInstant(task) ?? now;
  return Math.max(0, end.getTime() - entered.getTime());
}

/**
 * Overdue age — time past the due instant while the work remains incomplete.
 * Zero before the due instant, and it stops on completion.
 *
 * `dueAt` already carries the organisation-local end of a date-only commitment
 * (see the note in `20260805000400_tasks.sql`), so no extra allowance is made
 * here — doing so is what would create a one-day error.
 */
export function overdueAgeMs(
  task: Pick<TaskOverview, 'dueAt' | 'status' | 'completedAt' | 'cancelledAt'>,
  now: Date = new Date(),
): number {
  const due = parse(task.dueAt);
  if (!due) return 0;
  if (task.status === 'completed' || task.status === 'cancelled') return 0;

  return Math.max(0, now.getTime() - due.getTime());
}

/**
 * Stale age — time since the last meaningful update, for Active work only.
 *
 * A meaningful update is a checklist completion, written update, evidence
 * addition, or an owner/state/progress/next-action change. Merely viewing the
 * record never resets it (PRODUCTION_LOGIC.md section 15.2).
 */
export function staleAgeMs(
  task: Pick<TaskOverview, 'lastMeaningfulUpdateAt' | 'status'>,
  now: Date = new Date(),
): number {
  if (task.status !== 'active') return 0;

  const updated = parse(task.lastMeaningfulUpdateAt);
  if (!updated) return 0;

  return Math.max(0, now.getTime() - updated.getTime());
}

// ---------------------------------------------------------------------------
// Chips (section 31B.6)
// ---------------------------------------------------------------------------

/**
 * The compact age indicators shown in My Day, My Focus, Available Work, Team
 * Load, routine occurrence lists, and task detail.
 *
 * Section 31B.6 asks for age without making every row visually heavy, so this
 * returns only the chips that currently mean something: the neutral open-age
 * chip and the current-state chip always, plus overdue and stale only when
 * those conditions actually hold.
 */
export function ageChips(
  task: TaskOverview,
  options: { now?: Date; staleThresholdDays?: number } = {},
): AgeChip[] {
  const now = options.now ?? new Date();
  const staleThresholdDays = options.staleThresholdDays ?? 7;

  const chips: AgeChip[] = [];

  const open = openAgeMs(task, now);
  chips.push({
    label: `Open ${formatCompactDuration(open)}`,
    tone: 'neutral',
    explanation:
      `Open for ${formatDurationWords(open)}, measured from when this work was created` +
      `${terminalInstant(task) ? ' until it closed' : ''}. This does not reset when the state changes.`,
    milliseconds: open,
  });

  // The current-state chip is named after the state it measures: `Active 11d`.
  const stateAge = currentStateAgeMs(task, now);
  const stateLabel: Record<TaskOverview['status'], string> = {
    backlog: 'Available',
    active: 'Active',
    paused: 'Paused',
    completed: 'Completed',
    cancelled: 'Cancelled',
  };

  chips.push({
    label: `${stateLabel[task.status]} ${formatCompactDuration(stateAge)}`,
    tone: task.status === 'active' ? 'blue' : 'neutral',
    explanation:
      `In its current state for ${formatDurationWords(stateAge)}, ` +
      'measured from the last time this work changed state.',
    milliseconds: stateAge,
  });

  // Red is reserved for genuinely overdue work.
  if (task.isOverdue) {
    const overdue = overdueAgeMs(task, now);
    chips.push({
      label: `Overdue ${formatCompactDuration(overdue)}`,
      tone: 'red',
      explanation:
        `Overdue by ${formatDurationWords(overdue)}, measured from the due ` +
        `${task.dueIsDateOnly ? 'date, which ends at the close of that day' : 'time'}.`,
      milliseconds: overdue,
    });
  }

  // Amber for a stale Active task that has crossed the configured threshold.
  if (task.isStale) {
    const stale = staleAgeMs(task, now);
    chips.push({
      label: `No update ${formatCompactDuration(stale)}`,
      tone: 'amber',
      explanation:
        `No meaningful update for ${formatDurationWords(stale)}, which is past the ` +
        `${staleThresholdDays}-day threshold. Viewing the task does not count as an update.`,
      milliseconds: stale,
    });
  }

  return chips;
}

/**
 * Renders a due date for display.
 *
 * A date-only commitment shows a date; a date-time commitment shows the time as
 * well. Both are rendered in the organisation timezone regardless of where the
 * reader is, so two people discussing the same task see the same due date.
 */
export function formatDue(
  dueAt: string | null,
  dueIsDateOnly: boolean,
  timeZone = DEFAULT_ORG_TIMEZONE,
): string {
  const due = parse(dueAt);
  if (!due) return 'No date yet';

  if (dueIsDateOnly) {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone,
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }).format(due);
  }

  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(due);
}

/**
 * A due date for scanning: "4 Sep", with the year only when it is not this one.
 *
 * `formatDue` always prints the year. In a list of work that is nearly all in
 * the current year that is the same four characters on every row, and the eye
 * has to step over them to reach the part that differs. The year still appears
 * where it changes the meaning — next year's commitment, or last year's
 * overdue one.
 *
 * Composed from parts rather than formatted straight, because en-GB abbreviates
 * September as "Sept" while every other month gets three letters, so a column
 * of dates comes out visibly ragged.
 */
export function formatDueShort(
  dueAt: string | null,
  dueIsDateOnly: boolean,
  timeZone = DEFAULT_ORG_TIMEZONE,
  now: Date = new Date(),
): string {
  const due = parse(dueAt);
  if (!due) return 'No date yet';

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    ...(dueIsDateOnly ? {} : { hour: '2-digit', minute: '2-digit', hour12: false }),
  }).formatToParts(due);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';

  const thisYear = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric' }).format(now);
  const year = read('year');
  const time = dueIsDateOnly ? '' : ` ${read('hour')}:${read('minute')}`;
  return `${read('day')} ${read('month')}${year === thisYear ? '' : ` ${year}`}${time}`;
}

/**
 * Routine occurrence states (v41 section 15).
 *
 * Routine sits outside the 1 / 5 / 1 focus model, so it must not borrow focus
 * vocabulary. A future occurrence is not "Available Work" waiting to be
 * activated — nobody activates it, and it consumes no focus target. It is
 * simply Upcoming, and then it is due, and then it is late.
 */
export type RoutineOccurrenceState = 'completed' | 'overdue' | 'due_today' | 'upcoming';

export const ROUTINE_OCCURRENCE_LABELS: Record<RoutineOccurrenceState, string> = {
  completed: 'Completed',
  overdue: 'Overdue',
  due_today: 'Due today',
  upcoming: 'Upcoming',
};

export function routineOccurrenceState(
  occurrence: {
    status: string;
    isOverdue: boolean;
    occurrenceDate: string | null;
    dueAt: string | null;
  },
  timeZone = DEFAULT_ORG_TIMEZONE,
  now: Date = new Date(),
): RoutineOccurrenceState {
  if (occurrence.status === 'completed') return 'completed';
  if (occurrence.isOverdue) return 'overdue';

  const today = localDateString(now, timeZone);
  const scheduled =
    occurrence.occurrenceDate ??
    (occurrence.dueAt ? localDateString(new Date(occurrence.dueAt), timeZone) : null);

  if (scheduled && scheduled <= today) return 'due_today';
  return 'upcoming';
}
