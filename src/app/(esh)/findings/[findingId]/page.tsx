import Link from 'next/link';
import { notFound } from 'next/navigation';

import { Conversation } from '@/components/esh/Conversation';
import { ActionMenu } from '@/components/esh/ActionMenu';
import { OriginalEvidence } from '@/components/esh/OriginalEvidence';
import { FindingOutcome } from '@/components/esh/FindingOutcome';
import { ReopenFinding } from '@/components/esh/ReopenFinding';
import { VerifyPanel } from '@/components/esh/VerifyPanel';
import { FindingForm } from '@/components/esh/FindingForm';
import { nextActor } from '@/domain/esh-next-actor';
import { EnableContactInline } from '@/components/esh/EnableContactInline';
import { ReleaseNotificationButton } from '@/components/esh/ReleaseNotificationButton';
import { StaffMessageForm } from '@/components/esh/StaffMessageForm';
import { evidenceLabel } from '@/domain/esh-evidence';
import { VERIFICATION_METHOD_LABELS, type VerificationMethod } from '@/domain/esh-verification';
import {
  ACTION_STATE_LABELS,
  canonicalEmail,
  FINDING_STATUS_LABELS,
  FINDING_WARNING_MESSAGES,
  PRIORITY_LABELS,
  OUTCOME_LABELS,
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
  submission_created: 'Owner submitted for review',
  submission_accepted: 'ESH accepted the correction',
  changes_requested: 'ESH asked for more',
  finding_closed: 'Finding closed',
  finding_reopened: 'Finding reopened',
  due_changed: 'Due date changed',
  action_reassigned: 'Action given to another owner',
  submission_withdrawn: 'Owner withdrew a submission',
  original_evidence_added: 'Original evidence added',
  original_evidence_removed: 'Original evidence removed',
};

const NOTIFICATION_KIND_LABELS: Record<string, string> = {
  owner_assignment: 'Assignment email',
  esh_reply: 'Reply notice',
  access_link: 'Requested link',
  submission_received: 'Review request',
  submission_withdrawn: 'Withdrawal notice',
  changes_requested: 'More needed notice',
  due_changed: 'Due date notice',
  finding_closed: 'Closure notice',
  finding_reopened: 'Reopening notice',
  reassigned_away: 'Handover notice',
};

const NOTIFICATION_REASON_LABELS: Record<string, string> = {
  covered_by_assignment_email: 'Not needed: the assignment email opens the same conversation.',
  no_longer_the_owner: 'Not sent: the address no longer owns the action.',
  no_longer_pending: 'Not sent: the submission was withdrawn first.',
  no_longer_esh: 'Not sent: they can no longer review this finding.',
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
  searchParams: Promise<{ saved?: string; warn?: string; action?: string }>;
}) {
  const access = await requireEshAccess();
  const profile = await requireProfile();
  const { findingId } = await params;
  const query = await searchParams;
  if (!UUID.test(findingId)) notFound();
  const actionId = query.action && UUID.test(query.action) ? query.action : null;
  const finding = await getFindingDetail(findingId, actionId);
  if (!finding) notFound();
  if (actionId && !finding.action) notFound();

  const timeZone = profile.timezone ?? 'Asia/Kuala_Lumpur';
  // Read once on the server: `react-hooks/purity` forbids a clock in render.
  const now = new Date();
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
      {/*
       * v214 - the same sentence the register shows, from the same rule: who
       * has to act next, and by when. A reader should not have to assemble it
       * from a state chip, a date and a notification row.
       */}
      {(() => {
        const next = nextActor(
          {
            status: finding.status,
            actionState: finding.action?.state ?? null,
            ownerEmail: finding.action?.ownerEmail ?? null,
            dueAt: finding.action?.dueAt ?? null,
            dueIsDateOnly: Boolean(finding.action?.dueIsDateOnly),
            isOverdue: Boolean(
              finding.action &&
              finding.action.dueAt &&
              ['assigned', 'in_progress'].includes(finding.action.state) &&
              new Date(finding.action.dueAt).getTime() < now.getTime(),
            ),
            notificationHeld: finding.notifications.some((entry) => entry.state === 'held_rollout'),
            notificationFailed: finding.notifications.some((entry) => entry.stoppedRetrying),
            lastUpdateAt: finding.action?.assignedAt ?? finding.createdAt,
          },
          now,
          timeZone,
        );
        return next.kind === 'settled' ? null : (
          <p className="esh-next-banner" data-tone={next.tone}>
            <strong>{next.headline}</strong>
            <span>{next.detail}</span>
          </p>
        );
      })()}
      {notices}
      <FindingSummary
        finding={finding}
        timeZone={timeZone}
        canCoordinate={access.canCoordinate}
        canVerify={access.canVerify}
        viewerEmail={profile.email}
        isAdministrator={profile.role === 'administrator'}
      />
    </>
  );
}

/** A list of files, each opened through the staff file route. */
function FileList({ files, label }: { files: FindingDetail['originalEvidence']; label: string }) {
  if (files.length === 0) return <p className="form-hint">None.</p>;
  return (
    <ul className="esh-file-list" aria-label={label}>
      {files.map((file) => (
        <li key={file.id} className="esh-file">
          <a href={`/findings/files/${file.id}`} target="_blank" rel="noopener noreferrer">
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
  );
}

function FindingSummary({
  finding,
  timeZone,
  canCoordinate,
  canVerify,
  viewerEmail,
  isAdministrator,
}: {
  finding: FindingDetail;
  timeZone: string;
  canCoordinate: boolean;
  canVerify: boolean;
  viewerEmail: string;
  /** Only an administrator may switch a contact's access on (§31.3). */
  isAdministrator: boolean;
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
  // Nobody verifies their own correction: the panel says so rather than
  // offering a button the procedure would refuse (FM25).
  const ownWork =
    Boolean(action?.ownerEmail) &&
    canonicalEmail(action?.ownerEmail ?? '') === canonicalEmail(viewerEmail);
  const lastOpenAction = finding.openActionCount <= 1;
  const dueDay = action?.dueAt
    ? new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date(action.dueAt))
    : '';

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
          {finding.resolvedOutcome && (
            <div>
              <dt>Outcome</dt>
              <dd>
                {OUTCOME_LABELS[finding.resolvedOutcome] ?? finding.resolvedOutcome}
                {finding.duplicateOfReference ? ` of ${finding.duplicateOfReference}` : ''}
                {finding.statusReason ? ` — ${finding.statusReason}` : ''}
              </dd>
            </div>
          )}
        </dl>
        {/* v209 — a finding raised in error has an answer that is not a
            closure, and closure is what ESH verification means (§6). */}
        {canVerify && finding.status !== 'closed' && !finding.resolvedOutcome && (
          <FindingOutcome findingId={finding.id} />
        )}
      </section>

      <section className="esh-form-card" aria-labelledby="esh-detail-original">
        <h2 id="esh-detail-original" className="esh-form-card-title">
          Original evidence
        </h2>
        <OriginalEvidence
          findingId={finding.id}
          files={finding.originalEvidence}
          canChange={canCoordinate && ['draft', 'new', 'open'].includes(finding.status)}
        />
      </section>

      {finding.pendingSubmission && (
        <section className="esh-form-card esh-submission" aria-labelledby="esh-detail-submission">
          <h2 id="esh-detail-submission" className="esh-form-card-title">
            Submitted for review · version {finding.pendingSubmission.version}
          </h2>
          <p className="form-hint">
            {finding.pendingSubmission.ownerEmail} ·{' '}
            {dateTime(finding.pendingSubmission.submittedAt)}. The submission is fixed: messages
            sent since do not change it.
          </p>
          {/* Before and after, side by side on a desktop and stacked on a
              phone (§13), so the condition and the correction are compared. */}
          <div className="esh-compare">
            <div className="esh-compare-side">
              <p className="esh-compare-label">Before · original condition</p>
              {finding.description && <p className="esh-detail-text">{finding.description}</p>}
              <FileList files={finding.originalEvidence} label="Original evidence" />
            </div>
            <div className="esh-compare-side">
              <p className="esh-compare-label">After · submitted correction</p>
              <p className="esh-detail-text">{finding.pendingSubmission.resultText}</p>
              <FileList files={finding.pendingSubmission.files} label="Submitted files" />
            </div>
          </div>
          {canVerify && !ownWork && action && (
            <VerifyPanel
              submissionId={finding.pendingSubmission.id}
              findingId={finding.id}
              version={finding.pendingSubmission.version}
              closesFinding={lastOpenAction}
            />
          )}
          {canVerify && ownWork && (
            <p className="notice warn" role="status">
              This correction was submitted from your own address, so another ESH Verifier has to
              check it.
            </p>
          )}
          {!canVerify && <p className="form-hint">An ESH Verifier decides this submission.</p>}
        </section>
      )}

      {finding.decisions.length > 0 && (
        <section className="esh-form-card" aria-labelledby="esh-detail-decisions">
          <h2 id="esh-detail-decisions" className="esh-form-card-title">
            Verification
          </h2>
          <ol className="esh-history">
            {finding.decisions.map((decision) => (
              <li key={`${decision.version}-${decision.verifiedAt}`}>
                <strong>
                  {decision.decision === 'accepted'
                    ? `Version ${decision.version} accepted`
                    : `Version ${decision.version} sent back`}
                  {decision.method
                    ? ` · ${VERIFICATION_METHOD_LABELS[decision.method as VerificationMethod] ?? decision.method}`
                    : ''}
                </strong>
                <span>
                  {decision.verifierName} · {dateTime(decision.verifiedAt)}
                </span>
                {decision.note && <p className="esh-detail-text">{decision.note}</p>}
              </li>
            ))}
          </ol>
        </section>
      )}

      {/*
       * v211 - its own card, not a footnote inside Verification. It used to
       * be nested there, so a deadline moved before any verification decision
       * existed was recorded correctly and then shown to nobody.
       */}
      {finding.dueChanges.length > 0 && (
        <section className="esh-form-card" aria-labelledby="esh-detail-due-changes">
          <h2 id="esh-detail-due-changes" className="esh-form-card-title">
            Due-date changes
          </h2>
          <ol className="esh-history">
            {finding.dueChanges.map((change) => (
              <li key={change.changedAt}>
                <strong>
                  {change.oldDueAt ? `${dateTime(change.oldDueAt, true)} → ` : ''}
                  {dateTime(change.newDueAt, true)}
                </strong>
                <span>
                  {change.changedByName} · {dateTime(change.changedAt)} · {change.reason}
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {finding.status === 'closed' && (
        <section className="esh-form-card" aria-labelledby="esh-detail-closure">
          <h2 id="esh-detail-closure" className="esh-form-card-title">
            Closure record
          </h2>
          <dl className="esh-facts">
            <div>
              <dt>Closed</dt>
              <dd>
                {finding.closure.closedAt ? dateTime(finding.closure.closedAt) : 'Not recorded'}
                {finding.closure.closedByName ? ` · ${finding.closure.closedByName}` : ''}
              </dd>
            </div>
            {finding.closure.closureNote && (
              <div>
                <dt>Verification note</dt>
                <dd className="esh-detail-text">{finding.closure.closureNote}</dd>
              </div>
            )}
          </dl>
          {canVerify && <ReopenFinding findingId={finding.id} />}
        </section>
      )}

      {finding.closure.reopenedAt && finding.status !== 'closed' && (
        <div className="notice warn" role="status">
          <strong>Reopened</strong>
          <p>
            {finding.closure.reopenedByName ?? 'ESH'} reopened this finding on{' '}
            {dateTime(finding.closure.reopenedAt)}
            {finding.closure.reopenReason ? `: ${finding.closure.reopenReason}` : '.'}
          </p>
        </div>
      )}

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
            fileBase="/findings/files"
            submissions={finding.submissions}
            decideProposalFor={
              canCoordinate && actionOpen && action
                ? { actionId: action.id, findingId: finding.id }
                : null
            }
            emptyText="No messages yet. The owner’s updates and ESH replies appear here."
          />
          {canCoordinate && actionOpen && action.ownerEmail && (
            <ActionMenu
              actionId={action.id}
              findingId={finding.id}
              ownerEmail={action.ownerEmail}
              dueDate={dueDay}
              priority={action.priority ?? 'normal'}
            />
          )}
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
                    ? '. Nothing reaches them until this contact is enabled and the email is released — two deliberate acts, both below.'
                    : ''}
                  {entry.state === 'suppressed' && entry.stateReason
                    ? ` · ${NOTIFICATION_REASON_LABELS[entry.stateReason] ?? entry.stateReason}`
                    : ''}
                  {/*
                   * v212 - the remedy stands next to the problem. Enabling is
                   * an administrator's act and still grants only access; the
                   * release below it remains ESH's separate decision.
                   */}
                  {entry.state === 'held_rollout' &&
                    !entry.recipientEnabled &&
                    isAdministrator &&
                    entry.recipientPrincipalId &&
                    entry.recipient && (
                      <EnableContactInline
                        principalId={entry.recipientPrincipalId}
                        findingId={finding.id}
                        recipient={entry.recipient}
                      />
                    )}
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
