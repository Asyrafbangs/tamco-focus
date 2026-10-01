/**
 * What the team has actually done lately (v231, §20).
 *
 * A manager had to open each person, then each task, to find out what moved.
 * This is the same information read the other way round: newest first, across
 * everybody they can see, so "what happened this fortnight" is one screen
 * rather than a tour.
 *
 * What counts as an update is not invented here. `task_updates.is_meaningful`
 * is the flag the application already sets when somebody says something about
 * their work rather than merely touching it, and a completion is a completion.
 * Anything else — a field edited, a date nudged — belongs to the task's own
 * history, not to a digest somebody reads over coffee.
 */

export type TeamUpdateKind = 'update' | 'evidence' | 'completed' | 'contribution';

export interface TeamUpdate {
  id: string;
  kind: TeamUpdateKind;
  at: string;
  personId: string;
  personName: string;
  taskId: string;
  taskTitle: string;
  /** The checklist item or parent task a contribution belongs to. */
  parentTitle: string | null;
  /** What they wrote, when they wrote anything. */
  body: string | null;
}

/** The verb, in the words a manager would use about it. */
export const UPDATE_KIND_WORDS: Record<TeamUpdateKind, string> = {
  update: 'posted an update on',
  evidence: 'attached evidence to',
  completed: 'completed',
  contribution: 'finished their part of',
};

/**
 * Newest first, and stable when two things share a timestamp.
 *
 * Ties are real: completing a task from the drawer writes the update and the
 * completion in the same transaction, so without a tie-break the two lines
 * swap places between renders and the list looks like it is shuffling itself.
 */
export function sortUpdates(updates: TeamUpdate[]): TeamUpdate[] {
  return [...updates].sort((a, b) => {
    if (a.at !== b.at) return a.at < b.at ? 1 : -1;
    return a.id < b.id ? 1 : -1;
  });
}

/**
 * One line of context under the headline, or null when there is nothing worth
 * adding. A body is shown trimmed to a sentence or so: the whole of it belongs
 * on the task, which is one press away.
 */
export function updateDetail(update: TeamUpdate, limit = 160): string | null {
  if (update.kind === 'contribution' && update.parentTitle) {
    return `on ${update.parentTitle}`;
  }
  const body = (update.body ?? '').trim().replace(/\s+/g, ' ');
  if (!body) return null;
  return body.length > limit ? `${body.slice(0, limit - 1).trimEnd()}…` : body;
}

/** How many people appear, for the sentence above the list. */
export function peopleInvolved(updates: TeamUpdate[]): number {
  return new Set(updates.map((update) => update.personId)).size;
}

/**
 * The summary line: enough to know whether the list is worth reading before
 * reading it.
 */
export function updatesSummary(updates: TeamUpdate[], phrase: string): string {
  if (updates.length === 0) {
    return `Nobody recorded anything ${phrase}.`;
  }
  const people = peopleInvolved(updates);
  const completed = updates.filter(
    (update) => update.kind === 'completed' || update.kind === 'contribution',
  ).length;
  const parts = [
    `${updates.length} update${updates.length === 1 ? '' : 's'}`,
    `from ${people} ${people === 1 ? 'person' : 'people'}`,
    phrase,
  ];
  const sentence = parts.join(' ');
  return completed > 0
    ? `${sentence}, ${completed} of them ${completed === 1 ? 'a completion' : 'completions'}.`
    : `${sentence}.`;
}

/** The day heading a run of updates sits under. */
export function dayKey(at: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date(at));
}

/**
 * Grouped under the day they happened, newest day first.
 *
 * A flat list of forty lines all saying "3 days ago" is harder to read than
 * four days with ten lines each, and the day is how somebody asks the question
 * — "what happened on Monday" — in the first place.
 */
export function groupByDay(
  updates: TeamUpdate[],
  timeZone: string,
): Array<{ day: string; updates: TeamUpdate[] }> {
  const days: Array<{ day: string; updates: TeamUpdate[] }> = [];
  for (const update of sortUpdates(updates)) {
    const day = dayKey(update.at, timeZone);
    const last = days[days.length - 1];
    if (last && last.day === day) last.updates.push(update);
    else days.push({ day, updates: [update] });
  }
  return days;
}
