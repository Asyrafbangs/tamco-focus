import { redirect } from 'next/navigation';
import type { EmailOtpType } from '@supabase/supabase-js';

import { createSupabaseServerClient } from '@/lib/supabase/server';

/**
 * Where every emailed link lands: invitation, password recovery, email change.
 *
 * This route did not exist until an invitation was actually clicked. The proxy
 * listed `/auth/callback` as public and Supabase was configured to redirect
 * here, but nothing served the address — so every invitation and every reset
 * link 404'd, and nobody could complete sign-up. Local development never caught
 * it because seeded accounts have passwords and never go through an email.
 *
 * The link carries a one-time `token_hash`. Exchanging it here, server-side,
 * sets the session cookies through the SSR client, which is what lets the
 * following request act as that person. The token is single-use: a second click
 * on the same link fails, and that is a correct outcome rather than a bug.
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

export async function GET(request: Request) {
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get('token_hash');
  const type = url.searchParams.get('type') as EmailOtpType | null;

  if (!tokenHash || !type || !HANDLED.includes(type)) {
    redirect('/sign-in?error=link');
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });

  if (error) {
    // Logged for the operator, never shown: the message can distinguish an
    // expired link from an invalid one.
    console.error(`[auth/callback] ${type}: ${error.message}`);
    redirect('/sign-in?error=link');
  }

  redirect(destinationFor(type));
}
