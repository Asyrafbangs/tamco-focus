import Link from 'next/link';

import { attentionSeverity, attentionSummaryLine } from '@/domain/attention';
import type { AttentionRequest } from '@/server/queries';

import styles from './MyDayNeedsAttentionSummary.module.css';

const MY_DAY_ATTENTION_LIMIT = 2;

function agoWords(iso: string, now: Date): string {
  const minutes = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

function scheduledLabel(iso: string, timeZone: string): string {
  return `Discussion ${new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  }).format(new Date(iso))}`;
}

function requesterInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

function AttentionIcon({ type }: { type: string }) {
  if (type === 'decision') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="7.5" r="3.2" />
        <path d="M5.5 20c.7-4.1 3-6.1 6.5-6.1s5.8 2 6.5 6.1" />
      </svg>
    );
  }

  if (type === 'approval') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="4.5" y="5.5" width="15" height="14" rx="2" />
        <path d="M8 3.5v4M16 3.5v4M4.5 9.5h15M9 14l2 2 4-4" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8.2 11.2V7.6a1.4 1.4 0 0 1 2.8 0v3.1-4.2a1.4 1.4 0 0 1 2.8 0v4.2-3a1.4 1.4 0 0 1 2.8 0v4-1.8a1.4 1.4 0 0 1 2.8 0v4.5c0 3.6-2.5 6.1-6 6.1h-1.2c-2.4 0-4.1-1.1-5.3-2.8l-2.1-3.1a1.5 1.5 0 0 1 2.3-1.9l1.1 1" />
    </svg>
  );
}

function requestTone(item: AttentionRequest, scheduled: boolean): 'critical' | 'high' | 'normal' {
  if (scheduled) return 'normal';
  if (item.requestedActionType === 'decision') return 'critical';
  if (['approval', 'support', 'escalation'].includes(item.requestedActionType)) return 'high';
  return attentionSeverity(item.reasonCode, item.kind);
}

function MyDayAttentionRow({
  item,
  now,
  timeZone,
}: {
  item: AttentionRequest;
  now: Date;
  timeZone: string;
}) {
  const scheduled = Boolean(item.scheduledAt);
  const tone = requestTone(item, scheduled);

  return (
    <li className={styles.row} data-testid="my-day-attention-row">
      <span className={styles.severityDot} data-tone={tone} aria-hidden="true" />
      <div className={styles.marker} data-tone={tone} aria-hidden="true">
        <AttentionIcon type={item.requestedActionType} />
      </div>

      <div className={styles.copy} data-cell="attention-copy">
        <span className={styles.badge} data-tone={tone}>
          {item.headline}
        </span>
        <h3>{item.taskTitle}</h3>
        <p className={styles.request}>{item.requestedAction}</p>
        <p className={styles.meta}>
          <span className={styles.requester}>
            <span className={styles.avatar} aria-hidden="true">
              {requesterInitials(item.requestedByName)}
            </span>
            <span className={styles.requesterName}>Requested by {item.requestedByName}</span>
          </span>
          <span aria-hidden="true">·</span>
          <span>{agoWords(item.createdAt, now)}</span>
          {item.scheduledAt ? (
            <>
              <span aria-hidden="true">·</span> {scheduledLabel(item.scheduledAt, timeZone)}
            </>
          ) : item.isOverdue ? (
            <>
              <span aria-hidden="true">·</span>
              <span className={styles.overdue}>Overdue</span>
            </>
          ) : null}
        </p>
      </div>

      <Link
        href={item.href}
        className={`btn small primary ${styles.action}`}
        data-cell="attention-action"
        aria-label={`${item.requiredAction} for ${item.taskTitle}: ${item.requestedAction}`}
      >
        {scheduled ? 'Open request' : item.requiredAction}
        <span aria-hidden="true">›</span>
      </Link>
    </li>
  );
}

/**
 * My Day's bounded decision summary. It intentionally does not reuse either a
 * task row or a My Team person row: the object here is a request owed by the
 * signed-in person, so its hierarchy starts with the requested action.
 */
export function MyDayNeedsAttentionSummary({
  items,
  now,
  timeZone,
  announceClear = true,
}: {
  items: AttentionRequest[];
  now: Date;
  timeZone: string;
  /**
   * Whether "all clear" is worth saying. False when the exception banner above
   * is already reporting that something is wrong: the two count different
   * things — that banner is this person's own work slipping, this is other
   * people waiting on them — but stacked together they read as a contradiction,
   * and the reassuring half is the one to drop.
   */
  announceClear?: boolean;
}) {
  const visible = items.slice(0, MY_DAY_ATTENTION_LIMIT);

  /*
   * Nothing waiting is a line, not a panel.
   *
   * This was a full card with a heading and a sentence, which gave the absence
   * of news more of the screen than most of the work on it. The information is
   * worth one line — you are not blocking anybody, and nobody is blocking you —
   * and the space belongs to Start here. When something IS waiting, the card
   * below returns at full size, which is the moment it earns it.
   */
  if (items.length === 0) {
    if (!announceClear) return null;
    return (
      <p className={styles.clearStrip} role="status" id="needs-attention-heading">
        <strong>
          <span aria-hidden="true">✓</span> All clear
        </strong>
        No blockers, approvals or responses need you.
      </p>
    );
  }

  return (
    <section className={`card ${styles.queue}`} aria-labelledby="needs-attention-heading">
      <div className={styles.header}>
        <div>
          <h2 id="needs-attention-heading">
            Needs Attention{' '}
            <span className={styles.count} data-testid="my-day-attention-count">
              {items.length}
            </span>
          </h2>
          <p data-testid="my-day-attention-summary">
            {attentionSummaryLine(items.length, visible.length)}
          </p>
        </div>
        {items.length > visible.length ? (
          <Link href="/work?scope=team&filter=attention" className={styles.viewAll}>
            View all {items.length} <span aria-hidden="true">→</span>
          </Link>
        ) : null}
      </div>

      <ul className={styles.list}>
        {visible.map((item) => (
          <MyDayAttentionRow key={item.sourceId} item={item} now={now} timeZone={timeZone} />
        ))}
      </ul>
    </section>
  );
}
