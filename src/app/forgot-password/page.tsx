import Link from 'next/link';
import { redirect } from 'next/navigation';

import { createSupabaseServerClient } from '@/lib/supabase/server';
import { orgConfig } from '@/lib/env';

/**
 * Password recovery.
 *
 * The sign-in page had no way out of a forgotten password, which left the
 * administrator as the only recovery route for six people — a support burden
 * for them and a wait for everybody else.
 *
 * The confirmation is deliberately identical whether or not the address has an
 * account. Saying "no such account" turns this form into a way to discover who
 * works here, and an internal directory is worth more to somebody probing than
 * it looks. The same reticence is already applied on sign-in, where a wrong
 * password and an unknown address give one message.
 */
export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string }>;
}) {
  const params = await searchParams;

  async function requestReset(formData: FormData) {
    'use server';

    const email = String(formData.get('email') ?? '').trim();
    if (!email) redirect('/forgot-password');

    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${orgConfig.appBaseUrl}/auth/callback`,
    });

    // Logged, never shown. A rate-limit refusal and an unknown address must
    // look the same from outside.
    if (error) console.error(`[forgot-password] ${error.message}`);

    redirect('/forgot-password?sent=1');
  }

  return (
    <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh', padding: 16 }}>
      <main className="card pad" style={{ width: 'min(420px, 100%)' }}>
        <h1 style={{ marginTop: 0 }}>Reset your password</h1>

        {params.sent ? (
          <>
            <div className="notice" role="status">
              <p>
                If that address has an account, a link is on its way. It works once and expires
                within the hour.
              </p>
            </div>
            <p className="muted">
              Nothing arrived? Check your junk folder, then ask your administrator to confirm the
              address on your account.
            </p>
          </>
        ) : (
          <>
            <p className="muted" style={{ marginTop: 0 }}>
              Enter the address you sign in with and we will send you a link to choose a new
              password.
            </p>

            <form action={requestReset}>
              <div className="field">
                <label htmlFor="email">Email address</label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  required
                  autoComplete="email"
                  autoFocus
                />
              </div>

              <button type="submit" className="btn primary" style={{ width: '100%' }}>
                Send reset link
              </button>
            </form>
          </>
        )}

        <p style={{ marginBottom: 0, marginTop: 16 }}>
          <Link href="/sign-in">Back to sign in</Link>
        </p>
      </main>
    </div>
  );
}
