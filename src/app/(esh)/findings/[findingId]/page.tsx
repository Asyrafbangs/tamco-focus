import Link from 'next/link';
import { notFound } from 'next/navigation';

import { Conversation } from '@/components/esh/Conversation';
import { FindingForm } from '@/components/esh/FindingForm';
import { ReleaseNotificationButton } from '@/components/esh/ReleaseNotificationButton';
import { StaffMessageForm } from '@/components/esh/StaffMessageForm';
import {
  ACTION_STATE_LABELS,
  FINDING_STATUS_LABELS,
  FINDING_WARNING_MESSAGES,
  PRIORITY_LABELS,
  RISK_LABELS,
  SOURCE_LABELS,
} from '@/domain/esh-findings';
import { requireProfile } from '@/lib/supabase/server';
import { requireEshAccess } from '@/server/esh/access';
import {
  getDepartmentsInScope,
  getFindingDetail,
  getVerifiers,
  type FindingDetail,
} from '@/server/esh/queries';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const HISTORY_LABELS: Record<string, string> = {
  finding_created: 'Finding recorded',
  finding_draft_saved: 'Draft saved',
  action_assigned: 'Action assigned',
  action_started: 'Owner started the work',
  owner_message: 'Owner sent an update',
  esh_message: 'ESH wrote to the owner',
  notification_released: 'Email released',
  notification_sent: 'Email accepted by the mail server',
  guest_link_redeemed: 'Owner opened a secure link',
  guest_link_requested: 'New link requested',
};

const NOTIFICATION_KIND_LABELS: Record<string, string> = {
  owner_assignment: 'Assignment email',
  esh_reply: 'Reply notice',
  access_link: 'Requested link',
};

const NOTIFICATION_REASON_LABELS: Record<string, string> = {
  covered_by_assignment_email: 'Not needed: the assignment email opens the same conversation.',
  no_longer_the_owner: 'Not sent: the address no longer owns the action.',
  access_not_enabled: 'Not sent: the contact’s access is off.',
  access_disabled: 'Stopped: the contact’s access was switched off.',
};

const NOTIFICATION_STATE_LABELS: Record<string, string> = {
  held_rollout: 'Held — access not enabled',
  queued: 'Queued to send',
  processing: 'Sending',
  provider_accepted: 'Accepted by the mail server',
  failed: 'Failed',
  suppressed: 'Not sent',
  cancelled: 'Cancelled',
};

/**
 * One finding (§13, §24). A draft opens in the form it was started in; an
 * assigned finding is read here — the owner's conversation, evidence and
 * verification join this page in the stages that build them.
 */
export default async function FindingPage({
  params,
  searchParams,
}: {
  params: Promise<{ findingId: string }>;
  searchParams: Promise<{ saved?: string; warn?: string }>;
}) {
  const access = await requireEshAccess();
  const profile = await requireProfile();
  const { findingId } = await params;
  const query = await searchParams;
  if (!UUID.test(findingId)) notFound();
  const finding = await getFindingDetail(findingId);
  if (!finding) notFound();

  const timeZone = profile.timezone ?? 'Asia/Kuala_Lumpur';
  const warnings = (query.warn ?? '')
    .split(',')
    .map((code) => FINDING_WARNING_MESSAGES[code])
    .filter((message): message is string => Boolean(message));

  const notices = (
    <>
      {query.saved === 'assigned' && (
        <div className="notice success" role="status">
          <strong>Finding assigned</strong>
          <p>
            {finding.reference} is open.{' '}
            {finding.notifications.some((entry) => entry.state === 'held_rollout')
              ? 'The owner has not been emailed yet: their access is not enabled.'
              : 'The owner is being emailed a secure link.'}
          </p>
        </div>
      )}
      {query.saved === 'draft' && (
        <div className="notice success" role="status">
          <strong>Draft saved</strong>
          <p>Nothing has been sent. Assign it when it is ready.</p>
        </div>
      )}
      {warnings.map((message) => (
        <div key={message} className="notice warn" role="status">
          <p>{message}</p>
        </div>
      ))}
    </>
  );

  if (finding.status === 'draft' && access.canCoordinate && finding.action) {
    const [departments, verifiers] = await Promise.all([
      getDepartmentsInScope(access),
      getVerifiers(),
    ]);
    const escalation: Record<number, string[]> = {};
    for (const entry of finding.action.escalation) {
      (escalation[entry.level] ??= []).push(entry.email);
    }
    const dayOf = (instant: string | null) =>
      instant ? new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date(instant)) : '';
    const timeOf = (instant: string | null) =>
      instant && finding.action && !finding.action.dueIsDateOnly
        ? new Intl.DateTimeFormat('en-GB', {
            hour: '2-digit',
            minute: '2-digit',
            hourCycle: 'h23',
            timeZone,
          }).format(new Date(instant))
        : '';
    return (
      <>
        <Link href="/findings/register" className="esh-back-link">
          ← Finding Register
        </Link>
        <div className="pagehead">
          <div>
            <p className="eyebrow">{finding.reference} · Draft</p>
            <h1>{finding.title}</h1>
            <p>Finish the details and assign it, or keep it as a draft.</p>
          </div>
        </div>
        {notices}
        <FindingForm
          departments={departments}
          verifiers={verifiers}
          initial={{
            findingId: finding.id,
            reference: finding.reference,
            title: finding.title,
            description: finding.description ?? '',
            source: finding.source,
            sourceReference: finding.sourceReference ?? '',
            reportedOn: finding.reportedOn ?? '',
            location: finding.location ?? '',
            departmentId: finding.departmentId ?? '',
            riskLevel: finding.riskLevel,
            isRestricted: finding.isRestricted,
            requiredOutcome: finding.action.requiredOutcome ?? '',
            evidenceInstruction: finding.action.evidenceInstruction ?? '',
            priority: finding.action.priority ?? '',
            ownerEmail: finding.action.draftOwnerEmail ?? '',
            dueDate: dayOf(finding.action.dueAt),
            dueTime: timeOf(finding.action.dueAt),
            reviewerUserId: finding.action.reviewerUserId ?? '',
            escalation,
            noFurtherEscalationReason: finding.action.noFurtherEscalationReason ?? '',
          }}
        />
      </>
    );
  }

  return (
    <>
      <Link href="/findings/register" className="esh-back-link">
        ← Finding Register
      </Link>
      <div className="pagehead">
        <div>
          <p className="eyebrow">
            {[finding.reference, finding.location, finding.departmentName]
              .filter(Boolean)
              .join(' · ')}
          </p>
          <h1>{finding.title}</h1>
        </div>
        <span className="flag neutral esh-status-flag">
          {finding.status === 'open' && finding.action
            ? ACTION_STATE_LABELS[finding.action.state]
            : FINDING_STATUS_LABELS[finding.status]}
        </span>
      </div>
      {notices}
      <FindingSummary finding={finding} timeZone={timeZone} canCoordinate={access.canCoordinate} />
    </>
  );
}

function FindingSummary({
  finding,
  timeZone,
  canCoordinate,
}: {
  finding: FindingDetail;
  timeZone: string;
  canCoordinate: boolean;
}) {
  const dateTime = (instant: string, dateOnly = false) =>
    new Intl.DateTimeFormat('en-MY', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      ...(dateOnly ? {} : { hour: '2-digit', minute: '2-digit' }),
      timeZone,
    }).format(new Date(instant));
  const action = finding.action;
  const actionOpen =
    finding.status === 'open' &&
    Boolean(action && ['assigned', 'in_progress', 'awaiting_verification'].includes(action.state));
  // The owner can read a reply only once their access is on and the
  // assignment email has actually been released to them.
  const assignmentHeld = finding.notifications.some(
    (entry) => entry.eventType === 'owner_assignment' && entry.state === 'held_rollout',
  );
  const ownerReachable = Boolean(action?.ownerAccessEnabled) && !assignmentHeld;

  return (
    <div className="esh-detail">
      <section className="esh-form-card" aria-labelledby="esh-detail-finding">
        <h2 id="esh-detail-finding" className="esh-form-card-title">
          The finding
        </h2>
        {finding.description && <p className="esh-detail-text">{finding.description}</p>}
        <dl className="esh-facts">
          <div>
            <dt>Reported</dt>
            <dd>
              {finding.reportedOn
                ? dateTime(`${finding.reportedOn}T12:00:00Z`, true)
                : 'Not recorded'}
            </dd>
          </div>
          <div>
            <dt>Source</dt>
            <dd>
              {SOURCE_LABELS[finding.source]}
              {finding.sourceReference ? ` · ${finding.sourceReference}` : ''}
            </dd>
          </div>
          <div>
            <dt>Accountable department</dt>
            <dd>{finding.departmentName ?? 'Not set'}</dd>
          </div>
          <div>
            <dt>Risk</dt>
            <dd>{RISK_LABELS[finding.riskLevel]}</dd>
          </div>
          <div>
            <dt>Recorded by</dt>
            <dd>
              {finding.createdByName} · {dateTime(finding.createdAt)}
            </dd>
          </div>
          {finding.isRestricted && (
            <div>
              <dt>Visibility</dt>
              <dd>Restricted — excluded from leadership reports</dd>
            </div>
          )}
        </dl>
      </section>

      {action && (
        <section className="esh-form-card" aria-labelledby="esh-detail-action">
          <h2 id="esh-detail-action" className="esh-form-card-title">
            Corrective action
          </h2>
          {action.requiredOutcome && <p className="esh-detail-text">{action.requiredOutcome}</p>}
          <dl className="esh-facts">
            <div>
              <dt>Action Owner</dt>
              <dd>{action.ownerEmail ?? 'Not assigned'}</dd>
            </div>
            <div>
              <dt>Due</dt>
              <dd>
                {action.dueAt
                  ? `${dateTime(action.dueAt, action.dueIsDateOnly)}${action.dueIsDateOnly ? ' (end of day, 17:00)' : ''}`
                  : 'Not set'}
                {action.baselineDueAt && action.dueAt && action.baselineDueAt !== action.dueAt
                  ? ` · originally ${dateTime(action.baselineDueAt, action.dueIsDateOnly)}`
                  : ''}
              </dd>
            </div>
            <div>
              <dt>Priority</dt>
              <dd>{action.priority ? PRIORITY_LABELS[action.priority] : 'Not set'}</dd>
            </div>
            <div>
              <dt>Completion evidence</dt>
              <dd>{action.evidenceInstruction ?? 'A result and at least one file'}</dd>
            </div>
            <div>
              <dt>ESH reviewer</dt>
              <dd>{action.reviewerName ?? 'Verification queue — any ESH Verifier'}</dd>
            </div>
          </dl>

          <h3 className="esh-subheading">Escalation route</h3>
          {action.escalation.length > 0 ? (
            <>
              <ul className="esh-route">
                {Array.from(new Set(action.escalation.map((entry) => entry.level)))
                  .sort((a, b) => a - b)
                  .map((level) => (
                    <li key={level}>
                      <span>Level {level}</span>
                      <span>
                        {action.escalation
                          .filter((entry) => entry.level === level)
                          .map((entry) => entry.email)
                          .join(', ')}
                      </span>
                    </li>
                  ))}
              </ul>
              <p className="form-hint">
                Configured, not active. Each level is told only when the action becomes overdue
                enough to reach it.
              </p>
            </>
          ) : (
            <p className="esh-detail-text">
              No further escalation
              {action.noFurtherEscalationReason ? `: ${action.noFurtherEscalationReason}` : '.'}
            </p>
          )}
        </section>
      )}

      {action && action.state !== 'draft' && (
        <section className="esh-form-card" aria-labelledby="esh-detail-conversation">
          <h2 id="esh-detail-conversation" className="esh-form-card-title">
            Conversation with the owner
          </h2>
          <Conversation
            entries={finding.conversation}
            viewer="staff"
            timeZone={timeZone}
            now={new Date()}
            emptyText="No messages yet. The owner’s updates and ESH replies appear here."
          />
          {canCoordinate && actionOpen && (
            <StaffMessageForm
              actionId={action.id}
              findingId={finding.id}
              ownerReachable={ownerReachable}
            />
          )}
        </section>
      )}

      {finding.notifications.length > 0 && (
        <section className="esh-form-card" aria-labelledby="esh-detail-notices">
          <h2 id="esh-detail-notices" className="esh-form-card-title">
            Notifications
          </h2>
          <ul className="esh-route">
            {finding.notifications.map((entry) => (
              <li key={entry.id}>
                <span>
                  {entry.recipient ?? 'Recipient'}
                  <small className="esh-notice-kind">
                    {NOTIFICATION_KIND_LABELS[entry.eventType] ?? entry.eventType}
                  </small>
                </span>
                <span>
                  {entry.stoppedRetrying
                    ? 'Failed — the mail server refused it. Check the address.'
                    : entry.state === 'held_rollout' && entry.recipientEnabled
                      ? 'Held — not yet released. Their access is on; release it when ready.'
                      : (NOTIFICATION_STATE_LABELS[entry.state] ?? entry.state)}
                  {entry.state === 'held_rollout' && !entry.recipientEnabled
                    ? '. Sent once an administrator enables this contact and ESH releases it.'
                    : ''}
                  {entry.state === 'suppressed' && entry.stateReason
                    ? ` · ${NOTIFICATION_REASON_LABELS[entry.stateReason] ?? entry.stateReason}`
                    : ''}
                  {entry.state === 'held_rollout' &&
                    entry.recipientEnabled &&
                    canCoordinate &&
                    entry.recipient &&
                    // A reply notice follows the assignment email, never leads it.
                    (entry.eventType === 'owner_assignment' || !assignmentHeld) && (
                      <ReleaseNotificationButton
                        outboxId={entry.id}
                        findingId={finding.id}
                        recipient={entry.recipient}
                        kind={(NOTIFICATION_KIND_LABELS[entry.eventType] ?? 'email').toLowerCase()}
                      />
                    )}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="esh-form-card" aria-labelledby="esh-detail-history">
        <h2 id="esh-detail-history" className="esh-form-card-title">
          History
        </h2>
        <ol className="esh-history">
          {finding.history.map((entry, index) => (
            <li key={`${entry.eventType}-${entry.occurredAt}-${index}`}>
              <strong>{HISTORY_LABELS[entry.eventType] ?? entry.eventType}</strong>
              <span>
                {entry.actorName} · {dateTime(entry.occurredAt)}
              </span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
