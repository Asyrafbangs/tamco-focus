/**
 * Whether the machinery behind Finding Management is actually running (§27).
 *
 * A green HTTP response says nothing about a daily job that stopped on
 * Tuesday, and on a once-a-day schedule that silence can last a week before
 * anybody notices their reminders stopped. This decides what is worth saying
 * about that: nothing at all when the work is flowing, and one plain line per
 * problem when it is not.
 */

export interface OperationalHealth {
  lastRunAt: string | null;
  lastRunOk: boolean | null;
  hoursSinceRun: number | null;
  queued: number;
  failing: number;
  held: number;
  reviewOverdue: number;
}

export interface HealthNote {
  text: string;
  href?: string;
  /** Something is wrong, as opposed to something merely being large. */
  exception: boolean;
}

/**
 * A daily run that has not reported for a day and a half has missed one.
 * Tighter than that and a slow Monday morning reads as a failure.
 */
export const STALE_AFTER_HOURS = 36;
/** A queue this deep is worth mentioning; a shorter one is just a queue. */
export const QUEUE_WORTH_MENTIONING = 20;

function hoursInWords(value: number | null): string {
  if (value === null) return 'never';
  if (value < 1) return 'in the last hour';
  if (value === 1) return 'an hour ago';
  if (value < 24) return `${value} hours ago`;
  const days = Math.round(value / 24);
  return days === 1 ? 'a day ago' : `${days} days ago`;
}

export function healthNotes(health: OperationalHealth): HealthNote[] {
  const notes: HealthNote[] = [];
  const stale = health.hoursSinceRun === null || health.hoursSinceRun >= STALE_AFTER_HOURS;

  if (stale) {
    notes.push({
      text:
        health.lastRunAt === null
          ? 'The scheduled run has never reported in, so reminders, escalations and reports are not going out.'
          : `The scheduled run last reported ${hoursInWords(health.hoursSinceRun)}; it should report daily.`,
      exception: true,
    });
  } else if (health.lastRunOk === false) {
    notes.push({
      text: `The scheduled run reported a failure ${hoursInWords(health.hoursSinceRun)}.`,
      exception: true,
    });
  }
  if (health.failing > 0) {
    notes.push({
      text: `${health.failing} notification${health.failing === 1 ? '' : 's'} bounced or gave up`,
      href: '/findings/register?filter=attention',
      exception: true,
    });
  }
  if (health.held > 0) {
    notes.push({
      text: `${health.held} held because a contact is not cleared to receive mail`,
      href: '/findings/register?filter=attention',
      exception: true,
    });
  }
  if (health.queued > QUEUE_WORTH_MENTIONING) {
    notes.push({
      text: `${health.queued} notifications waiting to be sent`,
      exception: false,
    });
  }
  if (health.reviewOverdue > 0) {
    notes.push({
      text: `${health.reviewOverdue} submission${health.reviewOverdue === 1 ? ' has' : 's have'} been waiting over a week for ESH`,
      href: '/findings/verification',
      exception: true,
    });
  }
  return notes;
}
