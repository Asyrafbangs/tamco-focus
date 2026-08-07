import { redirect } from 'next/navigation';

import { requireProfile } from '@/lib/supabase/server';

export default async function CapturePage() {
  await requireProfile();
  redirect('/today?capture=1');
}
