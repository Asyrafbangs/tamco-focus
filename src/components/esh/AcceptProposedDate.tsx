'use client';

import { useState, useTransition } from 'react';

import { useHydrated } from '@/components/esh/use-hydrated';
import { changeDueDate } from '@/server/esh/verification-actions';

/**
 * The owner asked for more time; ESH answers it here (§14).
 *
 * Until v211 the date an owner asked for was stored with their message and
 * read by nothing, so agreeing to it meant retyping it into the due-date form
 * and hoping it matched. One press now moves the deadline to exactly the date
 * they asked for, with a reason that says so. It is still ESH's decision: the
 * request changed nothing on its own, and declining it needs no button because
 * doing nothing already declines it.
 */
export function AcceptProposedDate({
  actionId,
  findingId,
  date,
  label,
}: {
  actionId: string;
  findingId: string;
  date: string;
  label: string;
}) {
  const [pending, startTransition] = useTransition();
  /*
   * v311 - not pressable until React owns it.
   *
   * These controls are `type="button"` with a React handler and nothing
   * underneath: no form, no action, no native behaviour. Pressed before the
   * page hydrates they do nothing whatsoever - no request, no error, no
   * change on screen - and the person who pressed has every reason to think
   * the decision was taken. On the controls that accept, reject, reopen and
   * reassign a correction, that is the lifecycle silently not moving.
   */
  const hydrated = useHydrated();
  const [problem, setProblem] = useState<string | null>(null);

  return (
    <span className="esh-accept-date">
      <button
        type="button"
        className="btn small"
        disabled={!hydrated || pending}
        onClick={() =>
          startTransition(async () => {
            const result = await changeDueDate({
              actionId,
              findingId,
              dueDate: date,
              dueTime: null,
              reason: `Agreed the Action Owner's request to move the deadline to ${label}.`,
            });
            if (!result.ok) {
              setProblem('The date could not be moved. Use Change due date instead.');
            }
          })
        }
      >
        {pending ? 'Moving…' : `Move the deadline to ${label}`}
      </button>
      {problem && (
        <span className="esh-field-error" role="alert">
          {problem}
        </span>
      )}
    </span>
  );
}
