import { describe, expect, it } from 'vitest';

import { createTask, PEOPLE, serviceClient, signInAs } from './setup';

type Rpc = Record<string, unknown> & { ok: boolean; code: string; message?: string };

async function queuedRequest() {
  const task = await createTask('izzah', { status: 'active' });
  const employee = await signInAs('izzah');

  const raised = (
    await employee.rpc('raise_barrier', {
      p_task_id: task.id,
      p_description: 'The original contractor cannot meet the installation date.',
      p_support_needed: 'Confirm whether we should appoint the alternative contractor.',
      p_impact: 'may_delay',
      p_add_to_meeting_queue: false,
      p_action_type: 'decision',
      p_action_required_from: PEOPLE.izzul.id,
      p_idempotency_key: crypto.randomUUID(),
    })
  ).data as Rpc & { barrier_id: string };
  expect(raised.ok).toBe(true);

  const manager = await signInAs('izzul');
  const queued = (
    await manager.rpc('add_barrier_to_meeting_queue', {
      p_barrier_id: raised.barrier_id,
      p_idempotency_key: crypto.randomUUID(),
    })
  ).data as Rpc & { item_id: string };
  expect(queued.ok).toBe(true);

  return { task, barrierId: raised.barrier_id, itemId: queued.item_id, manager };
}

describe('v47 — queueing records who and why, and answers nothing', () => {
  it('links the barrier, the task, the requester and the person who queued it', async () => {
    const { task, barrierId, itemId } = await queuedRequest();

    const { data: item } = await serviceClient()
      .from('meeting_queue_items')
      .select('task_id, barrier_id, status, added_by, requested_by, scheduled_event_id, summary')
      .eq('id', itemId)
      .single();

    expect(item).toMatchObject({
      task_id: task.id,
      barrier_id: barrierId,
      status: 'queued',
      added_by: PEOPLE.izzul.id,
      requested_by: PEOPLE.izzah.id,
      scheduled_event_id: null,
      summary: 'Confirm whether we should appoint the alternative contractor.',
    });
  });

  it('leaves the request outstanding — queueing is not answering (section 29)', async () => {
    const { task, barrierId } = await queuedRequest();

    const admin = serviceClient();
    const [{ data: barrier }, { data: tasks }] = await Promise.all([
      admin.from('barriers').select('status, action_pending').eq('id', barrierId).single(),
      admin.from('tasks').select('id').eq('id', task.id),
    ]);

    expect(barrier).toMatchObject({ status: 'open', action_pending: true });
    // No second task, no second barrier.
    expect(tasks).toHaveLength(1);
  });

  it('refuses somebody who was neither asked nor owns the work', async () => {
    const { barrierId } = await queuedRequest();
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

describe('v47 — scheduling a discussion', () => {
  it('books one event on the existing calendar, linked to the work and the request', async () => {
    const { task, barrierId, itemId, manager } = await queuedRequest();
    const startsAt = '2026-08-12T02:00:00.000Z';

    const scheduled = (
      await manager.rpc('schedule_meeting_queue_item', {
        p_item_id: itemId,
        p_starts_at: startsAt,
        p_duration_minutes: 30,
        p_participant_ids: null,
        p_idempotency_key: crypto.randomUUID(),
      })
    ).data as Rpc & { event_id: string };

    expect(scheduled).toMatchObject({ ok: true, code: 'discussion_scheduled' });

    const admin = serviceClient();
    const [{ data: event }, { data: item }, { data: participants }] = await Promise.all([
      admin
        .from('calendar_events')
        .select('title, starts_at, ends_at, task_id, barrier_id, source_type, source_id')
        .eq('id', scheduled.event_id)
        .single(),
      admin
        .from('meeting_queue_items')
        .select('status, scheduled_event_id')
        .eq('id', itemId)
        .single(),
      admin
        .from('calendar_event_participants')
        .select('user_id')
        .eq('event_id', scheduled.event_id),
    ]);

    expect(event).toMatchObject({
      task_id: task.id,
      barrier_id: barrierId,
      source_type: 'meeting_queue',
      source_id: itemId,
    });
    expect(new Date(String((event as { starts_at: string }).starts_at)).toISOString()).toBe(
      startsAt,
    );
    expect(item).toMatchObject({ status: 'scheduled', scheduled_event_id: scheduled.event_id });

    // Section 23 — the two people the request is about are in it by default.
    const ids = (participants as Array<{ user_id: string }>).map((row) => row.user_id).sort();
    expect(ids).toEqual([PEOPLE.izzul.id, PEOPLE.izzah.id].sort());
  });

  it('shows the discussion on the same calendar the tasks use', async () => {
    const { itemId, manager } = await queuedRequest();

    const scheduled = (
      await manager.rpc('schedule_meeting_queue_item', {
        p_item_id: itemId,
        p_starts_at: '2026-08-12T02:00:00.000Z',
        p_duration_minutes: 30,
        p_participant_ids: null,
        p_idempotency_key: crypto.randomUUID(),
      })
    ).data as Rpc & { event_id: string };

    const { data: events } = await manager
      .from('plan_events')
      .select('event_kind, event_id, barrier_id, occurs_at')
      .eq('event_id', scheduled.event_id);

    expect(events).toHaveLength(1);
    expect(events?.[0]).toMatchObject({ event_kind: 'discussion' });
  });

  it('still leaves the answer outstanding after a date exists (section 29)', async () => {
    const { barrierId, itemId, manager } = await queuedRequest();

    await manager.rpc('schedule_meeting_queue_item', {
      p_item_id: itemId,
      p_starts_at: '2026-08-12T02:00:00.000Z',
      p_duration_minutes: 30,
      p_participant_ids: null,
      p_idempotency_key: crypto.randomUUID(),
    });

    const { data: barrier } = await serviceClient()
      .from('barriers')
      .select('status, action_pending')
      .eq('id', barrierId)
      .single();

    // A date in the diary is not a decision.
    expect(barrier).toMatchObject({ status: 'open', action_pending: true });
  });

  it('tells the participants, once', async () => {
    const { barrierId, itemId, manager } = await queuedRequest();

    await manager.rpc('schedule_meeting_queue_item', {
      p_item_id: itemId,
      p_starts_at: '2026-08-12T02:00:00.000Z',
      p_duration_minutes: 30,
      p_participant_ids: null,
      p_idempotency_key: crypto.randomUUID(),
    });

    const { data: notifications } = await serviceClient()
      .from('notifications')
      .select('recipient_id, title')
      .eq('barrier_id', barrierId)
      .eq('title', 'Discussion scheduled');

    // The organiser does not need telling what they just booked.
    expect(notifications).toHaveLength(1);
    expect((notifications as Array<{ recipient_id: string }>)[0]?.recipient_id).toBe(
      PEOPLE.izzah.id,
    );
  });

  it('reports the existing booking rather than making a second one', async () => {
    const { itemId, manager } = await queuedRequest();

    const first = (
      await manager.rpc('schedule_meeting_queue_item', {
        p_item_id: itemId,
        p_starts_at: '2026-08-12T02:00:00.000Z',
        p_duration_minutes: 30,
        p_participant_ids: null,
        p_idempotency_key: crypto.randomUUID(),
      })
    ).data as Rpc & { event_id: string };

    // A different key: a genuine second press, not a retry.
    const second = (
      await manager.rpc('schedule_meeting_queue_item', {
        p_item_id: itemId,
        p_starts_at: '2026-08-13T02:00:00.000Z',
        p_duration_minutes: 30,
        p_participant_ids: null,
        p_idempotency_key: crypto.randomUUID(),
      })
    ).data as Rpc & { event_id: string };

    expect(second).toMatchObject({ ok: true, code: 'discussion_already_scheduled' });
    expect(second.event_id).toBe(first.event_id);

    const { data: events } = await serviceClient()
      .from('calendar_events')
      .select('id')
      .eq('source_id', itemId);

    expect(events).toHaveLength(1);
  });

  it('creates one event when the button is double-clicked', async () => {
    const { itemId, manager } = await queuedRequest();
    const key = crypto.randomUUID();
    const args = {
      p_item_id: itemId,
      p_starts_at: '2026-08-12T02:00:00.000Z',
      p_duration_minutes: 30,
      p_participant_ids: null,
      p_idempotency_key: key,
    };

    const [first, second] = await Promise.all([
      manager.rpc('schedule_meeting_queue_item', args),
      manager.rpc('schedule_meeting_queue_item', args),
    ]);

    expect((first.data as Rpc).ok).toBe(true);
    expect((second.data as Rpc).ok).toBe(true);

    const admin = serviceClient();
    const [{ data: events }, { data: audits }] = await Promise.all([
      admin.from('calendar_events').select('id').eq('source_id', itemId),
      admin
        .from('audit_events')
        .select('id')
        .eq('event_type', 'discussion_scheduled')
        .contains('detail', { meeting_queue_item_id: itemId }),
    ]);

    expect(events).toHaveLength(1);
    expect(audits).toHaveLength(1);
  });

  it('refuses a length nobody meant', async () => {
    const { itemId, manager } = await queuedRequest();

    const refused = (
      await manager.rpc('schedule_meeting_queue_item', {
        p_item_id: itemId,
        p_starts_at: '2026-08-12T02:00:00.000Z',
        p_duration_minutes: 0,
        p_participant_ids: null,
        p_idempotency_key: crypto.randomUUID(),
      })
    ).data as Rpc;

    expect(refused).toMatchObject({ ok: false, code: 'validation_failed' });
  });
});

describe('v47 — removing a queued topic', () => {
  it('removes it and records why the queue changed', async () => {
    const { itemId, manager } = await queuedRequest();

    const removed = (
      await manager.rpc('remove_meeting_queue_item', {
        p_item_id: itemId,
        p_idempotency_key: crypto.randomUUID(),
      })
    ).data as Rpc;

    expect(removed).toMatchObject({ ok: true, code: 'meeting_queue_item_removed' });

    const admin = serviceClient();
    const [{ data: item }, { data: audits }] = await Promise.all([
      admin.from('meeting_queue_items').select('status').eq('id', itemId).single(),
      admin
        .from('audit_events')
        .select('id')
        .eq('event_type', 'meeting_queue_item_removed')
        .contains('detail', { meeting_queue_item_id: itemId }),
    ]);

    expect((item as { status: string }).status).toBe('removed');
    expect(audits).toHaveLength(1);
  });

  it('lets the topic be queued again once removed', async () => {
    const { barrierId, itemId, manager } = await queuedRequest();

    await manager.rpc('remove_meeting_queue_item', {
      p_item_id: itemId,
      p_idempotency_key: crypto.randomUUID(),
    });

    const again = (
      await manager.rpc('add_barrier_to_meeting_queue', {
        p_barrier_id: barrierId,
        p_idempotency_key: crypto.randomUUID(),
      })
    ).data as Rpc;

    expect(again).toMatchObject({ ok: true, code: 'meeting_queue_item_added' });
  });

  it('refuses to drop a topic that people already have in their diaries', async () => {
    const { itemId, manager } = await queuedRequest();

    await manager.rpc('schedule_meeting_queue_item', {
      p_item_id: itemId,
      p_starts_at: '2026-08-12T02:00:00.000Z',
      p_duration_minutes: 30,
      p_participant_ids: null,
      p_idempotency_key: crypto.randomUUID(),
    });

    const refused = (
      await manager.rpc('remove_meeting_queue_item', {
        p_item_id: itemId,
        p_idempotency_key: crypto.randomUUID(),
      })
    ).data as Rpc;

    expect(refused).toMatchObject({ ok: false, code: 'invalid_state' });
    expect(refused.message).toContain('Cancel the discussion first');
  });
});
