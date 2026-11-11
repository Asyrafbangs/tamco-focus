'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { useHydrated } from '@/components/esh/use-hydrated';
import { reopenFinding } from '@/server/esh/verification-actions';

/**
 * Reopening a closed finding (§13, FM52). A Verifier's decision, with a
 * reason. The closure, the accepted submission and the verification stay in
 * the record; the owner gets the work back and fresh links.
 */
export function ReopenFinding({ findingId }: { findingId: string }) {
  const router = useRouter();
  const [reason, setReason] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
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

  return (
    <div className="esh-action-menu-panel">
      <div className="form-grid two">
        <label className="esh-field">
          <span>Why it is being reopened (the owner sees it)</span>
          <input
            value={reason}
            maxLength={500}
            onChange={(event) => {
              setReason(event.target.value);
              setProblem(null);
            }}
          />
        </label>
        <label className="esh-field">
          <span>New due date (optional)</span>
          <input
            type="date"
            value={dueDate}
            onChange={(event) => {
              setDueDate(event.target.value);
              setProblem(null);
            }}
          />
        </label>
      </div>
      {problem && (
        <p className="esh-field-error" role="alert">
          {problem}
        </p>
      )}
      <button
        type="button"
        className="btn"
        disabled={!hydrated || pending}
        onClick={() =>
          startTransition(async () => {
            const result = await reopenFinding({
              findingId,
              reason,
              dueDate: dueDate || null,
              dueTime: null,
            });
            if (!result.ok) {
              setProblem(result.message);
              return;
            }
            setProblem(null);
            router.refresh();
          })
        }
      >
        {pending ? 'Reopening…' : 'Reopen finding'}
      </button>
    </div>
  );
}
