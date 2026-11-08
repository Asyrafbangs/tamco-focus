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
      {/*
        A region that takes focus (v181): on a phone the table is wider than the
        screen and scrolls inside this box, and a box that scrolls must be
        reachable by keyboard or its right-hand columns are not reachable at all.
      */}
      <div
        className="data-table-wrap"
        role="region"
        aria-label="Authorised attachments and evidence"
        tabIndex={0}
      >
        {/*
          Roles written out, because the phone layout stacks the row.
          Chromium drops a table's structure as soon as a `tr` or `td` is given
          a `display` other than the table ones, so without these the stacked
          rows would reach a screen reader as a pile of text.
        */}
        <table className="data-table" role="table">
          <caption className="visually-hidden">Authorised attachments and evidence</caption>
          <thead role="rowgroup">
            <tr role="row">
              <th role="columnheader">File</th>
              <th role="columnheader">Work item</th>
              <th role="columnheader">Uploaded by</th>
              <th role="columnheader">Added</th>
              <th role="columnheader">Opened</th>
            </tr>
          </thead>
          <tbody role="rowgroup">
            {items.map((item) => (
              <tr key={item.id} className="interactive-row" role="row">
                <td role="cell">
                  <RowPrimaryLink
                    href={`/api/attachments/${item.id}`}
                    ariaLabel={`Open ${item.fileName}`}
                  >
                    <strong>{item.fileName}</strong>
                  </RowPrimaryLink>
                  {/* No media type. The file name carries its extension, and
                      "application/vnd.openxmlformats-officedocument.presentationml.presentation"
                      was three lines of a phone screen for a fact nobody acts on. */}
                  <small>
                    {bytes(item.byteSize)}
                    {item.isEvidence ? ' · Evidence' : ''}
                  </small>
                </td>
                <td role="cell">
                  <Link href={taskDrawerHref(item.taskId, '/more/attachments')} data-row-action>
                    {item.taskTitle}
                  </Link>
                </td>
                <td role="cell">{item.uploadedByName}</td>
                <td role="cell">
                  {new Intl.DateTimeFormat('en-MY', { dateStyle: 'medium' }).format(
                    new Date(item.createdAt),
                  )}
                </td>
                {/* No second Open control. It pointed at the same address as
                    the file name beside it, and cost the widest column on a
                    phone. */}
                <td role="cell">{item.viewCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {items.length === 0 && (
          <div className="empty-state">
            <h2>No matching attachments</h2>
            <p>
              Files appear here once they are attached to work you can see. Try a shorter search.
            </p>
          </div>
        )}
      </div>
    </>
  );
}
