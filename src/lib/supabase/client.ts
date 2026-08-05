'use client';

import { createBrowserClient } from '@supabase/ssr';

import { publicEnv } from '@/lib/env';

/**
 * The browser client.
 *
 * It holds the anon key, which is constrained entirely by RLS — it grants
 * nothing on its own. Every state change still goes through a server action, so
 * this client is used only for sign-in and for reading data the caller is
 * already authorised to see.
 */
export function createSupabaseBrowserClient() {
  return createBrowserClient(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}
