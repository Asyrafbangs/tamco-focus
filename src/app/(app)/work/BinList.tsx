'use client';

import { useTransition, useState } from 'react';
import { useRouter } from 'next/navigation';

import { restoreTask } from '@/server/actions/task-actions';
import type { BinnedTask } from '@/server/queries';

/**
 * The Bin.
 *
 * Deleted work, and the way back out of it. Deletion here is recoverable by
 * design — every table referencing `tasks` cascades, so a real DELETE would
 * take the audit history with it — which makes Restore the point of the screen
 * rather than a courtesy.
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
          </li>
        ))}
      </ul>
    </>
  );
}
