import { redirect } from 'next/navigation';

import { createSupabaseServerClient } from '@/lib/supabase/server';

import { SetPasswordForm, type SetPasswordState } from './SetPasswordForm';
import styles from './SetPasswordForm.module.css';

/**
 * Where an invited or recovering person chooses their password.
 *
 * Reached only from `/auth/callback`, which has already verified the one-time
 * token and established a session. That session is the authorisation: this page
 * changes the password of whoever the cookies say is signed in, and nothing
 * else. Somebody arriving here without one is sent to sign in.
 *
 * There is deliberately no "current password" field. The recovery token is what
 * proves the request is genuine, and asking somebody who has forgotten their
 * password to type it is the one thing they cannot do.
 *
 * The server keeps the twelve-character minimum as the rule it enforces. The
 * form additionally asks for a digit and a symbol before it will enable submit;
 * that is a client-side policy, and this check stays authoritative underneath
 * it.
 */
export default async function SetPasswordPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/sign-in?error=link');

  async function setPassword(
    _state: SetPasswordState,
    formData: FormData,
  ): Promise<SetPasswordState> {
    'use server';

    const password = String(formData.get('password') ?? '');
    const confirmation = String(formData.get('confirmation') ?? '');

    if (password.length < 12) {
      return { ok: false, message: 'Use at least twelve characters.' };
    }
    if (password !== confirmation) {
      return { ok: false, message: 'The two passwords did not match.' };
    }

    const client = await createSupabaseServerClient();

    // The session established by the callback is the authorisation. If it has
    // gone, the link has been used or has expired, and there is nothing to
    // update.
    const {
      data: { user: current },
    } = await client.auth.getUser();
    if (!current) {
      return {
        ok: false,
        message: 'That reset link is no longer valid. Request a new one from Forgot password.',
      };
    }

    const { error } = await client.auth.updateUser({ password });

    if (error) {
      // Logged for us, translated for them. The raw text can name internal
      // policy and provider detail that is no use to somebody resetting a
      // password. The password itself is never logged.
      console.error(`[set-password] ${error.message}`);
      return { ok: false, message: describe(error.message) };
    }

    redirect('/today');
  }

  return (
    <div className={styles.page}>
      <main className={styles.card}>
        <h1 className={styles.title}>Change Password</h1>
        <p className={styles.intro}>
          Signed in as {user.email}. Set a password and you will not need this link again.
        </p>
        <SetPasswordForm action={setPassword} />
      </main>
    </div>
  );
}

/** Turns a provider message into one worth showing somebody. */
function describe(raw: string): string {
  const text = raw.toLowerCase();

  if (text.includes('should be different')) {
    return 'Choose a password you have not used on this account before.';
  }
  if (text.includes('weak') || text.includes('pwned') || text.includes('compromised')) {
    return 'That password has appeared in a known breach. Choose a different one.';
  }
  if (text.includes('at least') || text.includes('characters')) {
    return 'That password does not meet the requirements.';
  }
  if (text.includes('session') || text.includes('token') || text.includes('jwt')) {
    return 'That reset link is no longer valid. Request a new one from Forgot password.';
  }
  if (text.includes('fetch') || text.includes('network') || text.includes('timeout')) {
    return 'We could not reach the server. Check your connection and try again.';
  }
  return 'That password could not be saved. Try again.';
}
