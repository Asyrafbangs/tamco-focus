import { redirect } from 'next/navigation';

import { createSupabaseServerClient } from '@/lib/supabase/server';

import { SetPasswordForm } from './SetPasswordForm';

/**
 * Where an invited or recovering person chooses their password.
 *
 * Reached only from `/auth/callback`, which has already verified the one-time
 * token and established a session. That session is the authorisation: this page
 * changes the password of whoever the cookies say is signed in, and nothing
 * else. Somebody arriving here without one is sent to sign in.
 *
 * The minimum is twelve characters and nothing else. A rule that also demands a
 * symbol and a digit reliably produces `Password1!` — memorable to nobody,
 * guessable by everybody — while length is the property that actually resists
 * an attack. NIST dropped composition rules for the same reason.
 */
export default async function SetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/sign-in?error=link');

  async function setPassword(formData: FormData) {
    'use server';

    const password = String(formData.get('password') ?? '');
    const confirmation = String(formData.get('confirmation') ?? '');

    if (password.length < 12) redirect('/set-password?error=short');
    if (password !== confirmation) redirect('/set-password?error=mismatch');

    const client = await createSupabaseServerClient();
    const { error } = await client.auth.updateUser({ password });

    if (error) {
      console.error(`[set-password] ${error.message}`);
      redirect('/set-password?error=failed');
    }

    redirect('/today');
  }

  const message =
    params.error === 'short'
      ? 'Use at least twelve characters.'
      : params.error === 'mismatch'
        ? 'The two passwords did not match.'
        : params.error === 'failed'
          ? 'That password could not be saved. Try again.'
          : null;

  return (
    <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh', padding: 16 }}>
      <main className="card pad" style={{ width: 'min(420px, 100%)' }}>
        <h1 style={{ marginTop: 0 }}>Choose a password</h1>
        <p className="muted" style={{ marginTop: 0 }}>
          Signed in as {user.email}. Set a password and you will not need this link again.
        </p>

        {message && (
          <div className="notice error" role="alert">
            <p>{message}</p>
          </div>
        )}

        <SetPasswordForm action={setPassword} />
      </main>
    </div>
  );
}
