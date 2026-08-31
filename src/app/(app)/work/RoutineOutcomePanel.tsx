'use client';

import { useState, useTransition } from 'react';

import { Modal } from '@/components/ui/Modal';
import { decideRoutineException, markRoutineNotRequired } from '@/server/actions/routine-actions';
import type { TaskDetail } from '@/server/queries';

import { CompletionForm } from './CompletionForm';

function idempotencyKey() {
  return crypto.randomUUID();
}

/**
 * The whole of a routine occurrence's workflow.
 *
 * Two outcomes: it was done, or it genuinely did not apply this time. Nothing
 * else is asked of the person doing it, because nothing else is theirs to
 * know. The system already holds who owns it, when it was due, which steps
 * were ticked, by whom, at what time, whether evidence exists and whether it
 * was late - so it records all of that itself and never asks for it back.
 *
 * What deliberately is not here: Skip, Postpone, Waive, Exempt, Reschedule,
 * Request exception, Submit for review, Close occurrence. Each would be a
 * separate visible action for a case the two outcomes already cover, and the
 * cost of them is paid on every occurrence by every person forever.
 */

const REASON_LABELS = {
  no_applicable_work: 'No applicable site or work',
  activity_cancelled: 'Activity cancelled',
  other: 'Other',
} as const;

type ReasonCode = keyof typeof REASON_LABELS;

export function RoutineOutcomePanel({
  taskId,
  taskVersion,
  routine,
  status,
  stepsTotal,
  stepsCompleted,
  evidenceCount,
  canAct,
  canDecide,
  readyToComplete,
  blockers,
  pending,
  timeZone,
  noteOpen,
  onAddNote,
  onCompleted,
  onFailed,
}: {
  taskId: string;
  taskVersion: number;
  routine: NonNullable<TaskDetail['routine']>;
  status: string;
  stepsTotal: number;
  stepsCompleted: number;
  evidenceCount: number;
  canAct: boolean;
  /** The owner's manager, who decides whether the work was really not needed. */
  canDecide: boolean;
  readyToComplete: boolean;
  blockers: string[];
  pending: boolean;
  timeZone: string;
  noteOpen: boolean;
  onAddNote: () => void;
  onCompleted: (message: string) => void;
  onFailed: (message: string) => void;
}) {
  const [busy, startTransition] = useTransition();
  const [reasonOpen, setReasonOpen] = useState(false);
  const [otherNote, setOtherNote] = useState('');
  const [completeOpen, setCompleteOpen] = useState(false);
  const [returnOpen, setReturnOpen] = useState(false);
  const [returnNote, setReturnNote] = useState('');
  const working = pending || busy;
  const exception = routine.exception;

  const moment = (iso: string) =>
    new Intl.DateTimeFormat('en-GB', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone,
    }).format(new Date(iso));

  function raise(reasonCode: ReasonCode, note?: string) {
    startTransition(async () => {
      const result = await markRoutineNotRequired({
        taskId,
        reasonCode,
        reasonNote: note ?? null,
        idempotencyKey: idempotencyKey(),
      });
      setReasonOpen(false);
      setOtherNote('');
      if (result.ok) {
        onCompleted(
          result.code === 'not_required_accepted'
            ? 'Recorded as not required.'
            : 'Sent to your manager to accept.',
        );
      } else {
        onFailed(result.message);
      }
    });
  }

  function decide(accept: boolean, note?: string) {
    if (!exception) return;
    startTransition(async () => {
      const result = await decideRoutineException({
        exceptionId: exception.id,
        accept,
        note: note ?? null,
        idempotencyKey: idempotencyKey(),
      });
      setReturnOpen(false);
      setReturnNote('');
      if (result.ok) {
        onCompleted(accept ? 'Accepted as not required.' : 'Returned to be completed.');
      } else {
        onFailed(result.message);
      }
    });
  }

  // --- already settled -------------------------------------------------------

  if (status === 'completed') {
    return (
      <div className="routine-outcome settled done">
        <strong>✓ Completed</strong>
        <span>
          {stepsCompleted}/{stepsTotal} steps
          {evidenceCount > 0
            ? ` · ${evidenceCount} attachment${evidenceCount === 1 ? '' : 's'}`
            : ''}
        </span>
      </div>
    );
  }

  if (exception?.state === 'accepted') {
    return (
      <div className="routine-outcome settled skipped">
        <strong>— Not required</strong>
        <span>
          {REASON_LABELS[exception.reasonCode]}
          {exception.reasonNote ? ` · ${exception.reasonNote}` : ''}
        </span>
        <span className="muted">
          Raised by {exception.raisedByName}
          {exception.decidedByName ? ` · accepted by ${exception.decidedByName}` : ''}
          {exception.decidedAt ? ` · ${moment(exception.decidedAt)}` : ''}
        </span>
      </div>
    );
  }

  // --- waiting on a manager --------------------------------------------------

  if (exception?.state === 'pending') {
    return (
      <div className="routine-outcome awaiting">
        <div className="routine-outcome-copy">
          <strong>Marked as not required</strong>
          <span>
            {REASON_LABELS[exception.reasonCode]}
            {exception.reasonNote ? ` · ${exception.reasonNote}` : ''}
          </span>
          <span className="muted">
            {exception.raisedByName} · {moment(exception.raisedAt)}
          </span>
        </div>
        {canDecide ? (
          <div className="routine-outcome-actions">
            <button
              type="button"
              className="btn primary"
              disabled={working}
              aria-busy={working}
              onClick={() => decide(true)}
            >
              Accept
            </button>
            <button
              type="button"
              className="btn"
              disabled={working}
              onClick={() => setReturnOpen(true)}
            >
              Return
            </button>
          </div>
        ) : (
          <span className="muted">Waiting for your manager to accept.</span>
        )}

        {returnOpen && (
          <Modal open title="Return this occurrence" onClose={() => setReturnOpen(false)}>
            <form
              className="modalbody detail-form"
              onSubmit={(event) => {
                event.preventDefault();
                if (!returnNote.trim()) return;
                decide(false, returnNote.trim());
              }}
            >
              {/* The only decision that costs a sentence. Accepting is one
                  click; returning it means somebody has to go and do the work,
                  and they cannot act on "returned" alone. */}
              <label>
                <span>Why does it still need doing?</span>
                <textarea
                  rows={3}
                  maxLength={500}
                  required
                  value={returnNote}
                  onChange={(event) => setReturnNote(event.target.value)}
                />
              </label>
              <div className="modalfoot">
                <button type="button" className="btn" onClick={() => setReturnOpen(false)}>
                  Cancel
                </button>
                <button className="btn primary" disabled={working} aria-busy={working}>
                  Return it
                </button>
              </div>
            </form>
          </Modal>
        )}
      </div>
    );
  }

  // --- open ------------------------------------------------------------------

  return (
    <div className="routine-outcome open">
      {exception?.state === 'returned' && (
        <p className="routine-returned">
          <strong>Returned by {exception.decidedByName ?? 'your manager'}.</strong>{' '}
          {exception.decisionNote}
        </p>
      )}

      {/* Decided once, on the schedule, so nobody doing the work has to
          wonder whether this particular one needs a photo. */}
      {routine.evidenceRequired ? (
        <div className="routine-evidence required">
          <strong>Evidence required</strong>
          <span>
            {routine.evidenceInstruction ??
              'Attach at least one photo or record before completing this.'}
          </span>
        </div>
      ) : null}

      {canAct && (
        <>
          {/*
            Said, not hidden in a tooltip. "Complete is greyed out" is a
            question; "Finish 2 steps and add evidence" is an instruction, and
            somebody standing in a plant with a phone cannot hover anything.
          */}
          {!readyToComplete && blockers.length > 0 && (
            <p className="routine-blockers">{blockers.join(' · ')}</p>
          )}
          <div className="routine-outcome-actions">
            {/*
              Opens the same form Focus completion opens.

              It used to complete immediately, which meant evidence had to be
              attached somewhere else first and a routine occurrence and a
              piece of Focus work were finished by two different rituals. An
              inspection is exactly the case where the proof is a photograph
              taken at that moment, so the form is where the photograph goes.
            */}
            <button
              type="button"
              className="btn primary"
              disabled={working || !readyToComplete}
              aria-busy={working}
              title={
                readyToComplete || blockers.length === 0
                  ? undefined
                  : `Not yet: ${blockers.join('; ')}`
              }
              onClick={() => setCompleteOpen(true)}
            >
              Complete
            </button>
            <button
              type="button"
              className="btn ghost routine-skip"
              disabled={working}
              onClick={() => setReasonOpen(true)}
            >
              Not required this time
            </button>
          </div>
          {completeOpen && (
            <Modal
              open
              title="Complete work"
              className="completion-modal"
              onClose={() => setCompleteOpen(false)}
            >
              <div className="modal-head">
                <div>
                  <strong>Complete work</strong>
                  <span>This records the result, its evidence, and closes the occurrence.</span>
                </div>
                <button
                  type="button"
                  className="btn small"
                  aria-label="Close completion form"
                  onClick={() => setCompleteOpen(false)}
                >
                  &times;
                </button>
              </div>
              <CompletionForm
                taskId={taskId}
                expectedVersion={taskVersion}
                stepsTotal={stepsTotal}
                stepsCompleted={stepsCompleted}
                stepsNeedingEvidence={0}
                existingEvidenceCount={evidenceCount}
                readyToComplete={readyToComplete}
                blockers={blockers}
                pending={working}
                onCancel={() => setCompleteOpen(false)}
                onDone={(message) => {
                  setCompleteOpen(false);
                  onCompleted(message);
                }}
                onFailed={onFailed}
              />
            </Modal>
          )}

          {/* Quiet, and optional. Most people never touch it: a routine
              records itself, and a running commentary is Focus vocabulary. */}
          <button
            type="button"
            className="btn small ghost routine-note"
            aria-expanded={noteOpen}
            onClick={onAddNote}
          >
            + Add note
          </button>
        </>
      )}

      {reasonOpen && (
        <Modal open title="Not required this time" onClose={() => setReasonOpen(false)}>
          <div className="modalbody routine-reasons">
            <p className="muted">Why wasn&rsquo;t this required?</p>
            {/* The two common answers submit on the press. Only "Other" costs
                a sentence, and only because nobody can act on the word
                "other" a year later. */}
            <button
              type="button"
              className="btn"
              disabled={working}
              onClick={() => raise('no_applicable_work')}
            >
              No applicable site or work
            </button>
            <button
              type="button"
              className="btn"
              disabled={working}
              onClick={() => raise('activity_cancelled')}
            >
              Activity cancelled
            </button>
            <form
              className="routine-reason-other"
              onSubmit={(event) => {
                event.preventDefault();
                if (!otherNote.trim()) return;
                raise('other', otherNote.trim());
              }}
            >
              <label>
                <span>Other — brief reason</span>
                <input
                  maxLength={500}
                  value={otherNote}
                  onChange={(event) => setOtherNote(event.target.value)}
                />
              </label>
              <button className="btn small" disabled={working || !otherNote.trim()}>
                Submit
              </button>
            </form>
          </div>
        </Modal>
      )}
    </div>
  );
}
