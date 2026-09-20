'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { VERIFICATION_METHODS, type VerificationMethod } from '@/domain/esh-verification';
import { verifySubmission } from '@/server/esh/verification-actions';

/**
 * Deciding the submission in front of ESH (§13).
 *
 * Accepting records how it was verified — evidence is not accepted because a
 * photo exists. For the last open action the one button says what it does:
 * accept and close the finding. Asking for more needs an explanation the
 * owner will read, and an explicit decision about the deadline, so a
 * correction never quietly restarts the clock (FM23).
 */
export function VerifyPanel({
  submissionId,
  findingId,
  version,
  closesFinding,
}: {
  submissionId: string;
  findingId: string;
  version: number;
  closesFinding: boolean;
}) {
  const router = useRouter();
  const [method, setMethod] = useState<VerificationMethod>('document_review');
  const [note, setNote] = useState('');
  const [asking, setAsking] = useState(false);
  const [keepDue, setKeepDue] = useState<'keep' | 'change'>('keep');
  const [dueDate, setDueDate] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function decide(decision: 'accepted' | 'changes_requested') {
    startTransition(async () => {
      const result = await verifySubmission({
        submissionId,
        findingId,
        decision,
        method: decision === 'accepted' ? method : null,
        note,
        keepDue: decision === 'accepted' ? null : keepDue === 'keep',
        dueDate: decision === 'accepted' || keepDue === 'keep' ? null : dueDate,
        dueTime: null,
      });
      if (!result.ok) {
        setProblem(result.message);
        return;
      }
      setProblem(null);
      router.refresh();
    });
  }

  return (
    <div className="esh-verify">
      <h3 className="esh-subheading">Verify the submitted correction</h3>
      <div className="form-grid two">
        <label className="esh-field">
          <span>Verification method</span>
          <select
            value={method}
            onChange={(event) => {
              setMethod(event.target.value as VerificationMethod);
              setProblem(null);
            }}
          >
            {VERIFICATION_METHODS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="esh-field">
          <span>{asking ? 'What is still needed' : 'Verification note'}</span>
          <textarea
            rows={3}
            maxLength={2000}
            value={note}
            onChange={(event) => {
              setNote(event.target.value);
              setProblem(null);
            }}
            placeholder={
              asking
                ? 'The owner reads this in their conversation.'
                : 'Condition checked against the required outcome.'
            }
          />
        </label>
      </div>

      {asking && (
        <fieldset className="esh-due-decision">
          <legend>The due date</legend>
          <label className="check-row">
            <input
              type="radio"
              name="due-decision"
              checked={keepDue === 'keep'}
              onChange={() => setKeepDue('keep')}
            />
            <span>Keep the current due date</span>
          </label>
          <label className="check-row">
            <input
              type="radio"
              name="due-decision"
              checked={keepDue === 'change'}
              onChange={() => setKeepDue('change')}
            />
            <span>Give a new due date</span>
          </label>
          {keepDue === 'change' && (
            <label className="esh-field">
              <span>New due date</span>
              <input
                type="date"
                value={dueDate}
                onChange={(event) => {
                  setDueDate(event.target.value);
                  setProblem(null);
                }}
              />
            </label>
          )}
        </fieldset>
      )}

      {problem && (
        <p className="esh-field-error" role="alert">
          {problem}
        </p>
      )}

      <div className="esh-verify-actions">
        {asking ? (
          <>
            <button
              type="button"
              className="btn"
              onClick={() => {
                setAsking(false);
                setProblem(null);
              }}
              disabled={pending}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn primary"
              onClick={() => decide('changes_requested')}
              disabled={pending}
            >
              {pending ? 'Sending…' : `Send back version ${version}`}
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="btn"
              onClick={() => {
                setAsking(true);
                setProblem(null);
              }}
              disabled={pending}
            >
              Request improvement
            </button>
            <button
              type="button"
              className="btn primary"
              onClick={() => decide('accepted')}
              disabled={pending}
            >
              {pending
                ? 'Saving…'
                : closesFinding
                  ? 'Accept & close finding'
                  : 'Accept corrective action'}
            </button>
          </>
        )}
      </div>
      <p className="form-hint">
        {closesFinding
          ? 'Accepting closes the finding: this is its last open action.'
          : 'Other actions on this finding stay open until they are accepted too.'}
      </p>
    </div>
  );
}
