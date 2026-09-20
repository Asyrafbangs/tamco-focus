'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { changeDueDate, reassignAction } from '@/server/esh/verification-actions';

/**
 * The action's secondary menu (§13, §14): change the due date, or give the
 * action to a different address. Both ask for a reason, because both are
 * recorded and shown to the owner — an owner asking for more time in the
 * conversation changes nothing by itself (FM28).
 */
export function ActionMenu({
  actionId,
  findingId,
  ownerEmail,
  dueDate,
}: {
  actionId: string;
  findingId: string;
  ownerEmail: string;
  /** The current due date, as a date input reads it. */
  dueDate: string;
}) {
  const router = useRouter();
  const [newDue, setNewDue] = useState(dueDate);
  const [dueReason, setDueReason] = useState('');
  const [newOwner, setNewOwner] = useState('');
  const [reassignReason, setReassignReason] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(work: () => Promise<{ ok: boolean; message?: string }>, said: string) {
    startTransition(async () => {
      const result = await work();
      if (!result.ok) {
        setProblem(result.message ?? 'Something went wrong.');
        setDone(null);
        return;
      }
      setProblem(null);
      setDone(said);
      router.refresh();
    });
  }

  return (
    <details className="esh-form-more esh-action-menu">
      <summary>Change the due date or the owner</summary>
      {problem && (
        <p className="esh-field-error" role="alert">
          {problem}
        </p>
      )}
      {done && (
        <p className="notice success" role="status">
          {done}
        </p>
      )}

      <div className="esh-action-menu-panel">
        <h3 className="esh-subheading">Change the due date</h3>
        <div className="form-grid two">
          <label className="esh-field">
            <span>New due date</span>
            <input
              type="date"
              value={newDue}
              onChange={(event) => {
                setNewDue(event.target.value);
                setProblem(null);
              }}
            />
          </label>
          <label className="esh-field">
            <span>Reason (the owner sees it)</span>
            <input
              value={dueReason}
              maxLength={500}
              onChange={(event) => {
                setDueReason(event.target.value);
                setProblem(null);
              }}
            />
          </label>
        </div>
        <button
          type="button"
          className="btn"
          disabled={pending}
          onClick={() =>
            run(
              () =>
                changeDueDate({
                  actionId,
                  findingId,
                  dueDate: newDue,
                  dueTime: null,
                  reason: dueReason,
                }),
              'Due date changed. The owner has been told.',
            )
          }
        >
          Change due date
        </button>
      </div>

      <div className="esh-action-menu-panel">
        <h3 className="esh-subheading">Give this action to somebody else</h3>
        <p className="form-hint">
          {ownerEmail} keeps what they wrote; their links to this action stop working at once.
        </p>
        <div className="form-grid two">
          <label className="esh-field">
            <span>New Action Owner email</span>
            <input
              type="email"
              value={newOwner}
              onChange={(event) => {
                setNewOwner(event.target.value);
                setProblem(null);
              }}
            />
          </label>
          <label className="esh-field">
            <span>Reason (recorded)</span>
            <input
              value={reassignReason}
              maxLength={500}
              onChange={(event) => {
                setReassignReason(event.target.value);
                setProblem(null);
              }}
            />
          </label>
        </div>
        <button
          type="button"
          className="btn"
          disabled={pending}
          onClick={() =>
            run(
              () =>
                reassignAction({
                  actionId,
                  findingId,
                  ownerEmail: newOwner,
                  reason: reassignReason,
                }),
              'Reassigned. The new owner is emailed their own links.',
            )
          }
        >
          Reassign action
        </button>
      </div>
    </details>
  );
}
