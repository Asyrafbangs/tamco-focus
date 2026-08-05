import { redirect } from 'next/navigation';

import { createSupabaseServerClient } from '@/lib/supabase/server';

async function signOut() {
  'use server';

  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect('/sign-in');
}

export function SignOutButton() {
  return (
    <form action={signOut}>
      <button type="submit" className="btn small ghost">
        Sign out
      </button>
    </form>
  );
}
