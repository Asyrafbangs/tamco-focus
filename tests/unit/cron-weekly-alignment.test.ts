import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { weeklyWindow } from '@/domain/weekly-schedule';

/**
 * The daily cron has to land after the weekly summary's threshold.
 *
 * Two schedules decide when the summary goes out and neither knows about the
 * other. `vercel.json` fires `/api/cron` once a day in UTC; `weeklyWindow`
 * then decides whether the summary is due, which it is from the configured
 * local day and hour onwards. The summary is actually sent on the first
 * firing after that moment, because the per-period record stops it repeating.
 *
 * So if the daily firing lands EARLIER in the day than the weekly threshold,
 * Monday's run is not yet due and the send slips to Tuesday — every week,
 * silently, with the run reporting success both days. That is exactly what
 * happened: the cron ran at 22:00 UTC (06:00 in Kuala Lumpur) against a
 * threshold of Monday 08:00, so the "Monday summary" had been arriving on
 * Tuesday.
 *
 * This asserts the relationship rather than either schedule, because either
 * one can be changed on its own by somebody who cannot see the other.
 */

const TIME_ZONE = 'Asia/Kuala_Lumpur';
/** The defaults `src/app/api/cron/route.ts` leaves `weeklyWindow` to use. */
const SCHEDULE_DAY = 'monday';
const SCHEDULE_HOUR = 8;

const weekdayIn = (at: Date, timeZone: string) =>
  new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(at);

function dailyCronUtc(): { hour: number; minute: number } {
  const config = JSON.parse(readFileSync(join(process.cwd(), 'vercel.json'), 'utf8')) as {
    crons?: { path: string; schedule: string }[];
  };
  const cron = config.crons?.find((entry) => entry.path === '/api/cron');
  if (!cron) throw new Error('vercel.json no longer schedules /api/cron.');
  const [minute, hour, ...rest] = cron.schedule.split(' ');
  // A cron that is not once-daily would make "the firing on Monday" ambiguous,
  // and this test would be quietly checking something else.
  expect(rest.join(' '), `/api/cron is no longer a simple daily schedule: ${cron.schedule}`).toBe(
    '* * *',
  );
  return { hour: Number(hour), minute: Number(minute) };
}

describe('the daily cron and the weekly summary threshold', () => {
  it('sends on the configured day, not the day after', () => {
    const { hour, minute } = dailyCronUtc();

    /*
     * A week of firings, starting from midnight local on a known Monday
     * (31 August 2026, which is 16:00 UTC on the 30th). Whichever of them is
     * the first to be due is the one that sends.
     */
    const localMondayStart = Date.UTC(2026, 7, 30, 16, 0, 0);
    const firings: Date[] = [];
    for (let day = 0; firings.length < 7; day += 1) {
      const at = new Date(Date.UTC(2026, 7, 30 + day, hour, minute, 0));
      if (at.getTime() >= localMondayStart) firings.push(at);
    }

    const firstDue = firings.find(
      (at) => weeklyWindow(at, TIME_ZONE, SCHEDULE_DAY, SCHEDULE_HOUR).due,
    );
    expect(firstDue, 'no firing in the whole week was ever due').toBeDefined();
    expect(
      weekdayIn(firstDue!, TIME_ZONE),
      `the first due firing is ${weekdayIn(firstDue!, TIME_ZONE)} ${firstDue!.toISOString()}; ` +
        `the cron fires too early in the day for a ${SCHEDULE_DAY} ${SCHEDULE_HOUR}:00 threshold`,
    ).toBe('Mon');
  });

  it('still lands on Monday if the platform fires up to an hour late', () => {
    // Vercel triggers a cron within the hour following its schedule rather
    // than on the minute, so the alignment cannot depend on an exact time.
    const { hour, minute } = dailyCronUtc();
    const monday = new Date(Date.UTC(2026, 7, 31, hour, minute, 0));
    for (const lateness of [0, 15, 30, 45, 59]) {
      const at = new Date(monday.getTime() + lateness * 60_000);
      expect(weekdayIn(at, TIME_ZONE), `${lateness} minutes late left Monday`).toBe('Mon');
      expect(
        weeklyWindow(at, TIME_ZONE, SCHEDULE_DAY, SCHEDULE_HOUR).due,
        `${lateness} minutes late was not yet due`,
      ).toBe(true);
    }
  });
});
