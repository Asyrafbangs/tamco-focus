'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition } from 'react';

import { submitProblems } from '@/domain/esh-guest';
import { submitOwnerWork } from '@/server/esh/guest-actions';

/**
 * Submit an update already sent, exactly as it was (§12, FM18): the owner
 * chooses which one, so nothing is guessed and nothing is uploaded again.
 */
export function SubmitSentUpdate({ actionId, messageId }: { actionId: string; messageId: string }) {
  const router = useRouter();
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const clientKey = useRef('');
  return (
    <span className="esh-submit-sent">
      <button
        type="button"
        className="btn ghost small"
        disabled={pending}
        onClick={() => {
          if (!clientKey.current) clientKey.current = window.crypto.randomUUID();
          startTransition(async () => {
            const result = await submitOwnerWork({
              actionId,
              body: '',
              assetIds: [],
              reuseMessageId: messageId,
              clientKey: clientKey.current,
            });
            if (!result.ok) {
              clientKey.current = '';
              setProblem(submitProblems(result.code, result.problems));
              return;
            }
            router.refresh();
          });
        }}
      >
        {pending ? 'Submitting…' : 'Submit this update for review'}
      </button>
      {problem && (
        <span className="esh-field-error" role="alert">
          {problem}
        </span>
      )}
    </span>
  );
}
