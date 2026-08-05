import Link from 'next/link';

import { AgeChips } from '@/components/AgeChips';
import { formatDue } from '@/domain/duration';
import { comingUp, needsAttention, startHere, todayList } from '@/domain/prioritisation';
import { TASK_STATUS_LABELS, WORK_CLASS_LABELS } from '@/domain/types';
import { requireProfile } from '@/lib/supabase/server';
import {
  getBlockingCounts,
  getDisplaySettings,
  getFocusSummary,
  getHandoffReadyTaskIds,
  getMyTasks,
} from '@/server/queries';

import { WhyThis } from './WhyThis';

/**
 * My Day (section 9).
 *
 * A decision page, not a system summary. It answers three questions: what
 * requires attention, what should I do next, and what is coming soon.
 */
export default async function TodayPage() {
  const profile = await requireProfile();

  const [tasks, focus, handoffReadyTaskIds, blockingCounts, settings] = await Promise.all([
    getMyTasks(profile.id),
    getFocusSummary(profile.id),
    getHandoffReadyTaskIds(profile.id),
    getBlockingCounts(),
    getDisplaySettings(),
  ]);

  const context = {
    viewerId: profile.id,
    upcomingWindowDays: settings.upcomingWindowDays,
    timeZone: profile.timezone ?? undefined,
    handoffReadyTaskIds,
    blockingCounts,
  };

  const attention = needsAttention(tasks, context);
  const recommendation = startHere(tasks, context);
  const today = todayList(tasks, context, settings.todayListMaxItems);
  const upcoming = comingUp(tasks, context, 3);

  const activeCount = tasks.filter((task) => task.status === 'active').length;
  const availableCount = tasks.filter((task) => task.status === 'backlog').length;
  const overdueCount = tasks.filter((task) => task.isOverdue).length;
  const staleCount = tasks.filter((task) => task.isStale).length;
  const overTargetBuckets = focus.filter((bucket) => bucket.isOverTarget);

  const todayLabel = new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: profile.timezone ?? 'Asia/Kuala_Lumpur',
  }).format(new Date());

  return (
    <>
      <div className="pagehead">
        <div>
          <p className="eyebrow">{todayLabel}</p>
          <h1>My Day</h1>
          <p>What needs attention, and what to do next.</p>
        </div>
        <div className="actions">
          <Link href="/capture" className="btn primary">
            Capture work
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
              <span>{attention[0]!.message}</span>
            </div>
          </div>
          <Link href="/work" className="btn small">
            Review
          </Link>
        </div>
      )}

      <div className="today-grid">
        {/* Section 9.2 — one Start Here recommendation, with a Why this?
            explanation (section 9.5). */}
        <section className="card start-card" aria-labelledby="start-here-heading">
          <p className="reasonline" id="start-here-heading">
            Start here
          </p>

          {recommendation ? (
            <>
              <h2>{recommendation.task.title}</h2>
              <p>{recommendation.task.nextAction ?? 'Open the task to decide the next step.'}</p>

              <div className="start-meta">
                <span className={`status ${recommendation.task.status}`}>
                  {TASK_STATUS_LABELS[recommendation.task.status]}
                </span>
                <span className="pill">{WORK_CLASS_LABELS[recommendation.task.workClass]}</span>
                <span className="pill">
                  {formatDue(
                    recommendation.task.dueAt,
                    recommendation.task.dueIsDateOnly,
                    profile.timezone ?? undefined,
                  )}
                </span>
              </div>

              <div style={{ marginTop: 12 }}>
                <AgeChips
                  task={recommendation.task}
                  staleThresholdDays={settings.staleThresholdDays}
                />
              </div>

              <div className="actions" style={{ marginTop: 14 }}>
                <Link href={`/work?task=${recommendation.task.id}`} className="btn primary">
                  Open
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
                href={`/work?task=${entry.task.id}`}
                className="today-item"
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

        {upcoming.length > 0 ? (
          <div className="coming-grid">
            {upcoming.map((task) => (
              <Link
                key={task.id}
                href={`/work?task=${task.id}`}
                className="coming-item"
                style={{ textDecoration: 'none', color: 'inherit' }}
              >
                <strong>{task.title}</strong>
                <span>
                  {formatDue(task.dueAt, task.dueIsDateOnly, profile.timezone ?? undefined)} ·{' '}
                  {WORK_CLASS_LABELS[task.workClass]}
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
    </>
  );
}
