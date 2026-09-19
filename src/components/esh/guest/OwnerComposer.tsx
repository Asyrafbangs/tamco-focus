'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition } from 'react';

import { MESSAGE_MAX_LENGTH, ownerMessageProblem } from '@/domain/esh-guest';
import { sendOwnerUpdate } from '@/server/esh/guest-actions';

/**
 * The owner's composer (§11, §12): one box and Send update. An update is a
 * message to ESH; it never submits or closes anything.
 *
 * What is typed stays in the box when a send is refused, including when the
 * session has ended, so it can be copied before asking for a new link.
 */
export function OwnerComposer({ actionId }: { actionId: string }) {
  const router = useRouter();
  const [body, setBody] = useState('');
  const [problem, setProblem] = useState<{ code: string; message: string } | null>(null);
  const [sentNote, setSentNote] = useState(false);
  const [pending, startTransition] = useTransition();
  const clientKey = useRef<string>('');

  return (
    <form
      className="guest-composer"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (!body.trim()) {
          setProblem({ code: 'body_required', message: ownerMessageProblem('body_required') });
          return;
        }
        // One key per message: a double press, or a retry after a lost
        // answer, is the same message (§22).
        if (!clientKey.current) clientKey.current = window.crypto.randomUUID();
        const text = body;
        startTransition(async () => {
          try {
            const result = await sendOwnerUpdate({
              actionId,
              body: text,
              clientKey: clientKey.current,
            });
            if (!result.ok) {
              setProblem({ code: result.code, message: ownerMessageProblem(result.code) });
              return;
            }
            clientKey.current = '';
            setBody('');
            setProblem(null);
            setSentNote(true);
            router.refresh();
          } catch {
            setProblem({ code: 'invalid', message: ownerMessageProblem('invalid') });
          }
        });
      }}
    >
      <label className="esh-field">
        <span>Message ESH</span>
        <textarea
          name="body"
          rows={4}
          maxLength={MESSAGE_MAX_LENGTH}
          value={body}
          onChange={(event) => {
            setBody(event.target.value);
            setProblem(null);
            setSentNote(false);
          }}
          aria-invalid={problem ? true : undefined}
          aria-describedby={problem ? 'guest-composer-problem' : 'guest-composer-hint'}
        />
      </label>
      {problem && (
        <p id="guest-composer-problem" className="esh-field-error" role="alert">
          {problem.message}{' '}
          {problem.code === 'no_session' && (
            <Link href="/respond/request-link">Get a new link</Link>
          )}
        </p>
      )}
      {sentNote && !problem && (
        <p className="guest-composer-sent" role="status">
          Sent to ESH.
        </p>
      )}
      <div className="guest-composer-actions">
        <button type="submit" className="btn primary" disabled={pending}>
          {pending ? 'Sending…' : 'Send update'}
        </button>
      </div>
      <p id="guest-composer-hint" className="guest-note">
        Updates go to ESH, who verify the correction before the finding is closed. Email replies are
        not added here.
      </p>
    </form>
  );
}
