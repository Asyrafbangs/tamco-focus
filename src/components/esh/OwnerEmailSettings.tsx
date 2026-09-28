'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { ReleaseAllButton } from '@/components/esh/ReleaseAllButton';
import {
  OWNER_EMAIL_MODES,
  heldSentence,
  type HeldSummary,
  type OwnerEmailMode,
} from '@/domain/esh-owner-email';
import { setOwnerEmailMode } from '@/server/esh/owner-email-actions';

/**
 * Owner email, set once for the system (v223, §43.4). An administrator's
 * decision: Test mode holds email to anyone not yet cleared; Live sends
 * assignment email the moment a finding is assigned. Switching to Live does
 * not release what is already held — Release all does that, deliberately.
 */
export function OwnerEmailSettings({ summary }: { summary: HeldSummary }) {
  const router = useRouter();
  const [mode, setMode] = useState<OwnerEmailMode>(summary.mode);
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const sentence = heldSentence(summary);
  const changed = mode !== summary.mode;

  return (
    <section id="owner-email" className="esh-form-card" aria-labelledby="owner-email-title">
      <h2 id="owner-email-title" className="esh-form-card-title">
        Owner email
      </h2>
      <fieldset className="esh-choice-list">
        <legend className="visually-hidden">Owner email mode</legend>
        {OWNER_EMAIL_MODES.map((option) => (
          <label key={option.key} className="esh-choice">
            <input
              type="radio"
              name="owner-email-mode"
              value={option.key}
              checked={mode === option.key}
              onChange={() => {
                setMode(option.key);
                setMessage(null);
              }}
            />
            <span>
              <strong>{option.label}</strong>
              <small>{option.hint}</small>
            </span>
          </label>
        ))}
      </fieldset>
      {changed && (
        <div className="esh-release-confirm">
          <label className="esh-field">
            <span>Reason for the change</span>
            <input
              value={reason}
              maxLength={500}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
          <button
            type="button"
            className="btn primary"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const result = await setOwnerEmailMode({ mode, reason });
                setMessage(
                  result.ok
                    ? {
                        ok: true,
                        text:
                          mode === 'live'
                            ? 'Owner email is Live. New assignments are emailed at once.'
                            : 'Owner email is in Test mode. New owners’ email is held.',
                      }
                    : { ok: false, text: result.message },
                );
                if (result.ok) {
                  setReason('');
                  router.refresh();
                }
              })
            }
          >
            {pending ? 'Saving…' : 'Save'}
          </button>
        </div>
      )}
      {message && (
        <p className={message.ok ? 'notice success' : 'esh-field-error'} role="status">
          {message.text}
        </p>
      )}
      {sentence ? (
        <div className="esh-held-notice">
          <p>
            <strong>{sentence}</strong>
            {summary.switchedOff > 0 &&
              ` · ${summary.switchedOff} switched off by an administrator stay held.`}
          </p>
          {summary.recipients > summary.switchedOff && <ReleaseAllButton />}
        </div>
      ) : (
        <p className="form-hint">Nothing is held.</p>
      )}
    </section>
  );
}
