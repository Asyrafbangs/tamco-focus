import Link from 'next/link';

import { PRIORITY_LABELS } from '@/domain/esh-findings';
import { requireProfile } from '@/lib/supabase/server';
import { requireEshAccess } from '@/server/esh/access';
import { getDepartmentsInScope, listVerificationQueue } from '@/server/esh/queries';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The verification queue (§13, §24): every action waiting for ESH, oldest
 * submission first, so nothing sits unnoticed. Viewers see it too — they
 * simply cannot decide anything when they open one.
 */
export default async function VerificationPage({
  searchParams,
}: {
  searchParams: Promise<{ department?: string }>;
}) {
  const access = await requireEshAccess();
  const profile = await requireProfile();
  const query = await searchParams;
  const departmentUnassigned = query.department === 'unassigned';
  const departmentId = query.department && UUID.test(query.department) ? query.department : null;
  const timeZone = profile.timezone ?? 'Asia/Kuala_Lumpur';
  const [rows, departments] = await Promise.all([
    listVerificationQueue(departmentId, departmentUnassigned),
    getDepartmentsInScope(access),
  ]);
  const when = (instant: string) =>
    new Intl.DateTimeFormat('en-MY', { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(
      new Date(instant),
    );

  return (
    <>
      <div className="pagehead">
        <div>
          <p className="eyebrow">Finding Management</p>
          <h1>Verification</h1>
          <p>Corrections submitted for ESH to check, oldest first.</p>
        </div>
      </div>

      <form className="filterbar esh-register-search" action="/findings/verification">
        <label>
          <span>Department</span>
          <select
            name="department"
            defaultValue={departmentUnassigned ? 'unassigned' : (departmentId ?? '')}
          >
            <option value="">All departments in your scope</option>
            {departments.map((department) => (
              <option key={department.id} value={department.id}>
                {department.name}
              </option>
            ))}
            <option value="unassigned">Unassigned</option>
          </select>
        </label>
        <button className="btn small" type="submit">
          Apply
        </button>
      </form>

      {rows.length === 0 ? (
        <p className="guest-empty">Nothing is waiting for verification.</p>
      ) : (
        <ul className="esh-register" aria-label="Waiting for verification">
          {rows.map((row) => (
            <li key={row.submissionId}>
              <Link
                href={`/findings/${row.findingId}?action=${row.actionId}`}
                className="esh-register-row"
              >
                <span className="esh-register-finding">
                  <small>
                    {[row.reference, row.location ?? row.departmentName]
                      .filter(Boolean)
                      .join(' · ')}
                  </small>
                  <strong>{row.title}</strong>
                  <small>
                    Submitted by {row.ownerEmail} · {when(row.submittedAt)}
                  </small>
                </span>
                <span className="esh-register-owner">
                  <small>Version {row.version}</small>
                  <span>
                    {row.files} file{row.files === 1 ? '' : 's'}
                  </span>
                </span>
                <span className="esh-register-status">
                  <span className="flag neutral">Awaiting ESH review</span>
                  {row.priority && row.priority !== 'normal' && (
                    <small className="esh-priority" data-priority={row.priority}>
                      {PRIORITY_LABELS[row.priority]} priority
                    </small>
                  )}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <p className="esh-register-foot">
        {rows.length} waiting · A Verifier who submitted the work cannot verify it themselves.
      </p>
    </>
  );
}
