import Link from 'next/link';

import { PeriodPicker } from '@/components/ui/PeriodPicker';
import {
  ACTION_STATE_LABELS,
  FINDING_STATUS_LABELS,
  PRIORITY_LABELS,
  REGISTER_FILTERS,
  daysOverdue,
  registerFilterFrom,
} from '@/domain/esh-findings';
import { ESH_CLOSURE_PERIODS } from '@/domain/esh-overview';
import { periodParams, resolvePeriod } from '@/domain/period';
import { requireProfile } from '@/lib/supabase/server';
import { requireEshAccess } from '@/server/esh/access';
import {
  REGISTER_PAGE_SIZE,
  getDepartmentsInScope,
  listRegister,
  type RegisterListRow,
} from '@/server/esh/queries';

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
    period?: string;
    period_from?: string;
    period_to?: string;
    page?: string;
    saved?: string;
  }>;
}) {
  const access = await requireEshAccess();
  const profile = await requireProfile();
  const params = await searchParams;
  const filter = registerFilterFrom(params.filter);
  const departmentUnassigned = params.department === 'unassigned';
  const departmentId = params.department && UUID.test(params.department) ? params.department : null;
  const pageNumber = Math.max(1, Math.floor(Number(params.page ?? '1')) || 1);
  const search = (params.q ?? '').slice(0, 80);
  const timeZone = profile.timezone ?? 'Asia/Kuala_Lumpur';
  const now = new Date();
  const closurePeriod = resolvePeriod(
    params.period,
    params.period_from,
    params.period_to,
    now,
    '30',
    timeZone,
  );

  const [register, departments] = await Promise.all([
    listRegister({
      filter,
      search,
      departmentId,
      departmentUnassigned,
      closedSince: closurePeriod.since,
      closedUntil: closurePeriod.until,
      page: pageNumber - 1,
    }),
    getDepartmentsInScope(access),
  ]);

  const pages = Math.max(1, Math.ceil(register.total / REGISTER_PAGE_SIZE));

  const hrefFor = (overrides: Record<string, string | undefined>) => {
    const query = new URLSearchParams();
    const merged = {
      filter,
      q: search || undefined,
      department: departmentUnassigned ? 'unassigned' : (departmentId ?? undefined),
      ...overrides,
    };
    for (const [key, value] of Object.entries(merged)) {
      if (value) query.set(key, value);
    }
    if (filter === 'closed') {
      for (const [key, value] of Object.entries(periodParams(closurePeriod))) {
        query.set(key, value);
      }
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
        <div className="pagehead-actions">
          <Link className="btn" href="/findings/register/export">
            Export CSV
          </Link>
          {/* The backlog arrives through the register it belongs to, rather
              than through a navigation area of its own (v205, §38.1). */}
          {access.canCoordinate && (
            <Link className="btn" href="/findings/import">
              Import backlog
            </Link>
          )}
          {access.canCoordinate && (
            <Link className="btn primary" href="/findings/new">
              + New finding
            </Link>
          )}
        </div>
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
        {filter === 'closed' &&
          Object.entries(periodParams(closurePeriod)).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))}
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
        <button className="btn" type="submit">
          Apply
        </button>
      </form>

      {filter === 'closed' && (
        <div className="esh-register-period">
          <span>Closures</span>
          <PeriodPicker
            action="/findings/register"
            hidden={{
              filter: 'closed',
              ...(search ? { q: search } : {}),
              ...(departmentUnassigned
                ? { department: 'unassigned' }
                : departmentId
                  ? { department: departmentId }
                  : {}),
            }}
            presets={ESH_CLOSURE_PERIODS}
            period={closurePeriod}
            ariaLabel="Change the closure period"
            now={now}
          />
        </div>
      )}

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
              <RegisterRowItem
                key={row.actionId ?? row.findingId}
                row={row}
                timeZone={timeZone}
                now={now}
              />
            ))}
          </ul>
        </>
      )}

      {!register.failed && (
        <div className="esh-register-foot">
          <p>
            {register.total}{' '}
            {filter === 'overdue'
              ? register.total === 1
                ? 'action'
                : 'actions'
              : register.total === 1
                ? 'finding'
                : 'findings'}{' '}
            in this view
            {filter === 'closed' ? ` · closed ${closurePeriod.phrase}` : ''}
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
      <Link
        href={`/findings/${row.findingId}${row.actionId ? `?action=${row.actionId}` : ''}`}
        className="esh-register-row"
      >
        <span className="esh-register-finding">
          <small>
            {row.reference}
            {row.location || row.departmentName ? ` · ${row.location ?? row.departmentName}` : ''}
            {row.isRestricted ? ' · Restricted' : ''}
          </small>
          <strong>{row.actionTitle ?? row.title}</strong>
          {row.actionTitle && <small>Finding: {row.title}</small>}
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
