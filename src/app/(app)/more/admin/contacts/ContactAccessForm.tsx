'use client';

import { useState, useTransition, type FormEvent } from 'react';

import { useHydrated } from '@/components/esh/use-hydrated';
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
  /*
   * This form has no `action`, so its submission exists only in `onSubmit`.
   * Pressed before React has hydrated, the browser does its own default
   * submit — a GET to this same URL carrying `principal_id`, `enabled` and
   * `reason` as query parameters — and the page comes back looking saved with
   * nothing granted or revoked. On a screen that governs who may open an
   * owner's findings that is the worst way to fail.
   *
   * Guarding the button alone was not enough, and the browser suite showed
   * why: these inputs are controlled, so React reconciles them to its own
   * state when it hydrates and a tick made before that is thrown away. The
   * administrator then presses Save on a form that looks filled in and the
   * server is told the access is off. So nothing here is operable until
   * React owns it - which is also what makes the save deterministic.
   */
  const hydrated = useHydrated();

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
          disabled={!hydrated}
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
        <input name="reason" maxLength={200} disabled={!hydrated} />
      </label>
      {state && (
        <p className={`notice ${state.ok ? 'success' : 'error'}`} role="status">
          {state.message}
        </p>
      )}
      <button type="submit" className="btn primary" disabled={!hydrated || pending}>
        {pending ? 'Saving…' : 'Save contact access'}
      </button>
    </form>
  );
}
