'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import { createSupabaseBrowserClient } from '@/lib/supabase/client';

/**
 * The half of the recovery link the server can never see.
 *
 * The emailed button does not point at this application. It points at
 * Supabase's own `/auth/v1/verify`, which spends the token there and then
 * redirects here with the outcome in a URL FRAGMENT:
 *
 *   /auth/callback#access_token=…&refresh_token=…      (it worked)
 *   /auth/callback#error=access_denied&error_code=…    (it did not)
 *
 * A fragment is never transmitted to the server. So the server component saw a
 * request with no parameters whatsoever and did the only thing it could —
 * treated it as a bad link. Every recovery attempt failed that way, for
 * everybody, and it looked exactly like an expired token because the message
 * for both is the same.
 *
 * Reading the fragment therefore has to happen in the browser. The session is
 * established from the tokens Supabase already issued; nothing is verified
 * here that was not verified there.
 */
export function HashSession({ next }: { next: string }) {
  const router = useRouter();
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
      const accessToken = params.get('access_token');
      const refreshToken = params.get('refresh_token');

      /*
       * Both outcomes are awaited so neither settles state synchronously
       * inside the effect. Supabase reports its own refusals in this same
       * fragment — an expired or already-used link arrives as
       * `error_code=otp_expired` with no tokens at all — so a missing token is
       * a failure result rather than a separate early return.
       */
      const { error } =
        accessToken && refreshToken
          ? await createSupabaseBrowserClient().auth.setSession({
              access_token: accessToken,
              refresh_token: refreshToken,
            })
          : await Promise.resolve({ error: new Error(params.get('error_code') ?? 'no_tokens') });

      if (cancelled) return;

      if (error) {
        console.error(`[auth/callback:hash] ${error.message}`);
        setFailed('link');
        return;
      }

      // Clear the tokens out of the address bar before moving on, so they are
      // not left in history or pasted into a support message.
      window.history.replaceState(null, '', window.location.pathname);
      router.replace(next);
    })();

    return () => {
      cancelled = true;
    };
  }, [next, router]);

  if (failed) {
    return (
      <>
        <h1 style={{ marginTop: 0 }}>That link is no longer valid</h1>
        <p className="muted">
          Links can be used once and expire an hour after they are sent. Request a new password
          reset, or ask an administrator to send a fresh invitation.
        </p>
        <a className="btn primary" href="/forgot-password" style={{ width: '100%' }}>
          Request a new link
        </a>
      </>
    );
  }

  return (
    <>
      <h1 style={{ marginTop: 0 }}>Signing you in…</h1>
      <p className="muted">One moment while your link is confirmed.</p>
    </>
  );
}
