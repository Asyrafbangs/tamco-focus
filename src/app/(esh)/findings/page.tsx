import Link from 'next/link';

import { HeldNoticesRelease } from '@/components/esh/HeldNoticesRelease';
import { OperationalHealth } from '@/components/esh/OperationalHealth';
import { requireProfile } from '@/lib/supabase/server';
import { requireEshAccess } from '@/server/esh/access';
import {
  getDashboard,
  getOperationalHealth,
  getRolloutStatus,
  listRegister,
  listVerificationQueue,
  type RegisterListRow,
  type VerificationQueueRow,
} from '@/server/esh/queries';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Daily decisions belong here; historical measures remain in Patterns. */
export default async function FindingsTodayPage({
  searchParams,
}: {
  searchParams: Promise<{ queue?: string; department?: string }>;
}) {
  const access = await requireEshAccess();
  const profile = await requireProfile();
  const now = new Date();
  const timeZone = profile.timezone ?? 'Asia/Kuala_Lumpur';
  const query = await searchParams;
  const verificationOnly = query.queue === 'verification';
  const departmentUnassigned = query.department === 'unassigned';
  const departmentId = query.department && UUID.test(query.department) ? query.department : null;
  const verificationHref = (() => {
    const params = new URLSearchParams({ queue: 'verification' });
    if (departmentUnassigned) params.set('department', 'unassigned');
    else if (departmentId) params.set('department', departmentId);
    return `/findings?${params}`;
  })();
  const [dashboard, attention, verification, health, rollout] = await Promise.all([
    getDashboard(),
    listRegister({
      filter: 'attention',
      search: '',
      departmentId,
      departmentUnassigned,
      closedSince: now.toISOString(),
      closedUntil: null,
      page: 0,
    }),
    listVerificationQueue(departmentId, departmentUnassigned),
    getOperationalHealth(),
    access.canCoordinate ? getRolloutStatus() : Promise.resolve(null),
  ]);

  const protection = dashboard?.protection.unprotected ?? 0;
  const overdue = dashboard?.overdueActions ?? 0;
  const awaiting = dashboard?.awaitingVerification ?? verification.length;

  return (
    <>
      <div className="pagehead esh-today-head">
        <div>
          <p className="eyebrow">Finding Management</p>
          <h1>{verificationOnly ? 'To verify' : 'Today'}</h1>
          <p>
            {verificationOnly
              ? 'Corrections submitted for ESH to check, oldest first.'
              : 'What needs a decision now, and who owes the next move.'}
          </p>
        </div>
        {access.canCoordinate && (
          <Link className="btn primary" href="/findings/new">
            + New finding
          </Link>
        )}
      </div>

      {!verificationOnly && (
        <section className="esh-signals esh-today-signals" aria-label="Today’s queues">
          <Signal label="New reports" value={0} detail="QR intake is not enabled" disabled />
          <Signal
            label="Significant risks without verified protection"
            value={protection}
            detail="High or critical open findings"
            href="/findings/register?filter=open"
            exception={protection > 0}
          />
          <Signal
            label="Overdue owner actions"
            value={overdue}
            detail="Owner action is still due"
            href="/findings/register?filter=overdue"
            exception={overdue > 0}
          />
          <Signal
            label="Waiting for ESH verification"
            value={awaiting}
            detail="Submitted proof needs a decision"
            href={verificationHref}
            exception={awaiting > 0}
          />
        </section>
      )}

      {!verificationOnly && <OperationalHealth health={health} />}
      {!verificationOnly && rollout && <HeldNoticesRelease releasable={rollout.heldReleasable} />}

      {!verificationOnly && (
        <section className="esh-today-queue" aria-labelledby="today-queue-title">
          <div className="esh-section-head">
            <div>
              <h2 id="today-queue-title">Needs attention</h2>
              <p>One row per finding. The reason labels identify the current work.</p>
            </div>
            <Link href="/findings/register?filter=attention">Open all</Link>
          </div>
          {attention.failed ? (
            <div className="notice error" role="alert">
              <strong>The queue could not be read</strong>
              <p>No rows are shown rather than a list that might be incomplete.</p>
            </div>
          ) : attention.rows.length === 0 ? (
            <QueueEmpty
              title="No items need attention"
              detail="No open finding currently needs an ESH decision."
            />
          ) : (
            <ul className="esh-today-list" aria-label="Needs attention">
              {attention.rows.map((row) => (
                <AttentionRow key={row.actionId ?? row.findingId} row={row} />
              ))}
            </ul>
          )}
        </section>
      )}

      <div className={verificationOnly ? '' : 'esh-today-columns'}>
        <section className="esh-form-card" aria-labelledby="today-verification-title">
          <div className="esh-section-head">
            <div>
              <h2 id="today-verification-title">To verify</h2>
              <p>Owner submissions, oldest first.</p>
            </div>
            <Link href={verificationHref}>Open queue</Link>
          </div>
          {verification.length === 0 ? (
            <QueueEmpty
              title="No actions waiting for verification"
              detail="Submitted work will appear here when ESH has the next move."
            />
          ) : (
            <ul className="esh-today-list">
              {verification.slice(0, 6).map((row) => (
                <VerificationRow key={row.submissionId} row={row} timeZone={timeZone} />
              ))}
            </ul>
          )}
        </section>
        {!verificationOnly && (
          <section className="esh-form-card" aria-labelledby="today-incoming-title">
            <div className="esh-section-head">
              <div>
                <h2 id="today-incoming-title">Incoming reports</h2>
                <p>Public QR reporting is not enabled in this environment.</p>
              </div>
            </div>
            <QueueEmpty
              title="No incoming reports"
              detail="This queue remains intentionally empty until the approved Stage 2 rollout enables QR intake."
            />
          </section>
        )}
        {!verificationOnly && (
          <section className="esh-form-card" aria-labelledby="today-escalations-title">
            <div className="esh-section-head">
              <div>
                <h2 id="today-escalations-title">Escalations</h2>
                <p>Delivery failures and overdue work remain with the affected finding.</p>
              </div>
              <Link href="/findings/register?filter=attention">Review</Link>
            </div>
            <QueueEmpty
              title="No separate escalation queue"
              detail="Keeping escalation with the finding preserves the owner, protection and due-date context."
            />
          </section>
        )}
      </div>
    </>
  );
}

function Signal({
  label,
  value,
  detail,
  href,
  exception = false,
  disabled = false,
}: {
  label: string;
  value: number;
  detail: string;
  href?: string;
  exception?: boolean;
  disabled?: boolean;
}) {
  const content = (
    <>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </>
  );
  return href ? (
    <Link className="esh-signal" data-exception={exception || undefined} href={href}>
      {content}
    </Link>
  ) : (
    <div className="esh-signal" data-disabled={disabled || undefined}>
      {content}
    </div>
  );
}

function AttentionRow({ row }: { row: RegisterListRow }) {
  const reasons = [
    row.isOverdue && 'Overdue owner action',
    row.actionState === 'awaiting_verification' && 'Waiting for ESH verification',
    row.notificationFailed && 'Notification needs attention',
    row.changesRequested && 'Owner needs to improve proof',
  ].filter((value): value is string => Boolean(value));
  const href = row.actionId
    ? `/findings/${row.findingId}?action=${row.actionId}`
    : `/findings/${row.findingId}`;
  return (
    <li>
      <Link href={href}>
        <span className="esh-today-row-main">
          <strong>{row.reference}</strong>
          <b>{row.title}</b>
          <small>{[row.location, row.departmentName].filter(Boolean).join(' · ')}</small>
        </span>
        <span className="esh-today-row-reasons">
          {reasons.map((reason) => (
            <small key={reason}>{reason}</small>
          ))}
        </span>
      </Link>
    </li>
  );
}

function VerificationRow({ row, timeZone }: { row: VerificationQueueRow; timeZone: string }) {
  const submitted = new Intl.DateTimeFormat('en-MY', {
    day: 'numeric',
    month: 'short',
    timeZone,
  }).format(new Date(row.submittedAt));
  return (
    <li>
      <Link href={`/findings/${row.findingId}?action=${row.actionId}&review=1`}>
        <span className="esh-today-row-main">
          <strong>{row.reference}</strong>
          <b>{row.title}</b>
          <small>{[row.location, `Submitted ${submitted}`].filter(Boolean).join(' · ')}</small>
        </span>
      </Link>
    </li>
  );
}

function QueueEmpty({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="empty-state compact">
      <h3>{title}</h3>
      <p>{detail}</p>
    </div>
  );
}
