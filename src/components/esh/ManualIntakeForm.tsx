'use client';

import { useRef, useState, useTransition, type FormEvent } from 'react';

import { createManualReportIntake, type IntakeActionResult } from '@/server/esh/intake-actions';

/**
 * Record a verbal or otherwise off-system report before triage.
 *
 * This deliberately has no owner, due date, notification or public-reporting
 * fields. A coordinator must decide whether it becomes a Finding later.
 */
export function ManualIntakeForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<IntakeActionResult | null>(null);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(async () => {
      const next = await createManualReportIntake({
        reportText: String(formData.get('report_text') ?? ''),
        reportedLocation: String(formData.get('reported_location') ?? ''),
      });
      setResult(next);
      if (next.ok) formRef.current?.reset();
    });
  }

  return (
    <section className="settings-card" aria-labelledby="manual-intake-title">
      <div>
        <p className="eyebrow">Staff-only</p>
        <h2 id="manual-intake-title">Record a manual report</h2>
        <p>
          Use this for a verbal or otherwise off-system report. It stays private intake until a
          coordinator makes a triage decision.
        </p>
      </div>
      <form ref={formRef} className="settings-form" onSubmit={onSubmit} noValidate>
        <label>
          <span>What was reported</span>
          <textarea name="report_text" rows={4} maxLength={4000} required />
        </label>
        <label>
          <span>Reported location (optional)</span>
          <input name="reported_location" maxLength={500} />
        </label>
        {result && (
          <p
            className={result.ok ? 'notice success' : 'notice error'}
            role={result.ok ? 'status' : 'alert'}
          >
            {result.message}
          </p>
        )}
        <div className="form-actions">
          <button type="submit" disabled={pending}>
            {pending ? 'Recording…' : 'Record for triage'}
          </button>
        </div>
      </form>
    </section>
  );
}
