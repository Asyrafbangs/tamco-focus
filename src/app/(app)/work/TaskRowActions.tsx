'use client';

import Link from 'next/link';
import { useRef, useState, useTransition } from 'react';

import { activateTask, moveTaskToAvailable } from '@/server/actions/task-actions';
import { canOfferActivate, canOfferMoveOut } from '@/domain/focus';
import type { FocusBucket, TaskStatus, WorkClass } from '@/domain/types';

import { useTaskActionFeedback, type TaskActionFeedbackOrigin } from './TaskActionFeedback';

/**
 * Start work / Move out, with Undo.
 *
 * One click either way, no confirmation and no approval, and about ten seconds
 * of Undo on both (section 7.3, 7.5).
 *
 * The button reads "Start work" since v146. §9 names it as the primary action
 * on Available, and "Activate" was internal vocabulary: it describes what the
 * record does, not what the person is about to do.
 *
 * There used to be a question in the middle of this. Crossing the focus target
 * returned `reason_required`, and the person had to choose from a list of six
 * reasons and watch a note go to their manager before the work would start.
 * v144 removed it with the target: the Manager and Employee Change
 * Specification (§3) says these ratios are not reliable workload measures, and
 * §11 asks for the enforcement built on them to go too. Making somebody
 * justify themselves against a number the product has just disowned was the
 * clearest example of it.
 */

interface TaskRowActionsProps {
  taskId: string;
  title: string;
  status: TaskStatus;
  version: number;
  bucket: FocusBucket | null;
  isMandatory: boolean;
  /**
   * What kind of work this is. A routine occurrence is never activated, so the
   * row must not offer it: the schedule decides when the occurrence exists and
   * it consumes no focus target.
   */
  workClass?: WorkClass;
  openHref?: string;
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
  workClass,
  openHref,
}: TaskRowActionsProps) {
  const [pending, startTransition] = useTransition();
  const { offerUndo } = useTaskActionFeedback();
  const actions = useRef<HTMLDivElement>(null);

  const [error, setError] = useState<string | null>(null);

  function feedbackOrigin(action: TaskActionFeedbackOrigin['action']): TaskActionFeedbackOrigin {
    return {
      action,
      taskId,
      dialog: actions.current?.closest<HTMLElement>('[role="dialog"][aria-modal="true"]') ?? null,
    };
  }

  function runActivate() {
    setError(null);
    const origin = feedbackOrigin('activate');

    startTransition(async () => {
      const result = await activateTask({
        taskId,
        expectedVersion: version,
        idempotencyKey: newIdempotencyKey(),
      });

      if (result.ok) {
        offerUndo(
          (result as { audit_event_id?: string }).audit_event_id,
          `"${title}" is now active.`,
          isMandatory,
          origin,
        );
        return;
      }

      setError(result.message);
    });
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
      {canOfferActivate(status, workClass) && (
        <button
          type="button"
          className="btn small primary"
          onClick={runActivate}
          disabled={pending}
          aria-busy={pending}
          data-task-feedback-action="activate"
          data-task-feedback-id={taskId}
        >
          {pending ? 'Working…' : 'Start work'}
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
    </div>
  );
}
