'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { releaseAllHeld } from '@/server/esh/owner-email-actions';

/**
 * One press for everything held (v223). The reason the database asks for is
 * filled in and can be changed; confirming is the deliberate act.
 */
export function ReleaseAllButton() {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState('Owners briefed; releasing held email');
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  if (!confirming) {
    return (
      <>
        <button type="button" className="btn small" onClick={() => setConfirming(true)}>
          Release all
        </button>
        {message && (
          <span className={message.ok ? 'esh-held-done' : 'esh-field-error'} role="status">
            {message.text}
          </span>
        )}
      </>
    );
  }

  return (
    <span className="esh-release-confirm">
      <label className="esh-field">
        <span>Reason</span>
        <input value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} />
      </label>
      <button
        type="button"
        className="btn small primary"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const result = await releaseAllHeld({ reason });
            setMessage({ ok: result.ok, text: result.message ?? 'Released.' });
            if (result.ok) {
              setConfirming(false);
              router.refresh();
            }
          })
        }
      >
        {pending ? 'Releasing…' : 'Confirm release'}
      </button>
      <button type="button" className="btn small ghost" onClick={() => setConfirming(false)}>
        Cancel
      </button>
      {message && !message.ok && (
        <span className="esh-field-error" role="alert">
          {message.text}
        </span>
      )}
    </span>
  );
}
