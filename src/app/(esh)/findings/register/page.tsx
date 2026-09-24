import Link from 'next/link';

import { RegisterTools } from '@/components/esh/RegisterTools';
import { PeriodPicker } from '@/components/ui/PeriodPicker';
import { REGISTER_FILTERS, RISK_LABELS, registerFilterFrom } from '@/domain/esh-findings';
import { agoWords, dueWords, nextActor } from '@/domain/esh-next-actor';
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
          {/* The backlog arrives through the register it belongs to, rather
              than through a navigation area of its own (v205, §38.1) — but
              behind the menu, since it is a migration tool, not daily work. */}
          <RegisterTools canCoordinate={access.canCoordinate} />
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
        {/*
         * The department applies on choosing it (v179's SubmitOnSelect), so
         * this button is only ever pressed by a browser without JavaScript,
         * or by somebody who has typed in the search box.
         */}
        <button className="btn" type="submit">
          Search
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
            <span>Finding</span>
            <span>Owner</span>
            <span>Next action</span>
            <span>Updated</span>
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

  /*
   * v214 - the row answers "who acts next" before anything else. It used to
   * carry a state chip, a due date, a held badge and a priority label and let
   * the reader assemble the answer; four labels to learn one thing.
   */
  const next = nextActor(row, now, timeZone);
  const due = row.dueAt
    ? row.isOverdue
      ? dueWords(row.dueAt, row.dueIsDateOnly, now, timeZone)
      : `Due ${dueWords(row.dueAt, row.dueIsDateOnly, now, timeZone)}`
    : null;

  return (
    <li>
      <Link
        href={`/findings/${row.findingId}${row.actionId ? `?action=${row.actionId}` : ''}`}
        className="esh-register-row"
      >
        <span className="esh-register-finding">
          <small>
            {row.reference}
            {row.location ? ` · ${row.location}` : ''}
            {row.isRestricted ? ' · Restricted' : ''}
          </small>
          {/*
           * The finding's own title leads: it is what people remember, what
           * they search for, and what the reference belongs to. An action
           * worded differently follows it rather than replacing it.
           */}
          <strong>{row.title}</strong>
          {row.actionTitle && row.actionTitle !== row.title && (
            <small>Action: {row.actionTitle}</small>
          )}
          <small>
            {[row.departmentName, `${RISK_LABELS[row.riskLevel]} risk`].filter(Boolean).join(' · ')}
          </small>
        </span>
        <span className="esh-register-owner">
          <span>{row.ownerEmail ?? 'No owner yet'}</span>
          {due && <small className={row.isOverdue ? 'esh-overdue' : undefined}>{due}</small>}
          {row.escalationLevel !== null && (
            <small className="esh-escalated">Escalated · level {row.escalationLevel}</small>
          )}
        </span>
        <span className="esh-register-next">
          <span className="esh-next-chip" data-tone={next.tone}>
            {next.headline}
          </span>
          <small>{next.detail}</small>
          {row.status === 'closed' && row.closedAt && (
            <small>Closed {shortDate(row.closedAt)}</small>
          )}
          {row.actionCount > 1 && <small>{row.actionCount} actions</small>}
        </span>
        <span className="esh-register-updated">{agoWords(row.lastUpdateAt, now)}</span>
      </Link>
    </li>
  );
}
