import { describe, expect, it } from 'vitest';

import { PEOPLE, serviceClient, signInAs } from './setup';

/**
 * v54 — account administration is not business management (§16, §17, §52).
 *
 * The administrator fixture manages nobody: no `reporting_manager_id` points at
 * them. That is the whole point of these tests. An administrator who is *also*
 * somebody's manager keeps every manager power, but they get it from the
 * reporting line, not from the role — so the fixture that holds only the role
 * is the one that proves the separation.
 *
 * §52 lists this as a go-live gate, and until this file existed nothing
 * asserted it. The predicates could have drifted back without a single test
 * turning red.
 */

type Rpc = Record<string, unknown> & { ok: boolean; code: string; message?: string };

const targetDate = () => `${new Date().getFullYear()}-12-15`;

describe('an administrator cannot act on business records', () => {
  it('cannot agree or activate an employee Goal', async () => {
    const manager = await signInAs('izzul');
    const created = (
      await manager.rpc('create_lean_goal', {
        p_owner_id: PEOPLE.lim.id,
        p_expected_result: `Admin authority probe ${crypto.randomUUID().slice(0, 8)}`,
        p_target_date: targetDate(),
        p_weight_percent: 2,
        p_measures: [{ description: 'The separation of duties holds.' }],
        p_milestones: [],
        p_submission_mode: 'discussion',
        p_idempotency_key: crypto.randomUUID(),
      })
    ).data as Rpc & { goal_id: string; goal_version_id: string; version: number };
    expect(created).toMatchObject({ ok: true });

    const admin = await signInAs('admin');
    const refused = (
      await admin.rpc('agree_lean_goal_version', {
        p_goal_id: created.goal_id,
        p_pending_version_id: created.goal_version_id,
        p_expected_version: created.version,
        p_idempotency_key: crypto.randomUUID(),
      })
    ).data as Rpc;
    expect(refused).toMatchObject({ ok: false, code: 'not_authorised' });

    // And the capability payload agrees, so no screen offers the control.
    const capabilities = (await admin.rpc('get_goal_capabilities', { p_goal_id: created.goal_id }))
      .data as Record<string, boolean>;
    expect(capabilities.can_agree).toBe(false);
    expect(capabilities.can_update).toBe(false);
    expect(capabilities.can_edit_structure).toBe(false);
    expect(capabilities.can_cancel_goal).toBe(false);
  });

  it('cannot cancel or reassign an employee task', async () => {
    const { data: task } = await serviceClient()
      .from('tasks')
      .insert({
        title: `Admin authority probe ${crypto.randomUUID().slice(0, 8)}`,
        status: 'active',
        work_class: 'operational_action',
        focus_bucket: 'operational',
        origin: 'self_initiated',
        primary_owner_id: PEOPLE.izzah.id,
        created_by: PEOPLE.izzah.id,
      })
      .select('id, version')
      .single();

    const admin = await signInAs('admin');

    const cancelled = (
      await admin.rpc('cancel_task', {
        p_task_id: task!.id,
        p_expected_version: task!.version,
        p_reason: 'An administrator should not be able to do this.',
        p_idempotency_key: crypto.randomUUID(),
      })
    ).data as Rpc;
    expect(cancelled).toMatchObject({ ok: false, code: 'not_authorised' });

    const reassigned = (
      await admin.rpc('reassign_task', {
        p_task_id: task!.id,
        p_expected_version: task!.version,
        p_new_owner_id: PEOPLE.lim.id,
        p_idempotency_key: crypto.randomUUID(),
      })
    ).data as Rpc;
    expect(reassigned).toMatchObject({ ok: false, code: 'not_authorised' });

    const capabilities = (await admin.rpc('get_task_capabilities', { p_task_id: task!.id }))
      .data as Record<string, boolean>;
    expect(capabilities.can_cancel).toBe(false);
    expect(capabilities.can_reassign).toBe(false);
    expect(capabilities.can_edit).toBe(false);
    expect(capabilities.can_review).toBe(false);

    // The work is untouched by either refusal.
    const { data: after } = await serviceClient()
      .from('tasks')
      .select('status, primary_owner_id')
      .eq('id', task!.id)
      .single();
    expect(after).toMatchObject({ status: 'active', primary_owner_id: PEOPLE.izzah.id });
  });

  /*
   * The workload review panel is gone (v144, specification §3), and nothing in
   * the product calls this any more. The function itself stays: dropping it
   * while the previously deployed client could still reach it would break that
   * client for the length of a deploy, and it is the recording step for
   * decisions already in the audit trail. It is still reachable over the API,
   * so its authorisation boundary is still worth holding.
   */
  it('cannot record a workload decision about somebody they do not manage', async () => {
    const admin = await signInAs('admin');
    const refused = (
      await admin.rpc('accept_workload_review', {
        p_person_id: PEOPLE.izzah.id,
        p_bucket: 'operational',
        p_active_count: 6,
        p_recommended_target: 5,
        p_idempotency_key: crypto.randomUUID(),
      })
    ).data as Rpc;
    expect(refused).toMatchObject({ ok: false, code: 'not_authorised' });
  });
});

describe('an administrator keeps what the role is actually for', () => {
  it('can still see the work they administer', async () => {
    const admin = await signInAs('admin');

    // Visibility is deliberately untouched: §19's user directory and any
    // support request would be unusable without it, and seeing is not acting.
    const { data: tasks, error } = await admin.from('tasks').select('id').limit(5);
    expect(error).toBeNull();
    expect((tasks ?? []).length).toBeGreaterThan(0);

    const { data: people } = await admin.from('user_profiles').select('id').limit(10);
    expect((people ?? []).length).toBeGreaterThan(1);
  });

  it('can still deactivate and reactivate an account', async () => {
    const admin = await signInAs('admin');

    const deactivated = (
      await admin.rpc('deactivate_user', {
        p_user_id: PEOPLE.ajmal.id,
        // Ajmal owns seeded work; the point here is the administrator's
        // authority over the *account*, not a tidy offboarding.
        p_allow_open_work: true,
      })
    ).data as Rpc;
    expect(deactivated).toMatchObject({ ok: true });

    const reactivated = (await admin.rpc('reactivate_user', { p_user_id: PEOPLE.ajmal.id }))
      .data as Rpc;
    expect(reactivated).toMatchObject({ ok: true });

    const { data: profile } = await serviceClient()
      .from('user_profiles')
      .select('status')
      .eq('id', PEOPLE.ajmal.id)
      .single();
    expect(profile).toMatchObject({ status: 'active' });
  });
});
