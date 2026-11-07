import Link from 'next/link';

import { IntakeOtherDecisions } from '@/components/esh/IntakeTriageActions';
import { FindingForm } from '@/components/esh/FindingForm';
import { SCAN_LABELS } from '@/domain/esh-evidence';
import { ManualIntakeForm } from '@/components/esh/ManualIntakeForm';
import { requireProfile } from '@/lib/supabase/server';
import { requireEshAccess } from '@/server/esh/access';
import {
  getDepartmentsInScope,
  getFollowupSettings,
  getVerifiers,
  listDepartmentEscalationDefaults,
  listReportIntake,
} from '@/server/esh/queries';

/**
 * The triage workspace (v293).
 *
 * One screen: the queue on the left, the report and the decision on the
 * right. It replaced a list of rows whose only real action was a link to a
 * second page — on twenty reports a day that was twenty page loads, twenty
 * returns to the queue, and the report itself out of sight while somebody
 * typed the finding it described.
 *
 * Selection is an address, not client state: `?report=<id>`. That keeps the
 * back button, a bookmarkable report and server-rendered permissions, and it
 * means the queue and the decision cannot disagree about which report is in
 * front of you.
 *
 * It is intentionally not linked from any public route, and the reporter's
 * contact is shown only to the coordinators who already read this queue.
 */

/**
 * A report is up to 4000 characters of free text. The row shows the beginning
 * of it; the whole of it is on the right, beside the decision.
 */
const SUMMARY_LIMIT = 110;

function summarise(text: string) {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= SUMMARY_LIMIT ? flat : `${flat.slice(0, SUMMARY_LIMIT - 1).trimEnd()}…`;
}

/**
 * A title for the finding, taken from what the employee wrote.
 *
 * Their words, shortened at a word boundary — not a summary of them, and
 * nothing added. It is the first field under Report details and stays
 * editable: a coordinator who wants a different title writes one.
 */
function titleFrom(text: string) {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= 90) return flat;
  const cut = flat.slice(0, 90);
  const space = cut.lastIndexOf(' ');
  return `${(space > 40 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

export default async function IntakeQueuePage({
  searchParams,
}: {
  searchParams: Promise<{ report?: string }>;
}) {
  const access = await requireEshAccess('coordinate');
  const profile = await requireProfile();
  const params = await searchParams;
  const [intake, departments, verifiers, followup, routes] = await Promise.all([
    listReportIntake(),
    getDepartmentsInScope(access),
    getVerifiers(),
    getFollowupSettings(),
    listDepartmentEscalationDefaults(),
  ]);

  const timeZone = profile.timezone ?? 'Asia/Kuala_Lumpur';
  const when = (instant: string) =>
    new Intl.DateTimeFormat('en-MY', { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(
      new Date(instant),
    );
  const onlyDate = (instant: string) =>
    new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date(instant));

  const rows = intake.rows;
  const selectedIndex = Math.max(
    0,
    rows.findIndex((row) => row.id === params.report),
  );
  const selected = rows[selectedIndex] ?? null;
  /*
   * Where "Assign & next" goes. The one after this in the queue, or back to
   * the queue when this was the last — never a report that is not there.
   */
  const next = selected ? (rows[selectedIndex + 1] ?? null) : null;
  const nextHref = next ? `/findings/intake?report=${next.id}` : '/findings/intake';

  const departmentRoutes = Object.fromEntries(
    routes.map((route) => [
      route.departmentId,
      route.levels.reduce<Record<number, string[]>>((byLevel, entry) => {
        byLevel[entry.level] = [...(byLevel[entry.level] ?? []), entry.email];
        return byLevel;
      }, {}),
    ]),
  );

  return (
    <>
      <div className="pagehead">
        <div>
          <p className="eyebrow">Finding Management</p>
          <h1>Incoming reports</h1>
          <p>Review, decide and assign in one workspace.</p>
        </div>
      </div>

      {intake.failed ? (
        <div className="notice error" role="alert">
          <strong>The private intake queue could not be read</strong>
          <p>Nothing has been changed, and no rows are shown rather than an incomplete list.</p>
        </div>
      ) : rows.length === 0 ? (
        <>
          <div className="empty-state compact">
            <h3>No reports need triage</h3>
            <p>New private reports appear here for an authorized coordinator.</p>
          </div>
          <ManualIntakeForm departments={departments} allowUnassigned={access.scopeAll} />
        </>
      ) : (
        <div className="esh-intake-workspace">
          <section className="esh-intake-queue" aria-labelledby="esh-intake-queue-title">
            <div className="esh-intake-queue-head">
              <h2 id="esh-intake-queue-title">Reports queue</h2>
              <p>
                {intake.total} waiting
                {intake.truncated ? ` · showing the oldest ${rows.length}` : ''}
              </p>
            </div>
            <ol className="esh-intake-list">
              {rows.map((report) => (
                <li key={report.id}>
                  <Link
                    href={`/findings/intake?report=${report.id}`}
                    className="esh-intake-item"
                    aria-current={report.id === selected?.id ? 'true' : undefined}
                    data-selected={report.id === selected?.id || undefined}
                  >
                    <span className="esh-intake-item-top">
                      <span className={report.status === 'new' ? 'flag amber' : 'flag blue'}>
                        {report.status === 'new' ? 'Needs triage' : 'Being triaged'}
                      </span>
                      {report.photos.length > 0 && (
                        <span className="esh-intake-item-evidence">
                          {report.photos.length} photo{report.photos.length === 1 ? '' : 's'}
                        </span>
                      )}
                    </span>
                    <strong>{summarise(report.reportText)}</strong>
                    <small>
                      {[
                        report.reportedLocation ?? 'No location given',
                        when(report.receivedAt),
                      ].join(' · ')}
                    </small>
                  </Link>
                </li>
              ))}
            </ol>
          </section>

          {selected && (
            <section className="esh-intake-review" aria-labelledby="esh-intake-review-title">
              <h2 id="esh-intake-review-title">Review and assign</h2>

              {/*
               * The employee's own words, kept whole and read-only. The form
               * below carries a copy that ESH may correct; this is what was
               * actually reported, and it stays on screen while the decision
               * is made.
               */}
              <article className="esh-intake-original">
                <p className="esh-intake-original-eyebrow">Original report</p>
                <p className="esh-intake-original-text">{selected.reportText}</p>
                <dl className="esh-intake-facts">
                  <div>
                    <dt>Where</dt>
                    <dd>{selected.reportedLocation ?? 'Not given'}</dd>
                  </div>
                  <div>
                    <dt>Received</dt>
                    <dd>{when(selected.receivedAt)}</dd>
                  </div>
                  <div>
                    <dt>Source</dt>
                    <dd>{selected.source === 'esh_manual' ? 'Recorded by ESH' : 'QR report'}</dd>
                  </div>
                  <div>
                    <dt>Contact</dt>
                    <dd>{selected.reporterContact ?? 'Reported anonymously'}</dd>
                  </div>
                </dl>
                {selected.photos.length > 0 && (
                  <span className="esh-intake-photos">
                    {selected.photos.map((photo, index) => (
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
              </article>

              <FindingForm
                key={selected.id}
                variant="triage"
                nextHref={nextHref}
                departments={departments}
                canAddDepartment={profile.role === 'administrator'}
                verifiers={verifiers}
                levelDays={followup?.levelDays ?? []}
                departmentRoutes={departmentRoutes}
                initial={{
                  findingId: null,
                  intakeId: selected.id,
                  reference: null,
                  title: titleFrom(selected.reportText),
                  description: selected.reportText,
                  /*
                   * What the database will store anyway. `esh_accept_report_intake`
                   * forces `observation` and a private-intake source reference,
                   * so showing "ESH inspection" here only told the coordinator
                   * something untrue about their own record.
                   */
                  source: 'observation',
                  sourceReference: '',
                  reportedOn: onlyDate(selected.receivedAt),
                  location: selected.reportedLocation ?? '',
                  departmentId:
                    selected.departmentId ??
                    (departments.length === 1 ? (departments[0]?.id ?? '') : ''),
                  riskLevel: 'not_assessed',
                  isRestricted: false,
                  requiredOutcome: '',
                  evidenceInstruction: 'Photo showing the corrected condition.',
                  evidenceKind: '',
                  priority: '',
                  ownerEmail: '',
                  dueDate: '',
                  dueTime: '',
                  reviewerUserId: '',
                  escalation: {},
                  noFurtherEscalationReason: '',
                }}
              />

              <IntakeOtherDecisions
                intakeId={selected.id}
                status={selected.status}
                hasContact={Boolean(selected.reporterContact)}
              />
            </section>
          )}
        </div>
      )}

      {!intake.failed && rows.length > 0 && (
        <ManualIntakeForm departments={departments} allowUnassigned={access.scopeAll} />
      )}
    </>
  );
}
