'use client';

import { useState, useTransition } from 'react';

import { releaseHeldNotifications } from '@/server/esh/rollout-actions';

/**
 * Letting go of everything that is held, from where the count is read (v224,
 * §43.4).
 *
 * Releasing stayed a separate, deliberate act from clearing a contact (FM106)
 * and it still is — this changes nothing about who may be written to. What it
 * changes is that an afternoon of ninety-four identical presses, each one on a
 * different finding, becomes one. The database calls the same single-letter
 * release for each, so a contact nobody cleared is still not written to, and
 * the answer names whatever would not go and why.
 *
 * Shown only when something is actually releasable: the operational line above
 * already says how much is held and why, and a button that cannot do anything
 * is worse than no button.
 */
export function HeldNoticesRelease({ releasable }: { releasable: number }) {
  const [said, setSaid] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  if (releasable === 0 && !said) return null;

  return (
    <section className="esh-held-release" aria-labelledby="esh-held-release-title">
      <h2 id="esh-held-release-title">
        {releasable > 0
          ? `${releasable} notification${releasable === 1 ? '' : 's'} can go out now`
          : 'Held notifications'}
      </h2>
      {said ? (
        <p role="status">{said}</p>
      ) : (
        <p>
          Their contacts can be written to. Nothing has been sent yet: releasing is a separate act
          from clearing somebody.
        </p>
      )}
      {releasable > 0 && (
        <button
          type="button"
          className="btn primary"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const answer = await releaseHeldNotifications();
              setSaid(answer.message);
            })
          }
        >
          {pending ? 'Releasing…' : `Release all ${releasable}`}
        </button>
      )}
    </section>
  );
}
