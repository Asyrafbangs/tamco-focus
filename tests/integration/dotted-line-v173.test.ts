import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { FIXTURE_PASSWORD, PEOPLE, serviceClient, signInAs } from './setup';

/**
 * v173 — a dotted line, which grants nothing.
 *
 * The record could hold only the formal reporting line, so the working one —
 * who somebody answers to on safety, say, alongside their line manager — lived
 * in people's heads. These are the rules for the second line: an administrator
 * draws it, it is refused where it would say nothing or point at somebody who
 * has left, it is written into the same history as formal moves, and above all
 * it gives the dotted-line manager no sight of the person's work.
 *
 * That last test is built so it cannot pass by accident. Both managers are
 * given the manager role, which does see direct reports, and the formal manager
 * is shown seeing the task before the dotted-line manager is shown not seeing
 * it — so a pass means the line granted nothing, not that the check was blind.
 *
 * The accounts are made for this run: moving seeded people changes what their
 * managers can see, and other files run alongside against the same database.
 */

const DEPARTMENT_OPS = 'f0c05100-0000-4000-a000-000000000002';
const run = crypto
  .randomUUID()
  .replace(/[^a-zA-Z0-9]/g, '')
  .slice(0, 6)
  .toUpperCase();

interface Account {
  id: string;
  email: string;
}

let formal: Account;
let dotted: Account;
let subject: Account;
let leaver: Account;
let taskId = '';

interface RpcResult {
  ok: boolean;
  code?: string;
  message?: string;
}

async function provision(
  label: string,
  role: 'team_member' | 'manager',
  managerId: string | null,
): Promise<Account> {
  const admin = serviceClient();
  const email = `v173-${label.toLowerCase()}-${run.toLowerCase()}@tamco.local`;
  const created = await admin.auth.admin.createUser({
    email,
    password: FIXTURE_PASSWORD,
    email_confirm: true,
  });
  if (created.error || !created.data.user) {
    throw new Error(`Could not create the ${label} account: ${created.error?.message}`);
  }
  const id = created.data.user.id;
  const { data, error } = await admin.rpc('provision_user_profile', {
    p_user_id: id,
    p_employee_id: `V173-${label}-${run}`,
    p_email: email,
    p_full_name: `V173 ${label} ${run}`,
    p_department_id: DEPARTMENT_OPS,
    p_role: role,
    p_reporting_manager_id: managerId,
    p_actor_id: PEOPLE.admin.id,
  });
  if (error || !(data as RpcResult).ok) {
    throw new Error(
      `Could not provision ${label}: ${error?.message ?? (data as RpcResult).message}`,
    );
  }
  return { id, email };
}

async function signInAsAccount(account: Account): Promise<SupabaseClient> {
  const client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { error } = await client.auth.signInWithPassword({
    email: account.email,
    password: FIXTURE_PASSWORD,
  });
  if (error) throw new Error(`Could not sign in as ${account.email}: ${error.message}`);
  return client;
}

beforeAll(async () => {
  formal = await provision('FORMAL', 'manager', null);
  dotted = await provision('DOTTED', 'manager', null);
  subject = await provision('SUBJ', 'team_member', formal.id);
  leaver = await provision('LEAVER', 'manager', null);

  const { data, error } = await serviceClient()
    .from('tasks')
    .insert({
      title: `V173 subject's work ${run}`,
      status: 'active',
      work_class: 'operational_action',
      focus_bucket: 'operational',
      origin: 'self_initiated',
      primary_owner_id: subject.id,
      created_by: subject.id,
    })
    .select('id')
    .single();
  if (error) throw new Error(`Could not create the subject's task: ${error.message}`);
  taskId = (data as { id: string }).id;
});

beforeEach(async () => {
  // Each case starts from lines it set: the formal one to FORMAL, no dotted one.
  await serviceClient()
    .from('user_profiles')
    .update({ reporting_manager_id: formal.id, functional_manager_id: null })
    .eq('id', subject.id);
});

afterAll(async () => {
  const service = serviceClient();
  // Binned rather than deleted: a task with an audit trail refuses deletion.
  if (taskId) {
    await service
      .from('tasks')
      .update({ deleted_at: new Date().toISOString(), deleted_by: subject.id })
      .eq('id', taskId);
  }
  const admin = await signInAs('admin');
  for (const account of [subject, formal, dotted, leaver]) {
    if (account) {
      await admin.rpc('deactivate_user', { p_user_id: account.id, p_allow_open_work: true });
    }
  }
});

async function setDotted(client: SupabaseClient, fields: Record<string, unknown>) {
  const { data, error } = await client.rpc('change_functional_manager', {
    p_user_id: subject.id,
    ...fields,
  });
  if (error) throw new Error(`change_functional_manager failed: ${error.message}`);
  return data as RpcResult;
}

async function lines() {
  const { data, error } = await serviceClient()
    .from('user_profiles')
    .select('reporting_manager_id,functional_manager_id')
    .eq('id', subject.id)
    .single();
  if (error) throw new Error(`Could not read the profile: ${error.message}`);
  return data as { reporting_manager_id: string | null; functional_manager_id: string | null };
}

async function history(relationship: 'primary' | 'functional') {
  const { data, error } = await serviceClient()
    .from('reporting_assignments')
    .select('previous_manager_id,new_manager_id,relationship,reason')
    .eq('subject_id', subject.id)
    .eq('relationship', relationship)
    .order('changed_at', { ascending: false });
  if (error) throw new Error(`Could not read the history: ${error.message}`);
  return (data ?? []) as Array<{
    previous_manager_id: string | null;
    new_manager_id: string | null;
    relationship: string;
    reason: string | null;
  }>;
}

describe('v173 the dotted line', () => {
  it('is drawn by an administrator and written into the history', async () => {
    const admin = await signInAs('admin');
    const drawn = await setDotted(admin, {
      p_manager_id: dotted.id,
      p_reason: 'Answers to them on safety.',
    });
    expect(drawn.ok, drawn.message).toBe(true);

    const now = await lines();
    expect(now.functional_manager_id).toBe(dotted.id);
    // The formal line is a different relationship, and untouched.
    expect(now.reporting_manager_id).toBe(formal.id);

    const [latest] = await history('functional');
    expect(latest?.previous_manager_id).toBeNull();
    expect(latest?.new_manager_id).toBe(dotted.id);
    expect(latest?.reason).toBe('Answers to them on safety.');
  });

  it('gives the dotted-line manager no sight of the work', async () => {
    const admin = await signInAs('admin');
    const drawn = await setDotted(admin, { p_manager_id: dotted.id });
    expect(drawn.ok, drawn.message).toBe(true);

    // The check can see: the formal manager, through the reporting line.
    const formalClient = await signInAsAccount(formal);
    const { data: seenByFormal } = await formalClient.from('tasks').select('id').eq('id', taskId);
    expect(seenByFormal ?? []).toHaveLength(1);

    // And the dotted line grants nothing, to a manager whose role would see a report.
    const dottedClient = await signInAsAccount(dotted);
    const { data: seenByDotted } = await dottedClient.from('tasks').select('id').eq('id', taskId);
    expect(seenByDotted ?? []).toHaveLength(0);
  });

  it('refuses a line that would say nothing, or point at somebody who has left', async () => {
    const admin = await signInAs('admin');

    const self = await setDotted(admin, { p_manager_id: subject.id });
    expect(self.code).toBe('manager_invalid');

    const same = await setDotted(admin, { p_manager_id: formal.id });
    expect(same.code).toBe('manager_is_primary');

    const { data: off } = await admin.rpc('deactivate_user', {
      p_user_id: leaver.id,
      p_allow_open_work: true,
    });
    expect((off as RpcResult).ok, (off as RpcResult).message).toBe(true);
    const gone = await setDotted(admin, { p_manager_id: leaver.id });
    expect(gone.code).toBe('manager_inactive');

    expect((await lines()).functional_manager_id).toBeNull();
  });

  it('writes nothing when it does not change, and records a clearing', async () => {
    const admin = await signInAs('admin');
    await setDotted(admin, { p_manager_id: dotted.id });
    const before = (await history('functional')).length;

    const same = await setDotted(admin, { p_manager_id: dotted.id });
    expect(same.code).toBe('unchanged');
    expect((await history('functional')).length).toBe(before);

    const cleared = await setDotted(admin, { p_manager_id: null });
    expect(cleared.ok, cleared.message).toBe(true);
    expect((await lines()).functional_manager_id).toBeNull();
    const [latest] = await history('functional');
    expect(latest?.previous_manager_id).toBe(dotted.id);
    expect(latest?.new_manager_id).toBeNull();
  });

  it('goes when the dotted-line manager becomes the reporting manager', async () => {
    const admin = await signInAs('admin');
    await setDotted(admin, { p_manager_id: dotted.id });

    const { data, error } = await admin.rpc('change_reporting_manager', {
      p_user_id: subject.id,
      p_manager_id: dotted.id,
    });
    if (error) throw new Error(`change_reporting_manager failed: ${error.message}`);
    expect((data as RpcResult).ok, (data as RpcResult).message).toBe(true);

    const now = await lines();
    expect(now.reporting_manager_id).toBe(dotted.id);
    expect(now.functional_manager_id).toBeNull();

    // Both changes are on the record: the formal move, and the dotted line's end.
    const [formalMove] = await history('primary');
    expect(formalMove?.new_manager_id).toBe(dotted.id);
    const [dottedEnd] = await history('functional');
    expect(dottedEnd?.previous_manager_id).toBe(dotted.id);
    expect(dottedEnd?.new_manager_id).toBeNull();
    expect(dottedEnd?.reason).toBe('Became the reporting manager.');
  });

  it('refuses anybody who is not an administrator', async () => {
    const manager = await signInAs('izzul');
    const attempt = await setDotted(manager, { p_manager_id: dotted.id });
    expect(attempt.ok).toBe(false);
    expect(attempt.code).toBe('not_authorised');
  });
});
