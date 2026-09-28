import Link from 'next/link';
import { notFound } from 'next/navigation';

import { Conversation } from '@/components/esh/Conversation';
import {
  ChangeDueForm,
  ChangeOwnerForm,
  ChangePriorityForm,
  ChangeRiskForm,
  EditFindingForm,
} from '@/components/esh/FindingControls';
import { FindingActionsMenu, type FindingMenuItem } from '@/components/esh/FindingActionsMenu';
import { OriginalEvidence } from '@/components/esh/OriginalEvidence';
import { FindingOutcome } from '@/components/esh/FindingOutcome';
import { HistoryDrawer } from '@/components/esh/HistoryDrawer';
import { ReopenFinding } from '@/components/esh/ReopenFinding';
import { VerifyPanel } from '@/components/esh/VerifyPanel';
import { FindingForm } from '@/components/esh/FindingForm';
import { StaffMessageForm } from '@/components/esh/StaffMessageForm';
import { activityLabel, humanActivity } from '@/domain/esh-activity';
import { evidenceLabel } from '@/domain/esh-evidence';
import { nextActor } from '@/domain/esh-next-actor';
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
  getDepartmentRoutes,
  getDepartmentsInScope,
  getFindingDetail,
  getVerifiers,
  type FindingDetail,
} from '@/server/esh/queries';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const NOTIFICATION_KIND_LABELS: Record<string, string> = {
  owner_assignment: 'Assignment email',
  import_assignment: 'Backlog summary',
  esh_reply: 'Reply notice',
  access_link: 'Requested link',
  submission_received: 'Review request',
  submission_withdrawn: 'Withdrawal notice',
  changes_requested: 'More needed notice',
  due_changed: 'Due date notice',
  finding_closed: 'Closure notice',
  finding_reopened: 'Reopening notice',
  reassigned_away: 'Handover notice',
  owner_reminder: 'Reminder',
  escalation: 'Escalation',
  review_reminder: 'Review reminder',
  owner_digest: 'Daily summary',
  escalation_digest: 'Escalation summary',
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
  held_rollout: 'Held — owner email is in Test mode',
  queued: 'Queued to send',
  processing: 'Sending',
  provider_accepted: 'Accepted by the mail server',
  delivered: 'Delivered',
  bounced: 'Bounced',
  failed: 'Failed',
  suppressed: 'Not sent',
  cancelled: 'Cancelled',
  digested: 'Sent in a summary',
};

/**
 * One finding (§13, §24), as one job: what am I looking at, and what is
 * happening about it.
 *
 * v223 - the left column is one card saying what has to be fixed; the right
 * is the conversation, with the submission to review above it when there is
 * one. Everything else the record holds — verification history, due-date
 * changes, the escalation route, the delivery log, the audit trail — is kept
 * and one press away, rather than standing on the page as equal cards.
 */
export default async function FindingPage({
  params,
  searchParams,
}: {
  params: Promise<{ findingId: string }>;
  searchParams: Promise<{
    saved?: string;
    warn?: string;
    action?: string;
    full?: string;
    review?: string;
  }>;
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
              ? 'Owner email is in Test mode, so the assignment email is held until it is released.'
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
    const [departments, verifiers, routes] = await Promise.all([
      getDepartmentsInScope(access),
      getVerifiers(),
      getDepartmentRoutes(),
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
          canAddDepartment={access.canCoordinate && access.scopeAll}
          departmentRoutes={routes}
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

  const action = finding.action;
  const actionLive = Boolean(
    action && ['assigned', 'in_progress', 'awaiting_verification'].includes(action.state),
  );
  const findingEditable = ['new', 'open'].includes(finding.status);
  const lastDecision = finding.decisions.at(-1) ?? null;
  const changesRequested = Boolean(
    action &&
    ['assigned', 'in_progress'].includes(action.state) &&
    lastDecision?.decision === 'changes_requested',
  );

  // v223 - the menu: a few named things, each opening its own form.
  const menu: FindingMenuItem[] = [];
  if (access.canCoordinate && action && actionLive && finding.status === 'open') {
    menu.push({
      key: 'due',
      label: 'Change due date',
      panel: (
        <ChangeDueForm
          actionId={action.id}
          findingId={finding.id}
          dueDate={
            action.dueAt
              ? new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date(action.dueAt))
              : ''
          }
        />
      ),
    });
    if (action.ownerEmail) {
      menu.push({
        key: 'owner',
        label: 'Change owner',
        panel: (
          <ChangeOwnerForm
            actionId={action.id}
            findingId={finding.id}
            ownerEmail={action.ownerEmail}
          />
        ),
      });
    }
    if (action.state !== 'awaiting_verification') {
      menu.push({
        key: 'priority',
        label: 'Change priority',
        panel: (
          <ChangePriorityForm
            actionId={action.id}
            findingId={finding.id}
            priority={action.priority ?? 'normal'}
          />
        ),
      });
    }
  }
  if (access.canCoordinate && findingEditable) {
    const departments = await getDepartmentsInScope(access);
    menu.push({
      key: 'edit',
      label: 'Edit finding',
      panel: (
        <EditFindingForm
          findingId={finding.id}
          title={finding.title}
          description={finding.description ?? ''}
          location={finding.location ?? ''}
          departmentId={finding.departmentId ?? ''}
          departments={departments}
        />
      ),
    });
    menu.push({
      key: 'risk',
      label: 'Change risk',
      panel: <ChangeRiskForm findingId={finding.id} risk={finding.riskLevel} />,
    });
  }
  if (access.canVerify && finding.pendingSubmission) {
    menu.push({
      key: 'review',
      label: 'Review submission',
      href: `/findings/${finding.id}?review=1#esh-review`,
    });
  }
  if (access.canVerify && finding.status !== 'closed' && !finding.resolvedOutcome) {
    menu.push({
      key: 'outcome',
      label: 'Cancel / mark duplicate',
      panel: <FindingOutcome findingId={finding.id} />,
    });
  }
  if (access.canVerify && finding.status === 'closed') {
    menu.push({
      key: 'reopen',
      label: 'Reopen finding',
      panel: <ReopenFinding findingId={finding.id} />,
    });
  }

  const next = nextActor(
    {
      status: finding.status,
      actionState: action?.state ?? null,
      ownerEmail: action?.ownerEmail ?? null,
      dueAt: action?.dueAt ?? null,
      dueIsDateOnly: Boolean(action?.dueIsDateOnly),
      isOverdue: Boolean(
        action &&
        action.dueAt &&
        ['assigned', 'in_progress'].includes(action.state) &&
        new Date(action.dueAt).getTime() < now.getTime(),
      ),
      changesRequested,
      lastUpdateAt:
        finding.pendingSubmission?.submittedAt ?? action?.assignedAt ?? finding.createdAt,
    },
    now,
    timeZone,
  );

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
        <div className="esh-detail-head-actions">
          <span className="flag neutral esh-status-flag">
            {finding.status === 'open' && action
              ? ACTION_STATE_LABELS[action.state]
              : finding.resolvedOutcome
                ? (OUTCOME_LABELS[finding.resolvedOutcome] ?? FINDING_STATUS_LABELS[finding.status])
                : FINDING_STATUS_LABELS[finding.status]}
          </span>
          <FindingActionsMenu items={menu} />
        </div>
      </div>
      {next.kind !== 'settled' && (
        <p className="esh-next-banner" data-tone={next.tone}>
          <strong>{next.headline}</strong>
          <span>{next.detail}</span>
        </p>
      )}
      {notices}
      <FindingSummary
        finding={finding}
        timeZone={timeZone}
        canCoordinate={access.canCoordinate}
        canVerify={access.canVerify}
        viewerEmail={profile.email}
        isAdministrator={profile.role === 'administrator'}
        full={query.full === '1'}
        reviewOpen={query.review === '1'}
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
  full,
  reviewOpen,
}: {
  finding: FindingDetail;
  timeZone: string;
  canCoordinate: boolean;
  canVerify: boolean;
  viewerEmail: string;
  /** Only an administrator may correct a contact's address (§31.3). */
  isAdministrator: boolean;
  /** v221 - a closed finding shows its result; this asks for everything. */
  full: boolean;
  /** v223 - arrived from "Review submission". */
  reviewOpen: boolean;
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
  // assignment email has actually gone to them.
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

  /*
   * v221 - a closed finding is a result, not a workspace.
   *
   * Once ESH has verified the correction the operational process is over, and
   * the page that helped run it stops being the useful thing to show. What is
   * left is what happened: the condition, the correction, and who verified it.
   * Everything else is preserved and one link away.
   */
  const accepted = finding.submissions.find((mark) => mark.state === 'accepted') ?? null;
  const acceptedMessage = accepted
    ? (finding.conversation.find((entry) => entry.id === accepted.messageId) ?? null)
    : null;
  const acceptance = [...finding.decisions].reverse().find((one) => one.decision === 'accepted');

  if (finding.status === 'closed' && !full) {
    return (
      <section className="esh-closure-record" role="region" aria-label="Closure record">
        <p className="esh-closure-lead">
          {[
            finding.departmentName,
            finding.closure.closedAt
              ? `Closed ${dateTime(finding.closure.closedAt, true)}`
              : 'Closed',
            finding.closure.closedByName ? `by ${finding.closure.closedByName}` : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>

        <div className="esh-compare">
          <div className="esh-compare-side">
            <p className="esh-compare-label">Before · original condition</p>
            {finding.description && <p className="esh-detail-text">{finding.description}</p>}
            <FileList files={finding.originalEvidence} label="Original evidence" />
          </div>
          <div className="esh-compare-side">
            <p className="esh-compare-label">After · accepted correction</p>
            {acceptedMessage?.body && <p className="esh-detail-text">{acceptedMessage.body}</p>}
            <FileList files={acceptedMessage?.files ?? []} label="Completion evidence" />
          </div>
        </div>

        {acceptance && (
          <p className="esh-closure-verified">
            Verified by <strong>{acceptance.verifierName}</strong>
            {acceptance.method
              ? ` · ${(VERIFICATION_METHOD_LABELS as Record<string, string>)[acceptance.method] ?? acceptance.method}`
              : ''}
            {` · ${dateTime(acceptance.verifiedAt, true)}`}
            {acceptance.note ? ` — ${acceptance.note}` : ''}
          </p>
        )}
        {finding.closure.reopenedAt && (
          <p className="form-hint">
            Reopened {dateTime(finding.closure.reopenedAt, true)} by{' '}
            {finding.closure.reopenedByName ?? 'ESH'}
            {finding.closure.reopenReason ? `: ${finding.closure.reopenReason}` : ''}
          </p>
        )}

        <div className="esh-form-actions">
          <Link className="btn" href={`/findings/${finding.id}?full=1#esh-detail-conversation`}>
            View conversation
          </Link>
          <Link className="btn" href={`/findings/${finding.id}?full=1`}>
            View full record
          </Link>
        </div>
      </section>
    );
  }

  // v223 - human events only on the page; delivery mechanics live in the drawer.
  const story = humanActivity(finding.history);
  const recent = story.slice(-3).reverse();
  // Only a delivery that failed is worth anybody's attention here.
  const failures = finding.notifications.filter((entry) => entry.stoppedRetrying);

  return (
    <div className="esh-detail">
      {/*
       * The left column answers "what am I supposed to fix": one card, the
       * required outcome first, then what was found and seen.
       */}
      <aside className="esh-detail-side">
        <section className="esh-form-card" aria-labelledby="esh-detail-finding">
          {action?.requiredOutcome && (
            <div className="esh-required-outcome">
              <span className="esh-pinned-label">Required action</span>
              <p className="esh-detail-text">{action.requiredOutcome}</p>
            </div>
          )}
          <p className="esh-context-facts">
            {action && (
              <span>
                Owner <strong>{action.ownerEmail ?? 'Not assigned'}</strong>
              </span>
            )}
            {action?.dueAt && (
              <span>
                Due <strong>{dateTime(action.dueAt, action.dueIsDateOnly)}</strong>
              </span>
            )}
            <span>
              Risk <strong>{RISK_LABELS[finding.riskLevel]}</strong>
            </span>
            {action?.priority && action.priority !== 'normal' && (
              <span>
                Priority <strong>{PRIORITY_LABELS[action.priority]}</strong>
              </span>
            )}
          </p>

          <h2 id="esh-detail-finding" className="esh-subheading">
            What was found
          </h2>
          {finding.description && <p className="esh-detail-text">{finding.description}</p>}
          <OriginalEvidence
            findingId={finding.id}
            files={finding.originalEvidence}
            canChange={canCoordinate && ['draft', 'new', 'open'].includes(finding.status)}
          />

          {finding.resolvedOutcome && (
            <p className="notice neutral">
              <strong>
                {OUTCOME_LABELS[finding.resolvedOutcome] ?? finding.resolvedOutcome}
                {finding.duplicateOfReference ? ` of ${finding.duplicateOfReference}` : ''}
              </strong>
              {finding.statusReason ? ` — ${finding.statusReason}` : ''}
            </p>
          )}
          {finding.closure.reopenedAt && finding.status !== 'closed' && (
            <p className="form-hint" role="status">
              Reopened {dateTime(finding.closure.reopenedAt, true)} by{' '}
              {finding.closure.reopenedByName ?? 'ESH'}
              {finding.closure.reopenReason ? `: ${finding.closure.reopenReason}` : ''}
            </p>
          )}

          {/*
           * The rest of the record, kept and folded. "View full record" on a
           * closed finding arrives here with it open.
           */}
          <details className="esh-form-more" open={full || undefined}>
            <summary>Full record</summary>
            <dl className="esh-facts">
              <div>
                <dt>Reported</dt>
                <dd>
                  {finding.reportedOn
                    ? dateTime(`${finding.reportedOn}T12:00:00Z`, true)
                    : 'Not recorded'}
                  {' · '}
                  {SOURCE_LABELS[finding.source]}
                  {finding.sourceReference ? ` · ${finding.sourceReference}` : ''}
                </dd>
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
              {action && (
                <>
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
                    <dt>Completion evidence</dt>
                    <dd>{action.evidenceInstruction ?? 'A result and at least one file'}</dd>
                  </div>
                  <div>
                    <dt>ESH reviewer</dt>
                    <dd>{action.reviewerName ?? 'Verification queue — any ESH Verifier'}</dd>
                  </div>
                  <div>
                    <dt>Follow-up if overdue</dt>
                    <dd>
                      {action.escalation.length > 0
                        ? Array.from(new Set(action.escalation.map((entry) => entry.level)))
                            .sort((a, b) => a - b)
                            .map(
                              (level) =>
                                `Level ${level}: ${action.escalation
                                  .filter((entry) => entry.level === level)
                                  .map((entry) => entry.email)
                                  .join(', ')}`,
                            )
                            .join(' · ')
                        : `No further escalation${action.noFurtherEscalationReason ? `: ${action.noFurtherEscalationReason}` : ''}`}
                    </dd>
                  </div>
                </>
              )}
              {finding.status === 'closed' && (
                <div>
                  <dt>Closed</dt>
                  <dd>
                    {finding.closure.closedAt ? dateTime(finding.closure.closedAt) : 'Not recorded'}
                    {finding.closure.closedByName ? ` · ${finding.closure.closedByName}` : ''}
                    {finding.closure.closureNote ? ` — ${finding.closure.closureNote}` : ''}
                  </dd>
                </div>
              )}
            </dl>
            {finding.decisions.length > 0 && (
              <>
                <h3 className="esh-subheading">Verification</h3>
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
              </>
            )}
            {finding.dueChanges.length > 0 && (
              <>
                <h3 className="esh-subheading">Due-date changes</h3>
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
              </>
            )}
          </details>
        </section>
      </aside>

      {/* The right column answers "what is happening about it". */}
      <div className="esh-detail-main">
        {failures.map((entry) => (
          <div key={entry.id} className="notice error" role="alert">
            <strong>
              ⚠ Email {entry.state === 'bounced' ? 'bounced' : 'could not be delivered'} —{' '}
              {entry.recipient ?? 'recipient'}
            </strong>
            <p>
              {isAdministrator ? (
                <>
                  <Link href="/more/admin/users" className="guest-link">
                    Correct the address
                  </Link>{' '}
                  in Identity &amp; access, or give the action to somebody else from the menu.
                </>
              ) : (
                'Correct the address with an administrator, or give the action to somebody else from the menu.'
              )}
            </p>
          </div>
        ))}

        {finding.pendingSubmission && (
          <section
            id="esh-review"
            className="esh-form-card esh-submission"
            aria-labelledby="esh-detail-submission"
          >
            {/*
             * Open for a Verifier, whose job this is; folded to one line for
             * everybody else until they ask ("Review submission").
             */}
            <details className="esh-review" open={reviewOpen || canVerify || undefined}>
              <summary className="esh-review-banner">
                <span>
                  <strong id="esh-detail-submission">
                    Submitted for review · version {finding.pendingSubmission.version}
                  </strong>
                  <br />
                  <small className="form-hint">
                    {finding.pendingSubmission.ownerEmail} ·{' '}
                    {dateTime(finding.pendingSubmission.submittedAt)}
                  </small>
                </span>
                <span className="btn">Review submission</span>
              </summary>
              {/*
               * v217 - what was required, at the top of the decision, then
               * before and after side by side (stacked on a phone, §13).
               */}
              {action?.requiredOutcome && (
                <div className="esh-required-outcome">
                  <span className="esh-pinned-label">Required outcome</span>
                  <p className="esh-detail-text">{action.requiredOutcome}</p>
                </div>
              )}
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
              <p className="form-hint">
                The submission is fixed: messages sent since do not change it.
              </p>
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
                  This correction was submitted from your own address, so another ESH Verifier has
                  to check it.
                </p>
              )}
              {!canVerify && <p className="form-hint">An ESH Verifier decides this submission.</p>}
            </details>
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
            {canCoordinate && actionOpen && (
              <StaffMessageForm
                actionId={action.id}
                findingId={finding.id}
                ownerReachable={ownerReachable}
              />
            )}
          </section>
        )}

        {/*
         * v223 - the latest few things that happened, and the whole record in
         * a drawer. Delivery mechanics are not events in the finding's story.
         */}
        <section className="esh-activity-line" aria-labelledby="esh-activity-title">
          <div>
            <h2 id="esh-activity-title" className="visually-hidden">
              Activity
            </h2>
            <ol aria-label="Latest activity">
              {recent.map((entry, index) => (
                <li key={`${entry.eventType}-${entry.occurredAt}-${index}`}>
                  {index === 0 && 'Latest: '}
                  <strong>{activityLabel(entry.eventType)}</strong> · {entry.actorName} ·{' '}
                  {dateTime(entry.occurredAt)}
                </li>
              ))}
            </ol>
          </div>
          <HistoryDrawer label="View full history">
            <section aria-labelledby="esh-history-title">
              <h3 id="esh-history-title" className="esh-subheading">
                Everything that happened
              </h3>
              <ol className="esh-history">
                {story.map((entry, index) => (
                  <li key={`all-${entry.eventType}-${entry.occurredAt}-${index}`}>
                    <strong>{activityLabel(entry.eventType)}</strong>
                    <span>
                      {entry.actorName} · {dateTime(entry.occurredAt)}
                    </span>
                  </li>
                ))}
              </ol>
            </section>
            {finding.notifications.length > 0 && (
              <section aria-labelledby="esh-delivery-title">
                <h3 id="esh-delivery-title" className="esh-subheading">
                  Delivery log
                </h3>
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
                          : (NOTIFICATION_STATE_LABELS[entry.state] ?? entry.state)}
                        {entry.state === 'suppressed' && entry.stateReason
                          ? ` · ${NOTIFICATION_REASON_LABELS[entry.stateReason] ?? entry.stateReason}`
                          : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </HistoryDrawer>
        </section>
      </div>
    </div>
  );
}
