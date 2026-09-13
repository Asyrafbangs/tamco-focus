import type { SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { FIXTURE_PASSWORD, PEOPLE, serviceClient, signInAs } from './setup';

/**
 * v174 — importing the organisation, checked before anything is written.
 *
 * The rules a file is held to live in one planner that both the check and the
 * apply run, so these tests go through both doors: that the check writes
 * nothing, that it finds what is wrong with rows alone and with the file as a
 * whole, that the apply writes exactly what the check promised into the same
 * history as every other move, and that it refuses when the promise has gone
 * stale.
 *
 * The accounts are made for this run: other files run alongside against the
 * same database, and an import that moved seeded people would change what
 * their managers see in the middle of somebody else's test.
 */

const DEPARTMENT_OPS = 'f0c05100-0000-4000-a000-000000000002';
const run = crypto
  .randomUUID()
  .replace(/[^a-zA-Z0-9]/g, '')
  .slice(0, 6)
  .toUpperCase();

interface Account {
  id: string;
  employeeId: string;
  email: string;
}

let lead: Account;
let peer: Account;
let one: Account;
let two: Account;
let three: Account;
let leaver: Account;

interface RpcResult {
  ok: boolean;
  code?: string;
  message?: string;
  applied?: number;
  counts?: { change: number; unchanged: number; problem: number };
  rows?: Array<{
    line: number;
    employee_id: string | null;
    status: 'change' | 'unchanged' | 'problem';
    problem: string | null;
    changes: Array<{ field: string; from: string | null; to: string | null }>;
  }>;
}

async function provision(label: string, role: 'team_member' | 'manager'): Promise<Account> {
  const admin = serviceClient();
  const email = `v174-${label.toLowerCase()}-${run.toLowerCase()}@tamco.local`;
  const created = await admin.auth.admin.createUser({
    email,
    password: FIXTURE_PASSWORD,
    email_confirm: true,
  });
  if (created.error || !created.data.user) {
    throw new Error(`Could not create the ${label} account: ${created.error?.message}`);
  }
  const id = created.data.user.id;
  const employeeId = `V174-${label}-${run}`;
  const { data, error } = await admin.rpc('provision_user_profile', {
    p_user_id: id,
    p_employee_id: employeeId,
    p_email: email,
    p_full_name: `V174 ${label} ${run}`,
    p_department_id: DEPARTMENT_OPS,
    p_role: role,
    p_reporting_manager_id: null,
    p_actor_id: PEOPLE.admin.id,
  });
  if (error || !(data as RpcResult).ok) {
    throw new Error(
      `Could not provision ${label}: ${error?.message ?? (data as RpcResult).message}`,
    );
  }
  return { id, employeeId, email };
}

/** Everybody back where each case expects them: ONE, TWO and THREE under LEAD. */
async function resetLines() {
  const service = serviceClient();
  const everyone = [lead, peer, one, two, three].map((account) => account.id);
  // Let go first, so resetting cannot trip the loop guard on the way.
  await service
    .from('user_profiles')
    .update({ reporting_manager_id: null, functional_manager_id: null, job_title: null })
    .in('id', everyone);
  await service
    .from('user_profiles')
    .update({ reporting_manager_id: lead.id, department_id: DEPARTMENT_OPS })
    .in(
      'id',
      [one, two, three].map((account) => account.id),
    );
}

beforeAll(async () => {
  lead = await provision('LEAD', 'manager');
  peer = await provision('PEER', 'manager');
  one = await provision('ONE', 'team_member');
  two = await provision('TWO', 'team_member');
  three = await provision('THREE', 'team_member');
  leaver = await provision('LEAVER', 'manager');

  const admin = await signInAs('admin');
  const { data } = await admin.rpc('deactivate_user', {
    p_user_id: leaver.id,
    p_allow_open_work: true,
  });
  if (!(data as RpcResult).ok)
    throw new Error(`Could not deactivate: ${(data as RpcResult).message}`);
});

beforeEach(resetLines);

afterAll(async () => {
  if (!lead) return;
  await serviceClient()
    .from('user_profiles')
    .update({ reporting_manager_id: null, functional_manager_id: null })
    .in(
      'id',
      [lead, peer, one, two, three].map((account) => account.id),
    );
  const admin = await signInAs('admin');
  for (const account of [one, two, three, lead, peer]) {
    await admin.rpc('deactivate_user', { p_user_id: account.id, p_allow_open_work: true });
  }
});

async function preview(client: SupabaseClient, rows: unknown[]) {
  const { data, error } = await client.rpc('preview_organisation_import', { p_rows: rows });
  if (error) throw new Error(`preview_organisation_import failed: ${error.message}`);
  return data as RpcResult;
}

async function apply(client: SupabaseClient, rows: unknown[], expected: number, reason?: string) {
  const { data, error } = await client.rpc('apply_organisation_import', {
    p_rows: rows,
    p_expected_changes: expected,
    p_reason: reason,
  });
  if (error) throw new Error(`apply_organisation_import failed: ${error.message}`);
  return data as RpcResult;
}

async function profile(account: Account) {
  const { data, error } = await serviceClient()
    .from('user_profiles')
    .select('reporting_manager_id,functional_manager_id,job_title,department_id')
    .eq('id', account.id)
    .single();
  if (error) throw new Error(`Could not read the profile: ${error.message}`);
  return data as {
    reporting_manager_id: string | null;
    functional_manager_id: string | null;
    job_title: string | null;
    department_id: string | null;
  };
}

function problemAt(result: RpcResult, line: number) {
  return result.rows?.find((row) => row.line === line)?.problem ?? null;
}

describe('v174 importing the organisation', () => {
  it('says what each row would do, names what is wrong, and writes nothing', async () => {
    const admin = await signInAs('admin');
    const result = await preview(admin, [
      { line: 2, employee_id: one.employeeId, job_title: 'V174 Coordinator' },
      { line: 3, employee_id: two.employeeId, manager_employee_id: lead.employeeId },
      { line: 4, employee_id: `V174-NOBODY-${run}`, job_title: 'Anything' },
      { line: 5, employee_id: three.employeeId, department_code: 'NOPE' },
      { line: 6, employee_id: peer.employeeId, manager_employee_id: `V174-GHOST-${run}` },
      { line: 7, employee_id: three.employeeId.toLowerCase(), job_title: 'Twice' },
      { line: 8, employee_id: lead.employeeId, email: 'somebody-else@tamco.local', job_title: 'X' },
    ]);
    expect(result.ok, result.message).toBe(true);

    expect(result.rows?.find((row) => row.line === 2)).toMatchObject({
      status: 'change',
      changes: [{ field: 'job_title', from: null, to: 'V174 Coordinator' }],
    });
    expect(result.rows?.find((row) => row.line === 3)?.status).toBe('unchanged');
    expect(problemAt(result, 4)).toBe('unknown_employee');
    // THREE is on two rows, so neither is trusted — even the one that is fine.
    expect(problemAt(result, 5)).toBe('duplicate_employee');
    expect(problemAt(result, 7)).toBe('duplicate_employee');
    expect(problemAt(result, 6)).toBe('missing_manager');
    expect(problemAt(result, 8)).toBe('email_mismatch');
    expect(result.counts).toEqual({ change: 1, unchanged: 1, problem: 5 });

    expect((await profile(one)).job_title).toBeNull();
  });

  it('refuses a department that does not exist and a manager who has left', async () => {
    const admin = await signInAs('admin');
    const result = await preview(admin, [
      { line: 2, employee_id: one.employeeId, department_code: 'nope' },
      { line: 3, employee_id: two.employeeId, manager_employee_id: leaver.employeeId },
      { line: 4, employee_id: three.employeeId, manager_employee_id: three.employeeId },
      {
        line: 5,
        employee_id: peer.employeeId,
        manager_employee_id: lead.employeeId,
        functional_manager_employee_id: lead.employeeId,
      },
    ]);
    expect(problemAt(result, 2)).toBe('unknown_department');
    expect(problemAt(result, 3)).toBe('inactive_manager');
    expect(problemAt(result, 4)).toBe('own_manager');
    expect(problemAt(result, 5)).toBe('functional_is_primary');
    expect(result.counts).toEqual({ change: 0, unchanged: 0, problem: 4 });
  });

  it('finds a loop the file makes as a whole, where every row alone is fine', async () => {
    const admin = await signInAs('admin');
    // LEAD and PEER are both at the top. Either row alone is a valid move.
    const result = await preview(admin, [
      { line: 2, employee_id: lead.employeeId, manager_employee_id: peer.employeeId },
      { line: 3, employee_id: peer.employeeId, manager_employee_id: lead.employeeId },
      { line: 4, employee_id: two.employeeId, manager_employee_id: one.employeeId },
    ]);
    expect(problemAt(result, 2)).toBe('circular');
    expect(problemAt(result, 3)).toBe('circular');
    // And the loop does not take an unrelated row down with it.
    expect(result.rows?.find((row) => row.line === 4)?.status).toBe('change');
  });

  it('applies a swap that the loop guard would refuse one row at a time', async () => {
    const admin = await signInAs('admin');
    /*
     * ONE reports to LEAD. The file turns that upside down, and lists LEAD's
     * row first: written in file order, LEAD under ONE while ONE is still under
     * LEAD is a loop, and the table's guard would refuse it.
     */
    const rows = [
      { line: 2, employee_id: lead.employeeId, manager_employee_id: one.employeeId },
      { line: 3, employee_id: one.employeeId, manager_employee_id: '' },
    ];
    const checked = await preview(admin, rows);
    expect(checked.counts).toEqual({ change: 2, unchanged: 0, problem: 0 });

    const applied = await apply(admin, rows, 2, 'V174 swap');
    expect(applied.ok, applied.message).toBe(true);
    expect(applied.applied).toBe(2);

    expect((await profile(one)).reporting_manager_id).toBeNull();
    expect((await profile(lead)).reporting_manager_id).toBe(one.id);

    // On the same record as a move made by hand, with the reason given.
    const { data: history } = await serviceClient()
      .from('reporting_assignments')
      .select('subject_id,previous_manager_id,new_manager_id,relationship,reason,changed_by')
      .in('subject_id', [lead.id, one.id])
      .eq('reason', 'V174 swap');
    expect(history).toHaveLength(2);
    expect(history).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          subject_id: one.id,
          previous_manager_id: lead.id,
          new_manager_id: null,
          relationship: 'primary',
          changed_by: PEOPLE.admin.id,
        }),
        expect.objectContaining({
          subject_id: lead.id,
          previous_manager_id: null,
          new_manager_id: one.id,
        }),
      ]),
    );

    const { data: logged } = await serviceClient()
      .from('admin_security_log')
      .select('summary')
      .eq('subject_user_id', one.id)
      .ilike('summary', '%organisation import%');
    expect((logged ?? []).length).toBeGreaterThan(0);
  });

  it('ends a dotted line when its manager becomes the reporting manager, and says so', async () => {
    const admin = await signInAs('admin');
    await serviceClient()
      .from('user_profiles')
      .update({ functional_manager_id: peer.id })
      .eq('id', one.id);

    const rows = [{ line: 2, employee_id: one.employeeId, manager_employee_id: peer.employeeId }];
    const checked = await preview(admin, rows);
    expect(checked.rows?.[0]?.changes.map((change) => change.field)).toEqual([
      'manager',
      'dotted_line',
    ]);

    const applied = await apply(admin, rows, 1);
    expect(applied.ok, applied.message).toBe(true);
    const now = await profile(one);
    expect(now.reporting_manager_id).toBe(peer.id);
    expect(now.functional_manager_id).toBeNull();

    const { data: ended } = await serviceClient()
      .from('reporting_assignments')
      .select('previous_manager_id,new_manager_id,reason')
      .eq('subject_id', one.id)
      .eq('relationship', 'functional')
      .order('changed_at', { ascending: false })
      .limit(1);
    expect(ended?.[0]).toEqual({
      previous_manager_id: peer.id,
      new_manager_id: null,
      reason: 'Became the reporting manager.',
    });
  });

  it('refuses to apply when the organisation has moved since the check', async () => {
    const admin = await signInAs('admin');
    const rows = [
      { line: 2, employee_id: one.employeeId, job_title: 'V174 First' },
      { line: 3, employee_id: two.employeeId, job_title: 'V174 Second' },
    ];
    const checked = await preview(admin, rows);
    expect(checked.counts?.change).toBe(2);

    // Somebody sets ONE's title by hand between the check and the apply.
    await serviceClient()
      .from('user_profiles')
      .update({ job_title: 'V174 First' })
      .eq('id', one.id);

    const applied = await apply(admin, rows, 2);
    expect(applied.ok).toBe(false);
    expect(applied.code).toBe('plan_changed');
    // All or nothing: TWO's title, still a valid change, was not written either.
    expect((await profile(two)).job_title).toBeNull();
  });

  it('refuses anybody who is not an administrator', async () => {
    const manager = await signInAs('izzul');
    const rows = [{ line: 2, employee_id: one.employeeId, job_title: 'Not allowed' }];
    expect((await preview(manager, rows)).code).toBe('not_authorised');
    expect((await apply(manager, rows, 1)).code).toBe('not_authorised');
    expect((await profile(one)).job_title).toBeNull();
  });
});
