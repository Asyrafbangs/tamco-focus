import { redirect } from 'next/navigation';

import { getCurrentProfile } from '@/lib/supabase/server';

/**
 * Sends each person to their configured opening page (section 22.2, "default
 * opening page"), or to sign-in.
 */
export default async function RootPage() {
  const profile = await getCurrentProfile();

  if (!profile) redirect('/sign-in');

  redirect(`/${profile.default_landing_page ?? 'today'}`);
}
