import type { SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { PEOPLE, serviceClient, signInAs } from './setup';

/**
 * v172 — every move is recorded, whichever screen made it.
 *
 * The Directory's user form saved a changed manager straight onto the profile,
 * so the effective-dated history from v169 never heard of it, and a caller
 * that said nothing about the manager cleared it. These are the rules that
 * close both: the move goes through the procedure that owns moves, silence
 * leaves the manager alone, and a refused move saves nothing else either.
 *
 * The accounts are made for this run rather than borrowed from the seed.
 * Moving a seeded person changes who their manager can see, and other test
 * files run alongside this one against the same database — which is exactly
 * how a v167 test clearing the tester's manager broke a v169 test yesterday.
 */

const DEPARTMENT_OPS = 'f0c05100-0000-4000-a000-000000000002';
const run = crypto
  .randomUUID()
  .replace(/[^a-zA-Z0-9]/g, '')
  .slice(0, 6)
  .toUpperCase();

let subject = '';
let leaver = '';

interface RpcResult {
  ok: boolean;
  code?: string;
  message?: string;
}

async function provision(label: string, managerId: string): Promise<string> {
  const admin = serviceClient();
  const email = `v172-${label.toLowerCase()}-${run.toLowerCase()}@tamco.local`;
  const created = await admin.auth.admin.createUser({
    email,
    password: 'LocalFocus123!',
    email_confirm: true,
  });
  if (created.error || !created.data.user) {
    throw new Error(`Could not create the ${label} account: ${created.error?.message}`);
  }
  const id = created.data.user.id;
  const { data, error } = await admin.rpc('provision_user_profile', {
    p_user_id: id,
    p_employee_id: `V172-${label}-${run}`,
    p_email: email,
    p_full_name: `V172 ${label} ${run}`,
    p_department_id: DEPARTMENT_OPS,
    p_role: 'team_member',
    p_reporting_manager_id: managerId,
    p_actor_id: PEOPLE.admin.id,
  });
  if (error || !(data as RpcResult).ok) {
    throw new Error(
      `Could not provision ${label}: ${error?.message ?? (data as RpcResult).message}`,
    );
  }
  return id;
}

beforeAll(async () => {
  // Under Amer, whose visibility is by explicit grant: extra reports there
  // change what nobody can see.
  subject = await provision('SUBJ', PEOPLE.amer.id);
  leaver = await provision('LEAVER', PEOPLE.amer.id);
});

beforeEach(async () => {
  // Each case starts from a line it set, not one a previous case left.
  await serviceClient()
    .from('user_profiles')
    .update({ reporting_manager_id: PEOPLE.amer.id, job_title: null })
    .eq('id', subject);
});

afterAll(async () => {
  // Out of every active list; the history these accounts gathered stays.
  const admin = await signInAs('admin');
  for (const id of [subject, leaver]) {
    if (id) await admin.rpc('deactivate_user', { p_user_id: id, p_allow_open_work: true });
  }
});

async function update(client: SupabaseClient, fields: Record<string, unknown>) {
  const { data, error } = await client.rpc('update_user_profile', {
    p_user_id: subject,
    ...fields,
  });
  if (error) throw new Error(`update_user_profile failed: ${error.message}`);
  return data as RpcResult;
}

async function profile(id: string) {
  const { data, error } = await serviceClient()
    .from('user_profiles')
    .select('reporting_manager_id,job_title,status')
    .eq('id', id)
    .single();
  if (error) throw new Error(`Could not read the profile: ${error.message}`);
  return data as { reporting_manager_id: string | null; job_title: string | null; status: string };
}

async function history(id: string) {
  const { data, error } = await serviceClient()
    .from('reporting_assignments')
    .select('previous_manager_id,new_manager_id,changed_by')
    .eq('subject_id', id)
    .order('changed_at', { ascending: false });
  if (error) throw new Error(`Could not read the history: ${error.message}`);
  return (data ?? []) as Array<{
    previous_manager_id: string | null;
    new_manager_id: string | null;
    changed_by: string | null;
  }>;
}

describe('v172 moving somebody from the Directory', () => {
  it('records the move like any other', async () => {
    const admin = await signInAs('admin');
    const saved = await update(admin, { p_reporting_manager_id: PEOPLE.ajmal.id });
    expect(saved.ok, saved.message).toBe(true);
    expect((await profile(subject)).reporting_manager_id).toBe(PEOPLE.ajmal.id);

    const [latest] = await history(subject);
    expect(latest?.previous_manager_id).toBe(PEOPLE.amer.id);
    expect(latest?.new_manager_id).toBe(PEOPLE.ajmal.id);
    expect(latest?.changed_by).toBe(PEOPLE.admin.id);
  });

  it('leaves the manager alone when a save says nothing about it', async () => {
    const admin = await signInAs('admin');
    const before = (await history(subject)).length;

    // A job title, and no manager argument at all. This used to clear it.
    const saved = await update(admin, { p_job_title: 'Operations Executive' });
    expect(saved.ok, saved.message).toBe(true);

    const after = await profile(subject);
    expect(after.reporting_manager_id).toBe(PEOPLE.amer.id);
    expect(after.job_title).toBe('Operations Executive');
    expect((await history(subject)).length).toBe(before);
  });

  it('clears the manager only when that is asked for', async () => {
    const admin = await signInAs('admin');
    const saved = await update(admin, { p_clear_reporting_manager: true });
    expect(saved.ok, saved.message).toBe(true);
    expect((await profile(subject)).reporting_manager_id).toBeNull();

    const [latest] = await history(subject);
    expect(latest?.previous_manager_id).toBe(PEOPLE.amer.id);
    expect(latest?.new_manager_id).toBeNull();
  });

  it('holds this screen to the same refusals, and saves nothing else when it refuses', async () => {
    const admin = await signInAs('admin');

    const { data: off } = await admin.rpc('deactivate_user', {
      p_user_id: leaver,
      p_allow_open_work: true,
    });
    expect((off as RpcResult).ok, (off as RpcResult).message).toBe(true);
    expect((await profile(leaver)).status).toBe('deactivated');

    const refused = await update(admin, {
      p_reporting_manager_id: leaver,
      p_job_title: 'Should not be saved',
    });
    expect(refused.ok).toBe(false);
    expect(refused.code).toBe('manager_inactive');
    const unchanged = await profile(subject);
    expect(unchanged.reporting_manager_id).toBe(PEOPLE.amer.id);
    expect(unchanged.job_title).toBeNull();

    // Amer manages the subject, so putting Amer under the subject loops.
    const { data: loop, error } = await admin.rpc('update_user_profile', {
      p_user_id: PEOPLE.amer.id,
      p_reporting_manager_id: subject,
    });
    if (error) throw new Error(`update_user_profile failed: ${error.message}`);
    expect((loop as RpcResult).ok).toBe(false);
    expect((loop as RpcResult).code).toBe('manager_invalid');
  });
});
