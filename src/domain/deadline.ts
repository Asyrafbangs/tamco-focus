/**
 * How close a commitment is — overdue, due today, due tomorrow, due soon, or
 * later — in one set of words (v187, Product Owner 15 September 2026).
 *
 * > Overdue = already late. Due soon = due within the attention window.
 * > Normal = further away than that. The same rule for Tasks and Steps.
 *
 * Every screen that shows a deadline reads it from here, so a task due
 * tomorrow cannot read "Due tomorrow" on one list and "Due 16 Sep" on the
 * next. Days are calendar days in the viewer's zone, as `calendarDaysSince`
 * counts them (v185).
 */

import { DEFAULT_ORG_TIMEZONE, calendarDaysSince, formatDueShort } from './duration';

/** The organisation default: work counts as due soon five days out. */
export const DEFAULT_ATTENTION_WINDOW_DAYS = 5;

export type DeadlineTone = 'overdue' | 'today' | 'tomorrow' | 'soon' | 'later';

export interface Deadline {
  tone: DeadlineTone;
  /**
   * Calendar days from today to the due date: negative when late, 0 today.
   * An overdue commitment that passed a due time earlier today is 0.
   */
  days: number;
  /** "Overdue 3 days", "Due today", "Due tomorrow", "Due in 3 days", "Due 28 Sep". */
  label: string;
  /** "Overdue 3d", "Due today", "Due tomorrow", "Due in 3d", "Due 28 Sep". */
  short: string;
  /** True for anything that belongs in an attention list: overdue to soon. */
  needsAttention: boolean;
}

export interface DeadlineOptions {
  dueIsDateOnly?: boolean;
  timeZone?: string;
  now?: Date;
  /** The attention window, in days. The organisation setting; 5 by default. */
  windowDays?: number;
  /** Completed or cancelled work has no deadline left to show. */
  closed?: boolean;
}

const RANK: Record<DeadlineTone, number> = {
  overdue: 0,
  today: 1,
  tomorrow: 2,
  soon: 3,
  later: 4,
};

function clockTime(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone,
  }).format(at);
}

/** Null when there is no date, or nothing left to be late for. */
export function deadlineFor(
  dueAt: string | null | undefined,
  options: DeadlineOptions = {},
): Deadline | null {
  if (!dueAt || options.closed) return null;
  const due = new Date(dueAt);
  if (Number.isNaN(due.getTime())) return null;

  const timeZone = options.timeZone ?? DEFAULT_ORG_TIMEZONE;
  const now = options.now ?? new Date();
  const windowDays = Math.max(1, options.windowDays ?? DEFAULT_ATTENTION_WINDOW_DAYS);
  const dateOnly = options.dueIsDateOnly ?? true;
  const since = calendarDaysSince(dueAt, timeZone, now);

  if (due.getTime() < now.getTime()) {
    const late = Math.max(0, since);
    return {
      tone: 'overdue',
      days: late === 0 ? 0 : -late,
      label: late >= 1 ? `Overdue ${late} day${late === 1 ? '' : 's'}` : 'Overdue',
      short: late >= 1 ? `Overdue ${late}d` : 'Overdue',
      needsAttention: true,
    };
  }

  const until = Math.max(0, -since);
  // A time is worth saying when it is today's or tomorrow's; further out the
  // day is what matters.
  const at = dateOnly ? '' : ` ${clockTime(due, timeZone)}`;
  if (until === 0) {
    return {
      tone: 'today',
      days: 0,
      label: `Due today${at}`,
      short: `Due today${at}`,
      needsAttention: true,
    };
  }
  if (until === 1) {
    return {
      tone: 'tomorrow',
      days: 1,
      label: `Due tomorrow${at}`,
      short: `Due tomorrow${at}`,
      needsAttention: true,
    };
  }
  if (until <= windowDays) {
    return {
      tone: 'soon',
      days: until,
      label: `Due in ${until} days`,
      short: `Due in ${until}d`,
      needsAttention: true,
    };
  }
  const date = `Due ${formatDueShort(dueAt, dateOnly, timeZone, now)}`;
  return { tone: 'later', days: until, label: date, short: date, needsAttention: false };
}

/**
 * Urgency order: overdue, today, tomorrow, soon, later, undated — then the
 * earlier date first, so the most overdue leads the overdue.
 */
export function compareDeadlines(
  left: { deadline: Deadline | null; dueAt: string | null | undefined },
  right: { deadline: Deadline | null; dueAt: string | null | undefined },
): number {
  const leftRank = left.deadline ? RANK[left.deadline.tone] : 5;
  const rightRank = right.deadline ? RANK[right.deadline.tone] : 5;
  if (leftRank !== rightRank) return leftRank - rightRank;
  return (left.dueAt ?? '').localeCompare(right.dueAt ?? '');
}

/** The glyph a tone carries beside its words: ⚠ for late, ! for close. */
export function deadlineGlyph(tone: DeadlineTone): string | null {
  if (tone === 'overdue') return '⚠';
  if (tone === 'later') return null;
  return '!';
}
