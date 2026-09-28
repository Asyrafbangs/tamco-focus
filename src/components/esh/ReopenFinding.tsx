'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

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
        disabled={pending}
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
