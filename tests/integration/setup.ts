import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { beforeAll } from 'vitest';

/**
 * Integration test harness.
 *
 * These tests run against the REAL local Supabase stack — real Postgres, real
 * GoTrue, real RLS. Nothing is mocked, because the behaviour under test is
 * precisely the interaction between the transactional procedures and the
 * policies, and a mock of either would test the mock.
 *
 * Requires `supabase start` and a seeded database.
 */

config({ path: '.env.local', quiet: true });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !anonKey) {
  throw new Error(
    'NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set.\n' +
      'Run `npm run supabase:start` then `node scripts/write-env.mjs`.',
  );
}

/** Local-only fixture accounts, from supabase/seed.sql. */
export const FIXTURE_PASSWORD = process.env.SEED_USER_PASSWORD ?? 'LocalFocus123!';

export const PEOPLE = {
  admin: { id: 'f0c05000-0000-4000-a000-000000000001', email: 'admin@tamco.local' },
  izzul: { id: 'f0c05000-0000-4000-a000-000000000002', email: 'izzul@tamco.local' },
  amer: { id: 'f0c05000-0000-4000-a000-000000000003', email: 'amer@tamco.local' },
  izzah: { id: 'f0c05000-0000-4000-a000-000000000004', email: 'izzah@tamco.local' },
  ajmal: { id: 'f0c05000-0000-4000-a000-000000000005', email: 'ajmal@tamco.local' },
  lim: { id: 'f0c05000-0000-4000-a000-000000000006', email: 'lim@tamco.local' },
} as const;

export type PersonKey = keyof typeof PEOPLE;

/** A client authenticated as one of the fixture accounts. */
export async function signInAs(person: PersonKey): Promise<SupabaseClient> {
  const client = createClient(supabaseUrl!, anonKey!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { error } = await client.auth.signInWithPassword({
    email: PEOPLE[person].email,
    password: FIXTURE_PASSWORD,
  });

  if (error) {
    throw new Error(`Could not sign in as ${person}: ${error.message}`);
  }

  return client;
}

/** Bypasses RLS. Used only to arrange fixtures and to read back ground truth. */
export function serviceClient(): SupabaseClient {
  if (!serviceRoleKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY must be set for integration tests.');
  }

  return createClient(supabaseUrl!, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Creates a task owned by `person` and returns it.
 *
 * Arranged through the service role so a test can set up state it would not be
 * authorised to create, without that being the thing under test.
 */
export async function createTask(
  person: PersonKey,
  overrides: Record<string, unknown> = {},
): Promise<{ id: string; version: number }> {
  const admin = serviceClient();

  const { data, error } = await admin
    .from('tasks')
    .insert({
      title: `Integration fixture ${crypto.randomUUID().slice(0, 8)}`,
      status: 'backlog',
      work_class: 'operational_action',
      focus_bucket: 'operational',
      origin: 'self_initiated',
      primary_owner_id: PEOPLE[person].id,
      created_by: PEOPLE[person].id,
      ...overrides,
    })
    .select('id, version')
    .single();

  if (error) throw new Error(`Could not create fixture task: ${error.message}`);

  return data as { id: string; version: number };
}

/** Removes tasks created by a test, keeping the seeded fixtures intact. */
export async function deleteTask(taskId: string): Promise<void> {
  await serviceClient().from('tasks').delete().eq('id', taskId);
}

beforeAll(async () => {
  const client = createClient(supabaseUrl!, anonKey!);
  const { error } = await client.from('org_settings').select('key').limit(1);

  // A transport failure here means the stack is not up; say so plainly rather
  // than letting every test fail with an opaque message.
  if (error && error.message.includes('fetch failed')) {
    throw new Error(
      `Cannot reach Supabase at ${supabaseUrl}.\n` +
        'Start it with `npm run supabase:start`, then `npm run db:reset`.',
    );
  }
});
