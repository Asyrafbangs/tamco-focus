'use client';

import { useState, useTransition } from 'react';

import { reassignAction } from '@/server/esh/verification-actions';

/**
 * The owner says it is not theirs; ESH decides (§14).
 *
 * Handing work over is not something an owner may do to themselves — it would
 * let an action be passed around until it expired with nobody accountable. So
 * the owner names a person and ESH presses this, which is the ordinary
 * reassignment: a new assignment interval, a reason, an audit entry, the old
 * links revoked and the new owner written to.
 */
export function AcceptHandover({
  actionId,
  findingId,
  email,
}: {
  actionId: string;
  findingId: string;
  email: string;
}) {
  const [pending, startTransition] = useTransition();
  const [problem, setProblem] = useState<string | null>(null);

  return (
    <span className="esh-accept-date">
      <button
        type="button"
        className="btn small"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await reassignAction({
              actionId,
              findingId,
              ownerEmail: email,
              reason: `The Action Owner said this belongs to ${email}.`,
            });
            if (!result.ok) {
              setProblem('That handover was refused. Use Give to another owner instead.');
            }
          })
        }
      >
        {pending ? 'Handing over…' : `Give it to ${email}`}
      </button>
      {problem && (
        <span className="esh-field-error" role="alert">
          {problem}
        </span>
      )}
    </span>
  );
}
