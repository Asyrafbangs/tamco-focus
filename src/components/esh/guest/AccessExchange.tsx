'use client';

import { useEffect, useState, useSyncExternalStore, useTransition } from 'react';

import { recoveryFor, secretFromFragment, type ExchangeProblem } from '@/domain/esh-guest';
import { openAccessLink, requestFreshLink } from '@/server/esh/guest-actions';

import { RequestLinkForm } from './RequestLinkForm';

type Outcome =
  | { kind: 'failed'; problem: ExchangeProblem; secret: string }
  | { kind: 'sent' }
  | { kind: 'opening'; secret: string };

const CHALLENGE_KEY = 'tamco-esh-exchange';

/**
 * This tab's answer to "was it you who pressed the button a moment ago?"
 * (§19). Kept for the tab only; it is useless without the link, and the link
 * is never stored.
 */
function tabChallenge(): string {
  try {
    const existing = window.sessionStorage.getItem(CHALLENGE_KEY);
    if (existing) return existing;
    const fresh = window.crypto.randomUUID();
    window.sessionStorage.setItem(CHALLENGE_KEY, fresh);
    return fresh;
  } catch {
    return window.crypto.randomUUID();
  }
}

function subscribeToHash(onChange: () => void) {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
}

/**
 * The page an emailed link opens (§19).
 *
 * Opening it changes nothing: a mail scanner that fetches it, or even runs
 * it, finds a button and spends nothing. The secret is in the fragment, which
 * no request carries; the server renders the page without knowing it. Pressing
 * the button exchanges it, once, for a session on this device. A returning
 * owner whose session already reaches the destination goes straight there.
 */
export function AccessExchange({
  purpose,
  hasSession,
}: {
  purpose: 'action' | 'actions' | 'report';
  hasSession: boolean;
}) {
  // Null while rendering on the server, where there is no fragment to read.
  const hash = useSyncExternalStore(
    subscribeToHash,
    () => window.location.hash,
    () => null,
  );
  const secret = hash === null ? null : secretFromFragment(hash);

  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [resumeChecked, setResumeChecked] = useState(!hasSession);
  const [pending, startTransition] = useTransition();

  // A browser that already holds a session may not need the button at all.
  useEffect(() => {
    if (!hasSession || !secret) return;
    let cancelled = false;
    openAccessLink({ secret, challenge: tabChallenge(), consume: false, purpose })
      .then((result) => {
        if (cancelled) return;
        if (result.ok) window.location.replace(result.destination);
        else setResumeChecked(true);
      })
      .catch(() => {
        if (!cancelled) setResumeChecked(true);
      });
    return () => {
      cancelled = true;
    };
  }, [hasSession, purpose, secret]);

  function open() {
    const value = secret;
    if (!value) return;
    setOutcome({ kind: 'opening', secret: value });
    startTransition(async () => {
      try {
        const result = await openAccessLink({
          secret: value,
          challenge: tabChallenge(),
          consume: true,
          purpose,
        });
        if (result.ok) {
          // Replace, so the address with the link in it leaves the history.
          window.location.replace(result.destination);
          return;
        }
        // The link no longer opens anything; it leaves the address bar, and
        // is kept only in this page's memory to ask for a fresh one.
        window.history.replaceState(null, '', window.location.pathname + window.location.search);
        setOutcome({ kind: 'failed', problem: result.problem, secret: value });
      } catch {
        setOutcome({ kind: 'failed', problem: 'unavailable', secret: value });
      }
    });
  }

  function sendFresh() {
    if (outcome?.kind !== 'failed') return;
    const value = outcome.secret;
    startTransition(async () => {
      await requestFreshLink({ secret: value, purpose });
      setOutcome({ kind: 'sent' });
    });
  }

  const noLink = hash !== null && !secret && !outcome;
  if (noLink || (outcome?.kind === 'failed' && recoveryFor(outcome.problem) === 'ask_email')) {
    return (
      <section className="guest-card" aria-labelledby="guest-access-title">
        <span className="guest-card-icon" aria-hidden="true">
          ↗
        </span>
        <h1 id="guest-access-title">
          {noLink ? 'Open your secure link' : 'This link cannot be opened'}
        </h1>
        <p className="guest-lead">
          {noLink
            ? 'Open the link from your TAMCO ESH email on this device, or ask for a new one below.'
            : 'It may have been copied incompletely. Ask for a new link below.'}
        </p>
        <RequestLinkForm purpose={purpose === 'report' ? 'report' : 'actions'} />
      </section>
    );
  }

  if (outcome?.kind === 'failed') {
    return (
      <section className="guest-card" aria-labelledby="guest-access-title">
        <span className="guest-card-icon" aria-hidden="true">
          ↗
        </span>
        <h1 id="guest-access-title">Let’s get you a fresh link</h1>
        <p className="guest-lead">
          This link has expired or was already used. We can send a new secure link to your assigned
          email.
        </p>
        <button
          type="button"
          className="btn primary guest-primary"
          onClick={sendFresh}
          disabled={pending}
        >
          {pending ? 'Sending…' : 'Send me a new link'}
        </button>
        <p className="guest-note">No account or password needed.</p>
      </section>
    );
  }

  if (outcome?.kind === 'sent') {
    return (
      <section className="guest-card" aria-labelledby="guest-access-title" role="status">
        <span className="guest-card-icon" aria-hidden="true">
          ✓
        </span>
        <h1 id="guest-access-title">Check your email</h1>
        <p className="guest-lead">
          If this link belongs to an address with open actions, a new link is on its way. It works
          once, for 30 minutes.
        </p>
      </section>
    );
  }

  const reading = hash === null || !resumeChecked;
  const opening = outcome?.kind === 'opening' || pending;
  return (
    <section className="guest-card" aria-labelledby="guest-access-title">
      <span className="guest-card-icon" aria-hidden="true">
        ↗
      </span>
      <h1 id="guest-access-title">
        {purpose === 'actions'
          ? 'Open your actions'
          : purpose === 'report'
            ? 'Open your weekly report'
            : 'Open your action'}
      </h1>
      <p className="guest-lead">
        {purpose === 'actions'
          ? 'Your secure link opens every open action assigned to your email, on this device.'
          : purpose === 'report'
            ? 'Your individual secure link opens a read-only Finding Management snapshot on this device.'
            : 'Your secure link opens the action assigned to you, on this device.'}
      </p>
      <button
        type="button"
        className="btn primary guest-primary"
        onClick={open}
        disabled={reading || opening}
      >
        {reading
          ? 'Checking your link…'
          : opening
            ? 'Opening…'
            : purpose === 'actions'
              ? 'Open my actions'
              : purpose === 'report'
                ? 'Open weekly report'
                : 'Open action'}
      </button>
      <p className="guest-note">No account or password needed.</p>
    </section>
  );
}
