'use client';

import { useEffect, useRef } from 'react';

import { barrierAction } from '@/domain/barriers';
import { BARRIER_IMPACT_LABELS, type BarrierImpact } from '@/domain/types';
import type { TaskDetailBarrier } from '@/server/queries';

function formatMoment(value: string, timeZone: string) {
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone,
  }).format(new Date(value));
}

/**
 * One barrier, in full (v47 section 5).
 *
 * Every surface that mentions a barrier — a notification, My Day, My Team, the
 * Meeting Queue, a calendar entry — shows a summary and links here. This is the
 * record itself: the request, who owes what, what has been said, and where the
 * discussion got to.
 *
 * It has no response form. Answering happens in `BarrierActionPanel`, at the
 * top of the drawer, so the submit rules exist once.
 */
export function BarrierDetailPanel({
  barrier,
  timeZone,
  canEdit,
  pending,
  highlighted,
  onResolve,
}: {
  barrier: TaskDetailBarrier;
  timeZone: string;
  canEdit: boolean;
  pending: boolean;
  /** Arrived here from "View request" or "View response": scroll it into view. */
  highlighted: boolean;
  onResolve: (form: HTMLFormElement, note: string) => void;
}) {
  const action = barrierAction(barrier.actionType);
  const container = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!highlighted) return;
    container.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    container.current?.focus({ preventScroll: true });
  }, [highlighted]);

  return (
    <article
      ref={container}
      tabIndex={-1}
      data-barrier-id={barrier.id}
      className={`barrier-record ${barrier.status}${highlighted ? ' highlighted' : ''}`}
    >
      <div>
        <strong>{action.title}</strong>
        <span>{BARRIER_IMPACT_LABELS[barrier.impact as BarrierImpact]}</span>
        <span>
          {barrier.status === 'open' ? 'Open' : 'Resolved'} ·{' '}
          {formatMoment(barrier.raisedAt, timeZone)}
        </span>
      </div>

      {/*
        v44 sections 17 and 21 — a manager opening this must not have to infer
        what is wanted. The questions are labelled in the order they are asked,
        and the heading names the action so the request reads as a request.
      */}
      <p className="barrier-question">
        <strong>What is blocking the work</strong>
        <span>{barrier.description}</span>
      </p>
      <p className="barrier-question">
        <strong>What is needed</strong>
        <span>{barrier.supportNeeded}</span>
      </p>
      {barrier.actionRequiredFromName && (
        <p className="barrier-question">
          <strong>Who needs to act</strong>
          <span>{barrier.actionRequiredFromName}</span>
        </p>
      )}

      {/*
        v45 §33, §45 and v47 §33-36 — the requester's standing, in one line.

        Four situations, and they are genuinely different: nobody has looked at
        it yet, it is going to be discussed, it is booked for a time, or it has
        been answered. Collapsing them into "open" leaves the person who asked
        deciding whether to chase somebody with no information to decide on.
      */}
      {barrier.status === 'open' && !barrier.actionRequiredFromViewer && (
        <p
          className={`barrier-status-line ${barrier.actionPending ? 'pending' : 'answered'}`}
          role="status"
        >
          {!barrier.actionPending ? (
            <>
              <span aria-hidden="true">✓</span> {action.answeredHeadline}. The barrier remains open
              until the work is genuinely unblocked.
            </>
          ) : barrier.scheduledDiscussionAt ? (
            <>
              <span aria-hidden="true">📅</span> Discussion scheduled:{' '}
              {formatMoment(barrier.scheduledDiscussionAt, timeZone)}
            </>
          ) : barrier.inMeetingQueue ? (
            <>
              <span aria-hidden="true">🟠</span> {action.noun} will be discussed — in the Meeting
              Queue
            </>
          ) : (
            <>
              <span aria-hidden="true">🟠</span> {action.noun} requested
              {barrier.actionRequiredFromName ? ` from ${barrier.actionRequiredFromName}` : ''}
            </>
          )}
        </p>
      )}

      {barrier.responses.length > 0 && (
        <div className="barrier-responses">
          <p className="eyebrow">Responses</p>
          {barrier.responses.map((response) => (
            <p key={response.id}>
              <strong>{response.authorName}</strong>{' '}
              {response.kind !== 'answer' && (
                <span className={`flag ${response.kind === 'approved' ? 'green' : 'amber'}`}>
                  {response.kind === 'approved' ? 'Approved' : 'Changes requested'}
                </span>
              )}{' '}
              <span className="muted">{formatMoment(response.createdAt, timeZone)}</span>
              <br />
              {response.message}
            </p>
          ))}
        </div>
      )}

      {barrier.resolutionNote && (
        <p>
          <strong>Resolution:</strong> {barrier.resolutionNote}
        </p>
      )}

      {/*
        §36 — resolving is a separate act from answering, and it belongs to the
        person who owns the work: they are the only one who can see whether the
        blocker actually went away.
      */}
      {barrier.status === 'open' && canEdit && (
        <form
          className="resolve-barrier"
          onSubmit={(event) => {
            event.preventDefault();
            const form = event.currentTarget;
            onResolve(form, String(new FormData(form).get('resolutionNote') ?? ''));
          }}
        >
          <label htmlFor={`resolve-${barrier.id}`}>Resolution note</label>
          <textarea id={`resolve-${barrier.id}`} name="resolutionNote" required rows={2} />
          <button className="btn small" disabled={pending} aria-busy={pending}>
            Resolve barrier
          </button>
        </form>
      )}
    </article>
  );
}
