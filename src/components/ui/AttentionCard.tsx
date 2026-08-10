import Link from 'next/link';

import type { AttentionSeverity } from '@/domain/attention';

/**
 * How long ago, in words (v48 §13).
 *
 * "12 min ago" is what somebody needs to judge whether a request is stale.
 * A full timestamp is precision nobody reads in a list.
 */
function agoWords(iso: string, now: Date): string {
  const minutes = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

export interface AttentionCardData {
  id: string;
  headline: string;
  actionLabel: string;
  taskTitle: string;
  /** The full original request. Previewed here, complete in the detail view. */
  requestedAction: string;
  requestedByName: string;
  requestedAt: string;
  href: string;
  /** Set when a discussion is booked: still owed, no longer urgent (v47 §30). */
  scheduledAt?: string | null;
  /** Rendered under the metadata when a discussion has a time. */
  scheduledLabel?: string | null;
}

/**
 * One thing waiting on this person (v48 §2, §17).
 *
 * The hierarchy is the whole design:
 *
 *   action type   a small label — what kind of answer is wanted
 *   task title    the heading — stable, and the thing they can place
 *   request       two lines of preview — enough to judge, not to read
 *   requester     secondary — who and how long ago
 *   action        the button, independent of how long any of the above is
 *
 * It replaces a heading built by joining the action type to the entire request,
 * which made the most prominent text on the screen exactly as long as whatever
 * sentence somebody typed. Nothing here is truncated in the data: the preview
 * is a CSS clamp, and the full text is one click away in the barrier panel.
 */
export function AttentionCard({
  item,
  now,
  severity = 'critical',
}: {
  item: AttentionCardData;
  now: Date;
  severity?: AttentionSeverity;
}) {
  /*
   * §5, §16 — severity belongs to the item, not to the container, and it tints
   * a dot and a chip rather than the whole card. A booked discussion is calmer
   * than an untouched request: still owed, no longer urgent.
   */
  const scheduled = Boolean(item.scheduledAt);
  const tone = scheduled ? 'normal' : severity;

  return (
    <article className="attention-card">
      <div className="attention-card-main">
        <p className={`attention-card-type ${tone}`}>
          <span className="attention-card-dot" aria-hidden="true" />
          {item.headline}
        </p>

        <h3 className="attention-card-title">{item.taskTitle}</h3>

        {/* Two lines, clamped in CSS. The data keeps every character. */}
        <p className="attention-card-request">{item.requestedAction}</p>

        <p className="attention-card-meta">
          Requested by {item.requestedByName.split(' ')[0]} · {agoWords(item.requestedAt, now)}
          {item.scheduledLabel ? ` · ${item.scheduledLabel}` : ''}
        </p>
      </div>

      {/*
        §10 — the control sits in its own grid column and never competes with
        the text for width. Below the breakpoint the column collapses and it
        takes its own line, rather than being squeezed into an unreadable strip.
      */}
      <Link href={item.href} className="btn small primary attention-card-action">
        {scheduled ? 'Open request' : item.actionLabel}
      </Link>
    </article>
  );
}
