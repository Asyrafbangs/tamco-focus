'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { SideDrawer } from '@/components/ui/SideDrawer';
import type { OperationResult } from '@/domain/types';
import {
  decideMajorProjectProposal,
  resubmitMajorProjectProposal,
} from '@/server/actions/proposal-actions';
import type { MajorProjectProposalDetail } from '@/server/queries';

function key() {
  return crypto.randomUUID();
}

function statusLabel(status: MajorProjectProposalDetail['status']) {
  if (status === 'pending') return 'For discussion';
  if (status === 'changes_requested') return 'Changes requested';
  if (status === 'approved') return 'Agreed';
  if (status === 'declined' || status === 'rejected') return 'Declined';
  return status;
}

export function WorkProposalDrawer({
  proposal,
  closeHref,
}: {
  proposal: MajorProjectProposalDetail;
  closeHref: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [version, setVersion] = useState(proposal.version);
  const [message, setMessage] = useState<{
    tone: 'success' | 'error';
    text: string;
  } | null>(null);

  function finish(result: OperationResult<{ version?: number }>, success: string) {
    if (!result.ok) {
      setMessage({ tone: 'error', text: result.message });
      return false;
    }
    setVersion(result.version ?? version + 1);
    setMessage({ tone: 'success', text: success });
    router.refresh();
    return true;
  }

  return (
    <SideDrawer
      closeHref={closeHref}
      title={proposal.title}
      eyebrow="Major Project proposal"
      meta={
        <span>
          {proposal.proposedByName} &middot; {statusLabel(proposal.status)}
        </span>
      }
      titleId="work-proposal-title"
    >
      <div className="task-detail-body">
        {message && (
          <div className={`notice ${message.tone === 'error' ? 'error' : 'success'}`} role="status">
            <strong>{message.tone === 'error' ? 'Nothing changed' : 'Decision recorded'}</strong>
            <p>{message.text}</p>
          </div>
        )}

        <section className="detail-section">
          <p className="eyebrow">Proposed outcome</p>
          <h3>Why this should become a Major Project</h3>
          <p>{proposal.rationale ?? 'No rationale was recorded.'}</p>
          {proposal.decisionNote && (
            <div className="notice warning">
              <strong>{statusLabel(proposal.status)}</strong>
              <p>{proposal.decisionNote}</p>
              {proposal.decidedByName && <small>Recorded by {proposal.decidedByName}</small>}
            </div>
          )}
          {proposal.createdTaskId && (
            <Link
              className="btn primary"
              href={`/work?tab=available&task=${proposal.createdTaskId}`}
            >
              Open Available project
            </Link>
          )}
        </section>

        {proposal.capabilities.canDecide && proposal.status === 'pending' && (
          <section className="detail-section" aria-labelledby="proposal-decision-heading">
            <h3 id="proposal-decision-heading">Manager decision</h3>
            <p>
              Agree creates one Major Project in Available. It does not activate work on the
              owner&apos;s behalf.
            </p>
            <form
              className="detail-form"
              onSubmit={(event) => {
                event.preventDefault();
                const form = event.currentTarget;
                const submitter = (event.nativeEvent as SubmitEvent)
                  .submitter as HTMLButtonElement | null;
                const decision = (submitter?.value ?? 'agree') as
                  'agree' | 'request_changes' | 'decline';
                const note = String(new FormData(form).get('decisionNote') ?? '');
                setMessage(null);
                startTransition(async () => {
                  const result = await decideMajorProjectProposal({
                    proposalId: proposal.id,
                    expectedVersion: version,
                    decision,
                    note,
                    idempotencyKey: key(),
                  });
                  const success =
                    decision === 'agree'
                      ? 'Major Project created in Available. The owner chooses when to activate it.'
                      : decision === 'request_changes'
                        ? 'Changes requested. The proposal returned to its owner.'
                        : 'Proposal declined with the reason preserved.';
                  finish(result, success);
                });
              }}
            >
              <div className="field">
                <label htmlFor={`proposal-note-${proposal.id}`}>
                  Decision note{' '}
                  <span className="optional-label">Required for changes or decline</span>
                </label>
                <textarea id={`proposal-note-${proposal.id}`} name="decisionNote" rows={4} />
              </div>
              <div className="actions">
                <button className="btn primary" name="decision" value="agree" disabled={pending}>
                  Agree
                </button>
                <button className="btn" name="decision" value="request_changes" disabled={pending}>
                  Request changes
                </button>
                <button className="btn danger" name="decision" value="decline" disabled={pending}>
                  Decline
                </button>
              </div>
            </form>
          </section>
        )}

        {proposal.capabilities.canResubmit && proposal.status === 'changes_requested' && (
          <section className="detail-section" aria-labelledby="proposal-revise-heading">
            <h3 id="proposal-revise-heading">Revise and send for discussion</h3>
            <form
              className="detail-form"
              onSubmit={(event) => {
                event.preventDefault();
                const form = event.currentTarget;
                const data = new FormData(form);
                setMessage(null);
                startTransition(async () => {
                  if (
                    finish(
                      await resubmitMajorProjectProposal({
                        proposalId: proposal.id,
                        expectedVersion: version,
                        title: String(data.get('title') ?? ''),
                        rationale: String(data.get('rationale') ?? ''),
                        idempotencyKey: key(),
                      }),
                      'Revised proposal sent back for discussion.',
                    )
                  ) {
                    form.reset();
                  }
                });
              }}
            >
              <div className="field">
                <label htmlFor={`proposal-title-${proposal.id}`}>Project title</label>
                <input
                  id={`proposal-title-${proposal.id}`}
                  name="title"
                  defaultValue={proposal.title}
                  maxLength={200}
                  required
                />
              </div>
              <div className="field">
                <label htmlFor={`proposal-rationale-${proposal.id}`}>Outcome and rationale</label>
                <textarea
                  id={`proposal-rationale-${proposal.id}`}
                  name="rationale"
                  defaultValue={proposal.rationale ?? ''}
                  rows={5}
                  maxLength={4000}
                  required
                />
              </div>
              <button className="btn primary" disabled={pending}>
                Send for discussion
              </button>
            </form>
          </section>
        )}
      </div>
    </SideDrawer>
  );
}
