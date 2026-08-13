import { describe, expect, it } from 'vitest';

import { createTask, serviceClient, signInAs } from './setup';

type Rpc = Record<string, unknown> & { ok: boolean; code: string };

/**
 * Delete and the Bin.
 *
 * The behaviour that matters is that "delete" removes the task from every
 * working surface without destroying anything, because every table referencing
 * `tasks` cascades and a real DELETE would take the audit trail with it.
 */
describe('v57 deleting a task moves it to the Bin', () => {
  it('hides the task everywhere and lists it in the Bin', async () => {
    const task = await createTask('amer', { title: 'Captured by mistake' });
    const owner = await signInAs('amer');

    const deleted = (
      await owner.rpc('delete_task', {
        p_task_id: task.id,
        p_expected_version: task.version,
        p_idempotency_key: crypto.randomUUID(),
      })
    ).data as Rpc;
    expect(deleted).toMatchObject({ ok: true, code: 'task_deleted' });

    const { data: working } = await owner
      .from('task_overview')
      .select('id')
      .eq('id', task.id)
      .maybeSingle();
    expect(working).toBeNull();

    const { data: binned } = await owner
      .from('binned_tasks')
      .select('id, deleted_at')
      .eq('id', task.id)
      .maybeSingle();
    expect(binned?.id).toBe(task.id);
    expect(binned?.deleted_at).not.toBeNull();
  });

  it('destroys nothing — checklist, attachments and audit all survive', async () => {
    const task = await createTask('amer', { title: 'Has history' });
    await serviceClient().from('task_checklist_items').insert({
      task_id: task.id,
      position: 1,
      action: 'A step worth keeping',
      assigned_to: null,
      evidence_rule: 'not_required',
    });

    const owner = await signInAs('amer');
    await owner.rpc('delete_task', {
      p_task_id: task.id,
      p_expected_version: task.version,
      p_idempotency_key: crypto.randomUUID(),
    });

    const admin = serviceClient();
    const { count: steps } = await admin
      .from('task_checklist_items')
      .select('id', { count: 'exact', head: true })
      .eq('task_id', task.id);
    expect(steps).toBe(1);

    const { count: events } = await admin
      .from('audit_events')
      .select('id', { count: 'exact', head: true })
      .eq('task_id', task.id)
      .eq('event_type', 'task_deleted');
    expect(events).toBe(1);

    // The row itself is still there, which is the whole point.
    const { data: row } = await admin.from('tasks').select('id').eq('id', task.id).maybeSingle();
    expect(row?.id).toBe(task.id);
  });

  it('restores a task back into the working view', async () => {
    const task = await createTask('amer', { title: 'Deleted then wanted back' });
    const owner = await signInAs('amer');

    await owner.rpc('delete_task', {
      p_task_id: task.id,
      p_expected_version: task.version,
      p_idempotency_key: crypto.randomUUID(),
    });

    const restored = (
      await owner.rpc('restore_task', {
        p_task_id: task.id,
        p_idempotency_key: crypto.randomUUID(),
      })
    ).data as Rpc;
    expect(restored).toMatchObject({ ok: true, code: 'task_restored' });

    const { data } = await owner.from('task_overview').select('id').eq('id', task.id).maybeSingle();
    expect(data?.id).toBe(task.id);
  });

  it('refuses somebody who neither owns nor manages the work', async () => {
    const task = await createTask('amer', { title: 'Not yours to bin' });
    const stranger = await signInAs('izzah');

    const refused = (
      await stranger.rpc('delete_task', {
        p_task_id: task.id,
        p_expected_version: task.version,
        p_idempotency_key: crypto.randomUUID(),
      })
    ).data as Rpc;
    expect(refused.ok).toBe(false);
    expect(refused.code).toBe('not_authorised');
  });

  it('refuses to delete completed work, which is a record of what was delivered', async () => {
    // `tasks_completed_at_consistent` requires the timestamp alongside the state.
    const task = await createTask('amer', {
      title: 'Finished properly',
      status: 'completed',
      completed_at: new Date().toISOString(),
    });
    const owner = await signInAs('amer');

    const refused = (
      await owner.rpc('delete_task', {
        p_task_id: task.id,
        p_expected_version: task.version,
        p_idempotency_key: crypto.randomUUID(),
      })
    ).data as Rpc;
    expect(refused.ok).toBe(false);
    expect(refused.code).toBe('invalid_state');
  });

  it('is idempotent when the task is already in the Bin', async () => {
    const task = await createTask('amer', { title: 'Deleted twice' });
    const owner = await signInAs('amer');

    await owner.rpc('delete_task', {
      p_task_id: task.id,
      p_expected_version: task.version,
      p_idempotency_key: crypto.randomUUID(),
    });
    const again = (
      await owner.rpc('delete_task', {
        p_task_id: task.id,
        p_expected_version: null,
        p_idempotency_key: crypto.randomUUID(),
      })
    ).data as Rpc;

    expect(again).toMatchObject({ ok: true, code: 'already_deleted' });
  });
});
