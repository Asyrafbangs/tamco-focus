/**
 * Work that is sitting there, ordered by whether it needs a manager (v233, §20).
 *
 * The screen used to be every person's backlog under their name: nineteen rows
 * with nothing to say which of them mattered. A manager does not need a list of
 * what has not started — they need the few items that have been waiting long
 * enough, or are late enough, to be worth a word.
 *
 * So waiting work is not treated as a problem by default. Most of it is work
 * properly queued behind other work, and saying so about all of it would teach
 * people to ignore the screen. Only the exceptions are raised.
 */

export interface WaitingItem {
  id: string;
  title: string;
  ownerId: string;
  ownerName: string;
  dueAt: string | null;
  dueIsDateOnly: boolean;
  urgency: string | null;
  createdAt: string;
  /** Set when somebody other than the owner put this on them. */
  assignedByName: string | null;
  progressPercent: number;
}

export type WaitingBucket = 'attention' | 'upcoming' | 'later';

export interface WaitingEntry extends WaitingItem {
  bucket: WaitingBucket;
  /** Why it is where it is, in the words shown under the title. */
  reasons: string[];
  waitingDays: number;
  overdue: boolean;
}

/**
 * A fortnight untouched is the point at which "queued" becomes "forgotten".
 *
 * Shorter and ordinary scheduling looks like a problem; longer and a month can
 * pass before anybody is asked about it.
 */
export const WAITING_TOO_LONG_DAYS = 14;

/**
 * A week before an unstarted assignment counts against the person who gave it.
 *
 * Without a delay every task assigned this morning is an exception, which makes
 * the exception list worthless by lunchtime.
 */
export const ASSIGNED_UNTOUCHED_DAYS = 7;

/** Due within this many days is worth seeing before it is late. */
export const UPCOMING_DAYS = 7;

const DAY = 24 * 60 * 60 * 1000;

function wholeDaysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / DAY);
}

/** "Due yesterday", "Due today", "Due in 3 days", "Due 13 Oct". */
export function dueWords(dueAt: string | null, now: Date, timeZone: string): string | null {
  if (!dueAt) return null;
  const days = wholeDaysBetween(now, new Date(dueAt));
  if (days < -1) return `Due ${Math.abs(days)} days ago`;
  if (days === -1) return 'Due yesterday';
  if (days === 0) return 'Due today';
  if (days === 1) return 'Due tomorrow';
  if (days <= UPCOMING_DAYS) return `Due in ${days} days`;
  return `Due ${new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone }).format(new Date(dueAt))}`;
}

/**
 * Where one waiting item belongs, and why.
 *
 * The reasons are the point: "5 need attention" is only useful if each of the
 * five says what makes it one.
 */
export function classify(item: WaitingItem, now: Date, timeZone: string): WaitingEntry {
  const waitingDays = Math.max(0, wholeDaysBetween(new Date(item.createdAt), now));
  const dueDays = item.dueAt ? wholeDaysBetween(now, new Date(item.dueAt)) : null;
  const overdue = dueDays !== null && dueDays < 0;
  const urgent = item.urgency === 'critical' || item.urgency === 'high';
  const untouched =
    Boolean(item.assignedByName) &&
    item.progressPercent === 0 &&
    waitingDays >= ASSIGNED_UNTOUCHED_DAYS;

  const reasons: string[] = [];
  const due = dueWords(item.dueAt, now, timeZone);
  if (due) reasons.push(due);
  if (overdue || waitingDays >= WAITING_TOO_LONG_DAYS || untouched || urgent) {
    if (waitingDays >= WAITING_TOO_LONG_DAYS) reasons.push(`waiting ${waitingDays} days`);
    if (untouched) reasons.push(`assigned by ${item.assignedByName}, not started`);
    if (urgent && !overdue) reasons.push('high attention');
    if (!item.dueAt) reasons.push('no due date');
    return { ...item, bucket: 'attention', reasons, waitingDays, overdue };
  }

  if (dueDays !== null && dueDays <= UPCOMING_DAYS) {
    return { ...item, bucket: 'upcoming', reasons, waitingDays, overdue };
  }

  return {
    ...item,
    bucket: 'later',
    reasons: reasons.length ? reasons : [`waiting ${waitingDays} days`],
    waitingDays,
    overdue,
  };
}

export interface WaitingView {
  attention: WaitingEntry[];
  upcoming: WaitingEntry[];
  later: WaitingEntry[];
  total: number;
}

/** The three groups, each ordered by what a manager would look at first. */
export function groupWaiting(items: WaitingItem[], now: Date, timeZone: string): WaitingView {
  const entries = items.map((item) => classify(item, now, timeZone));
  const byUrgency = (a: WaitingEntry, b: WaitingEntry) => {
    // Overdue first, then longest waiting: both are "how long has this been
    // somebody's problem", which is the order a manager reads in.
    if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
    if (a.waitingDays !== b.waitingDays) return b.waitingDays - a.waitingDays;
    return a.title.localeCompare(b.title);
  };
  const byDue = (a: WaitingEntry, b: WaitingEntry) => {
    if (!a.dueAt) return 1;
    if (!b.dueAt) return -1;
    return a.dueAt < b.dueAt ? -1 : a.dueAt > b.dueAt ? 1 : 0;
  };
  return {
    attention: entries.filter((entry) => entry.bucket === 'attention').sort(byUrgency),
    upcoming: entries.filter((entry) => entry.bucket === 'upcoming').sort(byDue),
    later: entries.filter((entry) => entry.bucket === 'later').sort(byUrgency),
    total: entries.length,
  };
}

/** "19 waiting · 5 need attention · 6 due within 7 days · 8 later". */
export function waitingSummary(view: WaitingView): string {
  if (view.total === 0) return 'Nothing is waiting to be started.';
  const parts = [`${view.total} waiting`];
  if (view.attention.length > 0) parts.push(`${view.attention.length} need attention`);
  if (view.upcoming.length > 0)
    parts.push(`${view.upcoming.length} due within ${UPCOMING_DAYS} days`);
  if (view.later.length > 0) parts.push(`${view.later.length} later`);
  return parts.join(' · ');
}
