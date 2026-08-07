import { describe, expect, it } from 'vitest';

import { createTask, PEOPLE, serviceClient, signInAs } from './setup';

type Rpc = Record<string, unknown> & { ok: boolean; code: string };

describe('v35 Next-action operations', () => {
  it('sets and completes the current Next action without changing task state', async () => {
    const task = await createTask('izzah', {
      next_action: 'Review the current evidence pack',
    });
    const owner = await signInAs('izzah');
    const nextAction = `Confirm the evidence owner ${crypto.randomUUID().slice(0, 8)}`;

    const changed = (
      await owner.rpc('set_task_next_action', {
        p_task_id: task.id,
        p_expected_version: task.version,
        p_next_action: nextAction,
        p_mark_done: false,
        p_idempotency_key: crypto.randomUUID(),
      })
    ).data as Rpc & { version: number };
    expect(changed).toMatchObject({
      ok: true,
      code: 'next_action_changed',
      next_action: nextAction,
      version: task.version + 1,
    });

    const completed = (
      await owner.rpc('set_task_next_action', {
        p_task_id: task.id,
        p_expected_version: changed.version,
        p_next_action: null,
        p_mark_done: true,
        p_idempotency_key: crypto.randomUUID(),
      })
    ).data as Rpc;
    expect(completed).toMatchObject({
      ok: true,
      code: 'next_action_completed',
      completed_action: nextAction,
    });

    const generic = (
      await owner.rpc('set_task_next_action', {
        p_task_id: task.id,
        p_expected_version: changed.version + 1,
        p_next_action: 'Continue next action.',
        p_mark_done: false,
        p_idempotency_key: crypto.randomUUID(),
      })
    ).data as Rpc;
    expect(generic).toMatchObject({ ok: false, code: 'validation_failed' });

    const admin = serviceClient();
    const [{ data: persisted }, { data: events }] = await Promise.all([
      admin
        .from('tasks')
        .select('status,next_action,last_meaningful_update_at,version')
        .eq('id', task.id)
        .single(),
      admin
        .from('audit_events')
        .select('event_type,detail')
        .eq('task_id', task.id)
        .in('event_type', ['next_action_changed', 'next_action_completed'])
        .order('occurred_at'),
    ]);
    expect(persisted).toMatchObject({
      status: 'backlog',
      next_action: null,
      version: task.version + 2,
    });
    expect(persisted?.last_meaningful_update_at).toBeTruthy();
    expect(events).toEqual([
      expect.objectContaining({
        event_type: 'next_action_changed',
        detail: expect.objectContaining({ source: 'overview', next_action: nextAction }),
      }),
      expect.objectContaining({
        event_type: 'next_action_completed',
        detail: expect.objectContaining({ source: 'checklist', completed_action: nextAction }),
      }),
    ]);
  });

  it('refreshes Next action atomically with a progress update and enforces edit authority', async () => {
    const task = await createTask('izzah', {
      next_action: 'Confirm the previous action',
    });
    const owner = await signInAs('izzah');
    const nextAction = `Book the follow-up review ${crypto.randomUUID().slice(0, 8)}`;
    const update = (
      await owner.rpc('post_task_update', {
        p_task_id: task.id,
        p_body: 'The first evidence review was completed.',
        p_is_evidence_only: false,
        p_checklist_item_id: null,
        p_mention_ids: [],
        p_attachments: [],
        p_idempotency_key: crypto.randomUUID(),
        p_next_action: nextAction,
      })
    ).data as Rpc;
    expect(update).toMatchObject({
      ok: true,
      code: 'update_posted',
      next_action: nextAction,
      next_action_changed: true,
    });

    const admin = serviceClient();
    const [{ data: persisted }, { data: audit }] = await Promise.all([
      admin.from('tasks').select('next_action,version').eq('id', task.id).single(),
      admin
        .from('audit_events')
        .select('event_type,detail')
        .eq('task_id', task.id)
        .eq('event_type', 'next_action_changed')
        .single(),
    ]);
    expect(persisted).toMatchObject({ next_action: nextAction, version: task.version + 1 });
    expect(audit).toMatchObject({
      event_type: 'next_action_changed',
      detail: expect.objectContaining({ source: 'progress_update', next_action: nextAction }),
    });

    const viewer = await signInAs('amer');
    const refused = (
      await viewer.rpc('set_task_next_action', {
        p_task_id: task.id,
        p_expected_version: task.version + 1,
        p_next_action: 'This view-only user must not be able to save this.',
        p_mark_done: false,
        p_idempotency_key: crypto.randomUUID(),
      })
    ).data as Rpc;
    expect(refused).toMatchObject({ ok: false, code: 'not_authorised' });

    const { data: auditRows } = await admin
      .from('audit_events')
      .select('actor_id')
      .eq('task_id', task.id)
      .eq('event_type', 'next_action_changed');
    expect(auditRows).toEqual([expect.objectContaining({ actor_id: PEOPLE.izzah.id })]);
  });
});
