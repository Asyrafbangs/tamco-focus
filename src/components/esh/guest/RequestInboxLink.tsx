'use client';

import { useState, useTransition } from 'react';

import { requestInboxLink } from '@/server/esh/guest-actions';

/**
 * My Actions from a link that opened one action (§9): a new link to the
 * owner's list, sent to the address already identified — the link in hand is
 * not quietly widened.
 */
export function RequestInboxLink({ email }: { email: string }) {
  const [sent, setSent] = useState(false);
  const [pending, startTransition] = useTransition();
  if (sent) {
    return (
      <p className="notice success" role="status">
        A link to all your actions is on its way to {email}. It works once, for 30 minutes.
      </p>
    );
  }
  return (
    <button
      type="button"
      className="btn primary guest-primary"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await requestInboxLink();
          setSent(true);
        })
      }
    >
      {pending ? 'Sending…' : 'Email me my actions link'}
    </button>
  );
}
