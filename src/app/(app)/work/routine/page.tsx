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
import {
  getDisplaySettings,
  getFocusSummary,
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
  searchParams: Promise<{ view?: string }>;
}) {
  const profile = await requireProfile();
  const params = await searchParams;

  const isManager = profile.role === 'manager' || profile.role === 'administrator';

  const [settings, occurrences, tasks, focus, team] = await Promise.all([
    getDisplaySettings(),
    getRoutineOccurrences(profile.id),
    getMyTasks(profile.id),
    getFocusSummary(profile.id),
    isManager ? getTeamLoad(profile.id) : Promise.resolve([]),
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
  const completed = occurrences.filter((task) => task.status === 'completed');

  // "Due now / this week" is one decision — what has to happen before the week
  // ends — so overdue and today's occurrences belong together rather than in
  // two lists somebody has to reconcile.
  const dueNow = [...overdue, ...dueToday];

  const view: RoutineView =
    params.view === 'upcoming' ? 'upcoming' : params.view === 'completed' ? 'completed' : 'due';

  const visible: TaskOverview[] =
    view === 'upcoming' ? upcoming : view === 'completed' ? completed : dueNow;

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
    completed: 'Occurrences you have closed. The record stays for audit.',
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
              count:
                key === 'due'
                  ? dueNow.length
                  : key === 'upcoming'
                    ? upcoming.length
                    : completed.length,
              attention: key === 'due' && overdue.length > 0,
            }) satisfies TabItem,
        )}
      />

      <p className="focus-tab-meaning">{VIEW_MEANING[view]}</p>

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
                : view === 'completed'
                  ? 'Nothing completed yet'
                  : view === 'upcoming'
                    ? 'Nothing scheduled ahead'
                    : 'Nothing due right now'}
            </h3>
            <p>
              {occurrences.length === 0
                ? 'Routine occurrences are generated from templates a manager or administrator maintains. If you think something should repeat on a schedule, capture it and choose Routine Template Request.'
                : view === 'completed'
                  ? 'Occurrences you close appear here, with their evidence and history.'
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
    </>
  );
}
