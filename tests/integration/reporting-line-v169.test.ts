import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PEOPLE, serviceClient, signInAs } from './setup';

/**
 * v169 — a reporting line that can be changed, and remembered.
 *
 * Moving somebody was only possible through the whole user form, which says
 * nothing about what the move means and left no record of when it happened.
 * These are the rules that make the record worth having: one procedure owns
 * the change, it refuses the moves that would break the tree, and a move that
 * happens is a move that is written down.
 *
 * History rows are never cleaned up here, because the table refuses deletes —
 * which is the point of it. Each test reads the most recent row instead.
 */

/** The temporary tester, who reports to Izzul in the seed. */
const SUBJECT = 'f0c05000-0000-4000-a000-000000000007';

interface RpcResult {
  ok: boolean;
  code?: string;
  message?: string;
}

/**
 * Establish the shape, rather than inherit it.
 *
 * These cases share one subject, and one of them deliberately leaves him at the
 * top of the line. Restoring only afterwards made each test depend on the last
 * one having finished — which held when this file ran alone and failed in the
 * whole gate, where vitest runs files in parallel against one database: the
 * move asserted a previous manager of Izzul and found none.
 *
 * So every test starts from a state it set itself, and the same restore runs
 * afterwards so the other files find the fixture as the seed left it.
 */
async function putTesterUnderIzzul() {
  const admin = serviceClient();
  await admin
    .from('user_profiles')
    .update({ reporting_manager_id: PEOPLE.izzul.id })
    .eq('id', SUBJECT);
  await admin
    .from('user_profiles')
    .update({ reporting_manager_id: null })
    .eq('id', PEOPLE.izzul.id);
}

beforeEach(putTesterUnderIzzul);
afterEach(putTesterUnderIzzul);

async function change(client: SupabaseClient, fields: Record<string, unknown>): Promise<RpcResult> {
  const { data, error } = await client.rpc('change_reporting_manager', fields);
  if (error) throw new Error(`change_reporting_manager failed: ${error.message}`);
  return data as RpcResult;
}

async function managerOf(personId: string): Promise<string | null> {
  const { data, error } = await serviceClient()
    .from('user_profiles')
    .select('reporting_manager_id')
    .eq('id', personId)
    .single();
  if (error) throw new Error(`Could not read the profile: ${error.message}`);
  return (data as { reporting_manager_id: string | null }).reporting_manager_id;
}

async function latestHistory() {
  const { data, error } = await serviceClient()
    .from('reporting_assignments')
    .select('previous_manager_id,new_manager_id,effective_date,reason,changed_by')
    .eq('subject_id', SUBJECT)
    .order('changed_at', { ascending: false })
    .limit(1);
  if (error) throw new Error(`Could not read the history: ${error.message}`);
  return (data ?? [])[0] as
    | {
        previous_manager_id: string | null;
        new_manager_id: string | null;
        effective_date: string;
        reason: string | null;
        changed_by: string | null;
      }
    | undefined;
}

async function historyCount(): Promise<number> {
  const { count, error } = await serviceClient()
    .from('reporting_assignments')
    .select('id', { count: 'exact', head: true })
    .eq('subject_id', SUBJECT);
  if (error) throw new Error(`Could not count the history: ${error.message}`);
  return count ?? 0;
}

describe('v169 changing a reporting line', () => {
  it('moves somebody and writes down when it took effect', async () => {
    const admin = await signInAs('admin');
    const moved = await change(admin, {
      p_user_id: SUBJECT,
      p_manager_id: PEOPLE.amer.id,
      p_reason: 'Covering while Izzul is on leave.',
    });
    expect(moved.ok, moved.message).toBe(true);
    expect(moved.code).toBe('changed');
    expect(await managerOf(SUBJECT)).toBe(PEOPLE.amer.id);

    const entry = await latestHistory();
    expect(entry?.previous_manager_id).toBe(PEOPLE.izzul.id);
    expect(entry?.new_manager_id).toBe(PEOPLE.amer.id);
    expect(entry?.changed_by).toBe(PEOPLE.admin.id);
    expect(entry?.reason).toBe('Covering while Izzul is on leave.');
    // Defaulted to the organisation's today rather than the server's.
    expect(entry?.effective_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('puts somebody at the top of the line when the manager is cleared', async () => {
    const admin = await signInAs('admin');
    const cleared = await change(admin, { p_user_id: SUBJECT, p_manager_id: null });
    expect(cleared.ok, cleared.message).toBe(true);
    expect(await managerOf(SUBJECT)).toBeNull();

    const entry = await latestHistory();
    expect(entry?.previous_manager_id).toBe(PEOPLE.izzul.id);
    expect(entry?.new_manager_id).toBeNull();
  });

  it('writes nothing when the line does not actually move', async () => {
    const admin = await signInAs('admin');
    const before = await historyCount();
    const same = await change(admin, { p_user_id: SUBJECT, p_manager_id: PEOPLE.izzul.id });
    expect(same.ok, same.message).toBe(true);
    expect(same.code).toBe('unchanged');
    expect(await historyCount()).toBe(before);
  });

  it('refuses a loop, whether it is immediate or further up the line', async () => {
    const admin = await signInAs('admin');

    const self = await change(admin, { p_user_id: SUBJECT, p_manager_id: SUBJECT });
    expect(self.ok).toBe(false);
    expect(self.code).toBe('manager_invalid');

    // The tester reports to Izzul, so making Izzul report to the tester closes
    // the loop one level further up than the self-check can see.
    const loop = await change(admin, { p_user_id: PEOPLE.izzul.id, p_manager_id: SUBJECT });
    expect(loop.ok).toBe(false);
    expect(loop.code).toBe('manager_invalid');
    expect(await managerOf(PEOPLE.izzul.id)).toBeNull();
  });

  it('refuses a manager who has been deactivated', async () => {
    const caller = await signInAs('admin');
    /*
     * Deactivated through the procedure that owns it, and then read back.
     *
     * The first version of this test set `status` with a direct update and
     * trusted it. When the move then succeeded, the failure read as a missing
     * guard — the read-back is what tells a refused setup apart from a broken
     * rule. The controlled exception is passed because Lim may own open work,
     * which is a different question from the one under test.
     */
    const { data: deactivated } = await caller.rpc('deactivate_user', {
      p_user_id: PEOPLE.lim.id,
      p_allow_open_work: true,
    });
    expect((deactivated as RpcResult).ok, (deactivated as RpcResult).message).toBe(true);

    try {
      const { data: check } = await serviceClient()
        .from('user_profiles')
        .select('status')
        .eq('id', PEOPLE.lim.id)
        .single();
      expect((check as { status: string }).status).toBe('deactivated');

      const attempt = await change(caller, {
        p_user_id: SUBJECT,
        p_manager_id: PEOPLE.lim.id,
      });
      expect(attempt.ok).toBe(false);
      expect(attempt.code).toBe('manager_inactive');
      expect(await managerOf(SUBJECT)).toBe(PEOPLE.izzul.id);
    } finally {
      await caller.rpc('reactivate_user', { p_user_id: PEOPLE.lim.id });
    }
  });

  it('refuses anybody who is not an administrator', async () => {
    // Izzul manages the tester. Managing somebody is not the authority to
    // rearrange the organisation around them.
    const manager = await signInAs('izzul');
    const attempt = await change(manager, {
      p_user_id: SUBJECT,
      p_manager_id: PEOPLE.amer.id,
    });
    expect(attempt.ok).toBe(false);
    expect(attempt.code).toBe('not_authorised');
    expect(await managerOf(SUBJECT)).toBe(PEOPLE.izzul.id);
  });
});
