'use client';

import { useState, useTransition, type FormEvent } from 'react';

import {
  claimReportIntake,
  declineReportIntake,
  type IntakeActionResult,
} from '@/server/esh/intake-actions';

/** Coordinator controls for a private report before it becomes a Finding. */
export function IntakeTriageActions({ intakeId, status }: { intakeId: string; status: string }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<IntakeActionResult | null>(null);

  function claim() {
    startTransition(async () => setResult(await claimReportIntake({ intakeId })));
  }

  function decline(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(async () => {
      setResult(
        await declineReportIntake({
          intakeId,
          reason: String(formData.get('reason') ?? ''),
        }),
      );
    });
  }

  return (
    <div className="esh-intake-actions">
      {status === 'new' && (
        <button type="button" onClick={claim} disabled={pending}>
          {pending ? 'Saving…' : 'Claim for triage'}
        </button>
      )}
      <details>
        <summary>Decline report</summary>
        <form className="settings-form" onSubmit={decline} noValidate>
          <label>
            <span>Reason</span>
            <textarea name="reason" rows={2} maxLength={2000} required />
          </label>
          <button type="submit" disabled={pending}>
            {pending ? 'Saving…' : 'Decline without action'}
          </button>
        </form>
      </details>
      {result && (
        <p
          className={result.ok ? 'notice success' : 'notice error'}
          role={result.ok ? 'status' : 'alert'}
        >
          {result.message}
        </p>
      )}
    </div>
  );
}
