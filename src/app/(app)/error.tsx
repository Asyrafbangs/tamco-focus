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
      <h1>Something went wrong</h1>
      {/*
        v182 — it used to say "this was a read, not a save" and to check the
        local database. The same page catches a save that fails, and the live
        site has no local database; a sentence that is wrong half the time is
        worse than a plainer one.
      */}
      <p>
        This page hit a problem. If you had just saved something, check whether the change is there
        before doing it again. Try again, and if it keeps happening, tell your administrator and
        quote the reference below.
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
