import Link from 'next/link';

import {
  FocusTabs,
  ProgressIndicator,
  RoutineRow,
  RowPrimaryLink,
  WorkspaceTabs,
  type TabItem,
} from '@/components/ui/ParityPrimitives';
import {
  ROUTINE_OCCURRENCE_LABELS,
  routineOccurrenceState,
  formatDue,
  localDateString,
} from '@/domain/duration';
import { taskDrawerHref } from '@/domain/navigation';
import { type TaskOverview } from '@/domain/types';
import { PeriodPicker } from '@/components/ui/PeriodPicker';
import { periodParams, resolvePeriod, ROUTINE_PERIODS } from '@/domain/period';
import { requireProfile } from '@/lib/supabase/server';

import { RoutineManager } from './RoutineManager';
import {
  PersonRoutineProfile,
  RoutineComplianceList,
  RoutineStandingList,
  TeamRoutineList,
} from './TeamRoutineView';
import {
  getDisplaySettings,
  getFocusSummary,
  getBinnedRoutines,
  getRoutineExceptionQueue,
  getRoutineTeamStanding,
  getTeamRoutineCompliance,
  getTeamRoutineSummary,
  getRoutineOutcomes,
  getRoutineTally,
  getRoutineTemplates,
  getTeamDirectory,
  getMyTasks,
  getRoutineOccurrences,
  getTeamLoad,
} from '@/server/queries';

/**
 * Work → Routine (section 16; shell unified in v43 section 6).
 *
 * Routine occurrences, not templates. A template is controlled and never itself
 * Active (section 16.1); what a person completes is one generated occurrence
 * with its own due date, checklist, evidence, and audit history.
 *
 * This page sits inside the SAME Work shell as Focus — same heading, same
 * My Work / My Team scope selector, same Focus / Routine selector. Switching to
 * Routine changes the work lifecycle on display, not the application you appear
 * to be in; previously it dropped the scope selector entirely, so it read as a
 * different product.
 *
 * The one thing deliberately NOT shared is the primary action. The shell used
 * to carry New Work here too, which was a genuine trap: it creates a task, and
 * a person who wanted a repeating responsibility got a one-off piece of work
 * and no routine. The button follows the selector instead — Focus creates
 * work, Routine creates the schedule that generates it.
 *
 * What does NOT carry over is Focus vocabulary. Routine has its own occurrence
 * lifecycle — Due now, Upcoming, Completed — because nobody activates an
 * occurrence and it consumes no focus target. Reusing Active/Available here
 * would imply a decision that does not exist.
 */

type RoutineView = 'due' | 'upcoming' | 'completed';

/**
 * Opens the schedules disclosure AND the create form inside it. Both, because
 * the form lives in that disclosure: leaving it shut would put the form behind
 * a closed `details` on the very navigation that asked for it.
 */
const ROUTINE_SETUP_HREF = '/work/routine?schedules=1&new=';

export default async function RoutinePage({
  searchParams,
}: {
  searchParams: Promise<{
    view?: string;
    new?: string;
    outcome?: string;
    period?: string;
    period_from?: string;
    period_to?: string;
    /** The manager layer: which panel, whose history, and how it is filtered. */
    panel?: string;
    person?: string;
    q?: string;
    filter?: string;
    /** Opens the schedules disclosure, for the empty state that points at it. */
    schedules?: string;
    /** The secondary axis: read the team by schedule rather than by person. */
    by?: string;
    routine?: string;
  }>;
}) {
  const profile = await requireProfile();
  const params = await searchParams;

  const isManager = profile.role === 'manager' || profile.role === 'administrator';

  /*
   * One period for this page, in the vocabulary every other screen uses.
   *
   * Routine used to resolve two of its own: a rolling 30/60/90 strip on its
   * own Completed view and a calendar-based strip on the manager panel, both
   * reading the same `period` parameter and neither offering a date range.
   *
   * Both now open on this month, because a routine is scheduled by the month
   * and that is the question either reader is asking. It also has to be a
   * period the menu actually offers: defaulting Completed to a rolling thirty
   * days left the button reading "Last 30 days" above a list that did not
   * contain it, so nothing was marked as current.
   */
  const now = new Date();
  const period = resolvePeriod(
    params.period,
    params.period_from,
    params.period_to,
    now,
    'this-month',
    // The reader's zone: "this month" means the month on their wall.
    profile.timezone,
  );
  const completedSince = period.since;
  const managerWindow = { since: period.since, until: period.until };
  // The chosen period travels with every manager link, so opening a person or
  // a schedule does not silently reset the question that was just asked.
  const managerQuery = new URLSearchParams(periodParams(period)).toString();
  const managerPanel = isManager && params.panel === 'manager';
  const managerPerson = managerPanel ? (params.person ?? null) : null;
  /*
   * People is the default and stays it: that is how a team is managed. Reading
   * by schedule answers a compliance question instead, which is asked far less
   * often than "who needs me".
   */
  const managerAxis: 'people' | 'routines' =
    managerPanel && params.by === 'routines' ? 'routines' : 'people';
  const managerRoutine =
    managerAxis === 'routines' && !managerPerson ? (params.routine ?? null) : null;
  // The same parameter, narrowing one person's history instead of choosing a
  // schedule to read across the team.
  const personRoutine = managerPerson ? (params.routine ?? null) : null;

  const [
    settings,
    occurrences,
    tasks,
    focus,
    team,
    routines,
    directory,
    binnedRoutines,
    routineOutcomes,
    exceptionQueue,
    tally,
    teamRoutine,
    personOutcomes,
    personTally,
    routineCompliance,
    routineStanding,
  ] = await Promise.all([
    getDisplaySettings(),
    getRoutineOccurrences(profile.id),
    getMyTasks(profile.id),
    getFocusSummary(profile.id),
    isManager ? getTeamLoad(profile.id) : Promise.resolve([]),
    // The schedules behind the occurrences. Nothing read this table and
    // nothing could write it, which is why creating a routine did nothing.
    getRoutineTemplates(),
    isManager ? getTeamDirectory() : Promise.resolve([]),
    // Deleted schedules belong beside the schedules, not in the Focus Bin.
    getBinnedRoutines(profile.id),
    // Both outcomes, over the chosen period. Only when Completed is open:
    // finished routine work is history, not part of anybody's day.
    params.view === 'completed'
      ? getRoutineOutcomes(profile.id, completedSince, period.until)
      : Promise.resolve({ outcomes: [], failed: false }),
    // What this manager has been asked to accept. Nothing to decide is the
    // normal case, and then nothing appears.
    isManager
      ? getRoutineExceptionQueue(profile.id)
      : Promise.resolve({ pending: [], failed: false }),
    // Counted, never entered. Only on Completed, where somebody is already
    // looking back rather than trying to get something done.
    params.view === 'completed'
      ? getRoutineTally(profile.id, completedSince)
      : Promise.resolve({ tallies: [], total: null, failed: false }),
    // People first: only loaded when the manager layer is actually open.
    managerPanel && !managerPerson
      ? getTeamRoutineSummary(profile.id, managerWindow.since, managerWindow.until)
      : Promise.resolve({ rows: [], failed: false }),
    managerPerson
      ? getRoutineOutcomes(managerPerson, managerWindow.since, managerWindow.until, [
          'done',
          'not_required',
          'awaiting_decision',
          'open',
        ])
      : Promise.resolve({ outcomes: [], failed: false }),
    managerPerson
      ? getRoutineTally(managerPerson, managerWindow.since, managerWindow.until)
      : Promise.resolve({ tallies: [], total: null, failed: false }),
    managerAxis === 'routines' && !managerRoutine
      ? getTeamRoutineCompliance(profile.id, managerWindow.since, managerWindow.until)
      : Promise.resolve({ rows: [], failed: false }),
    managerRoutine
      ? getRoutineTeamStanding(profile.id, managerRoutine, managerWindow.since, managerWindow.until)
      : Promise.resolve({ title: 'Routine', people: [], failed: false }),
  ]);

  const timeZone = profile.timezone ?? 'Asia/Kuala_Lumpur';
  const today = localDateString(new Date(), timeZone);

  const overdue = occurrences.filter((task) => task.isOverdue && task.status !== 'completed');
  const dueToday = occurrences.filter(
    (task) => !task.isOverdue && task.status !== 'completed' && task.occurrenceDate === today,
  );
  const upcoming = occurrences.filter(
    (task) => !task.isOverdue && task.status !== 'completed' && (task.occurrenceDate ?? '') > today,
  );
  /*
   * An occurrence waiting for a manager's decision is not Due.
   *
   * The person has said their piece and there is nothing further for them to
   * do; leaving it in Due would keep asking them for work that may not exist.
   * It is not Completed either, so it appears in neither list until decided -
   * which is exactly where it stands.
   */
  const awaitingIds = new Set(
    routineOutcomes.outcomes
      .filter((row) => row.outcome === 'awaiting_decision')
      .map((row) => row.taskId),
  );

  /*
   * The reader's own schedules, and which of them are not running yet.
   *
   * An empty occurrence list means three different things depending on these:
   * nobody has given them a routine, they set one up and it is waiting to be
   * switched on, or everything is running and nothing falls today. Only the
   * first two have a useful next action.
   */
  const mySchedules = routines.templates.filter((template) => template.ownerId === profile.id);
  const awaitingActivation = mySchedules.filter((template) => !template.isActive);

  // "Due now / this week" is one decision — what has to happen before the week
  // ends — so overdue and today's occurrences belong together rather than in
  // two lists somebody has to reconcile.
  const dueNow = [...overdue, ...dueToday].filter((task) => !awaitingIds.has(task.id));

  const view: RoutineView =
    params.view === 'upcoming' ? 'upcoming' : params.view === 'completed' ? 'completed' : 'due';

  const visible: TaskOverview[] = view === 'upcoming' ? upcoming : dueNow;

  const outcomeFilter: 'all' | 'done' | 'not_required' =
    params.outcome === 'done' ? 'done' : params.outcome === 'not_required' ? 'not_required' : 'all';
  const shownOutcomes = routineOutcomes.outcomes.filter((row) =>
    outcomeFilter === 'all' ? true : row.outcome === outcomeFilter,
  );

  // Counts the Focus tab needs, so the shell reads identically on both pages.
  const activeCount = tasks.filter(
    (task) =>
      task.primaryOwnerId === profile.id &&
      (task.status === 'active' || task.status === 'paused') &&
      task.workClass !== 'routine_occurrence',
  ).length;

  const teamNeedingAttention = team.filter(
    (person) =>
      person.openBarrierCount > 0 ||
      person.overdueCount > 0 ||
      person.decisionsPending > 0 ||
      person.routinesOverdue > 0 ||
      person.staleCount > 0 ||
      focus.some((bucket) => bucket.userId === person.userId && bucket.isOverTarget),
  );

  const VIEW_MEANING: Record<RoutineView, string> = {
    due: 'Occurrences that are overdue or scheduled for today.',
    upcoming: `Scheduled within the next ${settings.upcomingWindowDays} days and beyond.`,
    completed: 'What was done, and what genuinely was not required.',
  };

  return (
    <>
      <div className="pagehead">
        <div>
          <p className="eyebrow">Work</p>
          <h1>My Work</h1>
          <p>One workspace for focused commitments and repeating responsibilities.</p>
        </div>
        {/*
          Routine's half of the contextual action (see the Focus page).

          "Set up routine" rather than "New routine" because what this creates
          is the schedule, not a piece of work. The occurrences need no button
          at all — the schedule generates them, which is the entire reason
          somebody sets one up.

          It is shown to everybody, including on the manager's team panel:
          creating a schedule needs no particular authority here, and
          assigning one to somebody else needs exactly the authority that
          opened that panel. There is no reader who would be given a button
          that cannot work, so there is no case to hide it in.
        */}
        <div className="actions">
          <Link href={ROUTINE_SETUP_HREF} className="btn primary">
            ＋ Set up routine
          </Link>
        </div>
      </div>

      {isManager && (
        <WorkspaceTabs
          label="Work scope"
          items={[
            { href: '/work', label: 'My Work', active: true },
            {
              href: '/work?scope=team',
              label: 'My Team',
              count: teamNeedingAttention.length,
              attention: teamNeedingAttention.length > 0,
            },
          ]}
        />
      )}

      {/* The same two levels as Focus: whose work, then what kind. Rendered
          with the lighter treatment so the pair reads as a hierarchy rather
          than as four peers on one line (v130). */}
      <WorkspaceTabs
        label="Work type"
        tone="mode"
        items={[
          // Counted only where there is something to count: "0 active" and
          // "none due" are badges reporting the absence of news.
          {
            href: '/work',
            label: 'Focus',
            count: activeCount > 0 ? `${activeCount} active` : undefined,
          },
          {
            href: '/work/routine',
            label: 'Routine',
            active: true,
            count:
              overdue.length > 0
                ? `${overdue.length} overdue`
                : dueToday.length > 0
                  ? `${dueToday.length} due`
                  : undefined,
            attention: overdue.length > 0,
          },
        ]}
      />

      {/* Routine consumes no focus target, so no capacity strip belongs here —
          its absence is the point, and the sentence below says so. */}
      <p className="capacity-strip" role="status">
        Routine work does not use any of your focus targets.
      </p>

      {/*
        Two audiences, one module.

        An employee's Routine answers "what do I have to do"; a manager's
        answers "who needs me". Those are different enough that mixing them
        produces a screen serving neither - and a manager is also an employee,
        so this is a switch rather than a role.
      */}
      {isManager && (
        <div className="routine-audience" role="group" aria-label="Routine view">
          <Link
            href="/work/routine"
            className={managerPanel ? undefined : 'active'}
            aria-current={managerPanel ? undefined : 'true'}
          >
            My routine
          </Link>
          <Link
            href="/work/routine?panel=manager"
            className={managerPanel ? 'active' : undefined}
            aria-current={managerPanel ? 'true' : undefined}
          >
            My team
          </Link>
        </div>
      )}

      {managerPanel && !managerPerson && !managerRoutine && (
        <div className="routine-axis" role="group" aria-label="Read the team by">
          <Link
            href={`/work/routine?panel=manager&${managerQuery}`}
            className={managerAxis === 'people' ? 'active' : undefined}
            aria-current={managerAxis === 'people' ? 'true' : undefined}
          >
            People
          </Link>
          <Link
            href={`/work/routine?panel=manager&by=routines&${managerQuery}`}
            className={managerAxis === 'routines' ? 'active' : undefined}
            aria-current={managerAxis === 'routines' ? 'true' : undefined}
          >
            Routines
          </Link>
        </div>
      )}

      {managerPanel ? (
        managerRoutine ? (
          <RoutineStandingList
            title={routineStanding.title}
            people={routineStanding.people}
            period={period}
            backHref={`/work/routine?panel=manager&by=routines&${managerQuery}`}
            taskHref={(taskId) =>
              taskDrawerHref(
                taskId,
                `/work/routine?panel=manager&by=routines&routine=${managerRoutine}`,
              )
            }
            personHref={(userId) => `/work/routine?panel=manager&person=${userId}&${managerQuery}`}
          />
        ) : managerAxis === 'routines' ? (
          <RoutineComplianceList
            rows={routineCompliance.rows}
            failed={routineCompliance.failed}
            period={period}
            hrefFor={(templateId) =>
              `/work/routine?panel=manager&by=routines&routine=${templateId}&${managerQuery}`
            }
          />
        ) : managerPerson ? (
          <PersonRoutineProfile
            name={team.find((person) => person.userId === managerPerson)?.fullName ?? 'Team member'}
            tally={personTally.total}
            tallies={personTally.tallies}
            outcomes={personOutcomes.outcomes}
            period={period}
            routineFilter={personRoutine}
            routineHref={(templateId) =>
              `/work/routine?panel=manager&person=${managerPerson}&${managerQuery}${
                templateId ? `&routine=${templateId}` : ''
              }`
            }
            backHref={`/work/routine?panel=manager&${managerQuery}`}
            taskHref={(taskId) =>
              taskDrawerHref(taskId, `/work/routine?panel=manager&person=${managerPerson}`)
            }
          />
        ) : (
          <TeamRoutineList
            rows={teamRoutine.rows}
            failed={teamRoutine.failed}
            query={params.q ?? ''}
            period={period}
            attentionOnly={params.filter === 'attention'}
          />
        )
      ) : (
        <>
          <FocusTabs
            label="Routine occurrences"
            items={(['due', 'upcoming', 'completed'] as RoutineView[]).map(
              (key) =>
                ({
                  href: key === 'due' ? '/work/routine' : `/work/routine?view=${key}`,
                  /*
                    "Due now / this week" and its own description — "overdue or
                    scheduled for today" — did not agree with each other. The
                    description was the honest one, so the label matches it now:
                    Due now means overdue or due today, and everything later is
                    Upcoming.
                  */
                  label: key === 'due' ? 'Due now' : key === 'upcoming' ? 'Upcoming' : 'Completed',
                  active: key === view,
                  // No badge on Completed: a running total of finished routine work
                  // is not something anybody needs to act on. The count that means
                  // something is inside, after the period filter.
                  // A zero here is a counter reporting that there is nothing
                  // to count. Silence says it, and takes no room.
                  count:
                    key === 'due'
                      ? dueNow.length || undefined
                      : key === 'upcoming'
                        ? upcoming.length || undefined
                        : undefined,
                  attention: key === 'due' && overdue.length > 0,
                }) satisfies TabItem,
            )}
          />

          <p className="focus-tab-meaning">{VIEW_MEANING[view]}</p>

          {exceptionQueue.pending.length > 0 && (
            <section className="routine-exception-queue" aria-label="Routine exceptions">
              <h2>Routine exception{exceptionQueue.pending.length === 1 ? '' : 's'} to accept</h2>
              {/* One click to accept. Returning it costs a sentence, and that is
              written in the occurrence itself, where the person will read it. */}
              {exceptionQueue.pending.map((row) => (
                <article key={row.exceptionId ?? row.taskId} className="routine-exception-row">
                  <div>
                    <strong>{row.title}</strong>
                    <span>
                      {row.ownerName}
                      {row.occurrenceDate ? ` · ${row.occurrenceDate}` : ''}
                    </span>
                    <span className="muted">
                      {row.reasonCode === 'no_applicable_work'
                        ? 'No applicable site or work'
                        : row.reasonCode === 'activity_cancelled'
                          ? 'Activity cancelled'
                          : (row.reasonNote ?? 'Other')}
                    </span>
                  </div>
                  <Link
                    href={taskDrawerHref(row.taskId, '/work/routine')}
                    className="btn small primary"
                  >
                    Review
                  </Link>
                </article>
              ))}
            </section>
          )}

          {overdue.length > 0 && view === 'due' && (
            <div className="notice error" role="status" style={{ marginTop: 14 }}>
              <strong>
                {overdue.length} routine occurrence{overdue.length === 1 ? '' : 's'} overdue
              </strong>
              <p>
                A missed occurrence stays open rather than disappearing, so the record of what was
                and was not done remains accurate.
              </p>
            </div>
          )}

          {view === 'completed' ? (
            <div className="focus-panel">
              <div className="completed-controls">
                <div className="segmented" role="group" aria-label="Which outcome">
                  {(
                    [
                      ['all', 'All'],
                      ['done', 'Done'],
                      ['not_required', 'Not required'],
                    ] as const
                  ).map(([key, label]) => {
                    const query = new URLSearchParams({
                      view: 'completed',
                      ...periodParams(period),
                    });
                    if (key !== 'all') query.set('outcome', key);
                    return (
                      <Link
                        key={key}
                        href={`/work/routine?${query.toString()}`}
                        className={outcomeFilter === key ? 'active' : undefined}
                        aria-current={outcomeFilter === key ? 'true' : undefined}
                      >
                        {label}
                      </Link>
                    );
                  })}
                </div>
                {/* Three rolling day counts and nothing else, on a view whose
                    own manager panel offered five calendar periods and a page
                    elsewhere offered a date range. One control now. */}
                <PeriodPicker
                  action="/work/routine"
                  hidden={{
                    view: 'completed',
                    ...(outcomeFilter === 'all' ? {} : { outcome: outcomeFilter }),
                  }}
                  presets={ROUTINE_PERIODS}
                  period={period}
                  now={now}
                />
              </div>

              {tally.total && (
                <div className="routine-tally" aria-label="Routine summary for this period">
                  <div>
                    <strong>{tally.total.scheduled}</strong>
                    <span>Scheduled</span>
                  </div>
                  <div>
                    <strong>{tally.total.done}</strong>
                    <span>Completed</span>
                  </div>
                  <div>
                    <strong>{tally.total.notRequired}</strong>
                    <span>Not required</span>
                  </div>
                  <div>
                    <strong>{tally.total.outstanding}</strong>
                    <span>Outstanding</span>
                  </div>
                  <p className="routine-tally-note">
                    {tally.total.stepsCompleted} step{tally.total.stepsCompleted === 1 ? '' : 's'}{' '}
                    completed · {tally.total.attachments} attachment
                    {tally.total.attachments === 1 ? '' : 's'}. Counted from the occurrence records
                    — nobody enters these.
                  </p>
                </div>
              )}

              <p className="completed-count" role="status">
                {shownOutcomes.length} {shownOutcomes.length === 1 ? 'occurrence' : 'occurrences'}
              </p>

              {shownOutcomes.length === 0 ? (
                <div className="empty-state compact">
                  <h3>Nothing in this period</h3>
                  <p>Widen the period, or change which outcome you are looking at.</p>
                </div>
              ) : (
                <div className="completed-list">
                  {shownOutcomes.map((row) => (
                    <Link
                      key={row.taskId}
                      href={taskDrawerHref(row.taskId, '/work/routine?view=completed')}
                      className="completed-row"
                    >
                      <span className="completed-tick" aria-hidden="true">
                        {row.outcome === 'done' ? '✓' : '—'}
                      </span>
                      <span className="completed-copy">
                        <strong>{row.title}</strong>
                        {row.outcome === 'done' ? (
                          <span>Completed</span>
                        ) : (
                          <span>
                            Not required ·{' '}
                            {row.reasonCode === 'no_applicable_work'
                              ? 'No applicable site or work'
                              : row.reasonCode === 'activity_cancelled'
                                ? 'Activity cancelled'
                                : (row.reasonNote ?? 'Other')}
                            {row.decidedByName ? ` · accepted by ${row.decidedByName}` : ''}
                          </span>
                        )}
                        <span className="completed-when">{row.occurrenceDate}</span>
                      </span>
                      <span className="completed-chevron" aria-hidden="true">
                        ›
                      </span>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="focus-panel">
              {visible.length > 0 ? (
                visible.map((task) => {
                  const state = routineOccurrenceState(task, timeZone);
                  return (
                    <RoutineRow key={task.id}>
                      <div>
                        <RowPrimaryLink
                          href={taskDrawerHref(task.id, '/work/routine')}
                          className="title-link"
                          ariaLabel={`Open ${task.title}`}
                        >
                          <strong>{task.title}</strong>
                        </RowPrimaryLink>
                        <span className="sub">
                          Routine occurrence
                          {task.checklistTotal > 0 &&
                            ` · ${task.checklistCompleted} of ${task.checklistTotal} steps`}
                          {task.missingEvidenceCount > 0 &&
                            ` · ${task.missingEvidenceCount} step${
                              task.missingEvidenceCount === 1 ? '' : 's'
                            } need evidence`}
                        </span>
                      </div>

                      <div className="hide-mobile">
                        <span
                          className={`status ${
                            state === 'overdue'
                              ? 'cancelled'
                              : state === 'due_today'
                                ? 'active'
                                : state === 'completed'
                                  ? 'completed'
                                  : 'backlog'
                          }`}
                        >
                          {ROUTINE_OCCURRENCE_LABELS[state]}
                        </span>
                        <div className="sub" style={{ marginTop: 4 }}>
                          {formatDue(task.dueAt, task.dueIsDateOnly, timeZone)}
                        </div>
                      </div>

                      <div className="hide-narrow">
                        <ProgressIndicator
                          value={task.progressPercent}
                          label={
                            task.checklistTotal > 0
                              ? `${task.checklistCompleted} of ${task.checklistTotal} steps`
                              : `${task.progressPercent}% complete`
                          }
                        />
                      </div>

                      <div className="row-action">
                        <Link href={taskDrawerHref(task.id, '/work/routine')} className="btn small">
                          Open
                        </Link>
                      </div>
                    </RoutineRow>
                  );
                })
              ) : (
                /*
                  What is empty, why, and — only where there is one — the next
                  useful action.

                  This used to answer every situation with the same paragraph
                  and a "New Work" button. The paragraph explained the
                  machinery: occurrences are created from templates, and a
                  routine you set up starts once your manager activates it.
                  That is how it works, not what the reader needs, and the
                  button was worse than useless — New Work does not create a
                  schedule, so it invited people to make a task and wonder why
                  no routine appeared.

                  Three different situations, three answers: no schedules at
                  all, schedules that exist but are waiting to be switched on,
                  and schedules running with nothing due today.
                */
                <div className="empty-state">
                  <h3>
                    {mySchedules.length === 0
                      ? 'No routine responsibilities yet'
                      : view === 'upcoming'
                        ? 'Nothing scheduled ahead'
                        : 'No routine work due'}
                  </h3>
                  <p>
                    {mySchedules.length === 0
                      ? 'Routine work will appear here automatically when a schedule is set up or assigned to you.'
                      : awaitingActivation.length > 0
                        ? `${awaitingActivation.length} routine ${awaitingActivation.length === 1 ? 'schedule is' : 'schedules are'} waiting for manager activation.`
                        : view === 'upcoming'
                          ? 'Future occurrences appear as their scheduled date approaches, so the list stays about work you can act on.'
                          : 'Routine work appears here automatically when it reaches its scheduled date.'}
                  </p>
                  {/*
                    No second setup button. This one sat directly under a
                    header that now reads Set up routine, so an empty screen
                    offered the same action twice with equal weight. What is
                    left is a different action — go and look at the schedules
                    that already exist — and it is quiet, so the header keeps
                    the only primary action on the page.
                  */}
                  {mySchedules.length > 0 && awaitingActivation.length > 0 ? (
                    <Link href="/work/routine?schedules=1" className="empty-link">
                      View routine schedules
                    </Link>
                  ) : null}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/*
        The schedules, under the work rather than over it.

        Configuring a routine is something somebody does once; doing the work
        is something they do every week. Putting the manager first meant the
        administration was the first thing on screen every single time, for a
        job most people never need to open.
      */}
      {/* "Manage routines" sounded like an administrator's job. It is the
          list of schedules — the reader's own, mostly — so it says so. */}
      <details className="routine-manage" open={params.schedules === '1' || undefined}>
        <summary>Routine schedules</summary>
        <RoutineManager
          /*
            Keyed on the parameter that opens the form. Set up routine is a
            link on the page it leads to, so following it is a soft navigation
            that re-renders this server component without remounting the
            client one below — and the form's initial state would never be
            read. Keying it makes the parameter changing mean what it says.

            Absent and present-but-empty have to stay distinguishable: `?new=`
            is a request for a blank form, and folding it into the same key as
            "no parameter at all" produces one key for both, which is a key
            that never changes.
          */
          key={params.new === undefined ? 'routines' : `routines-open-${params.new}`}
          templates={routines.templates}
          failed={routines.failed}
          canManageOthers={isManager}
          people={directory}
          viewerId={profile.id}
          binned={binnedRoutines.routines}
          binnedFailed={binnedRoutines.failed}
          openWith={params.new ?? null}
        />
      </details>
    </>
  );
}
