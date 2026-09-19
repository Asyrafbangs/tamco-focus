import Link from 'next/link';

import {
  ACTION_STATE_LABELS,
  FINDING_STATUS_LABELS,
  PRIORITY_LABELS,
  REGISTER_FILTERS,
  daysOverdue,
  registerFilterFrom,
} from '@/domain/esh-findings';
import { requireProfile } from '@/lib/supabase/server';
import { requireEshAccess } from '@/server/esh/access';
import {
  REGISTER_PAGE_SIZE,
  getDepartmentsInScope,
  listRegister,
  type RegisterListRow,
} from '@/server/esh/queries';

const CLOSED_PERIODS = [30, 60, 90, 365] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const LAST_UPDATE_LABELS: Record<string, string> = {
  finding_created: 'Recorded',
  action_assigned: 'Assigned',
};

/**
 * The Finding Register (§24, screen 03).
 *
 * Four views of one definition — Needs attention, All open, Overdue, Closed —
 * with search and a department filter applied by the database, so a count and
 * the rows behind it always agree. Open work has no age cutoff; Closed
 * defaults to the last 30 days.
 */
export default async function FindingRegisterPage({
  searchParams,
}: {
  searchParams: Promise<{
    filter?: string;
    q?: string;
    department?: string;
    days?: string;
    page?: string;
    saved?: string;
  }>;
}) {
  const access = await requireEshAccess();
  const profile = await requireProfile();
  const params = await searchParams;
  const filter = registerFilterFrom(params.filter);
  const days = CLOSED_PERIODS.find((period) => String(period) === params.days) ?? 30;
  const departmentId = params.department && UUID.test(params.department) ? params.department : null;
  const pageNumber = Math.max(1, Math.floor(Number(params.page ?? '1')) || 1);
  const search = (params.q ?? '').slice(0, 80);

  const [register, departments] = await Promise.all([
    listRegister({
      filter,
      search,
      departmentId,
      closedWithinDays: days,
      page: pageNumber - 1,
    }),
    getDepartmentsInScope(access),
  ]);

  const timeZone = profile.timezone ?? 'Asia/Kuala_Lumpur';
  const now = new Date();
  const pages = Math.max(1, Math.ceil(register.total / REGISTER_PAGE_SIZE));

  const hrefFor = (overrides: Record<string, string | undefined>) => {
    const query = new URLSearchParams();
    const merged = {
      filter,
      q: search || undefined,
      department: departmentId ?? undefined,
      days: filter === 'closed' ? String(days) : undefined,
      ...overrides,
    };
    for (const [key, value] of Object.entries(merged)) {
      if (value) query.set(key, value);
    }
    const encoded = query.toString();
    return `/findings/register${encoded ? `?${encoded}` : ''}`;
  };

  return (
    <>
      <div className="pagehead">
        <div>
          <h1>Finding Register</h1>
          <p>See what needs action and who is responsible.</p>
        </div>
        {access.canCoordinate && (
          <Link className="btn primary" href="/findings/new">
            + New finding
          </Link>
        )}
      </div>

      <nav className="esh-filter-tabs" aria-label="Register views">
        {REGISTER_FILTERS.map((option) => (
          <Link
            key={option.key}
            href={hrefFor({ filter: option.key, page: undefined })}
            aria-current={option.key === filter ? 'page' : undefined}
          >
            {option.label}
          </Link>
        ))}
      </nav>

      <form className="filterbar esh-register-search" role="search" action="/findings/register">
        <input type="hidden" name="filter" value={filter} />
        <label className="esh-register-search-text">
          <span>Search</span>
          <input
            name="q"
            defaultValue={search}
            placeholder="Find reference, title, owner or location"
          />
        </label>
        <label>
          <span>Department</span>
          <select name="department" defaultValue={departmentId ?? ''}>
            <option value="">All departments in your scope</option>
            {departments.map((department) => (
              <option key={department.id} value={department.id}>
                {department.name}
              </option>
            ))}
          </select>
        </label>
        {filter === 'closed' && (
          <label>
            <span>Closed in</span>
            <select name="days" defaultValue={String(days)}>
              <option value="30">Last 30 days</option>
              <option value="60">Last 60 days</option>
              <option value="90">Last 90 days</option>
              <option value="365">Last year</option>
            </select>
          </label>
        )}
        <button className="btn" type="submit">
          Apply
        </button>
      </form>

      {register.failed ? (
        <div className="notice error" role="alert">
          <strong>The register could not be read</strong>
          <p>Nothing is shown rather than an empty list that might not be true. Try again.</p>
        </div>
      ) : register.rows.length === 0 ? (
        <div className="empty-state">
          <h2>No matching findings</h2>
          <p>
            {filter === 'attention'
              ? 'Nothing needs ESH’s attention right now.'
              : 'Try another view, or clear the search.'}
          </p>
        </div>
      ) : (
        <>
          <div className="esh-register-head" aria-hidden="true">
            <span>Finding / last update</span>
            <span>Action owner</span>
            <span>Status</span>
          </div>
          <ul className="esh-register" aria-label="Findings">
            {register.rows.map((row) => (
              <RegisterRowItem key={row.findingId} row={row} timeZone={timeZone} now={now} />
            ))}
          </ul>
        </>
      )}

      {!register.failed && (
        <div className="esh-register-foot">
          <p>
            {register.total} {register.total === 1 ? 'finding' : 'findings'} in this view
            {filter === 'closed'
              ? ` · closed in the last ${days === 365 ? 'year' : `${days} days`}`
              : ''}
          </p>
          {pages > 1 && (
            <nav className="esh-pager" aria-label="Pages">
              {pageNumber > 1 && (
                <Link href={hrefFor({ page: String(pageNumber - 1) })}>← Previous</Link>
              )}
              <span>
                Page {pageNumber} of {pages}
              </span>
              {pageNumber < pages && (
                <Link href={hrefFor({ page: String(pageNumber + 1) })}>Next →</Link>
              )}
            </nav>
          )}
        </div>
      )}
    </>
  );
}

function RegisterRowItem({
  row,
  timeZone,
  now,
}: {
  row: RegisterListRow;
  timeZone: string;
  now: Date;
}) {
  const shortDate = (instant: string) =>
    new Intl.DateTimeFormat('en-MY', { day: 'numeric', month: 'short', timeZone }).format(
      new Date(instant),
    );
  const stamp = new Intl.DateTimeFormat('en-MY', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  }).format(new Date(row.lastUpdateAt));

  const overdueDays = row.isOverdue && row.dueAt ? daysOverdue(row.dueAt, now, timeZone) : 0;
  const due = row.dueAt
    ? row.isOverdue
      ? overdueDays === 0
        ? 'Overdue today'
        : `Overdue ${overdueDays} ${overdueDays === 1 ? 'day' : 'days'}`
      : `Due ${shortDate(row.dueAt)}`
    : null;

  const status =
    row.status === 'open' && row.actionState
      ? ACTION_STATE_LABELS[row.actionState]
      : row.status === 'closed' && row.closedAt
        ? `Closed ${shortDate(row.closedAt)}`
        : FINDING_STATUS_LABELS[row.status];

  return (
    <li>
      <Link href={`/findings/${row.findingId}`} className="esh-register-row">
        <span className="esh-register-finding">
          <small>
            {row.reference}
            {row.location || row.departmentName ? ` · ${row.location ?? row.departmentName}` : ''}
            {row.isRestricted ? ' · Restricted' : ''}
          </small>
          <strong>{row.title}</strong>
          <small>
            {LAST_UPDATE_LABELS[row.lastUpdateType] ?? 'Updated'} · {stamp}
          </small>
        </span>
        <span className="esh-register-owner">
          <span>{row.ownerEmail ?? 'No owner yet'}</span>
          {due && <small className={row.isOverdue ? 'esh-overdue' : undefined}>{due}</small>}
          {row.priority && row.priority !== 'normal' && (
            <small className="esh-priority" data-priority={row.priority}>
              {PRIORITY_LABELS[row.priority]} priority
            </small>
          )}
        </span>
        <span className="esh-register-status">
          <span className="flag neutral">{status}</span>
          {row.notificationHeld && (
            <span className="flag amber" title="The owner has not been emailed: access not enabled">
              Notification held
            </span>
          )}
          {row.actionCount > 1 && <small>{row.actionCount} actions</small>}
        </span>
      </Link>
    </li>
  );
}
