'use client';

import { useState, useTransition } from 'react';

import { enableContactForFinding } from '@/server/esh/conversation-actions';

/**
 * Unblocking a held email where the holding is visible (§31.3, §43.2).
 *
 * A finding whose assignment is held reads as a finding that did nothing. The
 * remedy was two screens away, under Identity and access, and findings sat
 * silent because nobody knew to go there. This is the same audited switch,
 * with the same reason, offered on the finding itself — and it still only
 * grants access: releasing the email remains a separate, deliberate press.
 */
export function EnableContactInline({
  principalId,
  findingId,
  recipient,
}: {
  principalId: string;
  findingId: string;
  recipient: string;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, startTransition] = useTransition();

  if (result?.ok) {
    return (
      <span className="esh-release" role="status">
        {result.message}
      </span>
    );
  }

  return (
    <span className="esh-enable-contact">
      {!open ? (
        <button type="button" className="btn small" onClick={() => setOpen(true)}>
          Enable this contact
        </button>
      ) : (
        <>
          <label htmlFor={`enable-${principalId}`} className="visually-hidden">
            Why {recipient} may be written to
          </label>
          <input
            id={`enable-${principalId}`}
            value={reason}
            maxLength={200}
            placeholder={`Why ${recipient} may be written to`}
            onChange={(event) => {
              setReason(event.target.value);
              setResult(null);
            }}
          />
          <button
            type="button"
            className="btn primary small"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                setResult(await enableContactForFinding({ principalId, findingId, reason }));
              })
            }
          >
            {pending ? 'Enabling…' : 'Enable'}
          </button>
          <button type="button" className="btn ghost small" onClick={() => setOpen(false)}>
            Cancel
          </button>
        </>
      )}
      {result && !result.ok && (
        <span className="esh-field-error" role="alert">
          {result.message}
        </span>
      )}
    </span>
  );
}
