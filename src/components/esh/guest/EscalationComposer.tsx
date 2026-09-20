'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition } from 'react';

import { MESSAGE_MAX_LENGTH, ownerMessageProblem } from '@/domain/esh-guest';
import { acknowledgeEscalation, sendOwnerUpdate } from '@/server/esh/guest-actions';

/**
 * The deliberately smaller escalation response (§15): a reply and an
 * acknowledgment. There is no upload, submission, reassignment or closure
 * control because the recipient is supporting the owner, not replacing them.
 */
export function EscalationComposer({ actionId, level }: { actionId: string; level: number }) {
  const router = useRouter();
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const clientKey = useRef('');
  const body = useRef<HTMLTextAreaElement>(null);

  function key() {
    if (!clientKey.current) clientKey.current = window.crypto.randomUUID();
    return clientKey.current;
  }

  function send() {
    const message = body.current?.value ?? '';
    if (!message.trim()) {
      setNotice({ ok: false, text: ownerMessageProblem('body_required') });
      return;
    }
    startTransition(async () => {
      const result = await sendOwnerUpdate({ actionId, body: message, clientKey: key() });
      if (!result.ok) {
        setNotice({ ok: false, text: ownerMessageProblem(result.code) });
        return;
      }
      clientKey.current = '';
      if (body.current) body.current.value = '';
      setNotice({ ok: true, text: 'Your response is in the conversation.' });
      router.refresh();
    });
  }

  function acknowledge() {
    startTransition(async () => {
      const result = await acknowledgeEscalation({ actionId });
      setNotice(
        result.ok
          ? {
              ok: true,
              text: `Level ${result.level ?? level} acknowledged. The action remains with its owner.`,
            }
          : { ok: false, text: ownerMessageProblem(result.code) },
      );
      if (result.ok) router.refresh();
    });
  }

  return (
    <form
      className="guest-composer"
      noValidate
      action={`/respond/actions/${actionId}/reply`}
      method="post"
      onSubmit={(event) => {
        event.preventDefault();
        const submitter = event.nativeEvent.submitter as HTMLButtonElement | null;
        if (submitter?.value === 'acknowledge') acknowledge();
        else send();
      }}
    >
      <label className="esh-field">
        <span>Respond to ESH and the Action Owner</span>
        <textarea
          name="body"
          rows={4}
          maxLength={MESSAGE_MAX_LENGTH}
          ref={body}
          placeholder="Share the support or follow-up you can provide…"
          onChange={() => setNotice(null)}
          aria-invalid={notice && !notice.ok ? true : undefined}
          aria-describedby="escalation-composer-hint"
        />
      </label>
      {notice && (
        <p className={notice.ok ? 'notice success compact' : 'esh-field-error'} role="status">
          {notice.text}
        </p>
      )}
      <div className="guest-composer-row">
        <button type="submit" name="intent" value="acknowledge" className="btn" disabled={pending}>
          Acknowledge level {level}
        </button>
        <button type="submit" className="btn primary" disabled={pending}>
          {pending ? 'Sending…' : 'Send response'}
        </button>
      </div>
      <p id="escalation-composer-hint" className="guest-note">
        Acknowledging or replying does not complete the action. The Action Owner submits the
        correction, and ESH verifies it.
      </p>
    </form>
  );
}
