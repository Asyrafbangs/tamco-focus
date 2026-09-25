import Link from 'next/link';

import { OperationalHealth } from '@/components/esh/OperationalHealth';
import { PeriodPicker } from '@/components/ui/PeriodPicker';
import { SubmitOnSelect } from '@/components/ui/SubmitOnSelect';
import { ESH_CLOSURE_PERIODS, closurePeriodParams, totalOverview } from '@/domain/esh-overview';
import { resolvePeriod } from '@/domain/period';
import { requireProfile } from '@/lib/supabase/server';
import { requireEshAccess } from '@/server/esh/access';
import { getDepartmentsInScope, getEshOverview, getOperationalHealth } from '@/server/esh/queries';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function FindingsOverviewPage({
  searchParams,
}: {
  searchParams: Promise<{
    department?: string;
    period?: string;
    period_from?: string;
    period_to?: string;
  }>;
}) {
  const access = await requireEshAccess();
  const profile = await requireProfile();
  const query = await searchParams;
  const timeZone = profile.timezone ?? 'Asia/Kuala_Lumpur';
  const now = new Date();
  const departmentUnassigned = query.department === 'unassigned';
  const departmentId = query.department && UUID.test(query.department) ? query.department : null;
  const departmentParam = departmentUnassigned ? 'unassigned' : departmentId;
  const closurePeriod = resolvePeriod(
    query.period,
    query.period_from,
    query.period_to,
    now,
    '30',
    timeZone,
  );
  const [overview, departments, health] = await Promise.all([
    getEshOverview({
      departmentId,
      closedSince: closurePeriod.since,
      closedUntil: closurePeriod.until,
      asOf: now.toISOString(),
    }),
    getDepartmentsInScope(access),
    getOperationalHealth(),
  ]);
  const visibleRows = departmentUnassigned
    ? overview.rows.filter((row) => row.departmentId === null)
    : overview.rows;
  const signals = totalOverview(visibleRows);

  const registerHref = (
    filter: 'open' | 'overdue' | 'closed',
    rowDepartment: string | null = departmentParam,
  ) => {
    const params = new URLSearchParams({ filter });
    if (rowDepartment) params.set('department', rowDepartment);
    if (filter === 'closed') {
      for (const [name, value] of Object.entries(closurePeriodParams(closurePeriod))) {
        params.set(name, value);
      }
    }
    return `/findings/register?${params}`;
  };
  const verificationHref = (rowDepartment: string | null = departmentParam) => {
    const params = new URLSearchParams();
    if (rowDepartment) params.set('department', rowDepartment);
    const text = params.toString();
    return `/findings/verification${text ? `?${text}` : ''}`;
  };
  const timestamp = new Intl.DateTimeFormat('en-MY', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone,
  }).format(now);

  return (
    <>
      <div className="pagehead esh-overview-head">
        <div>
          <p className="eyebrow">Finding Management</p>
          <h1>Overview</h1>
          <p>What remains unresolved, where follow-up is needed, and what closed recently.</p>
        </div>
        <p className="esh-data-time">Data at {timestamp}</p>
      </div>

      <div className="esh-overview-controls">
        <form action="/findings">
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
          {Object.entries(closurePeriodParams(closurePeriod)).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))}
          <button className="btn small" type="submit">
            Apply
          </button>
          <SubmitOnSelect />
        </form>
        <div className="esh-closure-control">
          <span>Closures</span>
          <PeriodPicker
            action="/findings"
            hidden={departmentParam ? { department: departmentParam } : {}}
            presets={ESH_CLOSURE_PERIODS}
            period={closurePeriod}
            ariaLabel="Change the closure period"
            now={now}
          />
        </div>
      </div>

      {overview.failed ? (
        <div className="notice error" role="alert">
          <strong>The overview could not be read</strong>
          <p>No figures are shown rather than numbers that may be incomplete. Try again.</p>
        </div>
      ) : (
        <>
          <section className="esh-signals" aria-label="Finding signals">
            <Signal
              href={registerHref('open')}
              label="Open findings"
              value={signals.openFindings}
              unit="findings"
              detail="All ages, including new and unassigned work"
            />
            <Signal
              href={registerHref('overdue')}
              label="Overdue actions"
              value={signals.overdueActions}
              unit="actions"
              detail="Assigned or in progress; not awaiting review"
              exception={signals.overdueActions > 0}
            />
            <Signal
              href={verificationHref()}
              label="Awaiting ESH review"
              value={signals.awaitingReviewActions}
              unit="actions"
              detail={
                signals.reviewOverdueActions > 0
                  ? `${signals.reviewOverdueActions} review overdue`
                  : 'Current owner submissions only'
              }
              exception={signals.reviewOverdueActions > 0}
            />
            <Signal
              href={registerHref('closed')}
              label="Closed findings"
              value={signals.closedFindings}
              unit="findings"
              detail={closurePeriod.label}
            />
          </section>

          <OperationalHealth health={health} />

          <section className="esh-department-summary" aria-labelledby="department-summary-title">
            <div className="esh-section-head">
              <div>
                <h2 id="department-summary-title">By accountable department</h2>
                <p>Actions stay with their finding’s accountable department.</p>
              </div>
            </div>
            {visibleRows.length === 0 ? (
              <p className="guest-empty">No findings are visible in this scope.</p>
            ) : (
              /* v218 — scrollable by keyboard as well as by finger. The box
                 already clipped correctly; what it lacked was a tab stop, so
                 its right-hand columns were unreachable without a mouse, the
                 same gap v181 closed on the attachments table. */
              <div
                className="table-scroll"
                role="region"
                aria-label="Findings by department"
                tabIndex={0}
              >
                <table className="esh-overview-table">
                  <thead>
                    <tr>
                      <th scope="col">Department</th>
                      <th scope="col">Open findings</th>
                      <th scope="col">Overdue actions</th>
                      <th scope="col">Awaiting review</th>
                      <th scope="col">Closed findings</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRows.map((row) => (
                      <tr key={row.departmentId ?? 'unassigned'}>
                        <th scope="row">{row.departmentName}</th>
                        <MetricLink
                          href={registerHref(
                            'open',
                            row.departmentId === null ? 'unassigned' : row.departmentId,
                          )}
                          value={row.openFindings}
                          unit="findings"
                        />
                        <MetricLink
                          href={registerHref(
                            'overdue',
                            row.departmentId === null ? 'unassigned' : row.departmentId,
                          )}
                          value={row.overdueActions}
                          unit="actions"
                          exception={row.overdueActions > 0}
                        />
                        <MetricLink
                          href={verificationHref(
                            row.departmentId === null ? 'unassigned' : row.departmentId,
                          )}
                          value={row.awaitingReviewActions}
                          unit="actions"
                          exception={row.reviewOverdueActions > 0}
                          note={
                            row.reviewOverdueActions > 0
                              ? `${row.reviewOverdueActions} overdue`
                              : undefined
                          }
                        />
                        <MetricLink
                          href={registerHref(
                            'closed',
                            row.departmentId === null ? 'unassigned' : row.departmentId,
                          )}
                          value={row.closedFindings}
                          unit="findings"
                        />
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="esh-definition-note">
              Closed means the finding is still closed and its current official closure falls in{' '}
              {closurePeriod.phrase}. Reopened findings return to open; earlier closure history is
              retained but not counted here.
            </p>
          </section>
        </>
      )}
    </>
  );
}

function Signal({
  href,
  label,
  value,
  unit,
  detail,
  exception = false,
}: {
  href: string;
  label: string;
  value: number;
  unit: 'findings' | 'actions';
  detail: string;
  exception?: boolean;
}) {
  return (
    <Link className="esh-signal" data-exception={exception || undefined} href={href}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{unit}</small>
      <p>{detail}</p>
    </Link>
  );
}

function MetricLink({
  href,
  value,
  unit,
  note,
  exception = false,
}: {
  href: string;
  value: number;
  unit: 'findings' | 'actions';
  note?: string;
  exception?: boolean;
}) {
  return (
    <td>
      <Link href={href} className={exception ? 'esh-metric-exception' : undefined}>
        <strong>{value}</strong> <span className="visually-hidden">{unit}</span>
        {note && <small>{note}</small>}
      </Link>
    </td>
  );
}
