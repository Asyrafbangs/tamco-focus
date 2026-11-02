'use client';

import { useState, useTransition, type FormEvent } from 'react';
import Link from 'next/link';

import {
  claimReportIntake,
  declineReportIntake,
  markReportIntakeDuplicate,
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

  function markDuplicate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(async () => {
      setResult(
        await markReportIntakeDuplicate({
          intakeId,
          findingReference: String(formData.get('finding_reference') ?? ''),
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
      {status === 'triaging' && (
        <Link href={`/findings/new?intake=${intakeId}`}>Review as Finding</Link>
      )}
      <details>
        <summary>Mark as duplicate</summary>
        <form className="settings-form" onSubmit={markDuplicate} noValidate>
          <label>
            <span>Existing Finding reference</span>
            <input name="finding_reference" maxLength={40} required />
          </label>
          <label>
            <span>Reason</span>
            <textarea name="reason" rows={2} maxLength={2000} required />
          </label>
          <button type="submit" disabled={pending}>
            {pending ? 'Saving…' : 'Link duplicate without action'}
          </button>
        </form>
      </details>
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
