import Link from 'next/link';

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

      <div className="goal-row-badges" aria-label={`Health: ${displayHealth}`}>
        <span
          className={`${styles.healthLabel}${needsAction ? ` ${styles.healthAttention}` : ''}${displayHealth === 'Completed' ? ` ${styles.healthCompleted}` : ''}`}
        >
          {displayHealth}
        </span>
        {goal.openSupportCount > 0 && <StatusBadge tone="red">Support requested</StatusBadge>}
        {goal.pendingVersionId && <StatusBadge tone="purple">Changes to agree</StatusBadge>}
        {goal.status !== 'active' && (
          <StatusBadge tone="neutral">{GOAL_STATUS_LABELS[goal.status]}</StatusBadge>
        )}
      </div>

      <div className="goal-row-progress">
        <strong>{goal.successMeasureCount}</strong>
        <span className="sub">success measure{goal.successMeasureCount === 1 ? '' : 's'}</span>
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
