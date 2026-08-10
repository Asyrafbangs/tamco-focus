'use client';

import { useState } from 'react';

import { barrierAction } from '@/domain/barriers';
import { BARRIER_IMPACT_LABELS, type BarrierImpact } from '@/domain/types';
import type { TaskDetailBarrier } from '@/server/queries';

export type BarrierResponseKind = 'answer' | 'approved' | 'changes_requested';

function formatMoment(value: string, timeZone: string) {
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone,
  }).format(new Date(value));
}

/**
 * The requested action, presented first (v46 sections 10, 41).
 *
 * This is the whole point of the revision. A manager arriving from a
 * notification knows only that something wants them; the screen has to answer
 * "what am I being asked and what do I type" before it answers anything else.
 * So the request comes first, the response control is already here, and the
 * task it belongs to waits underneath.
 *
 * There is exactly one of these in the application. The barrier history lower
 * down deliberately has no form of its own — two response forms would be two
 * places for the transaction rules to drift apart.
 */
export function BarrierActionPanel({
  barrier,
  requesterName,
  timeZone,
  pending,
  autoFocus,
  inMeetingQueue,
  onRespond,
  onAddToMeetingQueue,
}: {
  barrier: TaskDetailBarrier;
  requesterName: string;
  timeZone: string;
  pending: boolean;
  /** Arriving from a notification or Needs Attention: put the caret in the box. */
  autoFocus: boolean;
  inMeetingQueue: boolean;
  onRespond: (message: string, kind: BarrierResponseKind) => void;
  onAddToMeetingQueue: () => void;
}) {
  const presentation = barrierAction(barrier.actionType);
  const [message, setMessage] = useState('');

  function submit(kind: BarrierResponseKind) {
    if (!message.trim() || pending) return;
    onRespond(message.trim(), kind);
    setMessage('');
  }

  return (
    <section className="barrier-action-panel" aria-labelledby={`barrier-action-${barrier.id}`}>
      <p className="barrier-action-eyebrow" id={`barrier-action-${barrier.id}`}>
        <span aria-hidden="true">🔴</span> {presentation.title}
      </p>

      <div className="barrier-action-question">
        <strong>What&rsquo;s blocking the work?</strong>
        <span>{barrier.description}</span>
      </div>

      <div className="barrier-action-question">
        <strong>Impact</strong>
        <span>{BARRIER_IMPACT_LABELS[barrier.impact as BarrierImpact]}</span>
      </div>

      <div className="barrier-action-question">
        <strong>What {requesterName.split(' ')[0]} needs from you</strong>
        <span>{barrier.supportNeeded}</span>
      </div>

      <p className="barrier-action-meta">
        Raised by {requesterName} · {formatMoment(barrier.raisedAt, timeZone)}
      </p>

      <form
        className="barrier-action-form"
        onSubmit={(event) => {
          event.preventDefault();
          submit(barrier.actionType === 'approval' ? 'approved' : 'answer');
        }}
      >
        <label htmlFor={`barrier-response-${barrier.id}`}>{presentation.inputLabel}</label>
        <textarea
          id={`barrier-response-${barrier.id}`}
          // The drawer reads this on open and puts the caret here (v46 §41).
          data-initial-focus={autoFocus ? '' : undefined}
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          rows={3}
          maxLength={2000}
          required
          placeholder={
            barrier.actionType === 'decision'
              ? 'Write your decision here…'
              : 'Write your response here…'
          }
        />

        <div className="barrier-action-buttons">
          <button
            type="submit"
            className="btn small primary"
            disabled={pending || !message.trim()}
            aria-busy={pending}
          >
            {presentation.primaryAction}
          </button>

          {presentation.secondaryAction && (
            <button
              type="button"
              className="btn small"
              disabled={pending || !message.trim()}
              aria-busy={pending}
              onClick={() => submit('changes_requested')}
            >
              {presentation.secondaryAction}
            </button>
          )}

          {/*
            v46 sections 18-19 — a quiet second option, and only here.
            "I need to talk about this" is a legitimate answer to a request for
            a decision, but it belongs to the person being asked. It was on the
            employee's Raise Barrier form, where it asked them to predict how
            somebody else would want to handle their problem.
          */}
          {inMeetingQueue ? (
            <span className="barrier-action-queued" role="status">
              ✓ Already in Meeting Queue
            </span>
          ) : (
            <button
              type="button"
              className="btn small ghost"
              disabled={pending}
              aria-busy={pending}
              onClick={onAddToMeetingQueue}
            >
              Add to Meeting Queue
            </button>
          )}
        </div>

        <small>Responding does not resolve the barrier.</small>
      </form>
    </section>
  );
}
