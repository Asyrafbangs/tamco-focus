import { requireEshAccess } from '@/server/esh/access';
import { listReportIntake } from '@/server/esh/queries';

/**
 * Private coordinator queue for reports that have reached the protected intake
 * store. It is intentionally not linked from public QR routes and does not
 * expose reporter contact data.
 */
export default async function IntakeQueuePage() {
  await requireEshAccess('coordinate');
  const intake = await listReportIntake();

  return (
    <main className="esh-workspace">
      <header className="esh-page-head">
        <div>
          <p className="eyebrow">Finding Management</p>
          <h1>Private intake</h1>
          <p>
            Reports here are not Findings and have not created an owner action. Review them before
            assigning any corrective work.
          </p>
        </div>
      </header>

      {intake.failed ? (
        <p role="alert">The private intake queue could not be read. Nothing has been changed.</p>
      ) : intake.rows.length === 0 ? (
        <section className="esh-empty-state">
          <h2>No reports need triage</h2>
          <p>New private reports will appear here for an authorized coordinator.</p>
        </section>
      ) : (
        <ul className="esh-register-list" aria-label="Private reports awaiting triage">
          {intake.rows.map((report) => (
            <li key={report.id} className="esh-register-row">
              <div>
                <strong>{report.reportText}</strong>
                <small>
                  {report.source === 'esh_manual' ? 'Manual entry' : 'QR report'} · received{' '}
                  {new Intl.DateTimeFormat('en-MY', {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  }).format(new Date(report.receivedAt))}
                </small>
              </div>
              <span className="status-chip">{report.status}</span>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
