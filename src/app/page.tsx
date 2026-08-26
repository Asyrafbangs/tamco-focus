import { redirect } from 'next/navigation';

import { getCurrentProfile } from '@/lib/supabase/server';

/**
 * Sends each person to their configured opening page (section 22.2, "default
 * opening page"), or to sign-in.
 *
 * It also rescues an emailed token that arrives here instead of at
 * `/auth/callback`. Supabase ignores a `redirect_to` that is not on the
 * project's allow-list and falls back to the Site URL, which is this page — so
 * a recovery link built with the wrong origin landed on the root carrying a
 * perfectly valid `token_hash`, and this page dropped it and redirected to
 * sign-in. From the recipient's side the link simply did nothing.
 *
 * The origin is now taken from the request, so links are built correctly. This
 * stays because links already sitting in somebody's inbox were built the old
 * way, and because a future change to the allow-list would otherwise silently
 * break recovery again. Forwarding costs nothing and the token is still
 * verified by the callback, not here.
 */
export default async function RootPage({
  searchParams,
}: {
  searchParams: Promise<{ token_hash?: string; type?: string }>;
}) {
  const params = await searchParams;
  if (params.token_hash && params.type) {
    const query = new URLSearchParams({ token_hash: params.token_hash, type: params.type });
    redirect(`/auth/callback?${query.toString()}`);
  }

  const profile = await getCurrentProfile();

  if (!profile) redirect('/sign-in');

  redirect(`/${profile.default_landing_page ?? 'today'}`);
}
