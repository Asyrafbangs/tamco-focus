'use client';

import { useEffect } from 'react';

/**
 * Error boundary for Finding Management.
 *
 * The module had none. `(app)/error.tsx` exists because eleven reads in
 * `src/server/queries.ts` throw when they fail and, without a boundary, "the
 * navigation, the header and the whole shell vanished, replaced by a stack
 * trace on a white background" — its own words. Finding Management then
 * acquired reads that throw for exactly the same reason, in v282 and v283 and
 * again here, and had nowhere to catch them: a gateway 502 on one read took
 * the whole module down to a framework error page.
 *
 * So the rule the throws were introduced for was only half kept. Telling a
 * coordinator "this page could not be found" was the lie being removed;
 * replacing it with a stack trace says the application is broken, which is a
 * different false statement about the same blink of a database.
 *
 * `reset()` re-runs the failed segment without a full reload. The reads these
 * throws come from are reads, so there is nothing to lose by retrying, and in
 * the case that prompted all of this — a gateway 502 that does not survive
 * being asked again — the retry is usually the whole fix.
 *
 * What this does NOT catch, which is worth knowing before relying on it:
 * `error.js` wraps nested layouts, pages and their children, but not the
 * `layout.js` above it in its own segment — `node_modules/next/dist/docs`,
 * `03-file-conventions/error.md`, is explicit about it. So every read under
 * `findings/` is covered, `findings/layout.tsx` among them, but
 * `(esh)/layout.tsx` is not, and it calls `getEshAccess()` for the module
 * chrome. A failed ACCESS read therefore still escapes to the framework's
 * page. Covering that needs a boundary at `src/app/`, which would also newly
 * catch `(app)/layout.tsx` and is a decision about every route in the
 * application rather than about this module.
 */
export default function FindingManagementError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[Finding Management]', error);
  }, [error]);

  return (
    <div className="empty-state card" role="alert">
      <h1>Finding Management could not be loaded</h1>
      <p>
        Something could not be read. Nothing is shown rather than a page that might be missing
        findings, people or figures — and nothing has been changed. If you had just saved something,
        check whether it is there before doing it again.
      </p>
      {/*
       * Shown because these messages name the read and carry the database's
       * own code: somebody reporting "it said the contact directory could not
       * be read, PGRST000" has said exactly which read failed and why.
       */}
      <p className="form-hint">{error.message}</p>
      <button type="button" className="btn primary" onClick={reset}>
        Try again
      </button>
    </div>
  );
}
