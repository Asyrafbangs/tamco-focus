import Link from 'next/link';

import { RowPrimaryLink } from '@/components/ui/ParityPrimitives';
import { taskDrawerHref } from '@/domain/navigation';
import { formatDue, overdueAgeMs } from '@/domain/duration';
import { goalExceptionMessage } from '@/domain/goals';
import {
  comingUp,
  needsAttention,
  startHere,
  todayList,
  type AttentionItem,
} from '@/domain/prioritisation';
import { TASK_STATUS_LABELS, WORK_CLASS_LABELS } from '@/domain/types';
import { requireProfile } from '@/lib/supabase/server';
import {
  getBarriersAwaitingOthers,
  getBlockingCounts,
  getDisplaySettings,
  getFocusSummary,
  getHandoffReadyTaskIds,
  getMyAttention,
  getMyTasks,
  getTeamDirectory,
} from '@/server/queries';
import { getGoalExceptions, getMyGoals } from '@/server/goal-queries';
import { getAssignablePeople } from '@/server/actions/assignment-actions';

import { CaptureWork } from '../capture/CaptureWork';

import { MyDayNeedsAttentionSummary } from './MyDayNeedsAttentionSummary';
import { WhyThis } from './WhyThis';

/**
 * My Day (section 9).
 *
 * A decision page, not a system summary. It answers three questions: what
 * requires attention, what should I do next, and what is coming soon.
 *
 * Each region answers exactly one of those, and nothing appears twice. The
 * Start Here recommendation is deliberately absent from Today, and anything
 * already listed under Coming Up is absent from Today as well: repeating a
 * commitment does not make it more likely to be done, it only makes the page
 * longer to read.
 */

/**
 * Summarises the exceptions by kind — "1 overdue · 1 barrier needs a decision"
 * — rather than showing only the first one's message.
 *
 * A banner that reports the count but explains just one item forces the reader
 * to open the list to discover what the others are, which is the opposite of
 * what an exception banner is for (section 9.3).
 */
function attentionSummary(items: readonly AttentionItem[]): string {
  const phrases: Partial<Record<AttentionItem['kind'], (count: number) => string>> = {
    overdue: (count) => `${count} overdue`,
    overdue_routine: (count) => `${count} overdue routine`,
    open_barrier: (count) => `${count} barrier${count === 1 ? '' : 's'} need a decision`,
    urgent_mandatory: (count) => `${count} mandatory action${count === 1 ? '' : 's'}`,
    missing_evidence: (count) => `${count} awaiting evidence`,
    paused_review_passed: (count) => `${count} paused past review`,
    completion_review_overdue: (count) => `${count} completion review${count === 1 ? '' : 's'} due`,
    available_needs_decision: (count) =>
      `${count} waiting in Available need${count === 1 ? 's' : ''} a decision`,
  };

  const counts = new Map<AttentionItem['kind'], number>();
  for (const item of items) counts.set(item.kind, (counts.get(item.kind) ?? 0) + 1);

  const parts: string[] = [];
  for (const [kind, count] of counts) {
    const phrase = phrases[kind];
    if (phrase)
      parts.push(count === 1 ? phrase(count).replace(/ need a /, ' needs a ') : phrase(count));
  }

  return parts.join(' · ');
}

/** "Due 3 Aug 2026 · 4 days overdue", or just the due date when it is not. */
function dueLine(
  task: { dueAt: string | null; dueIsDateOnly: boolean; isOverdue: boolean },
  timeZone: string | undefined,
  now: Date,
): string {
  const due = formatDue(task.dueAt, task.dueIsDateOnly, timeZone);
  if (!task.isOverdue) return due;
  const days = Math.floor(overdueAgeMs(task as never, now) / 86_400_000);
  return days >= 1 ? `${due} · ${days} day${days === 1 ? '' : 's'} overdue` : `${due} · overdue`;
}
export default async function TodayPage({
  searchParams,
}: {
  searchParams: Promise<{ capture?: string }>;
}) {
  const profile = await requireProfile();
  const params = await searchParams;

  const [
    tasks,
    focus,
    handoffReadyTaskIds,
    blockingCounts,
    settings,
    goalExceptions,
    myGoals,
    assignablePeople,
    actionRequests,
    teamDirectory,
    awaitingOthersTaskIds,
  ] = await Promise.all([
    getMyTasks(profile.id),
    getFocusSummary(profile.id),
    getHandoffReadyTaskIds(profile.id),
    getBlockingCounts(),
    getDisplaySettings(),
    getGoalExceptions(profile.id),
    getMyGoals(profile.id),
    // Empty for anyone who is not a manager, so the assignment panel does not
    // exist for them rather than appearing and then refusing.
    params.capture === '1' ? getAssignablePeople() : Promise.resolve([]),
    getMyAttention(profile.id),
    // Only when Capture is open, for checklist assignment. Loading the
    // directory on every My Day render would be a query nobody asked for.
    params.capture === '1' ? getTeamDirectory() : Promise.resolve([]),
    getBarriersAwaitingOthers(profile.id),
  ]);

  const context = {
    viewerId: profile.id,
    upcomingWindowDays: settings.upcomingWindowDays,
    timeZone: profile.timezone ?? undefined,
    handoffReadyTaskIds,
    blockingCounts,
    awaitingOthersTaskIds,
  };

  const now = new Date();

  const attention = needsAttention(tasks, context);
  const recommendation = startHere(tasks, context);

  /*
   * Each section shows work the ones above it have not.
   *
   * The exclusion used to run one way only: Next up dropped anything already
   * recommended or coming up, but Coming up was computed independently and so
   * happily repeated the Start here card. The recommendation is the largest
   * thing on the page; seeing it again four inches below reads as a mistake,
   * and it is. The page should reveal different work as you go down it.
   */
  /*
   * One row per piece of work, and one row per ROUTINE.
   *
   * Filtering by task id alone was not enough. A routine generates an
   * occurrence per period, each a separate task carrying the same title, so a
   * weekly walk put four rows reading "Weekly workplace safety walk" across
   * three sections — every one a different id, every one correctly
   * deduplicated, and the page still repeating itself to anybody reading it.
   * Nobody needs next week's occurrence while this week's is open, so the
   * nearest one stands for the routine and the rest wait for the calendar.
   */
  const seenTasks = new Set<string>();
  const seenRoutines = new Set<string>();

  /** Claims a slot, or refuses because the page already says this. */
  function claim(task: { id: string; routineTemplateId: string | null }): boolean {
    if (seenTasks.has(task.id)) return false;
    if (task.routineTemplateId && seenRoutines.has(task.routineTemplateId)) return false;
    seenTasks.add(task.id);
    if (task.routineTemplateId) seenRoutines.add(task.routineTemplateId);
    return true;
  }

  /*
   * Claims only what it shows. Filtering and then slicing would claim the
   * items the slice discards, and those never reach the page — so the section
   * below would hide work on account of a row nobody can see.
   */
  function take<T>(
    candidates: readonly T[],
    limit: number,
    of: (item: T) => { id: string; routineTemplateId: string | null },
  ): T[] {
    const chosen: T[] = [];
    for (const item of candidates) {
      if (chosen.length >= limit) break;
      if (claim(of(item))) chosen.push(item);
    }
    return chosen;
  }

  if (recommendation) claim(recommendation.task);
  const nextUp = take(
    todayList(tasks, context, settings.todayListMaxItems + 8),
    3,
    (entry) => entry.task,
  );
  const upcoming = take(comingUp(tasks, context, 12), 3, (task) => task);

  const activeCount = tasks.filter((task) => task.status === 'active').length;
  const availableCount = tasks.filter((task) => task.status === 'backlog').length;
  const overdueCount = tasks.filter((task) => task.isOverdue).length;
  const staleCount = tasks.filter((task) => task.isStale).length;
  const overTargetBuckets = focus.filter((bucket) => bucket.isOverTarget);
  const activeGoals = myGoals.filter((goal) => goal.status === 'active');
  const goalWeight = activeGoals.reduce((total, goal) => total + goal.weightPercent, 0);
  const weightedGoalProgress = goalWeight
    ? Math.round(
        activeGoals.reduce((total, goal) => total + goal.derivedProgress * goal.weightPercent, 0) /
          goalWeight,
      )
    : 0;
  const quarterlyComingUp = activeGoals.filter((goal) => {
    if (!goal.isQuarterlyCheckinDue) return false;
    const due = new Date(`${goal.nextQuarterlyCheckinDate}T12:00:00Z`).getTime();
    const days = (due - now.getTime()) / 86_400_000;
    return days >= 0 && days <= settings.upcomingWindowDays;
  });

  const todayLabel = new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: profile.timezone ?? 'Asia/Kuala_Lumpur',
  }).format(now);

  return (
    <>
      <div className="pagehead">
        <div>
          <p className="eyebrow">Daily workspace</p>
          <h1>{profile.full_name.split(' ')[0]} · My Day</h1>
          <p>{todayLabel} · What needs attention, what to do next, and what is coming soon.</p>
        </div>
        {/* Monthly Plan is reachable from Coming up, where it is in context.
            Two routes to the same page from one screen is navigation noise. */}
        <div className="actions">
          {/* Quieter than New Work: the rail already navigates to Focus, so
              this is a convenience, not the point of the page. */}
          <Link href="/work" className="btn ghost">
            My Focus
          </Link>
          <Link href="/today?capture=1" className="btn primary">
            ＋ New Work
          </Link>
        </div>
      </div>

      {/* Section 9.3 — genuine exceptions only, never a general notification
          count. Absent entirely when nothing is exceptional. */}
      {attention.length > 0 && (
        <div className="attention-banner" role="status">
          <div className="row">
            <div className="attention-icon" aria-hidden="true">
              !
            </div>
            <div>
              <strong>
                {attention.length} item{attention.length === 1 ? '' : 's'} need attention
              </strong>
              <span>{attentionSummary(attention) || attention[0]!.message}</span>
            </div>
          </div>
          <Link href="/work" className="btn small">
            Review {attention.length} item{attention.length === 1 ? '' : 's'}
          </Link>
        </div>
      )}

      {/*
        v46 sections 7, 10, 26 — the action queue.

        Distinct from the exception banner above it, and the distinction is the
        point: that banner is about this person's own work slipping, this is
        about somebody else waiting on them. It is not a second task list, so
        every row names the request, who is asking, which work it concerns, and
        the act itself — "Provide decision", never "Open".

        It is derived from the barrier, so reading the notification does not
        clear it (section 18). Only answering does.
      */}
      {/*
        v49 §1, §9 — a summary, not the backlog.

        Needs Attention has to stay useful at fifty items, and a card that grows
        with the count is a card that pushes the rest of My Day off the screen
        and stops being scannable at exactly the moment it matters most. My Day
        answers "what should I act on first"; the full list answers "show me
        everything", and lives where lists live.
      */}
      <MyDayNeedsAttentionSummary
        items={actionRequests}
        now={now}
        timeZone={profile.timezone ?? 'Asia/Kuala_Lumpur'}
        announceClear={attention.length === 0}
      />

      <div className="today-grid">
        {/* Section 9.2 — one Start Here recommendation, with a Why this?
            explanation (section 9.5). */}
        <section
          className={`card start-card${recommendation ? ' interactive-row' : ''}`}
          aria-labelledby="start-here-heading"
        >
          <p className="reasonline" id="start-here-heading">
            Start here
          </p>

          {recommendation ? (
            <>
              <h2>
                <RowPrimaryLink
                  href={taskDrawerHref(recommendation.task.id, '/today')}
                  ariaLabel={`Open ${recommendation.task.title}`}
                >
                  {recommendation.task.title}
                </RowPrimaryLink>
              </h2>
              {/* v83 - Steps are the only record of what remains, so this
                  says how far through them the work is rather than repeating a
                  separately maintained sentence. */}
              {recommendation.task.checklistTotal > 0 ? (
                <div className="start-next-action">
                  <p className="eyebrow">Steps</p>
                  <p>
                    {recommendation.task.checklistCompleted}/{recommendation.task.checklistTotal}{' '}
                    complete
                  </p>
                </div>
              ) : null}

              {/* Work type, state, and the commitment date. Open-for and
                  in-state ages are task-age analytics; they belong on the task,
                  not on the one thing someone is being asked to do next. */}
              <div className="start-meta">
                <span className="pill">{WORK_CLASS_LABELS[recommendation.task.workClass]}</span>
                <span className={`status ${recommendation.task.status}`}>
                  {TASK_STATUS_LABELS[recommendation.task.status]}
                </span>
                <span className={`pill${recommendation.task.isOverdue ? ' overdue' : ''}`}>
                  {dueLine(recommendation.task, profile.timezone ?? undefined, now)}
                </span>
              </div>

              {/*
                The reason, in the open.

                It was behind a "Why this?" disclosure, which asked for a click
                to answer the first question anybody has about a recommendation.
                The rule is one sentence; there is no reason to charge for it.
                The disclosure stays for the detailed version.
              */}
              <p className="start-reason">{recommendation.why}</p>

              <div className="actions" style={{ marginTop: 14 }}>
                <Link
                  href={taskDrawerHref(recommendation.task.id, '/today')}
                  className="btn primary"
                >
                  Open task
                </Link>
                <WhyThis explanation={recommendation.why} />
              </div>
            </>
          ) : (
            /* Section 27.2 — say what is empty, why, and the next useful action. */
            <div className="empty-state">
              <h3>Nothing is waiting on you</h3>
              <p>
                You have no overdue work, no open barriers, and nothing due today. This is what a
                clear day looks like.
              </p>
              <Link href="/work" className="btn">
                Review Available Work
              </Link>
            </div>
          )}
        </section>

        {/* Section 9.6 — a short list of three to five useful items. */}
        {/*
          "Today" was a promise the list could not keep: it ranks the next
          useful work, which on a clear week is due next month. People read the
          heading, saw the 16th and the 19th, and reasonably asked why it was
          under Today. The subtitle was already right, so the heading now
          matches it.
        */}
        <section className="card" aria-labelledby="next-up-heading">
          <div className="sectionhead">
            <div>
              <h3 id="next-up-heading">Next up</h3>
              <p>The next few active commitments worth your attention</p>
            </div>
            <Link href="/work" className="btn small ghost">
              All work
            </Link>
          </div>

          {nextUp.length > 0 ? (
            nextUp.map((entry) => (
              <Link
                key={entry.task.id}
                href={taskDrawerHref(entry.task.id, '/today')}
                className="today-item interactive-row"
                style={{ textDecoration: 'none', color: 'inherit', display: 'grid' }}
              >
                <div
                  className={`today-icon${
                    entry.task.workClass === 'routine_occurrence'
                      ? ' routine'
                      : entry.band === 'handoff_ready'
                        ? ' handoff'
                        : entry.band === 'immediate_mandatory' ||
                            entry.band === 'overdue_or_blocked'
                          ? ' alert'
                          : ''
                  }`}
                  aria-hidden="true"
                >
                  {entry.task.workClass === 'routine_occurrence' ? '↻' : '•'}
                </div>

                <div className="today-copy">
                  <strong>{entry.task.title}</strong>
                  <span>{entry.why}</span>
                </div>

                <div className="today-meta">
                  <strong>
                    {formatDue(
                      entry.task.dueAt,
                      entry.task.dueIsDateOnly,
                      profile.timezone ?? undefined,
                    )}
                  </strong>
                  <span>{TASK_STATUS_LABELS[entry.task.status]}</span>
                </div>
              </Link>
            ))
          ) : (
            <div className="empty-state">
              <h3>Nothing else waiting</h3>
              <p>Work you activate or that becomes due will appear here.</p>
            </div>
          )}
        </section>
      </div>

      {/* Section 9.2 — a compact workload summary, not a dashboard. */}
      {/*
        Counts that go somewhere.

        These looked informative but were inert, which is the worst of both:
        they occupy the space of navigation and answer nothing you can act on.
        The two that name a list are now links to that list. The rest stay
        plain, because there is no single view of "stale" to send anybody to.
      */}
      <div className="summary-strip" role="group" aria-label="Workload summary">
        <Link href="/work" className="summary-item summary-link">
          <span className="summary-dot" aria-hidden="true" />
          <strong>{activeCount}</strong> active
        </Link>
        <Link href="/work?tab=available" className="summary-item summary-link">
          <span className="summary-dot" style={{ background: 'var(--muted)' }} aria-hidden="true" />
          <strong>{availableCount}</strong> available
        </Link>
        {overdueCount > 0 && (
          <span className="summary-item">
            <span className="summary-dot red" aria-hidden="true" />
            <strong>{overdueCount}</strong> overdue
          </span>
        )}
        {staleCount > 0 && (
          <span className="summary-item">
            <span className="summary-dot amber" aria-hidden="true" />
            <strong>{staleCount}</strong> without a recent update
          </span>
        )}
        {overTargetBuckets.map((bucket) => (
          <span key={bucket.bucket} className="summary-item">
            <span className="summary-dot red" aria-hidden="true" />
            <strong>
              {bucket.activeCount} / {bucket.recommendedTarget}
            </strong>{' '}
            over focus target
          </span>
        ))}
      </div>

      {/*
        Exception-based, per the approved Goal integration: a goal strip that
        says nothing needs attention is a row of pixels reporting the absence of
        news. When no check-in is due, My Day stays silent about Goals.
      */}
      {goalExceptions.length > 0 && (
        <section
          className={`goal-quick-strip${goalExceptions.length > 0 ? ' attention' : ''}`}
          aria-label="Goal progress"
        >
          <div className="goal-quick-strip-copy">
            <strong>
              {/* A manager can hold goal exceptions for goals they do not own,
                  and "0 goals · 0% weighted progress" is a nonsense headline in
                  that case. Describe what needs attention instead. */}
              {activeGoals.length > 0
                ? `${activeGoals.length} goal${activeGoals.length === 1 ? '' : 's'} · ${weightedGoalProgress}% weighted progress`
                : `${goalExceptions.length} goal check-in${goalExceptions.length === 1 ? '' : 's'} need attention`}
            </strong>
            <span>
              {goalExceptions[0]
                ? `${goalExceptions[0].title} · ${goalExceptionMessage(goalExceptions[0])}`
                : 'A goal check-in needs attention.'}
            </span>
          </div>
          <Link
            href={
              goalExceptions[0] ? `/goals?goal=${goalExceptions[0].id}&action=update` : '/goals'
            }
            className="btn small"
          >
            {goalExceptions[0] ? 'Update' : 'Open Goals'}
          </Link>
        </section>
      )}

      {/* Section 9.7 — the nearest two or three commitments, and nothing more. */}
      <section className="card coming" aria-labelledby="coming-heading">
        <div className="sectionhead">
          <div>
            <h3 id="coming-heading">Coming up</h3>
            <p>
              Within the next {settings.upcomingWindowDays} days, excluding work already shown above
            </p>
          </div>
          <Link href="/plan" className="btn small ghost">
            View Monthly Plan
          </Link>
        </div>

        {upcoming.length > 0 || quarterlyComingUp.length > 0 ? (
          <div className="coming-grid">
            {upcoming.map((task) => (
              <Link
                key={task.id}
                href={taskDrawerHref(task.id, '/today')}
                className="coming-item interactive-row"
                style={{ textDecoration: 'none', color: 'inherit' }}
              >
                <strong>{task.title}</strong>
                <span>
                  {formatDue(task.dueAt, task.dueIsDateOnly, profile.timezone ?? undefined)} ·{' '}
                  {WORK_CLASS_LABELS[task.workClass]}
                </span>
              </Link>
            ))}
            {quarterlyComingUp.map((goal) => (
              <Link
                key={`goal-${goal.id}`}
                href={`/goals?goal=${goal.id}&action=update`}
                className="coming-item interactive-row"
                style={{ textDecoration: 'none', color: 'inherit' }}
              >
                <strong>{goal.title}</strong>
                <span>
                  Quarterly discussion by{' '}
                  {formatDue(
                    `${goal.nextQuarterlyCheckinDate}T12:00:00Z`,
                    true,
                    profile.timezone ?? undefined,
                  )}
                </span>
              </Link>
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <h3>Nothing due soon</h3>
            <p>
              Commitments falling inside the next {settings.upcomingWindowDays} days appear here.
            </p>
          </div>
        )}
      </section>
      {params.capture === '1' && (
        <CaptureWork
          modal
          assignablePeople={assignablePeople}
          teamDirectory={teamDirectory}
          viewerName={profile.full_name}
        />
      )}
    </>
  );
}
