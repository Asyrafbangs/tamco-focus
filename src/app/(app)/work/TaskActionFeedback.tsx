'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

import { Toast } from '@/components/ui/ParityPrimitives';
import { undoEvent } from '@/server/actions/task-actions';

interface UndoNotice {
  eventId: string;
  label: string;
  isMandatory: boolean;
  origin: TaskActionFeedbackOrigin;
}

export interface TaskActionFeedbackOrigin {
  action: 'activate' | 'move-out';
  taskId: string;
  dialog: HTMLElement | null;
}

interface TaskActionFeedbackContextValue {
  offerUndo: (
    eventId: string | undefined,
    label: string,
    isMandatory: boolean,
    origin: TaskActionFeedbackOrigin,
  ) => void;
}

const TaskActionFeedbackContext = createContext<TaskActionFeedbackContextValue | null>(null);

function newIdempotencyKey() {
  return crypto.randomUUID();
}

/**
 * Keeps action feedback above status-filtered rows.
 *
 * Activating Available work removes that row during the server refresh. Undo
 * must therefore live at the Work-page boundary rather than inside the row
 * whose successful action deliberately unmounts it.
 */
export function TaskActionFeedbackProvider({ children }: { children: ReactNode }) {
  const [notice, setNotice] = useState<UndoNotice | null>(null);
  const [error, setError] = useState<{ message: string; dialog: HTMLElement | null } | null>(null);
  const [pending, startTransition] = useTransition();
  const expiryTimer = useRef<number | null>(null);
  const focusTimer = useRef<number | null>(null);
  const undoButton = useRef<HTMLButtonElement | null>(null);

  const clearExpiryTimer = useCallback(() => {
    if (expiryTimer.current === null) return;
    window.clearTimeout(expiryTimer.current);
    expiryTimer.current = null;
  }, []);

  const clearFocusTimer = useCallback(() => {
    if (focusTimer.current === null) return;
    window.clearTimeout(focusTimer.current);
    focusTimer.current = null;
  }, []);

  useEffect(
    () => () => {
      clearExpiryTimer();
      clearFocusTimer();
    },
    [clearExpiryTimer, clearFocusTimer],
  );

  useEffect(() => {
    if (!notice) return;

    // An over-target activation closes its reason modal before exposing Undo.
    // Keep focus in that top-most modal for its 200 ms exit animation, then
    // move it to the feedback control in the page or underlying task drawer.
    const closingModal = document.querySelector(
      '.modal-layer[data-open="true"] .modal[aria-modal="true"]',
    );
    if (closingModal) {
      const timer = window.setTimeout(() => undoButton.current?.focus(), 210);
      return () => window.clearTimeout(timer);
    }

    undoButton.current?.focus();
  }, [notice]);

  const noticeDialog = notice?.origin.dialog ?? null;
  const errorDialog = error?.dialog ?? null;
  useEffect(() => {
    const dialog = noticeDialog ?? errorDialog;
    if (!dialog) return;

    // A drawer may close while its ten-second Undo is still live. Observe the
    // actual DOM boundary so feedback is re-parented to the Work page as soon
    // as that dialog detaches instead of remaining in an invisible subtree.
    const moveFeedbackToPage = () => {
      if (dialog.isConnected) return;
      setNotice((current) =>
        current?.origin.dialog === dialog
          ? { ...current, origin: { ...current.origin, dialog: null } }
          : current,
      );
      setError((current) => (current?.dialog === dialog ? { ...current, dialog: null } : current));
    };
    const observer = new MutationObserver(moveFeedbackToPage);
    observer.observe(document.body, { childList: true, subtree: true });
    moveFeedbackToPage();
    return () => observer.disconnect();
  }, [errorDialog, noticeDialog]);

  const focusAfterFeedback = useCallback(
    (feedback: UndoNotice, preferRestoredAction: boolean): boolean => {
      const dialog = feedback.origin.dialog?.isConnected ? feedback.origin.dialog : null;

      if (preferRestoredAction) {
        const scope: ParentNode = dialog ?? document;
        const selector =
          `[data-task-feedback-action="${feedback.origin.action}"]` +
          `[data-task-feedback-id="${feedback.origin.taskId}"]`;
        const action = Array.from(scope.querySelectorAll<HTMLButtonElement>(selector)).find(
          (candidate) => !candidate.disabled && candidate.getClientRects().length > 0,
        );
        if (action) {
          action.focus({ preventScroll: true });
          return true;
        }
        return false;
      }

      const fallback =
        dialog ?? document.querySelector<HTMLElement>('[data-task-feedback-page-anchor]');
      fallback?.focus({ preventScroll: true });
      return Boolean(fallback);
    },
    [],
  );

  const queueFocusAfterFeedback = useCallback(
    (feedback: UndoNotice, preferRestoredAction: boolean) => {
      clearFocusTimer();
      let attempts = 0;
      const tryFocus = () => {
        focusTimer.current = null;
        if (focusAfterFeedback(feedback, preferRestoredAction)) return;

        attempts += 1;
        if (attempts >= 20) {
          focusAfterFeedback(feedback, false);
          return;
        }
        focusTimer.current = window.setTimeout(tryFocus, 50);
      };
      focusTimer.current = window.setTimeout(tryFocus, 0);
    },
    [clearFocusTimer, focusAfterFeedback],
  );

  const offerUndo = useCallback(
    (
      eventId: string | undefined,
      label: string,
      isMandatory: boolean,
      origin: TaskActionFeedbackOrigin,
    ) => {
      if (!eventId) return;

      clearExpiryTimer();
      clearFocusTimer();
      setError(null);
      const nextNotice = { eventId, label, isMandatory, origin };
      setNotice(nextNotice);
      // Section 7.3 — approximately ten seconds. The server keeps a wider
      // grace period so a click made at the edge is not lost to network delay.
      expiryTimer.current = window.setTimeout(() => {
        // Do not steal focus if the person already moved on to another control.
        // Restore a stable target only when the expiring Undo still owns it.
        if (document.activeElement === undoButton.current) {
          focusAfterFeedback(nextNotice, false);
        }
        setNotice((current) => (current?.eventId === eventId ? null : current));
        expiryTimer.current = null;
      }, 10_000);
    },
    [clearExpiryTimer, clearFocusTimer, focusAfterFeedback],
  );

  const runUndo = useCallback(() => {
    if (!notice || pending) return;

    const activeNotice = notice;
    clearExpiryTimer();
    startTransition(async () => {
      const result = await undoEvent({
        eventId: activeNotice.eventId,
        idempotencyKey: newIdempotencyKey(),
      });

      setNotice(null);
      if (result.ok) {
        queueFocusAfterFeedback(activeNotice, true);
      } else {
        focusAfterFeedback(activeNotice, false);
        setError({ message: result.message, dialog: activeNotice.origin.dialog });
      }
    });
  }, [clearExpiryTimer, focusAfterFeedback, notice, pending, queueFocusAfterFeedback]);

  const contextValue = useMemo(() => ({ offerUndo }), [offerUndo]);

  const feedback = (
    <>
      {notice && (
        <Toast
          actionLabel={pending ? 'Working…' : 'Undo'}
          onAction={runUndo}
          actionDisabled={pending}
          actionBusy={pending}
          actionRef={undoButton}
        >
          {notice.label}
          {notice.isMandatory && ' Mandatory work activates regardless of the target.'}
        </Toast>
      )}
      {error && (
        <div className="toast error" role="alert">
          <span>
            <strong>Could not undo that action.</strong> {error.message}
          </span>
        </div>
      )}
    </>
  );
  const feedbackDialog = notice?.origin.dialog ?? error?.dialog ?? null;
  const feedbackTarget = feedbackDialog?.isConnected ? feedbackDialog : null;

  return (
    <TaskActionFeedbackContext.Provider value={contextValue}>
      {children}
      {feedbackTarget ? createPortal(feedback, feedbackTarget) : feedback}
    </TaskActionFeedbackContext.Provider>
  );
}

export function useTaskActionFeedback() {
  const value = useContext(TaskActionFeedbackContext);
  if (!value) {
    throw new Error('TaskRowActions must be rendered inside TaskActionFeedbackProvider.');
  }
  return value;
}
