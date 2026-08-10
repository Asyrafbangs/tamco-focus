import { RowPrimaryLink } from '@/components/ui/ParityPrimitives';
import { getCompletionRecords } from '@/server/queries';
import { taskDrawerHref } from '@/domain/navigation';

export default async function ArchivePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const params = await searchParams;
  const records = await getCompletionRecords({ query: params.q, state: 'cancelled' });
  return (
    <>
      <div className="pagehead">
        <div>
          <p className="eyebrow">Archive</p>
          <h1>Cancelled outcomes</h1>
          <p>
            Archive preserves the work, evidence, relationships, and reason. It is not deletion.
          </p>
        </div>
      </div>
      <form className="filterbar" role="search">
        <label className="grow">
          <span>Title or reference</span>
          <input name="q" defaultValue={params.q} placeholder="Search archive" />
        </label>
        <button className="btn primary" type="submit">
          Search
        </button>
      </form>
      <div className="record-list">
        {records.map(({ task }) => (
          <article className="record-card compact interactive-row" key={task.id}>
            <div>
              <span className="flag amber">Cancelled</span>
              <h2>
                <RowPrimaryLink
                  href={taskDrawerHref(task.id, '/more/archive')}
                  ariaLabel={`Open ${task.title}`}
                >
                  {task.title}
                </RowPrimaryLink>
              </h2>
              <p>
                {task.ownerName} · {task.workClass.replaceAll('_', ' ')}
              </p>
            </div>
            <div>
              <small>
                Archived{' '}
                {task.cancelledAt
                  ? new Intl.DateTimeFormat('en-MY', { dateStyle: 'medium' }).format(
                      new Date(task.cancelledAt),
                    )
                  : 'date unavailable'}
              </small>
            </div>
          </article>
        ))}
      </div>
      {records.length === 0 && (
        <div className="empty-state">
          <h2>No matching archived work</h2>
          <p>Cancelled work will remain searchable here.</p>
        </div>
      )}
    </>
  );
}
