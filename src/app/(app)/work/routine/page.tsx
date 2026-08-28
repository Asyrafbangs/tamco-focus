import Link from 'next/link';

import { AgeChips } from '@/components/AgeChips';
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
import { requireProfile } from '@/lib/supabase/server';

import { RoutineManager } from './RoutineManager';
import {
  getDisplaySettings,
  getFocusSummary,
  getBinnedRoutines,
  getRoutineExceptionQueue,
  getRoutineOutcomes,
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
 * My Work / My Team scope selector, same Focus / Routine selector, same Capture
 * entry point. Switching to Routine changes the work lifecycle on display, not
 * the application you appear to be in; previously it dropped the scope selector
 * and the Capture button, so it read as a different product.
 *
 * What does NOT carry over is Focus vocabulary. Routine has its own occurrence
 * lifecycle — Due now, Upcoming, Completed — because nobody activates an
 * occurrence and it consumes no focus target. Reusing Active/Available here
 * would imply a decision that does not exist.
 */

type RoutineView = 'due' | 'upcoming' | 'completed';

export default async function RoutinePage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; new?: string; outcome?: string; period?: string }>;
}) {
  const profile = await requireProfile();
  const params = await searchParams;

  const isManager = profile.role === 'manager' || profile.role === 'administrator';

  /*
   * How far back Completed looks. Routine work is periodic, so a month is
   * usually one or two occurrences of each schedule; 90 days is the widest
   * useful default before a list stops being scannable.
   */
  const completedDays = params.period === '90' ? 90 : params.period === '60' ? 60 : 30;
  const completedSince = new Date(
    new Date().getTime() - completedDays * 86_400_000,
  ).toISOString();

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
      ? getRoutineOutcomes(profile.id, completedSince, null)
      : Promise.resolve({ outcomes: [], failed: false }),
    // What this manager has been asked to accept. Nothing to decide is the
    // normal case, and then nothing appears.
    isManager
      ? getRoutineExceptionQueue(profile.id)
      : Promise.resolve({ pending: [], failed: false }),
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
        <div className="actions">
          <Link href="/capture" className="btn primary">
            New Work
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

      <WorkspaceTabs
        items={[
          { href: '/work', label: 'Focus', count: `${activeCount} active` },
          {
            href: '/work/routine',
            label: 'Routine',
            active: true,
            count:
              overdue.length > 0
                ? `${overdue.length} overdue`
                : dueToday.length > 0
                  ? `${dueToday.length} due`
                  : 'none due',
            attention: overdue.length > 0,
          },
        ]}
      />

      {/* Routine consumes no focus target, so no capacity strip belongs here —
          its absence is the point, and the sentence below says so. */}
      <p className="capacity-strip" role="status">
        Routine work does not use any of your focus targets.
      </p>

      {/* The schedules, above the work they create. */}
      <section className="routine-manager">
        <RoutineManager
          templates={routines.templates}
          failed={routines.failed}
          canManageOthers={isManager}
          people={directory}
          viewerId={profile.id}
          binned={binnedRoutines.routines}
          binnedFailed={binnedRoutines.failed}
          openWith={params.new ?? null}
        />
      </section>

      <FocusTabs
        label="Routine occurrences"
        items={(['due', 'upcoming', 'completed'] as RoutineView[]).map(
          (key) =>
            ({
              href: key === 'due' ? '/work/routine' : `/work/routine?view=${key}`,
              label:
                key === 'due'
                  ? 'Due now / this week'
                  : key === 'upcoming'
                    ? 'Upcoming'
                    : 'Completed',
              active: key === view,
              // No badge on Completed: a running total of finished routine work
              // is not something anybody needs to act on. The count that means
              // something is inside, after the period filter.
              count:
                key === 'due' ? dueNow.length : key === 'upcoming' ? upcoming.length : undefined,
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
            A missed occurrence stays open rather than disappearing, so the record of what was and
            was not done remains accurate.
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
              ).map(([key, label]) => (
                <Link
                  key={key}
                  href={`/work/routine?view=completed&period=${completedDays}${
                    key === 'all' ? '' : `&outcome=${key}`
                  }`}
                  className={outcomeFilter === key ? 'active' : undefined}
                  aria-current={outcomeFilter === key ? 'true' : undefined}
                >
                  {label}
                </Link>
              ))}
            </div>
            <div className="segmented" role="group" aria-label="Period">
              {([30, 60, 90] as const).map((days) => (
                <Link
                  key={days}
                  href={`/work/routine?view=completed&period=${days}${
                    outcomeFilter === 'all' ? '' : `&outcome=${outcomeFilter}`
                  }`}
                  className={completedDays === days ? 'active' : undefined}
                  aria-current={completedDays === days ? 'true' : undefined}
                >
                  Last {days} days
                </Link>
              ))}
            </div>
          </div>

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
                    <div style={{ marginTop: 6 }}>
                      <AgeChips task={task} staleThresholdDays={settings.staleThresholdDays} />
                    </div>
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
            /* Section 27.2 — what is empty, why, and the next useful action. */
            <div className="empty-state">
              <h3>
                {occurrences.length === 0
                  ? 'No routine work assigned to you'
                  : view === 'upcoming'
                    ? 'Nothing scheduled ahead'
                    : 'Nothing due right now'}
              </h3>
              <p>
                {occurrences.length === 0
                  ? 'Occurrences are created from the routines above. Set one up to have work appear here on a schedule; a routine you set up for yourself starts once your manager activates it.'
                  : view === 'upcoming'
                    ? 'Future occurrences appear as their scheduled date approaches, so the list stays about work you can act on.'
                    : 'Nothing is overdue or scheduled for today. Upcoming shows what is coming.'}
              </p>
              <Link
                href={occurrences.length === 0 ? '/capture' : '/work/routine?view=upcoming'}
                className="btn"
              >
                {occurrences.length === 0 ? 'New Work' : 'See upcoming'}
              </Link>
            </div>
          )}
        </div>
      )}
    </>
  );
}
