import Link from 'next/link';

import { SubmitOnSelect } from '@/components/ui/SubmitOnSelect';
import { CLOSED_PERIODS, closedPeriodFrom } from '@/domain/esh-verification';
import { requireProfile } from '@/lib/supabase/server';
import { requireEshAccess } from '@/server/esh/access';
import { listRegister, REGISTER_PAGE_SIZE } from '@/server/esh/queries';

/**
 * Closed findings (§24, visual reference 14): verified corrections and their
 * closure records, over a period ESH chooses. The same register definition as
 * every other list, so the counts never disagree.
 */
export default async function ClosedFindingsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; period?: string; page?: string }>;
}) {
  await requireEshAccess();
  const profile = await requireProfile();
  const query = await searchParams;
  const search = (query.q ?? '').trim().slice(0, 80);
  const days = closedPeriodFrom(query.period);
  const page = Math.max(1, Number.parseInt(query.page ?? '1', 10) || 1);
  const { rows, total, failed } = await listRegister({
    filter: 'closed',
    search,
    departmentId: null,
    closedWithinDays: days,
    page: page - 1,
  });
  const timeZone = profile.timezone ?? 'Asia/Kuala_Lumpur';
  const closedOn = (instant: string | null) =>
    instant
      ? new Intl.DateTimeFormat('en-MY', { dateStyle: 'medium', timeZone }).format(
          new Date(instant),
        )
      : 'Not recorded';
  const pages = Math.max(1, Math.ceil(total / REGISTER_PAGE_SIZE));
  const hrefFor = (next: { page?: number }) => {
    const params = new URLSearchParams();
    if (search) params.set('q', search);
    if (days !== 30) params.set('period', String(days));
    if (next.page && next.page > 1) params.set('page', String(next.page));
    const text = params.toString();
    return text ? `/findings/closed?${text}` : '/findings/closed';
  };

  return (
    <>
      <div className="pagehead">
        <div>
          <p className="eyebrow">Finding Management</p>
          <h1>Closed findings</h1>
          <p>Verified corrections and their closure records.</p>
        </div>
      </div>

      <form className="filterbar esh-register-search" role="search" action="/findings/closed">
        <label className="esh-register-search-text">
          <span>Search</span>
          <input name="q" defaultValue={search} placeholder="Search closed findings" />
        </label>
        <label>
          <span>Closed</span>
          <select name="period" defaultValue={String(days)}>
            {CLOSED_PERIODS.map((period) => (
              <option key={period.days} value={period.days}>
                {period.label}
              </option>
            ))}
          </select>
        </label>
        <button className="btn small" type="submit">
          Apply
        </button>
        <SubmitOnSelect />
      </form>

      {failed ? (
        <div className="notice error" role="alert">
          <strong>The closed findings could not be read</strong>
          <p>This is a problem on our side, not an empty list. Try again in a moment.</p>
        </div>
      ) : rows.length === 0 ? (
        <p className="guest-empty">
          {search ? 'Nothing matches that search.' : 'No findings were closed in this period.'}
        </p>
      ) : (
        <ul className="esh-register" aria-label="Closed findings">
          {rows.map((row) => (
            <li key={row.findingId}>
              <Link href={`/findings/${row.findingId}`} className="esh-register-row">
                <span className="esh-register-finding">
                  <small>
                    {[row.reference, row.location ?? row.departmentName]
                      .filter(Boolean)
                      .join(' · ')}
                  </small>
                  <strong>{row.title}</strong>
                  <small>
                    {row.ownerEmail ? `Owner: ${row.ownerEmail} · ` : ''}Verified by ESH · Closed{' '}
                    {closedOn(row.closedAt)}
                  </small>
                </span>
                <span className="esh-register-status">
                  <span className="flag green">Closed</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <div className="esh-register-foot">
        <p>
          {total} closed finding{total === 1 ? '' : 's'} in this period · Open any record to compare
          the original condition and the accepted correction.
        </p>
        {pages > 1 && (
          <nav className="esh-pager" aria-label="Pages">
            {page > 1 && <Link href={hrefFor({ page: page - 1 })}>← Previous</Link>}
            <span>
              Page {page} of {pages}
            </span>
            {page < pages && <Link href={hrefFor({ page: page + 1 })}>Next →</Link>}
          </nav>
        )}
      </div>
    </>
  );
}
