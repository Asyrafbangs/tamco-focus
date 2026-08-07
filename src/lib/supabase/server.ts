import 'server-only';

import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';

import { publicEnv } from '@/lib/env';

/**
 * The request-scoped client every server component and server action uses.
 *
 * It carries the caller's session, so every query and every RPC runs as that
 * person and is subject to their RLS policies. This is the ONLY client that
 * should touch user data.
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Server components cannot set cookies. The middleware refreshes
            // the session on every request, so a failure here is expected and
            // harmless rather than something to surface.
          }
        },
      },
    },
  );
}

/**
 * The service-role client. Bypasses RLS entirely.
 *
 * Reserved for the two operations that genuinely cannot run as the caller:
 *   * creating and deleting local Auth identities during user provisioning
 *   * the weekly summary worker, which reads across everyone by design
 *
 * Both re-check authorisation in application code before they use it. This
 * module is `server-only` and the key is never prefixed `NEXT_PUBLIC_`, so it
 * cannot reach a browser bundle.
 */
export function createSupabaseServiceRoleClient() {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!serviceRoleKey) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY is not set. It is required for user provisioning and the ' +
        'weekly summary worker. Run the local setup script to populate .env.local.',
    );
  }

  return createClient(publicEnv.NEXT_PUBLIC_SUPABASE_URL, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/**
 * The signed-in person's identity and personal preferences.
 *
 * Declared explicitly rather than inferred. `src/lib/database.types.ts` is
 * generated from the live schema by `npm run db:types`, which needs the local
 * Supabase stack running; until that file exists the client has no schema to
 * infer from. `npm run db:types:check` fails loudly while it is missing, so
 * this hand-written shape cannot quietly drift from the table.
 */
export interface CurrentProfile {
  id: string;
  employee_id: string;
  email: string;
  full_name: string;
  role: 'team_member' | 'manager' | 'administrator';
  status: 'active' | 'deactivated';
  department_id: string | null;
  reporting_manager_id: string | null;
  theme_preference: string;
  text_size: string;
  reduced_motion: boolean;
  default_landing_page: string;
  daily_brief_mode: 'off' | 'daily' | 'workdays';
  daily_brief_hour: number;
  quiet_hours_start: number | null;
  quiet_hours_end: number | null;
  first_day_of_week: number;
  timezone: string;
  status_labels_always_visible: boolean;
  shortcut_hints: boolean;
  personal_summary_mode: 'off' | 'focused' | 'standard';
  team_summary_mode: 'off' | 'leadership' | 'detailed';
}

const PROFILE_COLUMNS =
  'id, employee_id, email, full_name, role, status, department_id, reporting_manager_id, theme_preference, text_size, reduced_motion, default_landing_page, daily_brief_mode, daily_brief_hour, quiet_hours_start, quiet_hours_end, first_day_of_week, timezone, status_labels_always_visible, shortcut_hints, personal_summary_mode, team_summary_mode';

/**
 * The signed-in person's profile, or null.
 *
 * A deactivated account is treated as signed out here as well as in the
 * database (section 31B.2: deactivation prevents sign-in and revokes access),
 * so a still-valid JWT cannot be used to keep working.
 */
export async function getCurrentProfile(): Promise<CurrentProfile | null> {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data, error } = await supabase
    .from('user_profiles')
    .select(PROFILE_COLUMNS)
    .eq('id', user.id)
    .maybeSingle();

  if (error) {
    console.error(`[getCurrentProfile] ${error.message}`);
    return null;
  }

  const profile = data as CurrentProfile | null;

  if (!profile || profile.status !== 'active') return null;

  return profile;
}

/** Throws rather than returning null, for routes that have no anonymous path. */
export async function requireProfile() {
  const profile = await getCurrentProfile();

  if (!profile) {
    throw new Error('AUTH_REQUIRED');
  }

  return profile;
}
