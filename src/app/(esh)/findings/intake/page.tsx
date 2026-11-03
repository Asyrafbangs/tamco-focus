import { IntakeTriageActions } from '@/components/esh/IntakeTriageActions';
import { SCAN_LABELS } from '@/domain/esh-evidence';
import { ManualIntakeForm } from '@/components/esh/ManualIntakeForm';
import { requireProfile } from '@/lib/supabase/server';
import { requireEshAccess } from '@/server/esh/access';
import { getDepartmentsInScope, listReportIntake } from '@/server/esh/queries';

/**
 * Private coordinator queue for reports that have reached the protected intake
 * store. It is intentionally not linked from any public route and does not
 * expose reporter contact data.
 *
 * The whole queue, not a page of it: Today shows a preview and says how many
 * it is leaving out, and this is where the rest of them are.
 */

/**
 * A report is up to 4000 characters of free text. The row shows the beginning
 * of it; the full text is on the review screen the row leads to.
 */
const SUMMARY_LIMIT = 160;

function summarise(text: string) {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= SUMMARY_LIMIT ? flat : `${flat.slice(0, SUMMARY_LIMIT - 1).trimEnd()}…`;
}

export default async function IntakeQueuePage() {
  const access = await requireEshAccess('coordinate');
  const profile = await requireProfile();
  const [intake, departments] = await Promise.all([
    listReportIntake(),
    getDepartmentsInScope(access),
  ]);
  const timeZone = profile.timezone ?? 'Asia/Kuala_Lumpur';
  const when = (instant: string) =>
    new Intl.DateTimeFormat('en-MY', { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(
      new Date(instant),
    );

  return (
    <>
      <div className="pagehead">
        <div>
          <p className="eyebrow">Finding Management</p>
          <h1>Incoming reports</h1>
          <p>
            Reports here are not Findings and have not created an owner action. Review them before
            assigning any corrective work.
          </p>
        </div>
      </div>

      <ManualIntakeForm departments={departments} allowUnassigned={access.scopeAll} />

      {intake.failed ? (
        <div className="notice error" role="alert">
          <strong>The private intake queue could not be read</strong>
          <p>Nothing has been changed, and no rows are shown rather than an incomplete list.</p>
        </div>
      ) : intake.rows.length === 0 ? (
        <div className="empty-state compact">
          <h3>No reports need triage</h3>
          <p>New private reports appear here for an authorized coordinator.</p>
        </div>
      ) : (
        <ul className="esh-register" aria-label="Private reports awaiting triage">
          {intake.rows.map((report) => (
            <li key={report.id}>
              <div className="esh-register-row">
                <span className="esh-register-finding">
                  <small>
                    {[
                      report.source === 'esh_manual' ? 'Recorded by ESH' : 'QR report',
                      report.reportedLocation,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </small>
                  <strong>{summarise(report.reportText)}</strong>
                  {/*
                   * v288 - who to ask, said out loud either way. "Anonymous"
                   * changes how a coordinator triages, and a blank line where
                   * a name might be invites somebody to go looking for the
                   * person who reported it.
                   */}
                  <small>
                    {report.reporterContact
                      ? `Reported by ${report.reporterContact}`
                      : 'Reported anonymously'}
                  </small>
                  {report.photos.length > 0 && (
                    <span className="esh-intake-photos">
                      {report.photos.map((photo, index) => (
                        <a
                          key={photo.id}
                          href={`/findings/intake/photos/${photo.id}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element --
                              a private object behind a signed redirect; the
                              optimiser cannot fetch it. */}
                          <img
                            src={`/findings/intake/photos/${photo.id}`}
                            alt={`Photograph ${index + 1} from this report`}
                          />
                          <small>{SCAN_LABELS[photo.scanState] ?? 'Not scanned'}</small>
                        </a>
                      ))}
                    </span>
                  )}
                </span>
                <span className="esh-register-owner">
                  <small>Received</small>
                  <span>{when(report.receivedAt)}</span>
                </span>
                <span className="esh-register-status">
                  <span className={report.status === 'new' ? 'flag amber' : 'flag blue'}>
                    {report.status === 'new' ? 'Needs triage' : 'Being triaged'}
                  </span>
                </span>
                <IntakeTriageActions intakeId={report.id} status={report.status} />
              </div>
            </li>
          ))}
        </ul>
      )}
      {!intake.failed && intake.rows.length > 0 && (
        <p className="esh-register-foot">
          {intake.rows.length} report{intake.rows.length === 1 ? '' : 's'} waiting · a report
          becomes a Finding only when a coordinator reviews it.
        </p>
      )}
    </>
  );
}
