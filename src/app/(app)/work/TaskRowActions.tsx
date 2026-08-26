'use client';

import Link from 'next/link';
import { useRef, useState, useTransition } from 'react';

import { Modal } from '@/components/ui/Modal';
import { activateTask, moveTaskToAvailable } from '@/server/actions/task-actions';
import {
  ACTIVATION_REASON_OPTIONS,
  canOfferActivate,
  canOfferMoveOut,
  validateActivationReason,
} from '@/domain/focus';
import type { ActivationReason, FocusBucket, TaskStatus } from '@/domain/types';

import { useTaskActionFeedback, type TaskActionFeedbackOrigin } from './TaskActionFeedback';

/**
 * Activate / Move out, with the over-target question and Undo.
 *
 * The behaviour this implements, from section 7:
 *   * Activate is offered whenever the state allows it. Reaching the focus
 *     target NEVER disables it (7.2).
 *   * Within target, one click, no confirmation, no approval (7.3).
 *   * Over target, exactly one question, one reason, a note only for "Other",
 *     then activation proceeds without approval (7.4).
 *   * Both actions offer about ten seconds of Undo (7.3, 7.5).
 *
 * The server decides whether the target is exceeded. This component does not
 * pre-compute it: it calls Activate, and opens the dialog only if the server
 * answers `reason_required`. That way the question is asked against committed
 * state rather than a possibly stale count.
 */

interface TaskRowActionsProps {
  taskId: string;
  title: string;
  status: TaskStatus;
  version: number;
  bucket: FocusBucket | null;
  isMandatory: boolean;
  openHref?: string;
}

interface OverTargetPrompt {
  message: string;
  countBefore: number;
  countAfter: number;
  target: number;
}

/** A fresh key per user gesture, so a double-click is absorbed by the server
 * rather than performing the action twice. */
function newIdempotencyKey() {
  return crypto.randomUUID();
}

export function TaskRowActions({
  taskId,
  title,
  status,
  version,
  isMandatory,
  openHref,
}: TaskRowActionsProps) {
  const [pending, startTransition] = useTransition();
  const { offerUndo } = useTaskActionFeedback();
  const actions = useRef<HTMLDivElement>(null);

  const [prompt, setPrompt] = useState<OverTargetPrompt | null>(null);
  const [reasonCode, setReasonCode] = useState<ActivationReason | null>(null);
  const [reasonNote, setReasonNote] = useState('');
  const [reasonError, setReasonError] = useState<string | null>(null);

  const [error, setError] = useState<string | null>(null);

  function feedbackOrigin(action: TaskActionFeedbackOrigin['action']): TaskActionFeedbackOrigin {
    return {
      action,
      taskId,
      dialog: actions.current?.closest<HTMLElement>('[role="dialog"][aria-modal="true"]') ?? null,
    };
  }

  function runActivate(code: ActivationReason | null, note: string | null) {
    setError(null);
    const origin = feedbackOrigin('activate');

    startTransition(async () => {
      const result = await activateTask({
        taskId,
        expectedVersion: version,
        reasonCode: code,
        reasonNote: note,
        idempotencyKey: newIdempotencyKey(),
      });

      if (result.ok) {
        setPrompt(null);
        setReasonCode(null);
        setReasonNote('');
        offerUndo(
          (result as { audit_event_id?: string }).audit_event_id,
          `"${title}" is now active.`,
          isMandatory,
          origin,
        );
        return;
      }

      if (result.code === 'reason_required') {
        const detail = result.detail as
          { count_before?: number; count_after?: number; target?: number } | undefined;

        setPrompt({
          message: result.message,
          countBefore: detail?.count_before ?? 0,
          countAfter: detail?.count_after ?? 0,
          target: detail?.target ?? 0,
        });
        return;
      }

      if (result.code === 'reason_note_required') {
        setReasonError(result.message);
        return;
      }

      setError(result.message);
    });
  }

  function submitReason() {
    const validation = validateActivationReason(reasonCode, reasonNote);

    if (!validation.valid) {
      setReasonError(validation.message);
      return;
    }

    setReasonError(null);
    runActivate(reasonCode, reasonNote || null);
  }

  function runMoveOut() {
    setError(null);
    const origin = feedbackOrigin('move-out');

    startTransition(async () => {
      const result = await moveTaskToAvailable({
        taskId,
        expectedVersion: version,
        idempotencyKey: newIdempotencyKey(),
      });

      if (result.ok) {
        offerUndo(
          (result as { audit_event_id?: string }).audit_event_id,
          `"${title}" moved to Available Work.`,
          isMandatory,
          origin,
        );
        return;
      }

      setError(result.message);
    });
  }

  return (
    <div ref={actions} className="row-actions">
      {openHref && (
        <Link href={openHref} className="btn small">
          Open
        </Link>
      )}
      {canOfferActivate(status) && (
        <button
          type="button"
          className="btn small primary"
          onClick={() => runActivate(null, null)}
          disabled={pending}
          aria-busy={pending}
          data-task-feedback-action="activate"
          data-task-feedback-id={taskId}
        >
          {pending ? 'Working…' : 'Activate'}
        </button>
      )}

      {canOfferMoveOut(status) && (
        // Section 7.5 — a quiet secondary action, never styled as destructive
        // and never called Cancel or Delete.
        <button
          type="button"
          className="btn small ghost"
          onClick={runMoveOut}
          disabled={pending}
          aria-busy={pending}
          data-task-feedback-action="move-out"
          data-task-feedback-id={taskId}
        >
          Move out
        </button>
      )}

      {error && (
        <div className="notice error" role="alert" style={{ marginTop: 8, width: '100%' }}>
          <strong>Could not complete that action</strong>
          <p>{error}</p>
        </div>
      )}

      {/* Section 7.4 — exactly one question, asked once. */}
      <Modal open={Boolean(prompt)} title="Over focus target" onClose={() => setPrompt(null)}>
        {prompt && (
          <>
            <div className="modalhead">
              <h2 id="over-target-title">Over focus target</h2>
              <button type="button" className="btn small ghost" onClick={() => setPrompt(null)}>
                Close
              </button>
            </div>

            <div className="modalbody">
              <p style={{ marginTop: 0 }}>{prompt.message}</p>

              <div className="field">
                <label htmlFor={`reason-${taskId}`}>Why is this additional focus needed now?</label>
                <select
                  id={`reason-${taskId}`}
                  value={reasonCode ?? ''}
                  onChange={(event) => {
                    setReasonCode((event.target.value || null) as ActivationReason | null);
                    setReasonError(null);
                  }}
                  aria-invalid={reasonError ? 'true' : undefined}
                  aria-describedby={reasonError ? `reason-error-${taskId}` : undefined}
                >
                  <option value="">Select a reason</option>
                  {ACTIVATION_REASON_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* A note is required only for "Other" (section 7.4). */}
              {reasonCode === 'other' && (
                <div className="field">
                  <label htmlFor={`note-${taskId}`}>Add a short note</label>
                  <textarea
                    id={`note-${taskId}`}
                    rows={3}
                    value={reasonNote}
                    onChange={(event) => {
                      setReasonNote(event.target.value);
                      setReasonError(null);
                    }}
                    aria-invalid={reasonError ? 'true' : undefined}
                  />
                </div>
              )}

              {reasonError && (
                <p id={`reason-error-${taskId}`} className="error" role="alert">
                  {reasonError}
                </p>
              )}

              <p className="muted" style={{ fontSize: 11 }}>
                Your manager is notified, but no approval is needed. The reason is kept in this
                task&rsquo;s history.
              </p>
            </div>

            <div className="modalfoot">
              <button type="button" className="btn" onClick={() => setPrompt(null)}>
                Cancel
              </button>
              {/* Approved wording (PRODUCTION_LOGIC.md section 9). */}
              <button
                type="button"
                className="btn primary"
                onClick={submitReason}
                disabled={pending}
                aria-busy={pending}
              >
                Activate anyway
              </button>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}
