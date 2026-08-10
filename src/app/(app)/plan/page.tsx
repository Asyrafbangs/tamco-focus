import Link from 'next/link';

import { CalendarItem } from '@/components/ui/ParityPrimitives';
import { taskDrawerHref } from '@/domain/navigation';
import { barrierHref } from '@/domain/barriers';
import { formatDue, localDateString } from '@/domain/duration';
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

/**
 * Monthly Plan (section 17).
 *
 * An overview of due and planned work that keeps it out of My Day. Every item
 * is clickable and opens the task it belongs to (section 17.3).
 *
 * The calendar is INFORMATIONAL. Section 17.3 forbids ungoverned drag-and-drop
 * changes to due date, ownership, or state, so nothing here is draggable and
 * nothing mutates — a due date is changed on the task, where it is audited.
 *
 * Section 17.4 asks for a date-grouped agenda on mobile rather than a squeezed
 * grid. One markup tree serves both: the CSS turns each day into a card and
 * hides empty days below 700px.
 *
 * A manager or an administrator can switch the calendar between their own work
 * and the reporting line their visibility settings cover (sections 3.4 and 18).
 * Team is their default, because the reason to open a shared calendar is to see
 * where the team's dates collide, and an empty month is a misleading answer
 * when the people they are responsible for have commitments in it. The scope is
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
};

export default async function PlanPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; scope?: string }>;
}) {
  const profile = await requireProfile();
  const params = await searchParams;
  const timeZone = profile.timezone ?? 'Asia/Kuala_Lumpur';

  const canSeeTeam = profile.role === 'manager' || profile.role === 'administrator';
  const scope: PlanScope = !canSeeTeam ? 'mine' : params.scope === 'mine' ? 'mine' : 'team';

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
  const byDate = new Map<string, PlanEvent[]>();
  for (const event of events) {
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

  const scopeSuffix = scope === 'mine' ? '&scope=mine' : '';
  const scopeHref = (next: PlanScope) =>
    `/plan?month=${monthKey(year, month)}${next === 'mine' ? '&scope=mine' : ''}`;

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
        <Link href={scope === 'mine' ? '/plan?scope=mine' : '/plan'} className="btn small ghost">
          This month
        </Link>
      </div>

      <div className="plan-legend" aria-label="Calendar legend">
        <span>
          <span className="flag blue">Due</span> commitment date
        </span>
        <span>
          <span className="flag red">Overdue</span> past its date and still open
        </span>
        <span>
          <span className="flag green">Routine</span> scheduled occurrence
        </span>
        <span>
          <span className="flag amber">Review by</span> review or selection deadline
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
        <div className="calendar" role="grid" aria-label={`Commitments in ${monthLabel}`}>
          {WEEKDAYS.map((day) => (
            <div key={day} className="cal-head" role="columnheader">
              {day}
            </div>
          ))}

          {/* Leading blanks keep the 1st under its correct weekday. Hidden on
              mobile, where the grid becomes an agenda. */}
          {Array.from({ length: leadingBlanks }, (_, index) => (
            <div key={`blank-${index}`} className="day is-empty" aria-hidden="true" />
          ))}

          {Array.from({ length: daysInMonth }, (_, index) => {
            const dayNumber = index + 1;
            const date = `${monthKey(year, month)}-${String(dayNumber).padStart(2, '0')}`;
            const dayEvents = byDate.get(date) ?? [];
            const isToday = date === today;

            const heading = new Intl.DateTimeFormat('en-GB', {
              weekday: 'short',
              day: 'numeric',
              month: 'short',
              timeZone: 'UTC',
            }).format(new Date(`${date}T00:00:00Z`));

            return (
              <div
                key={date}
                className={`day${isToday ? ' today' : ''}${dayEvents.length === 0 ? ' is-empty' : ''}`}
                role="gridcell"
              >
                <div className="daynum">
                  {/* The grid shows a bare number; the agenda needs the full
                      date, since it has no column headers to read from. */}
                  <span aria-hidden="true">{dayNumber}</span>
                  <span className="visually-hidden">{heading}</span>
                  {isToday && <span className="visually-hidden"> (today)</span>}
                </div>

                {dayEvents.map((event) => {
                  // Whose item this is only matters when it is not the viewer's.
                  const owner =
                    event.primaryOwnerId === profile.id
                      ? undefined
                      : (ownerNames.get(event.primaryOwnerId) ?? 'Shared with you');

                  return (
                    <CalendarItem
                      key={`${event.eventId ?? event.taskId}-${event.eventKind}-${event.occursAt}`}
                      /*
                       * §42 — a discussion links to the request it exists to
                       * settle, not to the task in general. Somebody clicking a
                       * meeting wants the thing they are meeting about.
                       */
                      href={
                        event.eventKind === 'discussion' && event.taskId && event.barrierId
                          ? barrierHref(event.taskId, event.barrierId)
                          : taskDrawerHref(event.taskId, '/plan')
                      }
                      kind={event.eventKind}
                      title={`${EVENT_LABELS[event.eventKind]}: ${event.title}`}
                      owner={owner}
                      accessibleSuffix={`${event.title} — ${EVENT_LABELS[event.eventKind]} ${formatDue(event.occursAt, event.dueIsDateOnly, timeZone)}${owner ? `, owned by ${owner}` : ''}`}
                    />
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
