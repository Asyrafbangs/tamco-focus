'use client';

import { useState, useTransition, type FormEvent } from 'react';

import { useHydrated } from '@/components/esh/use-hydrated';
import {
  claimReportIntake,
  declineReportIntake,
  markReportIntakeDuplicate,
  type IntakeActionResult,
} from '@/server/esh/intake-actions';

/**
 * The decisions that are not "assign this" (v293).
 *
 * Four outcomes exist for an incoming report: it is a new hazard, it is one
 * already known, there is not enough in it to act on, or it needs no action.
 * The first is the form above this; the other three are here, folded away,
 * because on a normal day the answer is the first one.
 *
 * Nothing here is new behaviour — these are the same three server actions the
 * queue has always called, with the same reasons recorded and the same audit
 * trail behind them.
 */
export function IntakeOtherDecisions({
  intakeId,
  status,
  hasContact,
}: {
  intakeId: string;
  status: string;
  hasContact: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<IntakeActionResult | null>(null);
  /*
   * Neither of the two forms here has an `action`, so a press before
   * hydration is a native GET: the report is neither declined nor marked a
   * duplicate, the reason is left in the URL, and the row stays in the queue
   * looking untouched. Declining is the one triage decision that cannot be
   * undone from a screen, so it must not be able to half-happen.
   */
  const hydrated = useHydrated();

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
    <section className="esh-intake-other" aria-labelledby="esh-intake-other-title">
      <h3 id="esh-intake-other-title">Other decisions</h3>

      <details>
        <summary>
          <strong>Existing finding</strong>
          <small>Link as a duplicate, with no new action</small>
        </summary>
        <form className="settings-form" onSubmit={markDuplicate} noValidate>
          <label>
            <span>Existing Finding reference</span>
            <input name="finding_reference" maxLength={40} required />
          </label>
          <label>
            <span>Reason</span>
            <textarea name="reason" rows={2} maxLength={2000} required />
          </label>
          <button className="btn small" type="submit" disabled={!hydrated || pending}>
            {pending ? 'Saving…' : 'Link duplicate without action'}
          </button>
        </form>
      </details>

      <details>
        <summary>
          <strong>Not enough to act on</strong>
          <small>Keep it for triage while you find out more</small>
        </summary>
        {/*
         * No "request clarification" button, because nothing here can send
         * one. An anonymous report has nobody to ask, and a contact line is
         * an address somebody chose to leave rather than a channel this
         * application writes to. What it can do is say who, if anybody, may
         * be asked, and hold the report while that happens.
         */}
        <p className="form-hint">
          {hasContact
            ? 'This report carries a contact. Reaching them is outside this system — the report stays here, held in your name, until you decide.'
            : 'This report is anonymous, so there is nobody to ask. Inspect the location yourself, or decline it below with a reason.'}
        </p>
        {status === 'new' ? (
          <button className="btn small" type="button" onClick={claim} disabled={pending}>
            {pending ? 'Saving…' : 'Keep for triage'}
          </button>
        ) : (
          <p className="form-hint">Already held for triage.</p>
        )}
      </details>

      <details>
        <summary>
          <strong>No action needed</strong>
          <small>Decline, with a reason that is kept</small>
        </summary>
        <form className="settings-form" onSubmit={decline} noValidate>
          <label>
            <span>Reason</span>
            <textarea name="reason" rows={2} maxLength={2000} required />
          </label>
          <button className="btn small" type="submit" disabled={!hydrated || pending}>
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
    </section>
  );
}
