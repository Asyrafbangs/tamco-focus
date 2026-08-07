import { startOfLocalDay, timeZoneOffsetMs } from './duration';

export interface WeeklyWindow {
  due: boolean;
  reportingStart: Date;
  reportingEnd: Date;
  planningEnd: Date;
}

const DAY_MS = 86_400_000;

function localParts(at: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
  }).formatToParts(at);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';
  return { weekday: read('weekday'), hour: Number(read('hour')) % 24 };
}

function addLocalDays(at: Date, days: number, timeZone: string) {
  const localStart = startOfLocalDay(at, timeZone);
  const offset = timeZoneOffsetMs(timeZone, localStart);
  const wallClock = localStart.getTime() + offset + days * DAY_MS;
  let instant = wallClock - timeZoneOffsetMs(timeZone, new Date(wallClock));
  instant = wallClock - timeZoneOffsetMs(timeZone, new Date(instant));
  return new Date(instant);
}

/** Previous Monday-to-Monday reporting window and current planning week. */
export function weeklyWindow(
  now: Date,
  timeZone: string,
  scheduleDay = 'monday',
  scheduleHour = 8,
): WeeklyWindow {
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const configuredDay = [
    'sunday',
    'monday',
    'tuesday',
    'wednesday',
    'thursday',
    'friday',
    'saturday',
  ].indexOf(scheduleDay.toLowerCase());
  const current = localParts(now, timeZone);
  const currentDay = names.indexOf(current.weekday);
  const scheduleIndex = configuredDay < 0 ? 1 : configuredDay;
  const daysSinceSchedule = (currentDay - scheduleIndex + 7) % 7;
  const thisScheduleDay = addLocalDays(now, -daysSinceSchedule, timeZone);
  const reportingEnd = addLocalDays(thisScheduleDay, 0, timeZone);
  const reportingStart = addLocalDays(reportingEnd, -7, timeZone);
  const planningEnd = addLocalDays(reportingEnd, 7, timeZone);
  const due = daysSinceSchedule > 0 || (daysSinceSchedule === 0 && current.hour >= scheduleHour);
  return { due, reportingStart, reportingEnd, planningEnd };
}
