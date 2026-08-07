import { RowPrimaryLink } from '@/components/ui/ParityPrimitives';
import { getAuditHistory } from '@/server/queries';

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const params = await searchParams;
  const events = await getAuditHistory(params.q);
  return (
    <>
      <div className="pagehead">
        <div>
          <p className="eyebrow">Records</p>
          <h1>Audit history</h1>
          <p>
            Immutable authorised history. Undo adds a reversal; it never erases the original event.
          </p>
        </div>
      </div>
      <form className="filterbar" role="search">
        <label className="grow">
          <span>Event, person, or work item</span>
          <input name="q" defaultValue={params.q} placeholder="Search recent history" />
        </label>
        <button className="btn primary" type="submit">
          Search
        </button>
      </form>
      <ol className="audit-timeline">
        {events.map((event) => (
          <li key={event.id} className={event.taskId ? 'interactive-row' : undefined}>
            <span className="timeline-dot" aria-hidden="true" />
            <div>
              <div className="record-title-row">
                <strong>{event.eventType.replaceAll('_', ' ')}</strong>
                {event.isReversal && <span className="flag amber">Reversal</span>}
              </div>
              <p>
                {event.actorName}
                {event.taskTitle && (
                  <>
                    {' '}
                    ·{' '}
                    <RowPrimaryLink
                      href={`/work?task=${event.taskId}`}
                      ariaLabel={`Open ${event.taskTitle}`}
                    >
                      {event.taskTitle}
                    </RowPrimaryLink>
                  </>
                )}
              </p>
              {event.previousStatus && event.newStatus && (
                <small>
                  {event.previousStatus} → {event.newStatus}
                </small>
              )}
            </div>
            <time dateTime={event.occurredAt}>
              {new Intl.DateTimeFormat('en-MY', { dateStyle: 'medium', timeStyle: 'short' }).format(
                new Date(event.occurredAt),
              )}
            </time>
          </li>
        ))}
      </ol>
      {events.length === 0 && (
        <div className="empty-state">
          <h2>No matching events</h2>
          <p>Try a broader search.</p>
        </div>
      )}
    </>
  );
}
