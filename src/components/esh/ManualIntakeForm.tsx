'use client';

import { useRef, useState, useTransition, type FormEvent } from 'react';

import { createManualReportIntake, type IntakeActionResult } from '@/server/esh/intake-actions';

/**
 * Record a verbal or otherwise off-system report before triage.
 *
 * This deliberately has no owner, due date, notification or public-reporting
 * fields. A coordinator must decide whether it becomes a Finding later.
 *
 * The department is asked for because the database scopes this queue by it: a
 * report recorded without one is invisible to every coordinator who covers
 * departments rather than the whole organisation, so the person who wrote it
 * down could not then see it.
 */
export function ManualIntakeForm({
  departments,
  allowUnassigned,
}: {
  departments: Array<{ id: string; name: string }>;
  /**
   * Only a coordinator who covers every department may leave the department
   * open: an unrouted report is visible to nobody else, so for anyone scoped
   * it would vanish the moment they wrote it down.
   */
  allowUnassigned: boolean;
}) {
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
        departmentId: String(formData.get('department_id') ?? ''),
      });
      setResult(next);
      if (next.ok) formRef.current?.reset();
    });
  }

  return (
    <section className="esh-form-card" aria-labelledby="manual-intake-title">
      <div className="esh-section-head">
        <div>
          <p className="eyebrow">Staff-only</p>
          <h2 id="manual-intake-title">Record a manual report</h2>
          <p>
            Use this for a verbal or otherwise off-system report. It stays private intake until a
            coordinator makes a triage decision.
          </p>
        </div>
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
        {/*
         * Associated by id rather than by wrapping: a select inside its own
         * label makes the label's accessible name the label plus every option
         * text, which no test can then match.
         */}
        <div className="setting-control">
          <label htmlFor="manual-intake-department">
            <span>Department responsible</span>
          </label>
          <select id="manual-intake-department" name="department_id" defaultValue="">
            <option value="">{allowUnassigned ? 'Not known yet' : 'Choose a department'}</option>
            {departments.map((department) => (
              <option key={department.id} value={department.id}>
                {department.name}
              </option>
            ))}
          </select>
        </div>
        {result && (
          <p
            className={result.ok ? 'notice success' : 'notice error'}
            role={result.ok ? 'status' : 'alert'}
          >
            {result.message}
          </p>
        )}
        <div className="form-actions">
          <button className="btn primary" type="submit" disabled={pending}>
            {pending ? 'Recording…' : 'Record for triage'}
          </button>
        </div>
      </form>
    </section>
  );
}
