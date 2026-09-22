import Link from 'next/link';
import { redirect } from 'next/navigation';

import { GuestTopBar } from '@/components/esh/guest/GuestTopBar';
import type { GuestReportRow, ReportSignal } from '@/domain/esh-reports';
import { loadGuestReport } from '@/server/esh/guest';

const SIGNALS: Array<{ key: ReportSignal; label: string }> = [
  { key: 'open', label: 'Open' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'awaiting_verification', label: 'Awaiting review' },
  { key: 'closed', label: 'Closed last week' },
];

function dateTime(value: string, timeZone: string) {
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone,
  }).format(new Date(value));
}

function ReportRows({ rows, timeZone }: { rows: GuestReportRow[]; timeZone: string }) {
  if (rows.length === 0) return <p className="empty">No records in this view.</p>;
  return (
    <div className="esh-report-table-wrap">
      <table className="esh-report-table">
        <thead>
          <tr>
            <th scope="col">Finding</th>
            <th scope="col">Department</th>
            <th scope="col">Owner / action</th>
            <th scope="col">Due or closed</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${row.signal}-${row.reference}-${row.actionTitle ?? index}`}>
              <td>
                <strong>{row.reference}</strong>
                <span>{row.findingTitle}</span>
                {row.location && <small>{row.location}</small>}
              </td>
              <td>{row.departmentName ?? 'Unassigned'}</td>
              <td>
                <span>{row.ownerEmail ?? 'No owner'}</span>
                {row.actionTitle && <small>{row.actionTitle}</small>}
              </td>
              <td>
                {row.signal === 'closed' && row.closedAt
                  ? dateTime(row.closedAt, timeZone)
                  : row.dueAt
                    ? dateTime(row.dueAt, timeZone)
                    : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function GuestReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ runId: string }>;
  searchParams: Promise<{ view?: string }>;
}) {
  const [{ runId }, query] = await Promise.all([params, searchParams]);
  const live = query.view === 'live';
  const result = await loadGuestReport(runId, live);
  if (result.kind === 'no_session') redirect('/respond/access?for=report');
  return (
    <>
      <GuestTopBar identity="Leadership report" />
      <main id="guest-main" className="guest-main esh-report-viewer">
        {result.kind === 'report' ? (
          <>
            <header className="esh-report-header">
              <div>
                <span className="eyebrow">Finding Management</span>
                <h1>{result.data.name}</h1>
                <p>
                  {result.data.mode === 'snapshot'
                    ? `Snapshot captured ${dateTime(result.data.capturedAt, result.data.timezone)}`
                    : `Live view refreshed ${dateTime(new Date().toISOString(), result.data.timezone)}`}
                </p>
              </div>
              <nav className="segmented" aria-label="Report time view">
                <Link aria-current={!live ? 'page' : undefined} href={`/respond/reports/${runId}`}>
                  Saved snapshot
                </Link>
                <Link
                  aria-current={live ? 'page' : undefined}
                  href={`/respond/reports/${runId}?view=live`}
                >
                  Live
                </Link>
              </nav>
            </header>
            <div className="notice neutral">
              <p>
                This is a read-only leadership view for the configured departments. Restricted
                findings are excluded. The saved snapshot does not change after capture.
              </p>
            </div>
            <section className="esh-report-signals" aria-label="Report totals">
              {SIGNALS.map((signal) => (
                <article key={signal.key}>
                  <strong>
                    {signal.key === 'awaiting_verification'
                      ? result.data.counts.awaiting
                      : result.data.counts[signal.key]}
                  </strong>
                  <span>{signal.label}</span>
                </article>
              ))}
            </section>
            {SIGNALS.map((signal) => (
              <section className="esh-report-section" key={signal.key}>
                <h2>{signal.label}</h2>
                <ReportRows
                  rows={result.data.rows.filter((row) => row.signal === signal.key)}
                  timeZone={result.data.timezone}
                />
              </section>
            ))}
          </>
        ) : (
          <section className="guest-card" role="alert">
            <h1>This report is no longer available</h1>
            <p className="guest-lead">
              Its recipient, scope or definition changed. Ask ESH for the current report link.
            </p>
          </section>
        )}
      </main>
    </>
  );
}
