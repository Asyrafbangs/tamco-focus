import Link from 'next/link';
import type { CSSProperties } from 'react';

import { RowPrimaryLink, StatusBadge } from '@/components/ui/ParityPrimitives';
import { GOAL_STATUS_LABELS, goalDisplayHealth, type GoalOverview } from '@/domain/goals';

import styles from './GoalRow.module.css';

function dateLabel(value: string, timeZone: string) {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone,
  }).format(new Date(`${value}T12:00:00Z`));
}

function healthTone(health: GoalOverview['health']) {
  if (health === 'support_requested' || health === 'off_track') return 'red' as const;
  if (health === 'need_attention' || health === 'at_risk') return 'amber' as const;
  if (health === 'completed') return 'green' as const;
  return 'blue' as const;
}

export function GoalRow({
  goal,
  href,
  timeZone,
  now,
  showOwner = false,
}: {
  goal: GoalOverview;
  href: string;
  timeZone: string;
  now: Date;
  showOwner?: boolean;
}) {
  const displayHealth = goalDisplayHealth(goal);
  const needsAction =
    displayHealth === 'Needs attention' ||
    displayHealth === 'Update due' ||
    displayHealth === 'At risk' ||
    displayHealth === 'Off track';
  /*
   * v305 — one statement of where the goal stands.
   *
   * `goalDisplayHealth` returns "Needs attention" when a support request is
   * open, and the row then printed a second chip beside it saying "Support
   * requested" — two chips, one cause, stacked, and the row grew by half
   * again to carry the pair. The row says it once, in the more specific of
   * the two wordings: a goal that needs attention BECAUSE somebody asked for
   * help is better described by the asking.
   */
  const supportOpen = goal.openSupportCount > 0;
  const healthText = supportOpen ? 'Support requested' : displayHealth;

  /*
   * v305 — the row's one primary progress value, which the specification asks
   * for ("Each row shows one primary progress value, health, target date,
   * last meaningful update, and secondary weight") and which the row did not
   * show.
   *
   * Which value, and the fallback, follow the same specification: when
   * structured measures exist, overall progress is the deterministic average
   * of measure progress; a legacy Goal agreed before structured measures
   * keeps the milestone-weighted figure. Only one of the two is ever drawn,
   * so this stays the single current percentage rather than a competing one.
   */
  const hasMeasures = goal.successMeasureCount > 0;
  const progressPercent = Math.max(
    0,
    Math.min(100, hasMeasures ? goal.measureProgress : goal.derivedProgress),
  );

  return (
    <article
      className={`goal-row interactive-row ${styles.row}${
        needsAction ? ' attention' : ''
      }${goal.status === 'pending_discussion' || goal.status === 'draft' ? ` ${styles.discussion}` : ''}${goal.status === 'completed' || goal.status === 'closed' ? ` ${styles.completed}` : ''}`}
      data-goal-id={goal.id}
    >
      <div className="goal-row-main">
        <div className="goal-row-titleline">
          <span className={`goal-health-dot ${healthTone(goal.health)}`} aria-hidden="true" />
          <RowPrimaryLink
            href={href}
            ariaLabel={`Open goal ${goal.title}`}
            returnFocusId={`goal-${goal.id}`}
          >
            <strong>{goal.title}</strong>
          </RowPrimaryLink>
        </div>
        <span className="sub">
          {showOwner && `${goal.ownerName} · `}
          {goal.successMeasure ?? 'Success measures ready for discussion'}
        </span>
      </div>

      <div className="goal-row-badges" aria-label={`Health: ${healthText}`}>
        <span
          className={`${styles.healthLabel}${
            supportOpen
              ? ` ${styles.healthSupport}`
              : needsAction
                ? ` ${styles.healthAttention}`
                : ''
          }${displayHealth === 'Completed' ? ` ${styles.healthCompleted}` : ''}`}
        >
          {healthText}
        </span>
        {goal.pendingVersionId && <StatusBadge tone="purple">Changes to agree</StatusBadge>}
        {goal.status !== 'active' && (
          <StatusBadge tone="neutral">{GOAL_STATUS_LABELS[goal.status]}</StatusBadge>
        )}
      </div>

      {/*
        v305 — how far the goal has got, which this column is named for and did
        not show. It held the NUMBER of success measures: a count of what was
        agreed, which does not change once the goal is active, so a list of
        five goals read "1 success measure" five times and said nothing about
        any of them.

        The bar is `aria-hidden`: it restates the percentage beside it, and two
        announcements of one figure is worse than one.
      */}
      <div className="goal-row-progress">
        <div className="goal-row-progress-figure">
          <strong>{progressPercent}%</strong>
          <span className="sub">
            {hasMeasures
              ? `of ${goal.successMeasureCount} success measure${goal.successMeasureCount === 1 ? '' : 's'}`
              : 'from milestones'}
          </span>
        </div>
        <span className="progress-track" aria-hidden="true">
          <span style={{ '--progress': `${progressPercent}%` } as CSSProperties} />
        </span>
      </div>

      <div className="goal-row-date">
        <strong>{dateLabel(goal.targetDate, timeZone)}</strong>
        <span className="sub">
          Updated{' '}
          {new Intl.RelativeTimeFormat('en', { numeric: 'auto' }).format(
            -Math.max(
              0,
              Math.floor(
                (now.getTime() - new Date(goal.lastMeaningfulUpdateAt).getTime()) / 86_400_000,
              ),
            ),
            'day',
          )}
          {' · '}
          {goal.weightPercent}% weight
        </span>
      </div>

      {goal.status === 'active' && (
        <div className={`row-action ${styles.rowAction}`}>
          <Link
            href={`${href}&action=edit`}
            className="btn small"
            aria-label={`Revise goal ${goal.title}`}
          >
            Revise
          </Link>
          <Link href={href} className="btn small primary" aria-label={`Open goal ${goal.title}`}>
            Open
          </Link>
        </div>
      )}
    </article>
  );
}
