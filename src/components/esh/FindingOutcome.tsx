'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { FINDING_OUTCOMES, type FindingOutcomeKey } from '@/domain/esh-verification';
import { resolveFinding } from '@/server/esh/verification-actions';

/**
 * An outcome that is not a closure (§6), from the finding's menu.
 *
 * Rare by design: nearly every finding ends in a verified correction, and
 * nobody should meet this form unless they went looking for it. Nothing is
 * deleted — the reference, the conversation and the history stay — but the
 * work stops, the owner's links stop working and anything still queued to
 * send is cancelled.
 */
export function FindingOutcome({ findingId }: { findingId: string }) {
  const router = useRouter();
  const [outcome, setOutcome] = useState<FindingOutcomeKey>('cancelled');
  const [reason, setReason] = useState('');
  const [duplicateOf, setDuplicateOf] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const chosen = FINDING_OUTCOMES.find((option) => option.key === outcome);

  return (
    <div className="esh-finding-outcome">
      <fieldset className="esh-choice-list">
        <legend>What happened?</legend>
        {FINDING_OUTCOMES.map((option) => (
          <label key={option.key} className="esh-choice">
            <input
              type="radio"
              name="finding-outcome"
              value={option.key}
              checked={outcome === option.key}
              onChange={() => {
                setOutcome(option.key);
                setProblem(null);
              }}
            />
            <span>
              <strong>{option.label}</strong>
              <small>{option.hint}</small>
            </span>
          </label>
        ))}
      </fieldset>
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
        </label>
      )}
      <label className="esh-field">
        <span>Reason</span>
        <input
          value={reason}
          maxLength={500}
          onChange={(event) => {
            setReason(event.target.value);
            setProblem(null);
          }}
        />
      </label>
      {problem && (
        <p className="esh-field-error" role="alert">
          {problem}
        </p>
      )}
      <button
        type="button"
        className="btn danger"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const result = await resolveFinding({
              findingId,
              outcome,
              reason,
              // A pasted address is accepted as readily as a bare id.
              duplicateOf:
                outcome === 'duplicate'
                  ? (duplicateOf.trim().split('/').pop()?.split('?')[0] ?? null)
                  : null,
            });
            if (!result.ok) setProblem(result.message);
            else router.refresh();
          })
        }
      >
        {chosen?.label ?? 'Record'}
      </button>
    </div>
  );
}
