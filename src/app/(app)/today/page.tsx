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
  ]);

  const context = {
    viewerId: profile.id,
    upcomingWindowDays: settings.upcomingWindowDays,
    timeZone: profile.timezone ?? undefined,
    handoffReadyTaskIds,
    blockingCounts,
  };

  const now = new Date();

  const attention = needsAttention(tasks, context);
  const recommendation = startHere(tasks, context);
  const upcoming = comingUp(tasks, context, 3);

  // Today is the next useful work, so it excludes what the page already shows:
  // the Start Here recommendation above it and the commitments under Coming Up
  // below it. Three items keeps it scannable (section 9.6).
  const alreadyShown = new Set<string>([
    ...(recommendation ? [recommendation.task.id] : []),
    ...upcoming.map((task) => task.id),
  ]);
  const today = todayList(tasks, context, settings.todayListMaxItems + alreadyShown.size)
    .filter((entry) => !alreadyShown.has(entry.task.id))
    .slice(0, 3);

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
          <Link href="/work" className="btn">
            Open My Focus
          </Link>
          <Link href="/today?capture=1" className="btn primary">
            ＋ Capture Work
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
              {/* Labelled, because an unlabelled sentence under a title reads
                  as description rather than as the thing to go and do. */}
              <div className="start-next-action">
                <p className="eyebrow">Next action</p>
                <p>{recommendation.task.nextAction ?? 'Open the task to decide the next step.'}</p>
              </div>

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
        <section className="card" aria-labelledby="today-heading">
          <div className="sectionhead">
            <div>
              <h3 id="today-heading">Today</h3>
              <p>The next few things worth your time</p>
            </div>
            <Link href="/work" className="btn small ghost">
              All work
            </Link>
          </div>

          {today.length > 0 ? (
            today.map((entry) => (
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
              <h3>Nothing scheduled for today</h3>
              <p>Work you activate or that becomes due will appear here.</p>
            </div>
          )}
        </section>
      </div>

      {/* Section 9.2 — a compact workload summary, not a dashboard. */}
      <div className="summary-strip" role="group" aria-label="Workload summary">
        <span className="summary-item">
          <span className="summary-dot" aria-hidden="true" />
          <strong>{activeCount}</strong> active
        </span>
        <span className="summary-item">
          <span className="summary-dot" style={{ background: 'var(--muted)' }} aria-hidden="true" />
          <strong>{availableCount}</strong> available
        </span>
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
            <p>Within the next {settings.upcomingWindowDays} days</p>
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
