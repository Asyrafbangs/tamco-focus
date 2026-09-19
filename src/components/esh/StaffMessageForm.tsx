'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition } from 'react';

import { MESSAGE_MAX_LENGTH } from '@/domain/esh-guest';
import { postEshMessage } from '@/server/esh/conversation-actions';

/**
 * ESH writes to the Action Owner (§13), on the same conversation the owner
 * sees. What is typed stays in the box when a send is refused.
 */
export function StaffMessageForm({
  actionId,
  findingId,
  ownerReachable,
}: {
  actionId: string;
  findingId: string;
  ownerReachable: boolean;
}) {
  const router = useRouter();
  const [body, setBody] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [pending, startTransition] = useTransition();
  const clientKey = useRef('');

  return (
    <form
      className="esh-staff-composer"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (!body.trim()) {
          setProblem('Write a message first.');
          return;
        }
        if (!clientKey.current) clientKey.current = window.crypto.randomUUID();
        const text = body;
        startTransition(async () => {
          const result = await postEshMessage({
            actionId,
            findingId,
            body: text,
            clientKey: clientKey.current,
          });
          if (!result.ok) {
            setProblem(result.message);
            return;
          }
          clientKey.current = '';
          setBody('');
          setProblem(null);
          setSent(true);
          router.refresh();
        });
      }}
    >
      <label className="esh-field">
        <span>Message the owner</span>
        <textarea
          rows={3}
          maxLength={MESSAGE_MAX_LENGTH}
          value={body}
          onChange={(event) => {
            setBody(event.target.value);
            setProblem(null);
            setSent(false);
          }}
          aria-invalid={problem ? true : undefined}
          aria-describedby="esh-staff-composer-hint"
        />
      </label>
      {problem && (
        <p className="esh-field-error" role="alert">
          {problem}
        </p>
      )}
      {sent && !problem && (
        <p className="guest-composer-sent" role="status">
          Sent to the owner.
        </p>
      )}
      <p id="esh-staff-composer-hint" className="form-hint">
        {ownerReachable
          ? 'The owner reads this in their conversation and is emailed that ESH replied.'
          : 'The owner cannot open the conversation until their access is on and the assignment email is released. The reply notice is held until then.'}
      </p>
      <button type="submit" className="btn primary" disabled={pending}>
        {pending ? 'Sending…' : 'Send to owner'}
      </button>
    </form>
  );
}
