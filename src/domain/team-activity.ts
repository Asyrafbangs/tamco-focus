/**
 * What the team actually moved forward, as a manager would recount it
 * (v232, §20).
 *
 * The first version of this screen was an audit trail with better typography:
 * six rows for one person working on one task for an afternoon. A manager had
 * to reassemble the story themselves, which is the work the screen was supposed
 * to save.
 *
 * So the rule here is a merge, not a list. Every raw event stays in the audit
 * trail; this takes one person's events on one task on one day and reports the
 * single thing that happened:
 *
 *     Amer · 11:17
 *     Fire Fighting System Improvement
 *     Progressed 40% → 70% · 1 step · 2 files
 *     "Vendor inspection completed. Quotation received."
 *
 * And it says what changed rather than that something changed. "Progress
 * updated" makes somebody open the task to learn anything; "40% → 70%" does
 * not.
 */

/** The events worth a manager's attention. Everything else stays in the audit. */
export type ActivityEventKind =
  | 'completed'
  | 'contribution'
  | 'routine'
  | 'step'
  | 'note'
  | 'evidence'
  | 'due'
  | 'priority'
  | 'blocked'
  | 'unblocked'
  | 'submitted'
  | 'finding';

export interface ActivityEvent {
  id: string;
  kind: ActivityEventKind;
  at: string;
  personId: string;
  personName: string;
  taskId: string;
  taskTitle: string;
  /** The work a contribution belongs to. */
  parentTitle: string | null;
  body: string | null;
  /** Progress after this event, where the event carries it. */
  progressAfter: number | null;
  /** Progress before the person's first event of the day, from the caller. */
  progressBefore: number | null;
  dueFrom: string | null;
  dueTo: string | null;
  priorityFrom: string | null;
  priorityTo: string | null;
  stepName: string | null;
}

export type Relationship = 'owned' | 'contribution' | 'routine';

export interface ActivityCard {
  key: string;
  at: string;
  personId: string;
  personName: string;
  taskId: string;
  taskTitle: string;
  relationship: Relationship;
  parentTitle: string | null;
  completed: boolean;
  submitted: boolean;
  blocked: boolean;
  unblocked: boolean;
  steps: number;
  files: number;
  progressFrom: number | null;
  progressTo: number | null;
  dueFrom: string | null;
  dueTo: string | null;
  priorityFrom: string | null;
  priorityTo: string | null;
  /** The most recent thing the person actually wrote. */
  note: string | null;
  findings: string[];
}

/**
 * The day an instant falls on, in the reader's zone.
 *
 * Grouping on the server's midnight puts a 7am update in Kuala Lumpur under
 * "yesterday" for the person who wrote it.
 */
export function dayOf(at: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date(at));
}

/**
 * One card per person, per task, per day.
 *
 * Not per person per task outright: a fortnight of work on one task is a story
 * with days in it, and collapsing those into a single card would hide that
 * nothing has moved since Tuesday.
 */
export function mergeActivity(events: ActivityEvent[], timeZone: string): ActivityCard[] {
  const byGroup = new Map<string, ActivityEvent[]>();
  for (const event of events) {
    const key = `${event.personId}|${event.taskId}|${dayOf(event.at, timeZone)}`;
    const existing = byGroup.get(key);
    if (existing) existing.push(event);
    else byGroup.set(key, [event]);
  }

  const cards: ActivityCard[] = [];
  for (const [key, group] of byGroup) {
    const ordered = [...group].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
    const last = ordered[ordered.length - 1]!;
    const first = ordered[0]!;

    const progressEvents = ordered.filter((event) => event.progressAfter !== null);
    const progressTo = progressEvents.length
      ? (progressEvents[progressEvents.length - 1]!.progressAfter ?? null)
      : null;
    /*
     * Only claim a change when the starting point is known. Inventing a "from"
     * — assuming nought, or reading the first event's own result as its
     * starting point — reports a bigger move than happened, which is the one
     * kind of wrong a progress figure must never be.
     */
    const progressFrom = first.progressBefore;

    const relationship: Relationship = ordered.some((event) => event.kind === 'routine')
      ? 'routine'
      : ordered.some((event) => event.kind === 'contribution')
        ? 'contribution'
        : 'owned';

    const written = [...ordered]
      .reverse()
      .find((event) => event.kind === 'note' && (event.body ?? '').trim());
    const due = [...ordered].reverse().find((event) => event.kind === 'due');
    const priority = [...ordered].reverse().find((event) => event.kind === 'priority');

    cards.push({
      key,
      at: last.at,
      personId: last.personId,
      personName: last.personName,
      taskId: last.taskId,
      taskTitle: last.taskTitle,
      relationship,
      parentTitle: ordered.find((event) => event.parentTitle)?.parentTitle ?? null,
      completed: ordered.some(
        (event) => event.kind === 'completed' || event.kind === 'contribution',
      ),
      submitted: ordered.some((event) => event.kind === 'submitted'),
      blocked: ordered.some((event) => event.kind === 'blocked'),
      unblocked: ordered.some((event) => event.kind === 'unblocked'),
      steps: ordered.filter((event) => event.kind === 'step').length,
      files: ordered.filter((event) => event.kind === 'evidence').length,
      progressFrom: progressFrom !== null && progressFrom !== progressTo ? progressFrom : null,
      progressTo,
      dueFrom: due?.dueFrom ?? null,
      dueTo: due?.dueTo ?? null,
      priorityFrom: priority?.priorityFrom ?? null,
      priorityTo: priority?.priorityTo ?? null,
      note: written?.body?.trim() ?? null,
      findings: ordered
        .filter((event) => event.kind === 'finding' && event.body)
        .map((event) => event.body!.trim()),
    });
  }

  return cards.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : a.key < b.key ? 1 : -1));
}

/** The short phrases under the task title, worst-to-least-important first. */
export function cardChanges(card: ActivityCard): string[] {
  const changes: string[] = [];
  if (card.blocked) changes.push('Blocked');
  if (card.unblocked) changes.push('Unblocked');
  if (card.completed) changes.push('Completed');
  if (card.submitted && !card.completed) changes.push('Submitted for review');
  if (card.progressTo !== null) {
    changes.push(
      card.progressFrom !== null
        ? `Progress ${card.progressFrom}% → ${card.progressTo}%`
        : `Progress ${card.progressTo}%`,
    );
  }
  if (card.steps > 0) changes.push(`${card.steps} step${card.steps === 1 ? '' : 's'} completed`);
  if (card.files > 0) changes.push(`${card.files} file${card.files === 1 ? '' : 's'} added`);
  if (card.dueTo) {
    changes.push(card.dueFrom ? `Due ${card.dueFrom} → ${card.dueTo}` : `Due ${card.dueTo}`);
  }
  if (card.priorityTo) {
    changes.push(
      card.priorityFrom
        ? `Priority ${card.priorityFrom} → ${card.priorityTo}`
        : `Priority ${card.priorityTo}`,
    );
  }
  return changes;
}

export type ActivityFilter = 'all' | 'completed' | 'progress' | 'notes' | 'evidence' | 'blocked';

export const ACTIVITY_FILTERS: ReadonlyArray<{ key: ActivityFilter; label: string }> = [
  { key: 'all', label: 'All activity' },
  { key: 'completed', label: 'Completed' },
  { key: 'progress', label: 'Progress' },
  { key: 'notes', label: 'Updates' },
  { key: 'evidence', label: 'Evidence' },
  { key: 'blocked', label: 'Blocked' },
];

export function matchesFilter(card: ActivityCard, filter: ActivityFilter): boolean {
  switch (filter) {
    case 'completed':
      return card.completed;
    case 'progress':
      return card.progressTo !== null || card.steps > 0;
    case 'notes':
      return Boolean(card.note);
    case 'evidence':
      return card.files > 0;
    case 'blocked':
      return card.blocked || card.unblocked;
    default:
      return true;
  }
}

/** One understated line, rather than a row of dashboard cards. */
export function activitySummary(cards: ActivityCard[], phrase: string): string {
  if (cards.length === 0) return `Nothing recorded ${phrase}.`;
  const completed = cards.filter((card) => card.completed).length;
  const progressed = cards.filter(
    (card) => !card.completed && (card.progressTo !== null || card.steps > 0),
  ).length;
  const evidence = cards.filter((card) => card.files > 0).length;
  const parts = [`${cards.length} ${cards.length === 1 ? 'activity' : 'activities'}`];
  if (completed > 0) parts.push(`${completed} completed`);
  if (progressed > 0) parts.push(`${progressed} progressed`);
  if (evidence > 0) parts.push(`${evidence} with evidence`);
  return `${parts.join(' · ')} ${phrase}.`;
}

/**
 * How much each person appears, including the people who do not.
 *
 * Somebody with nothing is listed saying so rather than left off: absence is
 * the thing a manager most needs to notice, and a name quietly missing from a
 * list is not noticeable. The wording stays neutral — a fortnight on one
 * difficult task is honest work that generates no events.
 */
export function perPerson(
  cards: ActivityCard[],
  team: Array<{ userId: string; fullName: string }>,
): Array<{ personId: string; personName: string; count: number }> {
  const counts = new Map<string, number>();
  for (const card of cards) counts.set(card.personId, (counts.get(card.personId) ?? 0) + 1);
  return team
    .map((person) => ({
      personId: person.userId,
      personName: person.fullName,
      count: counts.get(person.userId) ?? 0,
    }))
    .sort((a, b) => b.count - a.count || a.personName.localeCompare(b.personName));
}

/** Newest day first, each day's cards newest first. */
export function groupByDay(
  cards: ActivityCard[],
  timeZone: string,
): Array<{ day: string; cards: ActivityCard[] }> {
  const days: Array<{ day: string; cards: ActivityCard[] }> = [];
  for (const card of cards) {
    const day = dayOf(card.at, timeZone);
    const last = days[days.length - 1];
    if (last && last.day === day) last.cards.push(card);
    else days.push({ day, cards: [card] });
  }
  return days;
}
