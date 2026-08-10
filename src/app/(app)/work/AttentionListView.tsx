import Link from 'next/link';

import { AttentionCard } from '@/components/ui/AttentionCard';
import { attentionPriority, attentionSeverity } from '@/domain/attention';
import type { AttentionRequest } from '@/server/queries';

type SortKey = 'oldest' | 'newest' | 'priority';

/** The filters, and the request types each covers (v49 §11). */
const TYPE_FILTERS: Array<{
  key: string;
  label: string;
  matches: (item: AttentionRequest) => boolean;
}> = [
  { key: 'all', label: 'All', matches: () => true },
  {
    key: 'decision',
    label: 'Decision',
    matches: (item) => item.requestedActionType === 'decision',
  },
  {
    key: 'approval',
    label: 'Approval',
    matches: (item) => item.requestedActionType === 'approval',
  },
  { key: 'support', label: 'Support', matches: (item) => item.requestedActionType === 'support' },
  {
    key: 'escalation',
    label: 'Escalation',
    matches: (item) => item.requestedActionType === 'escalation',
  },
  { key: 'scheduled', label: 'Scheduled', matches: (item) => Boolean(item.scheduledAt) },
];

/**
 * The complete list of things waiting on this person (v49 §11-13, §37).
 *
 * My Day shows the top three and stops; this is where the rest lives. It
 * defaults to oldest first deliberately — a priority-sorted backlog lets a
 * low-severity request age indefinitely at the bottom, seen by nobody, which is
 * the failure mode a backlog view exists to prevent.
 *
 * Only outstanding items appear. Something already answered is history, and
 * mixing it in would make the count meaningless.
 */
export function AttentionListView({
  items,
  activeType,
  sort,
  timeZone,
  now,
}: {
  items: AttentionRequest[];
  activeType: string;
  sort: SortKey;
  timeZone: string;
  now: Date;
}) {
  const filter = TYPE_FILTERS.find((entry) => entry.key === activeType) ?? TYPE_FILTERS[0]!;
  const filtered = items.filter(filter.matches);

  const sorted = [...filtered].sort((left, right) => {
    if (sort === 'priority') return attentionPriority(left, now) - attentionPriority(right, now);
    const leftAt = new Date(left.createdAt).getTime();
    const rightAt = new Date(right.createdAt).getTime();
    return sort === 'newest' ? rightAt - leftAt : leftAt - rightAt;
  });

  const href = (next: { type?: string; sort?: string }) => {
    const search = new URLSearchParams({ filter: 'attention' });
    const type = next.type ?? activeType;
    const order = next.sort ?? sort;
    if (type !== 'all') search.set('type', type);
    if (order !== 'oldest') search.set('sort', order);
    return `/work?${search.toString()}`;
  };

  return (
    <section className="card attention-list" aria-labelledby="attention-list-heading">
      <div className="attention-list-head">
        <div>
          <h2 id="attention-list-heading">Needs Attention</h2>
          <p>Everything waiting on your decision, approval or response.</p>
        </div>
      </div>

      <nav className="attention-list-filters" aria-label="Filter by request type">
        {TYPE_FILTERS.map((entry) => {
          const count = items.filter(entry.matches).length;
          // A filter that would show nothing is noise; only "All" always shows.
          if (count === 0 && entry.key !== 'all') return null;
          return (
            <Link
              key={entry.key}
              href={href({ type: entry.key })}
              className={entry.key === filter.key ? 'active' : undefined}
              aria-current={entry.key === filter.key ? 'page' : undefined}
            >
              {entry.label} <span>{count}</span>
            </Link>
          );
        })}
      </nav>

      <nav className="attention-list-sort" aria-label="Sort">
        {(
          [
            ['oldest', 'Oldest first'],
            ['newest', 'Newest first'],
            ['priority', 'Priority'],
          ] as const
        ).map(([key, label]) => (
          <Link
            key={key}
            href={href({ sort: key })}
            className={key === sort ? 'active' : undefined}
            aria-current={key === sort ? 'page' : undefined}
          >
            {label}
          </Link>
        ))}
      </nav>

      {sorted.length === 0 ? (
        <p className="muted">Nothing here needs your action.</p>
      ) : (
        <ul className="action-queue-list">
          {sorted.map((item) => (
            <li key={item.sourceId}>
              {/* The same card as My Day: one definition of how a request reads. */}
              <AttentionCard
                item={{
                  id: item.sourceId,
                  headline: item.headline,
                  actionLabel: item.requiredAction,
                  taskTitle: item.taskTitle,
                  requestedAction: item.requestedAction,
                  requestedByName: item.requestedByName,
                  requestedAt: item.createdAt,
                  href: item.href,
                  scheduledAt: item.scheduledAt,
                  scheduledLabel: item.scheduledAt
                    ? `Scheduled for discussion ${new Intl.DateTimeFormat('en-GB', {
                        day: 'numeric',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                        timeZone,
                      }).format(new Date(item.scheduledAt))}`
                    : null,
                }}
                now={now}
                severity={attentionSeverity(item.reasonCode, item.kind)}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
