import { calendarDaysSince } from '@/domain/duration';
import { RISK_LABELS } from '@/domain/esh-dashboard';

/**
 * What the Today board says, worked out away from the page (v303).
 *
 * Today used to be four counters in a row and three cards beneath them. The
 * counters answered "how many", which is not the question somebody opens this
 * screen with: they open it to find out whether anybody is exposed, and whose
 * desk the work is sitting on. Two of the four counters also repeated a list
 * directly below them, and two of them — significant risks without protection,
 * and overdue owner actions — were frequently the same finding counted twice,
 * so one problem could read as four.
 *
 * Three rules hold everything here:
 *
 *   - every figure is counted, never derived. Nothing subtracts one query's
 *     answer from another's to invent a stage, because `openFindings` minus
 *     `awaitingVerification` is a number nobody counted and §8 of the prompt
 *     this module serves forbids exactly that;
 *   - every figure keeps a list holding precisely it, which is the invariant
 *     `esh-today-counts-v4101` exists to hold;
 *   - a queue says how long its oldest item has been sitting there. A count
 *     says there is work; an age says the work is stuck, and that is the one
 *     a daily board is read for.
 */

/** Days are counted with the one helper that counts them (v185). */
function waitDays(instant: string | null, timeZone: string, now: Date): number | null {
  if (!instant) return null;
  return Math.max(0, calendarDaysSince(instant, timeZone, now));
}

export interface StageReading {
  /** `null` where the figure could not be read, which is not a count of none. */
  total: number | null;
  /** The oldest thing waiting in this queue, or null when it is empty. */
  oldest: string | null;
}

export interface TodayInput {
  /** `null` when the reader may not triage, so no counter and no card. */
  triage: StageReading | null;
  pastDue: StageReading;
  checking: StageReading;
  openTotal: number | null;
  /** From the dashboard, which already counts it (v230). */
  oldestOpenDays: number | null;
  timeZone: string;
  now: Date;
}

export type Desk = 'esh' | 'owner' | 'none';

export interface Stage {
  key: 'triage' | 'pastDue' | 'checking' | 'open';
  desk: Desk;
  label: string;
  value: number | null;
  detail: string;
  /** The age line, or null where there is nothing waiting to age. */
  dwell: string | null;
  href?: string;
  exception: boolean;
}

function plural(days: number) {
  return days === 1 ? 'day' : 'days';
}

/**
 * An age of nought days is today, and must be said in words.
 *
 * "Oldest waiting 0 days" is what the arithmetic produces and not what
 * anybody says, and on a board whose whole point is that an age means work is
 * stuck, a nought reads as a fault rather than as good news. Each queue gets
 * its own sentence because "today" means something different in each: a
 * report that arrived today, proof sent in today, and a date that passed
 * earlier today are three different states.
 */
function age(days: number | null, today: string, older: (days: number) => string): string | null {
  if (days === null) return null;
  return days === 0 ? today : older(days);
}

/**
 * v291's rule, in one place instead of at every call site.
 *
 * A figure that could not be read is not a count of none, it does not link to
 * a list that would disagree with it, and it is never an exception — an alarm
 * raised by a failed read is as wrong as a calm raised by one.
 */
function unread(total: number | null, detail: string, href: string) {
  return total === null
    ? {
        detail: 'This figure could not be read — it is not a count of none',
        href: undefined,
        exception: false,
      }
    : { detail, href, exception: total > 0 };
}

/**
 * The strip across the top: who holds the work, how much, and for how long.
 *
 * The fourth tile is the backlog rather than a stage, and says so in its own
 * label. It is here because "oldest open 94 days" is the figure that tells
 * somebody the board is not merely busy, and leaving it out to keep the row
 * tidy would be hiding it.
 */
export function todayStages(input: TodayInput): Stage[] {
  const { timeZone, now } = input;
  const stages: Stage[] = [];

  /*
   * The labels are the ones this board already used. They are good English,
   * `esh-today-counts-v4101` and `esh-overview-v202` pin them, and renaming
   * them would have bought a shade of clarity at the price of two acceptance
   * specs that hold a real invariant. The ages beneath them are the new part.
   */
  if (input.triage) {
    const days = waitDays(input.triage.oldest, timeZone, now);
    stages.push({
      key: 'triage',
      desk: 'esh',
      label: 'New reports',
      value: input.triage.total,
      dwell: age(days, 'All arrived today', (n) => `Oldest waiting ${n} ${plural(n)}`),
      ...unread(input.triage.total, 'Private reports waiting for triage', '/findings/intake'),
    });
  }

  const over = waitDays(input.pastDue.oldest, timeZone, now);
  stages.push({
    key: 'pastDue',
    desk: 'owner',
    label: 'Overdue owner actions',
    value: input.pastDue.total,
    dwell: age(over, 'Due earlier today', (n) => `Longest ${n} ${plural(n)} over`),
    ...unread(
      input.pastDue.total,
      'Owner action past its due date',
      '/findings/register?filter=overdue',
    ),
  });

  const since = waitDays(input.checking.oldest, timeZone, now);
  stages.push({
    key: 'checking',
    desk: 'esh',
    label: 'Waiting for ESH verification',
    value: input.checking.total,
    dwell: age(since, 'All sent in today', (n) => `Oldest sent ${n} ${plural(n)} ago`),
    ...unread(
      input.checking.total,
      'Submitted proof needs a decision',
      '/findings?queue=verification',
    ),
  });

  stages.push({
    key: 'open',
    desk: 'none',
    label: 'Open findings in total',
    value: input.openTotal,
    dwell:
      input.oldestOpenDays === null || input.oldestOpenDays <= 0
        ? null
        : `Oldest open ${input.oldestOpenDays} ${plural(input.oldestOpenDays)}`,
    ...unread(
      input.openTotal,
      'Every open finding, at any stage',
      '/findings/register?filter=open',
    ),
    // The backlog is context, never an alarm: a healthy programme has one.
    exception: false,
  });

  return stages;
}

export interface ExposureRow {
  findingId: string;
  actionId: string | null;
  reference: string;
  title: string;
  riskLevel: string;
  departmentName: string | null;
  location: string | null;
  dueAt: string | null;
  isOverdue: boolean;
}

export interface Exposure extends ExposureRow {
  riskLabel: string;
  /** Days past due, or null when it is not overdue or has no date. */
  overdueDays: number | null;
  href: string;
}

/**
 * The findings with nothing recorded protecting anybody, worst first.
 *
 * Critical before High, and within a level the one that has been past its date
 * longest. A finding with no due date sorts after one that has a date, because
 * a date that has passed is a fact and an absent date is not.
 *
 * This is the band at the top of the board. Today reported this as the bare
 * number `1` and left the reader to click through and work out which finding
 * it meant — and because the same finding is usually also the overdue one, the
 * counters beside it made a single problem look like several.
 */
export function rankExposure(rows: ExposureRow[], timeZone: string, now: Date): Exposure[] {
  const weight = (risk: string) => (risk === 'critical' ? 0 : risk === 'high' ? 1 : 2);
  return rows
    .map((row) => ({
      ...row,
      riskLabel: RISK_LABELS[row.riskLevel] ?? row.riskLevel,
      overdueDays: row.isOverdue ? waitDays(row.dueAt, timeZone, now) : null,
      href: row.actionId
        ? `/findings/${row.findingId}?action=${row.actionId}`
        : `/findings/${row.findingId}`,
    }))
    .sort(
      (a, b) =>
        weight(a.riskLevel) - weight(b.riskLevel) ||
        (b.overdueDays ?? -1) - (a.overdueDays ?? -1) ||
        a.reference.localeCompare(b.reference),
    );
}

/**
 * One sentence for the band, naming what is true rather than how many rows.
 *
 * "1 significant risk" is a count; "nobody is protected from ESH-0142" is the
 * thing somebody has to act on. Past three it becomes a count again, because
 * listing them all would bury the first.
 */
export function exposureWords(exposures: Exposure[]): string {
  if (exposures.length === 0) return '';
  if (exposures.length === 1) {
    const one = exposures[0]!;
    return `Nothing is recorded protecting anybody from ${one.reference}.`;
  }
  return `Nothing is recorded protecting anybody from ${exposures.length} significant findings.`;
}
