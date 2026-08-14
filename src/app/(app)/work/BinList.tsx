'use client';

import { useTransition, useState } from 'react';
import { useRouter } from 'next/navigation';

import { restoreRoutineTemplate } from '@/server/actions/routine-actions';
import { restoreTask } from '@/server/actions/task-actions';
import type { BinnedRoutine, BinnedTask } from '@/server/queries';

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
  routines = [],
  failed = false,
}: {
  tasks: readonly BinnedTask[];
  /** Deleted schedules. A routine is binned for the same reason a task is. */
  routines?: readonly BinnedRoutine[];
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

  if (tasks.length === 0 && routines.length === 0) {
    return (
      <div className="empty-state">
        <strong>The Bin is empty</strong>
        <p>Work and routines you delete appear here, and can be restored.</p>
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

      {routines.length > 0 && (
        <>
          <p className="bin-section-heading">Routines</p>
          <ul className="bin-list">
            {routines.map((routine) => (
              <li key={routine.id} className="bin-row">
                <div>
                  <strong>{routine.title}</strong>
                  <small className="muted">
                    {routine.recurrence} · {routine.ownerName} ·{' '}
                    {new Date(routine.deletedAt).toLocaleDateString('en-GB', {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                    })}
                  </small>
                </div>
                <button
                  type="button"
                  className="btn small"
                  disabled={pending && restoring === routine.id}
                  aria-busy={pending && restoring === routine.id}
                  onClick={() => {
                    setError(null);
                    setRestoring(routine.id);
                    startTransition(async () => {
                      const result = await restoreRoutineTemplate({
                        templateId: routine.id,
                        idempotencyKey: crypto.randomUUID(),
                      });
                      if (!result.ok) {
                        setError(result.message ?? 'Nothing changed.');
                        return;
                      }
                      router.refresh();
                    });
                  }}
                >
                  {pending && restoring === routine.id ? 'Restoring…' : 'Restore paused'}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
