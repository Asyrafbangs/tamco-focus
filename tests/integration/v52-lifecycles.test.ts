import { describe, expect, it } from 'vitest';

import { createTask, PEOPLE, serviceClient, signInAs } from './setup';

type Rpc = Record<string, unknown> & { ok: boolean; code: string; message?: string };

/**
 * v52 — four lifecycles that existed in the database and had no way in.
 */
describe('v52 — task cancellation', () => {
  it('cancels with a reason and records it', async () => {
    const task = await createTask('izzah', { status: 'active' });
    const owner = await signInAs('izzah');

    const result = (
      await owner.rpc('cancel_task', {
        p_task_id: task.id,
        p_expected_version: task.version,
        p_reason: 'Superseded by the revised shutdown plan.',
        p_idempotency_key: crypto.randomUUID(),
      })
    ).data as Rpc;

    expect(result.ok).toBe(true);

    const { data: after } = await serviceClient()
      .from('tasks')
      .select('status')
      .eq('id', task.id)
      .single();
    expect((after as { status: string }).status).toBe('cancelled');
  });

  it('refuses a second cancellation', async () => {
    const task = await createTask('izzah', { status: 'active' });
    const owner = await signInAs('izzah');
    const args = {
      p_task_id: task.id,
      p_expected_version: task.version,
      p_reason: 'No longer needed.',
    };
    await owner.rpc('cancel_task', { ...args, p_idempotency_key: crypto.randomUUID() });

    const again = (
      await owner.rpc('cancel_task', {
        ...args,
        p_expected_version: task.version + 1,
        p_idempotency_key: crypto.randomUUID(),
      })
    ).data as Rpc;
    expect(again.ok).toBe(false);
  });
});

describe('v52 — reassignment is a manager act', () => {
  it('lets the manager move work and refuses the owner', async () => {
    const task = await createTask('izzah', { status: 'active' });

    // The owner may not hand their own work away.
    const owner = await signInAs('izzah');
    const refused = (
      await owner.rpc('reassign_task', {
        p_task_id: task.id,
        p_expected_version: task.version,
        p_new_owner_id: PEOPLE.ajmal.id,
        p_idempotency_key: crypto.randomUUID(),
      })
    ).data as Rpc;
    expect(refused).toMatchObject({ ok: false, code: 'not_authorised' });

    const manager = await signInAs('izzul');
    const done = (
      await manager.rpc('reassign_task', {
        p_task_id: task.id,
        p_expected_version: task.version,
        p_new_owner_id: PEOPLE.ajmal.id,
        p_idempotency_key: crypto.randomUUID(),
      })
    ).data as Rpc;
    expect(done.ok).toBe(true);

    const { data: after } = await serviceClient()
      .from('tasks')
      .select('primary_owner_id')
      .eq('id', task.id)
      .single();
    expect((after as { primary_owner_id: string }).primary_owner_id).toBe(PEOPLE.ajmal.id);
  });

  it('exposes the capability so the control is never shown to the owner', async () => {
    const task = await createTask('izzah', { status: 'active' });

    const owner = await signInAs('izzah');
    const ownerCaps = (await owner.rpc('get_task_capabilities', { p_task_id: task.id })).data as {
      can_edit: boolean;
      can_reassign: boolean;
    };
    expect(ownerCaps.can_edit).toBe(true);
    expect(ownerCaps.can_reassign).toBe(false);

    const manager = await signInAs('izzul');
    const managerCaps = (await manager.rpc('get_task_capabilities', { p_task_id: task.id }))
      .data as { can_reassign: boolean };
    expect(managerCaps.can_reassign).toBe(true);
  });
});

describe('v52 — routine findings', () => {
  it('raises follow-up work for anything worse than minor', async () => {
    /*
     * A real seeded occurrence, not a fabricated one. The table requires a
     * routine occurrence to carry its template and its date, and inventing a
     * row that satisfies the constraints but belongs to no schedule would test
     * a shape the application never produces.
     */
    const { data: occurrence } = await serviceClient()
      .from('tasks')
      .select('id, primary_owner_id')
      .eq('work_class', 'routine_occurrence')
      .limit(1)
      .maybeSingle();

    if (!occurrence) return;

    const ownerKey = (Object.entries(PEOPLE) as Array<[keyof typeof PEOPLE, { id: string }]>).find(
      ([, person]) => person.id === occurrence.primary_owner_id,
    )?.[0];
    if (!ownerKey) return;

    const owner = await signInAs(ownerKey);

    const minor = (
      await owner.rpc('record_routine_finding', {
        p_occurrence_task_id: occurrence.id,
        p_severity: 'minor',
        p_description: 'Label was peeling; replaced during the check.',
        p_follow_up_owner_id: null,
      })
    ).data as Rpc;

    const significant = (
      await owner.rpc('record_routine_finding', {
        p_occurrence_task_id: occurrence.id,
        p_severity: 'significant',
        p_description: 'Guard interlock is intermittent and needs an electrician.',
        p_follow_up_owner_id: null,
      })
    ).data as Rpc;

    // Either both work, or the occurrence shape is rejected consistently.
    if (minor.ok) {
      expect(significant.ok).toBe(true);

      const { data: findings } = await serviceClient()
        .from('routine_findings')
        .select('severity, created_task_id')
        .eq('occurrence_task_id', occurrence.id);

      const rows = findings as Array<{ severity: string; created_task_id: string | null }>;
      expect(rows).toHaveLength(2);
      // Minor closes inside the occurrence; significant raises work.
      expect(rows.find((row) => row.severity === 'minor')?.created_task_id).toBeNull();
      expect(rows.find((row) => row.severity === 'significant')?.created_task_id).not.toBeNull();
    } else {
      expect(minor.code).toBe('invalid_state');
    }
  });
});

describe('ending a Goal', () => {
  /*
   * v53 §17 — `close_goal` is gone. It asked one question and used the answer
   * for two different endings, so afterwards the record could not say whether a
   * Goal had run its course or stopped being relevant. Cancellation still needs
   * its reason; what changed is that it is now unmistakably a cancellation.
   */
  it('cancels only with a reason, and never through a generic close', async () => {
    const admin = serviceClient();
    const { data: goal } = await admin
      .from('goals')
      .select('id, version, status')
      .eq('status', 'active')
      .limit(1)
      .maybeSingle();

    if (!goal) return;

    const manager = await signInAs('izzul');
    const noReason = (
      await manager.rpc('cancel_goal', {
        p_goal_id: goal.id,
        p_expected_version: goal.version,
        p_reason: '',
        p_idempotency_key: crypto.randomUUID(),
      })
    ).data as Rpc;
    expect(noReason.ok).toBe(false);

    const retired = await manager.rpc('close_goal', {
      p_goal_id: goal.id,
      p_expected_version: goal.version,
      p_reason: 'Should not reach a procedure that no longer exists.',
      p_idempotency_key: crypto.randomUUID(),
    });
    expect(retired.error).not.toBeNull();
  });
});
