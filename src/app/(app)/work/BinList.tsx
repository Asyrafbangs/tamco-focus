'use client';

import { useTransition, useState } from 'react';
import { useRouter } from 'next/navigation';

import { Modal } from '@/components/ui/Modal';
import { purgeTask, restoreTask } from '@/server/actions/task-actions';
import type { BinnedTask } from '@/server/queries';

/**
 * The Bin.
 *
 * Deleted work, the way back out of it, and the way to finish the job.
 *
 * Deletion here is recoverable by design — every table referencing `tasks`
 * cascades, so a real DELETE would take the audit history with it — which is
 * why Restore is the point of the screen. But the Bin only ever filled up: one
 * account reached twenty-one rows of the same few titles, none of which would
 * ever be restored, and there was no way to clear them.
 *
 * Permanent deletion therefore means gone from the application and recorded in
 * the database, which is the honest version of the promise. It is confirmed
 * first, because unlike everything else on this screen it cannot be undone.
 */
export function BinList({
  tasks,
  failed = false,
}: {
  tasks: readonly BinnedTask[];
  failed?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [confirmPurge, setConfirmPurge] = useState<BinnedTask | null>(null);

  // Distinguished from emptiness on purpose: a failed read used to render as
  // 'The Bin is empty', which told somebody their deleted work was gone.
  if (failed) {
    return (
      <div className="notice error" role="alert">
        <strong>The Bin could not be loaded</strong>
        <p>Nothing has been lost. Refresh the page, and tell an administrator if it persists.</p>
      </div>
    );
  }

  if (tasks.length === 0) {
    return (
      <div className="empty-state">
        <strong>The Bin is empty</strong>
        <p>
          Work you delete appears here, and can be restored. Deleted routines are kept with the
          routines themselves, under Routine.
        </p>
      </div>
    );
  }

  return (
    <>
      {error && (
        <div className="notice error" role="alert">
          <p>{error}</p>
        </div>
      )}
      <ul className="bin-list">
        {tasks.map((task) => (
          <li key={task.id} className="bin-row">
            <div>
              <strong>{task.title}</strong>
              <small className="muted">
                {task.ownerName}
                {task.deletedByName ? ` · deleted by ${task.deletedByName}` : ''} ·{' '}
                {new Date(task.deletedAt).toLocaleDateString('en-GB', {
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
                })}
              </small>
            </div>
            <div className="bin-row-actions">
              <button
                type="button"
                className="btn small"
                disabled={pending && restoring === task.id}
                aria-busy={pending && restoring === task.id}
                onClick={() => {
                  setError(null);
                  setRestoring(task.id);
                  startTransition(async () => {
                    const result = await restoreTask({
                      taskId: task.id,
                      idempotencyKey: crypto.randomUUID(),
                    });
                    if (!result.ok) {
                      setError(result.message);
                      return;
                    }
                    router.refresh();
                  });
                }}
              >
                {pending && restoring === task.id ? 'Restoring…' : 'Restore'}
              </button>
              <button
                type="button"
                className="btn small danger"
                disabled={pending}
                onClick={() => {
                  setError(null);
                  setConfirmPurge(task);
                }}
              >
                Delete permanently
              </button>
            </div>
          </li>
        ))}
      </ul>
      {confirmPurge && (
        <Modal open title="Delete permanently?" onClose={() => setConfirmPurge(null)}>
          <header className="modalhead">
            <div>
              <p className="eyebrow">Permanent</p>
              <h2>{confirmPurge.title}</h2>
            </div>
          </header>
          <div className="modalbody">
            <p>
              This removes it from the application for good. It will not appear in the Bin, in any
              list, or in search, and it cannot be restored.
            </p>
            <p className="muted">
              The database keeps a record that this work existed and was deleted, along with who
              deleted it and when. That history is not removable — it is what the audit trail is
              for.
            </p>
          </div>
          <footer className="modalfoot">
            <button type="button" className="btn" onClick={() => setConfirmPurge(null)}>
              Keep it in the Bin
            </button>
            <button
              type="button"
              className="btn danger"
              disabled={pending}
              aria-busy={pending}
              onClick={() => {
                const target = confirmPurge;
                setError(null);
                startTransition(async () => {
                  const result = await purgeTask({
                    taskId: target.id,
                    idempotencyKey: crypto.randomUUID(),
                  });
                  setConfirmPurge(null);
                  if (!result.ok) {
                    setError(result.message ?? 'Nothing changed.');
                    return;
                  }
                  router.refresh();
                });
              }}
            >
              {pending ? 'Deleting…' : 'Delete permanently'}
            </button>
          </footer>
        </Modal>
      )}
    </>
  );
}
