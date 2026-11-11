'use client';

import { useState, useTransition } from 'react';

import { useHydrated } from '@/components/esh/use-hydrated';
import { requestLinkByEmail, requestReportLinkByEmail } from '@/server/esh/guest-actions';

/**
 * Ask for a link by email (§19). The answer is the same for every address,
 * so the page never tells anybody whether an address has work (FM44).
 */
export function RequestLinkForm({ purpose = 'actions' }: { purpose?: 'actions' | 'report' }) {
  const [email, setEmail] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [pending, startTransition] = useTransition();
  /*
   * The form has no `action`, so a press before hydration submits natively:
   * a GET to this page with the address in the query string. Nothing is sent,
   * and the person's email address ends up in the URL, in history and in any
   * access log along the way — for a page whose whole promise is that it
   * never reveals whether an address has work. Wait for the handler.
   */
  const hydrated = useHydrated();

  if (sent) {
    return (
      <p className="notice success guest-sent" role="status">
        If that address is eligible, a link is on its way. It works once and opens only the
        requested
        {purpose === 'report' ? ' report.' : ' actions.'}
      </p>
    );
  }

  return (
    <form
      className="guest-request-form"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        startTransition(async () => {
          const result = await (
            purpose === 'report' ? requestReportLinkByEmail : requestLinkByEmail
          )(null, data);
          setProblem(result.problem);
          setSent(result.sent);
        });
      }}
    >
      <label className="esh-field">
        <span>Your email address</span>
        <input
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
            setProblem(null);
          }}
          aria-invalid={problem ? true : undefined}
          aria-describedby={problem ? 'guest-request-problem' : undefined}
        />
      </label>
      {problem && (
        <p id="guest-request-problem" className="esh-field-error">
          {problem}
        </p>
      )}
      <button type="submit" className="btn primary guest-primary" disabled={!hydrated || pending}>
        {pending ? 'Sending…' : 'Send me a link'}
      </button>
      <p className="guest-note">No account or password needed.</p>
    </form>
  );
}
