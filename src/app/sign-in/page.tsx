import { redirect } from 'next/navigation';

import { createSupabaseServerClient } from '@/lib/supabase/server';

/**
 * Sign-in.
 *
 * Public self-signup is closed (`supabase/config.toml`: `enable_signup = false`)
 * because administrators provision every account through the user directory
 * (section 31B.1). There is deliberately no "create an account" path here.
 */
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const params = await searchParams;

  async function signIn(formData: FormData) {
    'use server';

    const email = String(formData.get('email') ?? '').trim();
    const password = String(formData.get('password') ?? '');
    const next = String(formData.get('next') ?? '/today');

    if (!email || !password) {
      redirect('/sign-in?error=missing');
    }

    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      // Deliberately not distinguishing "no such account" from "wrong
      // password": that difference tells an attacker which addresses exist.
      redirect('/sign-in?error=invalid');
    }

    redirect(next.startsWith('/') ? next : '/today');
  }

  const errorMessage =
    params.error === 'invalid'
      ? 'That email address and password combination was not recognised.'
      : params.error === 'missing'
        ? 'Enter both your email address and your password.'
        : params.error === 'link'
          ? // One message for expired, already-used and tampered-with alike.
            // Telling somebody holding a stolen link which kind they hold is
            // help they should not get.
            'That link is no longer valid. Links can only be used once, and expire. ' +
            'Ask an administrator to send a new invitation, or use Forgot password.'
          : null;

  return (
    <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh', padding: 16 }}>
      <main className="card pad" style={{ width: 'min(420px, 100%)' }}>
        <div
          className="brandmark"
          style={{ background: 'var(--blue)', color: '#fff' }}
          aria-hidden="true"
        >
          TF
        </div>

        <h1 style={{ fontSize: 22, fontWeight: 650, margin: '14px 0 4px' }}>TAMCO Focus</h1>
        <p className="muted" style={{ marginTop: 0 }}>
          Sign in to see what needs your attention today.
        </p>

        {errorMessage && (
          <div className="notice error" role="alert">
            <strong>Could not sign in</strong>
            <p>{errorMessage}</p>
          </div>
        )}

        <form action={signIn}>
          <input type="hidden" name="next" value={params.next ?? '/today'} />

          <div className="field">
            <label htmlFor="email">Email address</label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="username"
              required
              aria-invalid={params.error ? 'true' : undefined}
            />
          </div>

          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              aria-invalid={params.error ? 'true' : undefined}
            />
          </div>

          <button type="submit" className="btn primary" style={{ width: '100%' }}>
            Sign in
          </button>
        </form>

        <p className="muted" style={{ fontSize: 11, marginBottom: 0 }}>
          Accounts are created by your administrator. If you cannot sign in, ask them to check your
          account status.
        </p>
      </main>
    </div>
  );
}
