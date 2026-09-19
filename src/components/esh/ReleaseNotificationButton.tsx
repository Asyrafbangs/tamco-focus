'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { releaseHeldNotification } from '@/server/esh/conversation-actions';

/** Release one held email, now that the contact's access is on (§43.4). */
export function ReleaseNotificationButton({
  outboxId,
  findingId,
  recipient,
  kind,
}: {
  outboxId: string;
  findingId: string;
  recipient: string;
  /** "assignment email", "reply notice": which held email this releases. */
  kind: string;
}) {
  const router = useRouter();
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <span className="esh-release">
      <button
        type="button"
        className="btn small"
        disabled={pending}
        aria-label={`Release the ${kind} to ${recipient}`}
        onClick={() =>
          startTransition(async () => {
            const result = await releaseHeldNotification({ outboxId, findingId });
            if (!result.ok) {
              setProblem(result.message);
              return;
            }
            setProblem(null);
            router.refresh();
          })
        }
      >
        {pending ? 'Releasing…' : 'Release email'}
      </button>
      {problem && (
        <span className="esh-field-error" role="alert">
          {problem}
        </span>
      )}
    </span>
  );
}
