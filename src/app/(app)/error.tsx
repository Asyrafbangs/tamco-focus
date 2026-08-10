'use client';

import { useEffect } from 'react';

/**
 * Error boundary for every authenticated workspace.
 *
 * Eleven queries in `src/server/queries.ts` throw when their read fails —
 * `TASKS_UNAVAILABLE`, `PLAN_UNAVAILABLE`, `TEAM_LOAD_UNAVAILABLE` and the
 * rest. Only Goals had a boundary, so anywhere else those throws escaped to
 * the framework's default page: the navigation, the header and the whole shell
 * vanished, replaced by a stack trace on a white background. Somebody whose
 * database connection blinked would reasonably conclude the application had
 * broken rather than that one read had failed.
 *
 * This keeps them inside the app, tells them their data is intact, and gives
 * them the one action worth offering — try again. `reset()` re-runs the failed
 * segment without a full reload, so nothing else they had open is lost.
 *
 * The identifier is shown because these strings are deliberate and greppable;
 * a person reporting "it said TEAM_LOAD_UNAVAILABLE" has told us exactly which
 * read failed.
 */
export default function WorkspaceError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[Workspace]', error);
  }, [error]);

  return (
    <div className="empty-state card" role="alert">
      <h1>This did not load</h1>
      <p>
        Something went wrong reading your work. Nothing was changed — this was a read, not a save.
        Try again, and if it keeps happening, check that the local database is running.
      </p>
      {error.message && (
        <p className="muted">
          Reference: <code>{error.message}</code>
          {error.digest ? ` · ${error.digest}` : ''}
        </p>
      )}
      <button type="button" className="btn primary" onClick={reset}>
        Try again
      </button>
    </div>
  );
}
