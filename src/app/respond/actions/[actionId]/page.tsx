import Link from 'next/link';

import { Conversation } from '@/components/esh/Conversation';
import { EndAccessButton } from '@/components/esh/guest/EndAccessButton';
import { GuestTopBar } from '@/components/esh/guest/GuestTopBar';
import { OwnerComposer } from '@/components/esh/guest/OwnerComposer';
import { RequestLinkForm } from '@/components/esh/guest/RequestLinkForm';
import { evidenceLabel } from '@/domain/esh-evidence';
import { ACTION_STATE_LABELS } from '@/domain/esh-findings';
import { firstName } from '@/domain/esh-guest';
import { orgConfig } from '@/lib/env';
import { loadGuestAction } from '@/server/esh/guest';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The owner's action (§11): a compact header, the conversation and the
 * composer — three areas, no forms, no tabs. Every load asks the database
 * again whether this session still reaches the action (§20), so a
 * reassignment or a switched-off contact is honoured on the next request.
 */
export default async function GuestActionPage({
  params,
  searchParams,
}: {
  params: Promise<{ actionId: string }>;
  searchParams: Promise<{ before?: string }>;
}) {
  const { actionId } = await params;
  const query = await searchParams;
  const before =
    query.before && !Number.isNaN(Date.parse(query.before))
      ? new Date(query.before).toISOString()
      : null;
  const result = UUID.test(actionId)
    ? await loadGuestAction(actionId, before)
    : ({ kind: 'not_available', inboxScope: false } as const);
  const timeZone = orgConfig.timeZone;

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
            <strong>This action could not be loaded</strong>
            <p>This is a problem on our side. Try again in a moment.</p>
          </div>
        </main>
      </>
    );
  }

  if (result.kind === 'not_available') {
    return (
      <>
        <GuestTopBar identity="Secure access" />
        <main id="guest-main" className="guest-main guest-main-narrow">
          <section className="guest-card" aria-labelledby="guest-gone-title">
            <h1 id="guest-gone-title">This action is not available</h1>
            <p className="guest-lead">
              It may have been completed, closed or given to someone else. If you think it is still
              yours, contact ESH.
            </p>
            {result.inboxScope && (
              <Link href="/respond/my-actions" className="guest-link">
                ← My Actions
              </Link>
            )}
          </section>
        </main>
      </>
    );
  }

  const { data } = result;
  const due = data.action.dueAt
    ? new Intl.DateTimeFormat('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        ...(data.action.dueIsDateOnly
          ? {}
          : { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }),
        timeZone,
      }).format(new Date(data.action.dueAt))
    : null;
  const identity = `${data.displayName ?? data.email} · Action Owner`;
  const earliest = data.messages[0]?.sentAt;
  const awaitingReview = data.action.state === 'awaiting_verification';

  return (
    <>
      <GuestTopBar identity={identity} />
      <main id="guest-main" className="guest-main">
        <Link href="/respond/my-actions" className="esh-back-link">
          ← My Actions
        </Link>
        <p className="guest-eyebrow">
          {[data.finding.reference, data.finding.location ?? data.finding.department]
            .filter(Boolean)
            .join(' · ')}
        </p>
        <h1 className="guest-title">{data.action.title}</h1>
        <span className="flag neutral guest-state">{ACTION_STATE_LABELS[data.action.state]}</span>
        <p className="guest-meta">
          {[due ? `Due ${due}` : null, `Owner: ${data.displayName ?? data.email}`]
            .filter(Boolean)
            .join(' · ')}
        </p>
        {data.action.requiredOutcome && (
          <p className="guest-outcome">{data.action.requiredOutcome}</p>
        )}
        <details className="guest-original">
          <summary>Original finding &amp; evidence</summary>
          <dl className="esh-facts">
            <div>
              <dt>Finding</dt>
              <dd>{data.finding.title}</dd>
            </div>
            {data.finding.description && (
              <div>
                <dt>What was found</dt>
                <dd className="esh-detail-text">{data.finding.description}</dd>
              </div>
            )}
            {data.finding.department && (
              <div>
                <dt>Department</dt>
                <dd>{data.finding.department}</dd>
              </div>
            )}
            <div>
              <dt>Evidence ESH needs</dt>
              <dd>
                {data.action.evidenceInstruction ??
                  (data.action.evidenceRule === 'file_required'
                    ? 'A short result and at least one file'
                    : 'A short result')}
              </dd>
            </div>
            {(data.eshContact.name || data.eshContact.email) && (
              <div>
                <dt>ESH contact</dt>
                <dd>
                  {[
                    data.eshContact.name ? firstName(data.eshContact.name) : null,
                    data.eshContact.email,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </dd>
              </div>
            )}
          </dl>
          {data.originalEvidence.length > 0 && (
            <ul className="esh-file-list guest-original-files" aria-label="Original evidence">
              {data.originalEvidence.map((file) => (
                <li key={file.id} className="esh-file">
                  <a href={`/respond/files/${file.id}`} target="_blank" rel="noopener noreferrer">
                    <span className="esh-file-icon" aria-hidden="true">
                      ▧
                    </span>
                    <span>
                      <strong>{file.name}</strong>
                      <small>{evidenceLabel(file.name, file.size)}</small>
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </details>

        <section className="guest-thread" aria-label="Conversation with ESH">
          {data.hasMore && earliest && (
            <Link
              href={`/respond/actions/${data.action.id}?before=${encodeURIComponent(earliest)}`}
              className="guest-link guest-earlier"
            >
              Show earlier messages
            </Link>
          )}
          {before && (
            <Link href={`/respond/actions/${data.action.id}`} className="guest-link guest-earlier">
              Back to the latest messages
            </Link>
          )}
          <Conversation
            entries={data.messages}
            viewer="owner"
            timeZone={timeZone}
            now={new Date()}
            fileBase="/respond/files"
            submissions={data.submissions}
            submitFor={awaitingReview ? null : data.action.id}
            emptyText="No messages yet. Send ESH an update when you start, or ask a question."
          />
        </section>

        {!before && (
          <OwnerComposer
            actionId={data.action.id}
            awaitingReview={awaitingReview}
            fileRequired={data.action.evidenceRule === 'file_required'}
            drafts={data.drafts}
          />
        )}
        <EndAccessButton />
      </main>
    </>
  );
}
