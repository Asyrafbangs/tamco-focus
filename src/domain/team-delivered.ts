/**
 * What the team finished, read as a week rather than as six filing cabinets
 * (v234, §20).
 *
 * Completed grouped everything under the person who delivered it, which
 * answers "how is Amer doing" — a question about one person, asked from a tab
 * you opened to ask about the team. "What did we actually finish this week?"
 * could not be read off it at all: six lists, each in its own time order, with
 * no way to see Tuesday.
 *
 * So time is the default axis and the person grouping is kept as the second
 * view, because checking one person's output is a real question. It is simply
 * not the one this tab opens on.
 */

import { dayOf } from '@/domain/team-activity';

export type DeliveredKind = 'owned' | 'shared' | 'routine';

export interface DeliveredRecord {
  /** Unique within the list: a task id for owned work, a step id for shared. */
  id: string;
  taskId: string;
  kind: DeliveredKind;
  title: string;
  /** The task a contributed step belongs to, which is somebody else's work. */
  parentTitle: string | null;
  at: string | null;
  personId: string;
  personName: string;
}

export interface DeliveredDay {
  /** `yyyy-mm-dd` in the reader's zone, or '' for a record with no timestamp. */
  day: string;
  records: DeliveredRecord[];
}

/**
 * Newest day first, and newest first inside each day.
 *
 * A record with no completion time is kept rather than dropped — it closed, and
 * saying so under its own heading is honest where filing it under today would
 * not be.
 */
export function deliveredDays(records: DeliveredRecord[], timeZone: string): DeliveredDay[] {
  const byDay = new Map<string, DeliveredRecord[]>();
  for (const record of records) {
    const day = record.at ? dayOf(record.at, timeZone) : '';
    const list = byDay.get(day);
    if (list) list.push(record);
    else byDay.set(day, [record]);
  }

  const days = [...byDay.entries()].map(([day, list]) => ({
    day,
    records: list.sort((a, b) => (b.at ?? '').localeCompare(a.at ?? '')),
  }));

  // The undated group last: it is a footnote to the week, not the top of it.
  return days.sort((a, b) => {
    if (a.day === '') return 1;
    if (b.day === '') return -1;
    return b.day.localeCompare(a.day);
  });
}

/**
 * "Today", "Yesterday", then the weekday and date.
 *
 * Two relative words and no more. "3 days ago" reads as a duration where a
 * manager wants a position in the week, and by Thursday nobody can tell
 * whether "4 days ago" was the weekend.
 */
export function dayHeading(day: string, now: Date, timeZone: string): string {
  if (day === '') return 'Date not recorded';
  const today = dayOf(now.toISOString(), timeZone);
  if (day === today) return 'Today';
  const yesterday = dayOf(new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(), timeZone);
  if (day === yesterday) return 'Yesterday';
  // Midday UTC so the date cannot slip a day while being formatted back.
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
    timeZone,
  }).format(new Date(`${day}T12:00:00Z`));
}

export interface DeliveredTally {
  personId: string;
  personName: string;
  count: number;
}

/**
 * How much each person closed, including the people who closed nothing.
 *
 * A name quietly absent from a list is not noticeable, and absence is the thing
 * most worth noticing: a fortnight spent on one Major Project is honest work
 * that closes nothing, and so is a fortnight of leave. The figure says which
 * question to ask, not what the answer is.
 */
export function deliveredTally(
  records: DeliveredRecord[],
  people: Array<{ userId: string; fullName: string }>,
): DeliveredTally[] {
  const counts = new Map<string, number>();
  for (const record of records) {
    counts.set(record.personId, (counts.get(record.personId) ?? 0) + 1);
  }
  return people
    .map((person) => ({
      personId: person.userId,
      personName: person.fullName,
      count: counts.get(person.userId) ?? 0,
    }))
    .sort((a, b) => b.count - a.count || a.personName.localeCompare(b.personName));
}

export interface DeliveredPersonGroup {
  personId: string;
  personName: string;
  records: DeliveredRecord[];
}

/**
 * The same records under the person who closed them, for the second view.
 *
 * Derived from the one list rather than queried again, so the timeline and the
 * person grouping cannot disagree about what closed — which is exactly how the
 * old strip and the list behind it came apart.
 */
export function deliveredByPerson(
  records: DeliveredRecord[],
  people: Array<{ userId: string; fullName: string }>,
): DeliveredPersonGroup[] {
  const byPerson = new Map<string, DeliveredPersonGroup>();
  for (const person of people) {
    byPerson.set(person.userId, {
      personId: person.userId,
      personName: person.fullName,
      records: [],
    });
  }
  for (const record of records) {
    const group = byPerson.get(record.personId);
    if (group) group.records.push(record);
    // A record whose owner is not on the roster is not dropped silently: it
    // would mean the two reads disagree about who the team is.
    else
      byPerson.set(record.personId, {
        personId: record.personId,
        personName: record.personName,
        records: [record],
      });
  }
  for (const group of byPerson.values()) {
    group.records.sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''));
  }
  return [...byPerson.values()].sort(
    (a, b) => b.records.length - a.records.length || a.personName.localeCompare(b.personName),
  );
}

/** "24 completed in the last 7 days", or the honest version of nothing. */
export function deliveredSummary(records: DeliveredRecord[], phrase: string): string {
  if (records.length === 0) return `Nothing closed ${phrase}.`;
  const owned = records.filter((record) => record.kind === 'owned').length;
  const shared = records.filter((record) => record.kind === 'shared').length;
  const routine = records.filter((record) => record.kind === 'routine').length;
  /*
   * Split by kind, because a routine occurrence closes every week and a Major
   * Project once a quarter. One total covering both reads as a ranking of
   * people, which is the one thing this screen must not be.
   */
  const parts = [
    owned > 0 ? `${owned} owned` : null,
    shared > 0 ? `${shared} contributed` : null,
    routine > 0 ? `${routine} routine` : null,
  ].filter((part): part is string => part !== null);
  return `${records.length} completed ${phrase} · ${parts.join(' · ')}`;
}

/** "10:42" — the clock, because within a day the order is the story. */
export function completedTime(at: string | null, timeZone: string): string | null {
  if (!at) return null;
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  }).format(new Date(at));
}

/**
 * "29 Sept" — the day alone, for a list already filed under one window.
 *
 * No year: every record in the list falls inside the period named above it, so
 * the year is the same on all of them and repeating it is noise.
 */
export function completedDay(at: string | null, timeZone: string): string | null {
  if (!at) return null;
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone,
  }).format(new Date(at));
}

export const DELIVERED_VIEWS = ['timeline', 'person'] as const;
export type DeliveredView = (typeof DELIVERED_VIEWS)[number];

export function readDeliveredView(value: string | undefined): DeliveredView {
  return value === 'person' ? 'person' : 'timeline';
}
