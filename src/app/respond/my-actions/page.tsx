import Link from 'next/link';

import { MyActionsList } from '@/components/esh/guest/MyActionsList';
import { GuestTopBar } from '@/components/esh/guest/GuestTopBar';
import { RequestInboxLink } from '@/components/esh/guest/RequestInboxLink';
import { RequestLinkForm } from '@/components/esh/guest/RequestLinkForm';
import { PRIORITY_LABELS } from '@/domain/esh-findings';
import {
  MY_ACTIONS_FILTERS,
  MY_ACTIONS_PAGE_SIZE,
  dueLine,
  myActionsFilterFrom,
} from '@/domain/esh-guest';
import { orgConfig } from '@/lib/env';
import { loadMyActions } from '@/server/esh/guest';

/**
 * My Actions (§10): every open action assigned to this email, and nothing
 * else — no other person's work, no menus, no way into the application. The
 * identity comes from the session, never from the address bar (§9).
 */
export default async function MyActionsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; q?: string; page?: string }>;
}) {
  const query = await searchParams;
  const filter = myActionsFilterFrom(query.filter);
  const search = (query.q ?? '').trim().slice(0, 120);
  const page = Math.max(1, Number.parseInt(query.page ?? '1', 10) || 1);
  const result = await loadMyActions(filter, search, page);
  const timeZone = orgConfig.timeZone;
  const now = new Date();

  if (result.kind === 'no_session') {
    return (
      <>
        <GuestTopBar identity="Secure access" />
        <main id="guest-main" className="guest-main guest-main-narrow">
          <section className="guest-card" aria-labelledby="guest-none-title">
            <span className="guest-card-icon" aria-hidden="true">
              ↗
            </span>
            <h1 id="guest-none-title">Your access on this device has ended</h1>
            <p className="guest-lead">
              Links last a limited time, for your security. Ask for a new one and we will send it to
              your assigned email.
            </p>
            <RequestLinkForm />
          </section>
        </main>
      </>
    );
  }

  if (result.kind === 'failed') {
    return (
      <>
        <GuestTopBar identity="Secure access" />
        <main id="guest-main" className="guest-main">
          <div className="notice error" role="alert">
            <strong>Your actions could not be loaded</strong>
            <p>This is a problem on our side, not an empty list. Try again in a moment.</p>
          </div>
        </main>
      </>
    );
  }

  if (result.kind === 'action_only') {
    return (
      <>
        <GuestTopBar identity="Action Owner" signedIn={{ email: result.email, inbox: false }} />
        <main id="guest-main" className="guest-main guest-main-narrow">
          <section className="guest-card" aria-labelledby="guest-scope-title">
            <h1 id="guest-scope-title">Your link opens one action</h1>
            <p className="guest-lead">
              To see every action assigned to {result.email}, use the View All My Actions link in
              your email, or we can send you one now.
            </p>
            <RequestInboxLink email={result.email} />
            {result.actions.length > 0 && (
              <ul className="guest-back-list">
                {result.actions.map((action) => (
                  <li key={action.id}>
                    <Link href={`/respond/actions/${action.id}`} className="guest-link">
                      ← Back to {action.reference} · {action.title}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </main>
      </>
    );
  }

  const totalOpen = result.counts.needs + result.counts.review;
  const pages = Math.max(1, Math.ceil(result.total / MY_ACTIONS_PAGE_SIZE));
  const hrefFor = (next: { filter?: string; page?: number }) => {
    const params = new URLSearchParams();
    const nextFilter = next.filter ?? filter;
    if (nextFilter !== 'needs') params.set('filter', nextFilter);
    if (search) params.set('q', search);
    if (next.page && next.page > 1) params.set('page', String(next.page));
    const text = params.toString();
    return text ? `/respond/my-actions?${text}` : '/respond/my-actions';
  };

  return (
    <>
      <GuestTopBar identity="Action Owner" signedIn={{ email: result.email, inbox: true }} />
      <main id="guest-main" className="guest-main">
        <h1 className="guest-title">My Actions</h1>
        <p className="guest-email">{result.email}</p>

        <nav className="esh-filter-tabs guest-tabs" aria-label="Filter actions">
          {MY_ACTIONS_FILTERS.map((option) => (
            <Link
              key={option.key}
              href={hrefFor({ filter: option.key })}
              aria-current={option.key === filter ? 'page' : undefined}
            >
              {option.label} <span className="guest-tab-count">{result.counts[option.key]}</span>
            </Link>
          ))}
        </nav>

        {(totalOpen > 10 || search) && (
          <form className="filterbar guest-search" role="search" action="/respond/my-actions">
            {filter !== 'needs' && <input type="hidden" name="filter" value={filter} />}
            <label className="guest-search-field">
              <span className="visually-hidden">Search your actions</span>
              <input
                name="q"
                defaultValue={search}
                placeholder="Search by reference, title or place"
              />
            </label>
            <button type="submit" className="btn small">
              Search
            </button>
          </form>
        )}

        {result.rows.length === 0 ? (
          <p className="guest-empty">
            {search
              ? 'Nothing matches that search.'
              : filter === 'review'
                ? 'Nothing is waiting for ESH review.'
                : totalOpen === 0
                  ? 'You have no open actions assigned to this email.'
                  : 'Nothing needs your action. ESH is reviewing the rest.'}
          </p>
        ) : (
          <MyActionsList
            rows={result.rows.map((row) => {
              const due = dueLine(row, now, timeZone);
              return {
                id: row.id,
                reference: row.reference,
                title: row.title,
                place: row.department ?? row.location ?? '',
                dueText: due.text,
                overdue: due.overdue,
                turn: row.state === 'awaiting_verification' ? 'Waiting for ESH' : 'Owner action',
                priorityLabel:
                  row.priority && row.priority !== 'normal' ? PRIORITY_LABELS[row.priority] : null,
              };
            })}
          />
        )}

        {pages > 1 && (
          <nav className="esh-pager guest-pager" aria-label="Pages">
            {page > 1 && <Link href={hrefFor({ page: page - 1 })}>← Previous</Link>}
            <span>
              Page {page} of {pages}
            </span>
            {page < pages && <Link href={hrefFor({ page: page + 1 })}>Next →</Link>}
          </nav>
        )}

        <p className="guest-footnote">
          {totalOpen} open action{totalOpen === 1 ? '' : 's'} · Only actions assigned to your email
        </p>
      </main>
    </>
  );
}
