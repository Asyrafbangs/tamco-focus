'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { resolveFinding } from '@/server/esh/verification-actions';

/**
 * An outcome that is not a closure (§6).
 *
 * A finding raised in error, or raised twice, used to have only one way out:
 * close it, which says ESH verified a correction that never happened. These
 * three say what actually became of it. Nothing is deleted — the reference,
 * the conversation and the history stay — but the work stops, the owner's
 * links stop working and anything still queued to send is cancelled.
 */

const OUTCOMES: Array<{
  key: 'cancelled' | 'withdrawn' | 'duplicate';
  label: string;
  hint: string;
}> = [
  {
    key: 'cancelled',
    label: 'Cancel',
    hint: 'Raised in error, or no longer applicable. The owner stops owing it.',
  },
  {
    key: 'withdrawn',
    label: 'Withdraw',
    hint: 'Taken back by ESH before it was worth anybody acting on.',
  },
  {
    key: 'duplicate',
    label: 'Duplicate',
    hint: 'The same thing as another finding, which keeps the work.',
  },
];

export function FindingOutcome({ findingId }: { findingId: string }) {
  const router = useRouter();
  const [outcome, setOutcome] = useState<'cancelled' | 'withdrawn' | 'duplicate'>('cancelled');
  const [reason, setReason] = useState('');
  const [duplicateOf, setDuplicateOf] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <details className="esh-form-more esh-finding-outcome">
      <summary>Administrative outcome</summary>
      <p className="form-hint">
        Closing a finding says ESH verified a correction. These do not: they record what became of a
        finding nobody is going to correct, and keep it on the register rather than deleting it.
      </p>
      {problem && (
        <p className="esh-field-error" role="alert">
          {problem}
        </p>
      )}
      <div className="form-grid two">
        <div className="esh-field">
          <label htmlFor="finding-outcome">Outcome</label>
          <select
            id="finding-outcome"
            value={outcome}
            onChange={(event) => {
              setOutcome(event.target.value as typeof outcome);
              setProblem(null);
            }}
          >
            {OUTCOMES.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </select>
          <small>{OUTCOMES.find((option) => option.key === outcome)?.hint}</small>
        </div>
        <label className="esh-field">
          <span>Why this outcome</span>
          <input
            value={reason}
            maxLength={500}
            onChange={(event) => {
              setReason(event.target.value);
              setProblem(null);
            }}
          />
        </label>
        {outcome === 'duplicate' && (
          <label className="esh-field">
            <span>The finding this repeats</span>
            <input
              value={duplicateOf}
              placeholder="Paste its address or id"
              onChange={(event) => {
                setDuplicateOf(event.target.value);
                setProblem(null);
              }}
            />
            <small>
              Open the other finding and copy the last part of its web address. Its own work carries
              on.
            </small>
          </label>
        )}
      </div>
      <button
        type="button"
        className="btn"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const result = await resolveFinding({
              findingId,
              outcome,
              reason,
              // A pasted address is accepted as readily as a bare id.
              duplicateOf: duplicateOf.trim().split('/').pop()?.split('?')[0] ?? null,
            });
            if (!result.ok) setProblem(result.message ?? 'Something went wrong.');
            else router.refresh();
          })
        }
      >
        Record this outcome
      </button>
    </details>
  );
}
