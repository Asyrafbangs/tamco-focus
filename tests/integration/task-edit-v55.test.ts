import { describe, expect, it } from 'vitest';

import { createTask, PEOPLE, serviceClient, signInAs } from './setup';

type Rpc = Record<string, unknown> & { ok: boolean; code: string };

describe('v55 editing task content', () => {
  it('lets the owner edit title and details without touching ownership', async () => {
    const task = await createTask('izzah', { title: 'Original title' });
    const owner = await signInAs('izzah');

    const edited = (
      await owner.rpc('update_task_details', {
        p_task_id: task.id,
        p_expected_version: task.version,
        p_title: 'Corrected title',
        p_description: 'Some useful detail.',
        p_idempotency_key: crypto.randomUUID(),
      })
    ).data as Rpc;
    expect(edited).toMatchObject({ ok: true, code: 'task_updated' });

    const { data: row } = await serviceClient()
      .from('tasks')
      .select('title, description, primary_owner_id, status, version')
      .eq('id', task.id)
      .single();

    expect(row?.title).toBe('Corrected title');
    expect(row?.description).toBe('Some useful detail.');
    // The whole point of keeping this separate from reassignment.
    expect(row?.primary_owner_id).toBe(PEOPLE.izzah.id);
    expect(row?.status).toBe('backlog');
    expect(row?.version).toBe(task.version + 1);
  });

  it('refuses somebody who neither owns nor manages the work', async () => {
    const task = await createTask('izzah', { title: 'Not yours' });
    const stranger = await signInAs('amer');

    const refused = (
      await stranger.rpc('update_task_details', {
        p_task_id: task.id,
        p_expected_version: task.version,
        p_title: 'Hijacked',
        p_description: null,
        p_idempotency_key: crypto.randomUUID(),
      })
    ).data as Rpc;
    expect(refused.ok).toBe(false);
    expect(refused.code).toBe('not_authorised');

    const { data: row } = await serviceClient()
      .from('tasks')
      .select('title')
      .eq('id', task.id)
      .single();
    expect(row?.title).toBe('Not yours');
  });

  it('refuses a stale version rather than overwriting a concurrent edit', async () => {
    const task = await createTask('izzah', { title: 'Concurrent' });
    const owner = await signInAs('izzah');

    await owner.rpc('update_task_details', {
      p_task_id: task.id,
      p_expected_version: task.version,
      p_title: 'First edit wins',
      p_description: null,
      p_idempotency_key: crypto.randomUUID(),
    });

    const stale = (
      await owner.rpc('update_task_details', {
        p_task_id: task.id,
        p_expected_version: task.version, // deliberately the old number
        p_title: 'Second edit, stale',
        p_description: null,
        p_idempotency_key: crypto.randomUUID(),
      })
    ).data as Rpc;
    expect(stale.ok).toBe(false);
    expect(stale.code).toBe('version_conflict');

    const { data: row } = await serviceClient()
      .from('tasks')
      .select('title')
      .eq('id', task.id)
      .single();
    expect(row?.title).toBe('First edit wins');
  });

  it('reports an unchanged edit without bumping the version or writing history', async () => {
    const task = await createTask('izzah', { title: 'Same as it ever was' });
    const owner = await signInAs('izzah');

    const unchanged = (
      await owner.rpc('update_task_details', {
        p_task_id: task.id,
        p_expected_version: task.version,
        p_title: 'Same as it ever was',
        p_description: null,
        p_idempotency_key: crypto.randomUUID(),
      })
    ).data as Rpc;
    expect(unchanged).toMatchObject({ ok: true, code: 'unchanged' });

    const { data: row } = await serviceClient()
      .from('tasks')
      .select('version')
      .eq('id', task.id)
      .single();
    expect(row?.version).toBe(task.version);

    const { count } = await serviceClient()
      .from('audit_events')
      .select('id', { count: 'exact', head: true })
      .eq('task_id', task.id)
      .eq('event_type', 'task_details_edited');
    expect(count).toBe(0);
  });

  it('records the previous title so the trail can explain a rename', async () => {
    const task = await createTask('izzah', { title: 'Before rename' });
    const owner = await signInAs('izzah');

    await owner.rpc('update_task_details', {
      p_task_id: task.id,
      p_expected_version: task.version,
      p_title: 'After rename',
      p_description: null,
      p_idempotency_key: crypto.randomUUID(),
    });

    const { data: event } = await serviceClient()
      .from('audit_events')
      .select('event_type, detail')
      .eq('task_id', task.id)
      .eq('event_type', 'task_details_edited')
      .single();

    expect(event?.detail).toMatchObject({
      previous_title: 'Before rename',
      new_title: 'After rename',
    });
  });

  it('refuses to edit work whose record is closed', async () => {
    const task = await createTask('izzah', { title: 'Closing this' });
    const owner = await signInAs('izzah');

    const cancelled = (
      await owner.rpc('cancel_task', {
        p_task_id: task.id,
        p_expected_version: task.version,
        p_reason: 'No longer required',
        p_idempotency_key: crypto.randomUUID(),
      })
    ).data as Rpc;
    expect(cancelled.ok).toBe(true);

    const refused = (
      await owner.rpc('update_task_details', {
        p_task_id: task.id,
        p_expected_version: task.version + 1,
        p_title: 'Rewriting history',
        p_description: null,
        p_idempotency_key: crypto.randomUUID(),
      })
    ).data as Rpc;
    expect(refused.ok).toBe(false);
    expect(refused.code).toBe('invalid_state');
  });
});
