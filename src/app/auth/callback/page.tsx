import { redirect } from 'next/navigation';
import type { EmailOtpType } from '@supabase/supabase-js';

import { createSupabaseServerClient } from '@/lib/supabase/server';

import { HashSession } from './HashSession';

/**
 * Where every emailed link lands: invitation, password recovery, email change.
 *
 * This used to be a GET route handler that verified the token as soon as the
 * address was fetched. That is the whole bug behind "the reset link does not
 * work". The token is single-use, and a GET is not only issued by the person
 * holding the link: `@tamco.com.my` is Microsoft 365, where Defender Safe
 * Links fetches every URL in every message to scan it. The scan spent the
 * token minutes after the mail arrived, so by the time anybody clicked, the
 * only honest answer left was "this link has already been used". Antivirus,
 * corporate proxies and chat link-previews all do the same thing.
 *
 * So the token is no longer spent by arriving. This renders a page with one
 * button, and the verification happens on the POST that button submits.
 * Scanners follow links; they do not submit forms. The cost is a single extra
 * click for a person who was about to click something anyway.
 *
 * The emailed button does not point here directly. It points at Supabase's own
 * `/auth/v1/verify`, which spends the token there and redirects back with the
 * outcome in a URL FRAGMENT — `#access_token=…` or `#error=…`. A fragment is
 * never sent to the server, so a request arriving from a real email carries no
 * parameters at all. Treating that as a bad link is what made every recovery
 * attempt fail: the token was fine, this page simply could not see it. When
 * there is nothing in the query string, the browser is asked to look.
 *
 * Nothing about the failure path is specific. A link that is expired, already
 * used, or tampered with produces one message, because distinguishing them
 * tells whoever is holding a stolen link which kind of thing they hold.
 */

/** The link types this application actually sends. Anything else is refused. */
const HANDLED: readonly EmailOtpType[] = ['invite', 'recovery', 'email', 'email_change'];

/** After verifying, where should this person go? */
function destinationFor(type: EmailOtpType): string {
  // An invited person has no password yet, and a recovering person is here
  // precisely to replace theirs. Both must choose one before anything else.
  if (type === 'invite' || type === 'recovery') return '/set-password';
  return '/today';
}

const WORDING: Record<string, { heading: string; body: string; action: string }> = {
  recovery: {
    heading: 'Reset your password',
    body: 'Continue to choose a new password for your TAMCO Focus account.',
    action: 'Continue',
  },
  invite: {
    heading: 'Finish setting up your account',
    body: 'Continue to choose a password and sign in for the first time.',
    action: 'Continue',
  },
};

export default async function AuthCallbackPage({
  searchParams,
}: {
  searchParams: Promise<{ token_hash?: string; type?: string }>;
}) {
  const params = await searchParams;
  const tokenHash = params.token_hash;
  const type = params.type as EmailOtpType | undefined;

  /*
   * No query string means the tokens are in the fragment, which only the
   * browser can read. This is the normal path for a link that came from an
   * email, so it must not be mistaken for a malformed one.
   */
  if (!tokenHash) {
    const next = type === 'email' || type === 'email_change' ? '/today' : '/set-password';
    return (
      <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh', padding: 16 }}>
        <main className="card pad" style={{ width: 'min(420px, 100%)' }}>
          <HashSession next={next} />
        </main>
      </div>
    );
  }

  if (!type || !HANDLED.includes(type)) {
    redirect('/sign-in?error=link');
  }

  async function confirm(formData: FormData) {
    'use server';

    const submittedToken = String(formData.get('token_hash') ?? '');
    const submittedType = String(formData.get('type') ?? '') as EmailOtpType;
    if (!submittedToken || !HANDLED.includes(submittedType)) redirect('/sign-in?error=link');

    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.verifyOtp({
      type: submittedType,
      token_hash: submittedToken,
    });

    if (error) {
      // Logged for the operator, never shown: the message can distinguish an
      // expired link from an invalid one.
      console.error(`[auth/callback] ${submittedType}: ${error.message}`);
      redirect('/sign-in?error=link');
    }

    redirect(destinationFor(submittedType));
  }

  const copy = WORDING[type] ?? {
    heading: 'Confirm this request',
    body: 'Continue to confirm the request you started by email.',
    action: 'Continue',
  };

  return (
    <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh', padding: 16 }}>
      <main className="card pad" style={{ width: 'min(420px, 100%)' }}>
        <h1 style={{ marginTop: 0 }}>{copy.heading}</h1>
        <p className="muted">{copy.body}</p>
        <form action={confirm}>
          <input type="hidden" name="token_hash" value={tokenHash} />
          <input type="hidden" name="type" value={type} />
          <button className="btn primary" type="submit" style={{ width: '100%' }}>
            {copy.action}
          </button>
        </form>
        <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
          Links can be used once and expire an hour after they are sent. If this one no longer
          works, request a new password reset.
        </p>
      </main>
    </div>
  );
}
