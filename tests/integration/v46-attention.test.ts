import { describe, expect, it } from 'vitest';

import { createTask, PEOPLE, serviceClient, signInAs } from './setup';

type Rpc = Record<string, unknown> & { ok: boolean; code: string; message?: string };

async function raiseRequest(
  actionType: 'decision' | 'approval' | 'support' | 'other',
  overrides: { impact?: string } = {},
) {
  const task = await createTask('izzah', { status: 'active' });
  const employee = await signInAs('izzah');

  const raised = (
    await employee.rpc('raise_barrier', {
      p_task_id: task.id,
      p_description: 'The original contractor cannot meet the installation date.',
      p_support_needed: 'Confirm whether we should appoint the alternative contractor.',
      p_impact: overrides.impact ?? 'may_delay',
      p_add_to_meeting_queue: false,
      p_action_type: actionType,
      p_action_required_from: PEOPLE.izzul.id,
      p_idempotency_key: crypto.randomUUID(),
    })
  ).data as Rpc & { barrier_id: string };

  expect(raised.ok).toBe(true);
  return { task, barrierId: raised.barrier_id };
}

/**
 * The rule the specification calls non-negotiable: Shared means assigned
 * checklist work, Needs Attention means somebody is waiting on a decision.
 * Left unguarded, Shared drifts into "anything another person wants from me"
 * and stops answering the only question it exists to answer.
 */
describe('v46 — Barrier and Shared are different things', () => {
  it('creates no Shared contribution and no checklist item when a barrier is raised', async () => {
    const before = await signInAs('izzul');
    const { data: sharedBefore } = await before.from('shared_contributions').select('task_id');

    const { task } = await raiseRequest('decision');

    const manager = await signInAs('izzul');
    const [{ data: sharedAfter }, { data: checklist }] = await Promise.all([
      manager.from('shared_contributions').select('task_id'),
      serviceClient().from('task_checklist_items').select('id').eq('task_id', task.id),
    ]);

    expect(sharedAfter?.length ?? 0).toBe(sharedBefore?.length ?? 0);
    expect(checklist).toHaveLength(0);
  });

  it('puts the request in Needs Attention for the person who was asked', async () => {
    const { task, barrierId } = await raiseRequest('decision');

    const { data: pending } = await serviceClient()
      .from('barriers')
      .select('id, task_id, action_required_from, action_pending, status')
      .eq('id', barrierId)
      .single();

    expect(pending).toMatchObject({
      task_id: task.id,
      action_required_from: PEOPLE.izzul.id,
      action_pending: true,
      status: 'open',
    });
  });

  it('creates no attention request when a checklist step is assigned', async () => {
    const task = await createTask('izzah', { status: 'active' });
    const owner = await signInAs('izzah');

    await owner.from('task_checklist_items').insert({
      task_id: task.id,
      position: 1,
      action: 'Verify machine guarding evidence',
      assigned_to: PEOPLE.amer.id,
    });

    const admin = serviceClient();
    const [{ data: barriers }, { data: shared }] = await Promise.all([
      admin.from('barriers').select('id').eq('task_id', task.id),
      admin
        .from('task_checklist_items')
        .select('id')
        .eq('task_id', task.id)
        .eq('assigned_to', PEOPLE.amer.id),
    ]);

    // Assigning work creates work, never a request for a decision.
    expect(barriers).toHaveLength(0);
    expect(shared).toHaveLength(1);
  });
});

describe('v46 — attention survives the notification being read', () => {
  it('keeps the request pending after the notification is marked read', async () => {
    const { barrierId } = await raiseRequest('decision');
    const admin = serviceClient();

    const { data: notifications } = await admin
      .from('notifications')
      .select('id')
      .eq('recipient_id', PEOPLE.izzul.id)
      .eq('barrier_id', barrierId);

    expect((notifications ?? []).length).toBeGreaterThan(0);

    await admin
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('id', (notifications as Array<{ id: string }>)[0]!.id);

    // Reading is not acting (section 18).
    const { data: barrier } = await admin
      .from('barriers')
      .select('action_pending')
      .eq('id', barrierId)
      .single();

    expect((barrier as { action_pending: boolean }).action_pending).toBe(true);
  });

  it('clears the request only when the answer is given, and leaves it open', async () => {
    const { task, barrierId } = await raiseRequest('decision');
    const manager = await signInAs('izzul');

    const answered = (
      await manager.rpc('post_barrier_response', {
        p_barrier_id: barrierId,
        p_message: 'Proceed with the alternative contractor once Procurement confirms.',
        p_expected_version: null,
        p_kind: 'answer',
        p_idempotency_key: crypto.randomUUID(),
      })
    ).data as Rpc;

    expect(answered.ok).toBe(true);

    const admin = serviceClient();
    const [{ data: barrier }, { data: parent }] = await Promise.all([
      admin.from('barriers').select('status, action_pending').eq('id', barrierId).single(),
      admin.from('tasks').select('status').eq('id', task.id).single(),
    ]);

    expect(barrier).toMatchObject({ status: 'open', action_pending: false });
    // Section 35 — answering is not resuming.
    expect((parent as { status: string }).status).toBe('active');
  });
});

describe('v46 — barrier impact decides whether the task pauses', () => {
  it('leaves the task active when the work can still continue', async () => {
    const { task } = await raiseRequest('decision', { impact: 'may_delay' });

    const { data: parent } = await serviceClient()
      .from('tasks')
      .select('status')
      .eq('id', task.id)
      .single();

    expect((parent as { status: string }).status).toBe('active');
  });

  it('pauses only when the work genuinely cannot continue', async () => {
    const { task } = await raiseRequest('decision', { impact: 'cannot_continue' });

    const { data: parent } = await serviceClient()
      .from('tasks')
      .select('status')
      .eq('id', task.id)
      .single();

    expect((parent as { status: string }).status).toBe('paused');
  });

  it('does not resume a paused task when the manager answers', async () => {
    const { task, barrierId } = await raiseRequest('decision', { impact: 'cannot_continue' });
    const manager = await signInAs('izzul');

    await manager.rpc('post_barrier_response', {
      p_barrier_id: barrierId,
      p_message: 'Shutdown on Friday approved.',
      p_expected_version: null,
      p_kind: 'answer',
      p_idempotency_key: crypto.randomUUID(),
    });

    const { data: parent } = await serviceClient()
      .from('tasks')
      .select('status')
      .eq('id', task.id)
      .single();

    // Section 35 — the Primary Owner decides when work restarts.
    expect((parent as { status: string }).status).toBe('paused');
  });
});

describe('v46 — Meeting Queue is a secondary manager action', () => {
  it('adds one agenda item that names the discussion and links the barrier', async () => {
    const { task, barrierId } = await raiseRequest('decision');
    const manager = await signInAs('izzul');

    const added = (
      await manager.rpc('add_barrier_to_meeting_queue', {
        p_barrier_id: barrierId,
        p_idempotency_key: crypto.randomUUID(),
      })
    ).data as Rpc & { already_queued: boolean };

    expect(added).toMatchObject({ ok: true, code: 'meeting_queue_item_added' });

    const admin = serviceClient();
    const [{ data: items }, { data: tasks }, { data: barriers }] = await Promise.all([
      admin
        .from('meeting_queue_items')
        .select('summary, source, task_id, barrier_id')
        .eq('barrier_id', barrierId),
      admin.from('tasks').select('id').eq('id', task.id),
      admin.from('barriers').select('id').eq('task_id', task.id),
    ]);

    expect(items).toHaveLength(1);
    expect(items?.[0]).toMatchObject({
      source: 'barrier',
      task_id: task.id,
      barrier_id: barrierId,
      summary: 'Confirm whether we should appoint the alternative contractor.',
    });

    // No second task, no second barrier (section 66).
    expect(tasks).toHaveLength(1);
    expect(barriers).toHaveLength(1);
  });

  it('reports the existing item instead of queueing it twice', async () => {
    const { barrierId } = await raiseRequest('decision');
    const manager = await signInAs('izzul');

    await manager.rpc('add_barrier_to_meeting_queue', {
      p_barrier_id: barrierId,
      p_idempotency_key: crypto.randomUUID(),
    });

    // A different idempotency key: this is a genuine second press, not a
    // retried request, and it still must not duplicate the agenda line.
    const again = (
      await manager.rpc('add_barrier_to_meeting_queue', {
        p_barrier_id: barrierId,
        p_idempotency_key: crypto.randomUUID(),
      })
    ).data as Rpc & { already_queued: boolean };

    expect(again).toMatchObject({ ok: true, code: 'meeting_queue_item_exists' });
    expect(again.already_queued).toBe(true);

    const { data: items } = await serviceClient()
      .from('meeting_queue_items')
      .select('id')
      .eq('barrier_id', barrierId);

    expect(items).toHaveLength(1);
  });

  it('refuses to queue a barrier that has already been resolved', async () => {
    const { barrierId } = await raiseRequest('decision');
    const employee = await signInAs('izzah');

    await employee.rpc('resolve_barrier', {
      p_barrier_id: barrierId,
      p_resolution_note: 'The original contractor confirmed the date after all.',
    });

    const manager = await signInAs('izzul');
    const refused = (
      await manager.rpc('add_barrier_to_meeting_queue', {
        p_barrier_id: barrierId,
        p_idempotency_key: crypto.randomUUID(),
      })
    ).data as Rpc;

    expect(refused).toMatchObject({ ok: false, code: 'invalid_state' });
  });

  it('refuses somebody with no connection to the work', async () => {
    const { barrierId } = await raiseRequest('decision');
    const outsider = await signInAs('lim');

    const refused = (
      await outsider.rpc('add_barrier_to_meeting_queue', {
        p_barrier_id: barrierId,
        p_idempotency_key: crypto.randomUUID(),
      })
    ).data as Rpc;

    expect(refused).toMatchObject({ ok: false, code: 'not_authorised' });
  });
});

describe('v46 — only the person asked may answer', () => {
  it('refuses a response from an unrelated colleague', async () => {
    const { barrierId } = await raiseRequest('decision');
    const outsider = await signInAs('lim');

    const refused = (
      await outsider.rpc('post_barrier_response', {
        p_barrier_id: barrierId,
        p_message: 'Go ahead.',
        p_expected_version: null,
        p_kind: 'answer',
        p_idempotency_key: crypto.randomUUID(),
      })
    ).data as Rpc;

    expect(refused).toMatchObject({ ok: false, code: 'not_authorised' });
  });

  it('produces one response, one transition and one notification on a double submit', async () => {
    const { barrierId } = await raiseRequest('decision');
    const manager = await signInAs('izzul');
    const key = crypto.randomUUID();

    const args = {
      p_barrier_id: barrierId,
      p_message: 'Proceed with the alternative contractor.',
      p_expected_version: null,
      p_kind: 'answer' as const,
      p_idempotency_key: key,
    };

    // The same command twice, as a double-click delivers it.
    const [first, second] = await Promise.all([
      manager.rpc('post_barrier_response', args),
      manager.rpc('post_barrier_response', args),
    ]);

    expect((first.data as Rpc).ok).toBe(true);
    expect((second.data as Rpc).ok).toBe(true);

    const admin = serviceClient();
    const [{ data: responses }, { data: events }, { data: notifications }] = await Promise.all([
      admin.from('barrier_responses').select('id').eq('barrier_id', barrierId),
      admin
        .from('audit_events')
        .select('id')
        .eq('event_type', 'barrier_response_posted')
        .contains('detail', { barrier_id: barrierId }),
      admin
        .from('notifications')
        .select('id')
        .eq('recipient_id', PEOPLE.izzah.id)
        .eq('barrier_id', barrierId)
        .eq('title', 'Decision received'),
    ]);

    expect(responses).toHaveLength(1);
    expect(events).toHaveLength(1);
    expect(notifications).toHaveLength(1);
  });
});
