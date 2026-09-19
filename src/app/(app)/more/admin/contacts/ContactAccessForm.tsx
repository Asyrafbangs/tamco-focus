'use client';

import { useState, useTransition, type FormEvent } from 'react';

import { setContactAccess, type ContactAccessState } from '@/server/esh/conversation-actions';

/**
 * Identity and access → Email contacts → one contact → Finding Management
 * access (§31.3, §43.2). Switching it on sends nothing by itself (FM106);
 * switching it off ends their links and sessions at once (FM107).
 */
export function ContactAccessForm({
  principalId,
  email,
  enabled: initiallyEnabled,
}: {
  principalId: string;
  email: string;
  enabled: boolean;
}) {
  const [enabled, setEnabled] = useState(initiallyEnabled);
  const [state, setState] = useState<ContactAccessState | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(async () => {
      setState(await setContactAccess(null, data));
    });
  }

  return (
    <form className="settings-form esh-access-form" onSubmit={onSubmit}>
      <input type="hidden" name="principal_id" value={principalId} />
      <label className="check-row">
        <input
          type="checkbox"
          name="enabled"
          checked={enabled}
          onChange={(event) => {
            setEnabled(event.target.checked);
            setState(null);
          }}
        />
        <span>
          <strong>Enable email-link access for {email}</strong>
          <small>
            They can open the actions assigned to this address from the links ESH sends. It gives
            them nothing else.
          </small>
        </span>
      </label>
      <label>
        <span>Reason (recorded in the audit)</span>
        <input name="reason" maxLength={200} />
      </label>
      {state && (
        <p className={`notice ${state.ok ? 'success' : 'error'}`} role="status">
          {state.message}
        </p>
      )}
      <button type="submit" className="btn primary" disabled={pending}>
        {pending ? 'Saving…' : 'Save contact access'}
      </button>
    </form>
  );
}
