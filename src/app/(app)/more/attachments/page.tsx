import Link from 'next/link';

import { RowPrimaryLink } from '@/components/ui/ParityPrimitives';
import { getAttachmentLibrary } from '@/server/queries';
import { taskDrawerHref } from '@/domain/navigation';

const bytes = (value: number) =>
  value < 1024
    ? `${value} B`
    : value < 1_048_576
      ? `${Math.ceil(value / 1024)} KB`
      : `${(value / 1_048_576).toFixed(1)} MB`;

export default async function AttachmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const params = await searchParams;
  const items = await getAttachmentLibrary(params.q);
  return (
    <>
      <div className="pagehead">
        <div>
          <p className="eyebrow">Records</p>
          <h1>Attachments</h1>
          <p>
            Every file follows the visibility of its work item. Opening it is recorded
            automatically.
          </p>
        </div>
      </div>
      <form className="filterbar" role="search">
        <label className="grow">
          <span>File name</span>
          <input name="q" defaultValue={params.q} placeholder="Search attachments" />
        </label>
        <button className="btn primary" type="submit">
          Search
        </button>
      </form>
      <div className="data-table-wrap">
        <table className="data-table">
          <caption className="visually-hidden">Authorised attachments and evidence</caption>
          <thead>
            <tr>
              <th>File</th>
              <th>Work item</th>
              <th>Uploaded by</th>
              <th>Added</th>
              <th>Views</th>
              <th>
                <span className="visually-hidden">Open</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id} className="interactive-row">
                <td>
                  <RowPrimaryLink
                    href={`/api/attachments/${item.id}`}
                    ariaLabel={`Open ${item.fileName}`}
                  >
                    <strong>{item.fileName}</strong>
                  </RowPrimaryLink>
                  <small>
                    {bytes(item.byteSize)} · {item.mimeType}
                    {item.isEvidence ? ' · Evidence' : ''}
                  </small>
                </td>
                <td>
                  <Link href={taskDrawerHref(item.taskId, '/more/attachments')} data-row-action>
                    {item.taskTitle}
                  </Link>
                </td>
                <td>{item.uploadedByName}</td>
                <td>
                  {new Intl.DateTimeFormat('en-MY', { dateStyle: 'medium' }).format(
                    new Date(item.createdAt),
                  )}
                </td>
                <td>{item.viewCount}</td>
                <td>
                  <a className="btn small" href={`/api/attachments/${item.id}`} data-row-action>
                    Open
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {items.length === 0 && (
          <div className="empty-state">
            <h2>No matching attachments</h2>
            <p>Only files you are authorised to view appear here.</p>
          </div>
        )}
      </div>
    </>
  );
}
