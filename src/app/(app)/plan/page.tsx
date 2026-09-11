import Link from 'next/link';

import { taskDrawerHref } from '@/domain/navigation';
import { barrierHref } from '@/domain/barriers';
import { dueInputValue, formatDue, localDateString } from '@/domain/duration';
import { CalendarTypeGlyph } from '@/components/ui/ParityPrimitives';
import { requireProfile } from '@/lib/supabase/server';
import {
  getMeetingQueue,
  getPlanEvents,
  getTeamDirectory,
  getTeamLoad,
  getUserNames,
  type PlanEvent,
  type PlanScope,
} from '@/server/queries';

import { MeetingQueuePanel } from './MeetingQueuePanel';
import { PlanCalendar, type PlanCalendarDay, type PlanCalendarMove } from './PlanCalendar';

/**
 * Monthly Plan (section 17).
 *
 * An overview of due and planned work that keeps it out of My Day. Every item
 * is clickable and opens the task it belongs to (section 17.3).
 *
 * v153 — a due date can be dragged to another day, or moved with "Move to…"
 * beside it. Section 17.3 forbids UNGOVERNED drag-and-drop changes to due
 * date, ownership or state, and this one is governed: the drop calls the same
 * action as the task drawer's Edit due date, with the same authority check,
 * version guard and audit event. Only due dates move — routine occurrences,
 * review deadlines and meetings stay where they are — and nothing else about a
 * task can be changed from here. The interaction lives in `PlanCalendar`; this
 * page decides what is shown and which items may move.
 *
 * Section 17.4 asks for a date-grouped agenda on mobile rather than a squeezed
 * grid. One markup tree serves both: the CSS turns each day into a card and
 * hides empty days below 700px.
 *
 * A manager or an administrator can switch the calendar between their own work
 * and the reporting line their visibility settings cover (sections 3.4 and 18).
 * Since v156 their own commitments are the default and Team is one click away:
 * once steps are on it, fifteen people's calendar is a list rather than a plan,
 * so it is something to ask for rather than something to wade through. The scope is
 * a filter on an already-authorised query, never a widening of authority:
 * `plan_events` is a `security_invoker` view, so the same RLS that governs
 * `tasks` decides which rows exist. Dropping the owner filter asks the database
 * the question; it does not answer it.
 */

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** `YYYY-MM` for the month being shown, defaulting to the current one. */
function resolveMonth(
  requested: string | undefined,
  timeZone: string,
): { year: number; month: number } {
  const match = /^(\d{4})-(\d{2})$/.exec(requested ?? '');

  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    if (month >= 1 && month <= 12) return { year, month: month - 1 };
  }

  const today = localDateString(new Date(), timeZone).split('-').map(Number);
  return { year: today[0]!, month: today[1]! - 1 };
}

function monthKey(year: number, month: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}`;
}

const EVENT_LABELS: Record<PlanEvent['eventKind'], string> = {
  due: 'Due',
  overdue: 'Overdue',
  routine: 'Routine',
  review: 'Review by',
  // v47 §26 — a booked discussion sits on the same grid as the work it is
  // about, because it is a commitment in the same day.
  discussion: 'Meeting',
  // v156 — a step somebody owes, on the day it is due.
  step: 'Step',
};

/**
 * v153 — what moving this item needs, or nothing if it may not move.
 *
 * `canReschedule` is the database's answer for this viewer, taken from the
 * same authority check the procedure makes. The kind is checked as well so the
 * rule "only due dates move" is visible where the calendar is built, not only
 * inside a view definition.
 */
function movable(event: PlanEvent, timeZone: string): PlanCalendarMove | undefined {
  if (!event.canReschedule || event.taskVersion === null) return undefined;
  if (event.eventKind !== 'due' && event.eventKind !== 'overdue') return undefined;
  if (event.dueIsDateOnly) return { version: event.taskVersion, dueIsDateOnly: true };

  // A timed commitment keeps its time when it moves to another day, read in
  // the organisation's zone rather than the browser's so two people dragging
  // the same item cannot produce two different instants.
  const localTime = dueInputValue(event.occursAt, false, timeZone).slice(11, 16);
  if (localTime.length !== 5) return undefined;
  return { version: event.taskVersion, dueIsDateOnly: false, localTime };
}

export default async function PlanPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; scope?: string }>;
}) {
  const profile = await requireProfile();
  const params = await searchParams;
  const timeZone = profile.timezone ?? 'Asia/Kuala_Lumpur';

  const canSeeTeam = profile.role === 'manager' || profile.role === 'administrator';
  // v156 — a manager's own commitments are the default; Team is one click away.
  const scope: PlanScope = canSeeTeam && params.scope === 'team' ? 'team' : 'mine';

  const { year, month } = resolveMonth(params.month, timeZone);

  // Bounds are generous by a day at each end so an event sitting near local
  // midnight is not dropped by the UTC comparison.
  const rangeStart = new Date(Date.UTC(year, month, 1) - 86_400_000);
  const rangeEnd = new Date(Date.UTC(year, month + 1, 1) + 86_400_000);

  const [events, team, meetingQueue] = await Promise.all([
    getPlanEvents(profile.id, rangeStart, rangeEnd, scope),
    // Names for other people's items. `team_load_summary` is filtered by the
    // same visibility rules, so it can never name somebody whose work the
    // calendar was not already allowed to show.
    scope === 'team' ? getTeamLoad(profile.id) : Promise.resolve([]),
    // The queue is not scoped by the calendar filter: a topic waiting to be
    // discussed is waiting whichever way the calendar happens to be filtered.
    getMeetingQueue(),
  ]);

  const ownerNames = new Map(team.map((person) => [person.userId, person.fullName]));

  /*
   * §23 — who else can be pulled into a discussion.
   *
   * The two people the request is about are added by the procedure itself, so
   * this list is only for the third person somebody occasionally needs. It
   * reuses the same directory the assignment picker uses rather than inventing
   * a second idea of "who I may invite".
   */
  const schedulingPeople = (await getTeamDirectory()).filter((person) => person.id !== profile.id);

  // Shared work reaches this calendar because the viewer contributes to it, and
  // its owner may be somebody `team_load_summary` never covers — a peer rather
  // than a report. Resolve the remaining names directly; RLS returns only the
  // profiles this person may already see.
  const unnamed = [
    ...new Set(
      events
        .map((event) => event.primaryOwnerId)
        .filter((ownerId) => ownerId !== profile.id && !ownerNames.has(ownerId)),
    ),
  ];
  for (const [id, name] of await getUserNames(unnamed)) ownerNames.set(id, name);

  // Group by the LOCAL date each event falls on, so a commitment appears on the
  // day people would say it is due.
  /*
   * v156 — which steps belong on this calendar. The view returns every step row
   * the viewer may read; this decides which are worth a square. A step you owe
   * is always yours to see. One you are waiting on — or, in Team, one in your
   * team — is shown only when it is due before the work it belongs to: a step
   * due with its task is counted on the task's own entry ("3 steps due")
   * instead of drawn beside it, which is what keeps a calendar from becoming a
   * list.
   */
  /*
   * v159 — and your own steps. A step you gave yourself, or left unassigned,
   * with a date of its own was not on the calendar at all while one handed to
   * somebody else was. It follows the rule a step you are waiting on follows:
   * drawn when it is due before the work, counted on the work's entry when it
   * is due with it. Work with no date has no entry to count on, so a dated
   * step on it is always drawn.
   */
  const dueBeforeItsTask = (event: PlanEvent) =>
    event.stepHasOwnDate &&
    (event.parentDueAt === null ||
      localDateString(new Date(event.occursAt), timeZone) <
        localDateString(new Date(event.parentDueAt), timeZone));
  const visibleEvents = events.filter((event) => {
    if (event.eventKind !== 'step') return true;
    // Handed to you on somebody else's work: always yours to see.
    if (event.assigneeId === profile.id && event.primaryOwnerId !== profile.id) return true;
    if (!dueBeforeItsTask(event)) return false;
    return scope === 'team' || event.primaryOwnerId === profile.id;
  });

  const byDate = new Map<string, PlanEvent[]>();
  for (const event of visibleEvents) {
    const key = localDateString(new Date(event.occursAt), timeZone);
    const bucket = byDate.get(key);
    if (bucket) bucket.push(event);
    else byDate.set(key, [event]);
  }

  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  // ISO weekday of the 1st, as an offset from Monday.
  const leadingBlanks = (new Date(Date.UTC(year, month, 1)).getUTCDay() + 6) % 7;

  const today = localDateString(new Date(), timeZone);
  const monthLabel = new Intl.DateTimeFormat('en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month, 1)));

  const previous = monthKey(month === 0 ? year - 1 : year, (month + 11) % 12);
  const next = monthKey(month === 11 ? year + 1 : year, (month + 1) % 12);

  const totalInMonth = [...byDate.entries()].filter(([date]) =>
    date.startsWith(monthKey(year, month)),
  ).length;

  const scopeSuffix = scope === 'team' ? '&scope=team' : '';
  const scopeHref = (next: PlanScope) =>
    `/plan?month=${monthKey(year, month)}${next === 'team' ? '&scope=team' : ''}`;

  /*
   * v156 — a step's entry. It opens the task at that step, and never drags: a
   * step's date is changed in its step, where it may not pass its task (v154).
   *
   * v163 — its title and one line: "Step", "Overdue" once its date has passed,
   * and the one fact that matters — who owes it ("↘ Amer") when that is
   * somebody else, or the work it is part of when it is you.
   */
  const stepItem = (event: PlanEvent) => {
    const mine = event.assigneeId === profile.id;
    // v159 — a step on your own work is a step, not a shared one.
    const ownWork = event.primaryOwnerId === profile.id;
    const who = event.assigneeName ?? 'A colleague';
    const late = localDateString(new Date(event.occursAt), timeZone) < today;
    return {
      key: `${event.stepId}-step-${event.occursAt}`,
      taskId: event.taskId,
      href: `${taskDrawerHref(event.taskId, '/plan')}&step=${event.stepId}`,
      kind: event.eventKind,
      label: event.title,
      taskTitle: event.title,
      status: late ? ('overdue' as const) : undefined,
      relation: mine ? (event.parentTitle ?? undefined) : `↘ ${who.split(' ')[0] ?? who}`,
      tooltip: `${event.title} — ${mine ? (ownWork ? 'your step' : 'a step you owe') : `${who} owes this step`}${event.parentTitle ? ` on ${event.parentTitle}` : ''}`,
      accessibleSuffix: `${event.title} — a step ${mine ? 'you owe' : `${who} owes`}${event.parentTitle ? ` on ${event.parentTitle}` : ''}, due ${formatDue(event.occursAt, event.dueIsDateOnly, timeZone)}${late ? ', overdue' : ''}`,
    };
  };

  const calendarDays: PlanCalendarDay[] = Array.from({ length: daysInMonth }, (_, index) => {
    const dayNumber = index + 1;
    const date = `${monthKey(year, month)}-${String(dayNumber).padStart(2, '0')}`;

    const heading = new Intl.DateTimeFormat('en-GB', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
    }).format(new Date(`${date}T00:00:00Z`));

    const items = (byDate.get(date) ?? []).map((event) => {
      if (event.eventKind === 'step') return stepItem(event);

      // Whose item this is only matters when it is not the viewer's.
      const owner =
        event.primaryOwnerId === profile.id
          ? undefined
          : (ownerNames.get(event.primaryOwnerId) ?? 'Shared with you');

      return {
        key: `${event.eventId ?? event.taskId}-${event.eventKind}-${event.occursAt}`,
        taskId: event.taskId,
        /*
         * §42 — a discussion links to the request it exists to settle, not to
         * the task in general. Somebody clicking a meeting wants the thing
         * they are meeting about.
         */
        href:
          event.eventKind === 'discussion' && event.taskId && event.barrierId
            ? barrierHref(event.taskId, event.barrierId)
            : taskDrawerHref(event.taskId, '/plan'),
        kind: event.eventKind,
        // v163 — the title alone; what kind of entry it is sits on the line beneath.
        label: event.title,
        taskTitle: event.title,
        owner,
        status:
          event.eventKind === 'overdue'
            ? ('overdue' as const)
            : event.eventKind === 'review'
              ? ('review' as const)
              : undefined,
        // v156 — steps due with the task are counted here, not drawn beside it.
        relation:
          event.stepsDueWithTask > 0 && (event.eventKind === 'due' || event.eventKind === 'overdue')
            ? `${event.stepsDueWithTask} step${event.stepsDueWithTask === 1 ? '' : 's'} due`
            : undefined,
        accessibleSuffix: `${event.title} — ${EVENT_LABELS[event.eventKind]} ${formatDue(event.occursAt, event.dueIsDateOnly, timeZone)}${owner ? `, owned by ${owner}` : ''}`,
        move: movable(event, timeZone),
      };
    });

    return { date, dayNumber, heading, isToday: date === today, items };
  });

  const anyMovable = calendarDays.some((day) => day.items.some((item) => item.move));

  return (
    <>
      <div className="pagehead">
        <div>
          <p className="eyebrow">Plan</p>
          <h1>Monthly Plan</h1>
          <p>
            {scope === 'team'
              ? 'Due and planned work across your team for the month. Selecting an item opens it.'
              : 'Your dates for the month, including work shared with you. Selecting an item opens it.'}
            {/* Said only when it is true: a month with nothing this person may
                move should not advertise a gesture that will do nothing. */}
            {anyMovable && ' Drag a due date to another day to move it.'}
          </p>
        </div>
        {/*
          v47 §16 — the queue lives beside the calendar it feeds, and beside the
          scope control it shares a row with. It is not a sidebar destination:
          most weeks it is empty, and a permanent empty page teaches people to
          stop looking.
        */}
        <div className="plan-head-actions">
          <MeetingQueuePanel items={meetingQueue} people={schedulingPeople} timeZone={timeZone} />
          {canSeeTeam && (
            <nav className="team-focus-filter" aria-label="Calendar scope">
              <Link
                href={scopeHref('team')}
                className={scope === 'team' ? 'active' : ''}
                aria-current={scope === 'team' ? 'page' : undefined}
              >
                My team
              </Link>
              <Link
                href={scopeHref('mine')}
                className={scope === 'mine' ? 'active' : ''}
                aria-current={scope === 'mine' ? 'page' : undefined}
              >
                Only me
              </Link>
            </nav>
          )}
        </div>
      </div>

      <div className="plan-head">
        <div className="row">
          <Link
            href={`/plan?month=${previous}${scopeSuffix}`}
            className="btn small"
            aria-label="Previous month"
          >
            ←
          </Link>
          <strong style={{ fontSize: 16 }}>{monthLabel}</strong>
          <Link
            href={`/plan?month=${next}${scopeSuffix}`}
            className="btn small"
            aria-label="Next month"
          >
            →
          </Link>
        </div>
        <Link href={scope === 'team' ? '/plan?scope=team' : '/plan'} className="btn small ghost">
          This month
        </Link>
      </div>

      {/*
        v163 — the two questions the entries answer, answered here the same way:
        what kind of entry it is, which is all colour says, and what state it is
        in, which is a chip or who owes it. Completed work is not on the
        calendar at all (v162).
      */}
      <div className="plan-legend" aria-label="Calendar legend">
        <span className="plan-legend-group">
          <span className="plan-legend-heading">Type</span>
          {(['task', 'routine', 'step'] as const).map((type) => (
            <span key={type} className={`legend-type is-${type}`}>
              <CalendarTypeGlyph type={type} />
              {type === 'task' ? 'Task' : type === 'routine' ? 'Routine' : 'Step'}
            </span>
          ))}
        </span>
        <span className="plan-legend-group">
          <span className="plan-legend-heading">Status</span>
          <span className="cal-chip overdue">Overdue</span>
          <span className="cal-chip review">Review by</span>
          <span className="legend-assigned">↘ Assigned</span>
        </span>
      </div>

      {totalInMonth === 0 ? (
        /* Section 27.2 — what is empty, why, and the next useful action. */
        <div className="card empty-state">
          <h3>
            Nothing scheduled in {monthLabel}
            {scope === 'team' ? ' for you or your team' : ''}
          </h3>
          <p>
            Due dates, review deadlines, and routine occurrences appear here once work carries a
            date. Work with no date yet stays in Available Work until you give it one.
          </p>
          <div className="row">
            <Link href="/work" className="btn">
              Go to Work
            </Link>
            {canSeeTeam && scope === 'mine' && (
              <Link href={scopeHref('team')} className="btn ghost">
                Include my team
              </Link>
            )}
          </div>
        </div>
      ) : (
        <PlanCalendar
          monthLabel={monthLabel}
          weekdays={WEEKDAYS}
          leadingBlanks={leadingBlanks}
          days={calendarDays}
        />
      )}
    </>
  );
}
