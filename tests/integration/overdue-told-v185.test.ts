import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, describe, expect, it } from 'vitest';

import { createTask, PEOPLE, serviceClient, signInAs, type PersonKey } from './setup';

/**
 * v185 — Overdue, told.
 *
 * The owner of late work is told once per due date, the morning after it
 * passed, and several pieces of late work are one notice. Pushing a due date
 * later tells the owner's manager and whoever assigned it; somebody else
 * moving an owner's date tells the owner. "Due-today and selection deadlines"
 * in My Alerts switches all of it off, including the step notice.
 */

const ZONE = 'Asia/Kuala_Lumpur';
type Rpc = { ok: boolean; code: string; message?: string };

const createdTasks: string[] = [];
const clients = new Map<PersonKey, SupabaseClient>();

async function as(person: PersonKey) {
  const held = clients.get(person);
  if (held) return held;
  const client = await signInAs(person);
  clients.set(person, client);
  return client;
}

function endOfDay(days: number): string {
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: ZONE }).format(
    new Date(Date.now() + days * 86_400_000),
  );
  return new Date(`${date}T23:59:59.999+08:00`).toISOString();
}

/** How the database writes a date: "13 Sep". */
function shortLabel(days: number): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: ZONE,
    day: 'numeric',
    month: 'short',
  }).formatToParts(new Date(Date.now() + days * 86_400_000));
  const read = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${read('day')} ${read('month')}`;
}

/** Deleted where possible; binned where history forbids it (see v153). */
async function removeTask(taskId: string) {
  const admin = serviceClient();
  const { error } = await admin.from('tasks').delete().eq('id', taskId);
  if (!error) return;
  await admin
    .from('tasks')
    .update({ deleted_at: new Date().toISOString(), deleted_by: PEOPLE.admin.id })
    .eq('id', taskId);
  await admin.from('notifications').delete().eq('task_id', taskId);
}

afterEach(async () => {
  const admin = serviceClient();
  while (createdTasks.length) await removeTask(createdTasks.pop()!);
  // Grouped notices carry no task; these tests' are recognisable by title.
  await admin.from('notifications').delete().like('body', '%OT fixture%');
  await admin
    .from('user_alert_preferences')
    .update({ due_today_and_deadlines: true })
    .in('user_id', [PEOPLE.amer.id, PEOPLE.izzul.id, PEOPLE.izzah.id]);
});

async function work(person: PersonKey, days: number, overrides: Record<string, unknown> = {}) {
  const task = await createTask(person, {
    status: 'active',
    title: `OT fixture ${crypto.randomUUID().slice(0, 6)}`,
    due_at: endOfDay(days),
    due_is_date_only: true,
    ...overrides,
  });
  createdTasks.push(task.id);
  const { data } = await serviceClient().from('tasks').select('title').eq('id', task.id).single();
  return { ...task, title: String(data!.title) };
}

async function runOverdue(...ids: string[]) {
  const { data, error } = await serviceClient().rpc('notify_overdue_work', { p_task_ids: ids });
  if (error) throw new Error(`notify_overdue_work failed: ${error.message}`);
  return data as { ok: boolean; notified: number; work: number };
}

async function bell(recipient: PersonKey, kind: string) {
  const { data, error } = await serviceClient()
    .from('notifications')
    .select('id,title,body,requires_action,channel,quiet,task_id,entity_type,entity_id,read_at')
    .eq('recipient_id', PEOPLE[recipient].id)
    .eq('kind', kind)
    .like('body', '%OT fixture%')
    .order('created_at', { ascending: true });
  if (error) throw new Error(`Could not read notifications: ${error.message}`);
  return data ?? [];
}

async function moveDue(
  person: PersonKey,
  taskId: string,
  version: number,
  days: number,
  reason?: string,
) {
  const { data, error } = await (
    await as(person)
  ).rpc('change_task_due_date', {
    p_task_id: taskId,
    p_expected_version: version,
    p_new_due_at: endOfDay(days),
    p_due_is_date_only: true,
    p_reason: reason ?? null,
    p_idempotency_key: crypto.randomUUID(),
  });
  if (error) throw new Error(`change_task_due_date failed: ${error.message}`);
  return data as Rpc & { version: number };
}

async function alertsOff(person: PersonKey) {
  await serviceClient()
    .from('user_alert_preferences')
    .update({ due_today_and_deadlines: false })
    .eq('user_id', PEOPLE[person].id);
}

describe('v185 — the owner is told their work is overdue', () => {
  it('once, by email, naming the work and its date', async () => {
    const task = await work('amer', -2);
    expect(await runOverdue(task.id)).toMatchObject({ ok: true, notified: 1, work: 1 });

    const [notice] = await bell('amer', 'work_overdue');
    expect(notice).toMatchObject({
      title: 'Work overdue',
      body: `${task.title} · It was due ${shortLabel(-2)}.`,
      requires_action: true,
      channel: 'immediate',
      quiet: false,
      task_id: task.id,
      entity_type: 'task',
      entity_id: task.id,
    });
    const { data: deliveries } = await serviceClient()
      .from('notification_email_deliveries')
      .select('recipient_email')
      .eq('notification_id', notice!.id);
    expect(deliveries).toEqual([expect.objectContaining({ recipient_email: 'amer@tamco.local' })]);

    // The next morning says nothing new.
    expect(await runOverdue(task.id)).toMatchObject({ notified: 0, work: 0 });
    expect(await bell('amer', 'work_overdue')).toHaveLength(1);
  });

  it('puts several pieces of late work in one notice', async () => {
    const tasks = [
      await work('amer', -4),
      await work('amer', -3, { status: 'paused', paused_reason: 'Waiting for parts' }),
      await work('amer', -2, { status: 'backlog' }),
      await work('amer', -1),
    ];
    expect(await runOverdue(...tasks.map((task) => task.id))).toMatchObject({
      notified: 1,
      work: 4,
    });

    const notices = await bell('amer', 'work_overdue');
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({
      title: '4 pieces of work overdue',
      task_id: null,
      entity_type: null,
    });
    expect(notices[0]!.body).toBe(
      `"${tasks[0]!.title}" was due ${shortLabel(-4)}; "${tasks[1]!.title}" was due ${shortLabel(-3)}; "${tasks[2]!.title}" was due ${shortLabel(-2)}; and 1 more.`,
    );
    const { data: told } = await serviceClient()
      .from('task_overdue_notices')
      .select('task_id')
      .in(
        'task_id',
        tasks.map((task) => task.id),
      );
    expect(told).toHaveLength(4);
  });

  it('leaves out work that is not late, closed or binned', async () => {
    const today = await work('amer', 0);
    const future = await work('amer', 3);
    const done = await work('amer', -2, {
      status: 'completed',
      completed_at: new Date().toISOString(),
    });
    const cancelled = await work('amer', -2, {
      status: 'cancelled',
      cancelled_at: new Date().toISOString(),
    });
    const binned = await work('amer', -2, {
      deleted_at: new Date().toISOString(),
      deleted_by: PEOPLE.amer.id,
    });
    expect(await runOverdue(today.id, future.id, done.id, cancelled.id, binned.id)).toMatchObject({
      notified: 0,
      work: 0,
    });
  });

  it('tells again when a new due date passes too', async () => {
    const task = await work('amer', -2);
    await runOverdue(task.id);
    const moved = await moveDue('amer', task.id, task.version, 3);
    expect(moved.ok).toBe(true);
    // Time passes: the new date is now behind us as well.
    await serviceClient()
      .from('tasks')
      .update({ due_at: endOfDay(-1) })
      .eq('id', task.id);
    expect(await runOverdue(task.id)).toMatchObject({ notified: 1 });
    expect(await bell('amer', 'work_overdue')).toHaveLength(2);
  });

  it('respects the alert being off, and does not send the backlog when it is turned on', async () => {
    await alertsOff('amer');
    const task = await work('amer', -2);
    expect(await runOverdue(task.id)).toMatchObject({ notified: 0, work: 1 });
    expect(await bell('amer', 'work_overdue')).toHaveLength(0);

    await serviceClient()
      .from('user_alert_preferences')
      .update({ due_today_and_deadlines: true })
      .eq('user_id', PEOPLE.amer.id);
    expect(await runOverdue(task.id)).toMatchObject({ notified: 0, work: 0 });
  });

  it('clears the notice when the work is completed or its date moves ahead', async () => {
    const first = await work('amer', -2);
    const second = await work('amer', -2);
    await runOverdue(first.id);
    await runOverdue(second.id);

    await serviceClient()
      .from('tasks')
      .update({ status: 'completed', completed_at: new Date().toISOString() })
      .eq('id', first.id);
    expect((await moveDue('amer', second.id, second.version, 4)).ok).toBe(true);

    const notices = await bell('amer', 'work_overdue');
    expect(notices).toHaveLength(2);
    expect(notices.every((notice) => notice.read_at !== null)).toBe(true);
  });
});

describe('v185 — a moved due date is told to the people it affects', () => {
  it('pushed later by the owner: the manager and the assigner, with how late and why', async () => {
    const task = await work('amer', -2, { assigned_by: PEOPLE.izzah.id });
    const moved = await moveDue('amer', task.id, task.version, 5, 'Supplier delayed');
    expect(moved.ok).toBe(true);

    const expected = `Amer Hakim moved it from ${shortLabel(-2)} to ${shortLabel(5)}. It was 2 days overdue. Reason: "Supplier delayed".`;
    for (const person of ['izzul', 'izzah'] as const) {
      const notices = await serviceClient()
        .from('notifications')
        .select('id,title,body,requires_action,task_id,entity_type')
        .eq('recipient_id', PEOPLE[person].id)
        .eq('kind', 'due_date_changed')
        .eq('task_id', task.id);
      expect(notices.data).toHaveLength(1);
      expect(notices.data![0]).toMatchObject({
        title: `Due date moved: ${task.title}`,
        body: expected,
        requires_action: false,
        entity_type: 'task',
      });
      const { data: deliveries } = await serviceClient()
        .from('notification_email_deliveries')
        .select('recipient_email')
        .eq('notification_id', notices.data![0]!.id);
      expect(deliveries).toHaveLength(1);
    }

    const { count } = await serviceClient()
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('recipient_id', PEOPLE.amer.id)
      .eq('kind', 'due_date_changed')
      .eq('task_id', task.id);
    expect(count).toBe(0);
  });

  it('says nothing about lateness when the work was not yet due', async () => {
    const task = await work('amer', 2);
    await moveDue('amer', task.id, task.version, 6);
    const { data } = await serviceClient()
      .from('notifications')
      .select('body')
      .eq('recipient_id', PEOPLE.izzul.id)
      .eq('kind', 'due_date_changed')
      .eq('task_id', task.id);
    expect(data).toEqual([
      { body: `Amer Hakim moved it from ${shortLabel(2)} to ${shortLabel(6)}.` },
    ]);
  });

  it('brought earlier by the owner: nobody is told', async () => {
    const task = await work('amer', 6, { assigned_by: PEOPLE.izzah.id });
    expect((await moveDue('amer', task.id, task.version, 3)).ok).toBe(true);
    const { count } = await serviceClient()
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('kind', 'due_date_changed')
      .eq('task_id', task.id);
    expect(count).toBe(0);
  });

  it('moved by the manager, either way: the owner is told, and the manager is not', async () => {
    const task = await work('amer', 4);
    const earlier = await moveDue('izzul', task.id, task.version, 2, 'Client brought it forward');
    expect(earlier.ok).toBe(true);
    await moveDue('izzul', task.id, earlier.version, 7);

    const { data } = await serviceClient()
      .from('notifications')
      .select('recipient_id,title,body')
      .eq('kind', 'due_date_changed')
      .eq('task_id', task.id)
      .order('created_at', { ascending: true });
    expect(data).toEqual([
      {
        recipient_id: PEOPLE.amer.id,
        title: `Due date changed: ${task.title}`,
        body: `Izzul Asyraf changed it from ${shortLabel(4)} to ${shortLabel(2)}. Reason: "Client brought it forward".`,
      },
      {
        recipient_id: PEOPLE.amer.id,
        title: `Due date changed: ${task.title}`,
        body: `Izzul Asyraf changed it from ${shortLabel(2)} to ${shortLabel(7)}.`,
      },
    ]);
  });

  it('tells a manager who also assigned the work once', async () => {
    const task = await work('amer', 1, { assigned_by: PEOPLE.izzul.id });
    await moveDue('amer', task.id, task.version, 5);
    const { count } = await serviceClient()
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('recipient_id', PEOPLE.izzul.id)
      .eq('kind', 'due_date_changed')
      .eq('task_id', task.id);
    expect(count).toBe(1);
  });

  it('respects the manager’s alert being off', async () => {
    await alertsOff('izzul');
    const task = await work('amer', 1);
    await moveDue('amer', task.id, task.version, 5);
    const { count } = await serviceClient()
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('kind', 'due_date_changed')
      .eq('task_id', task.id);
    expect(count).toBe(0);
  });
});

describe('v185 — the step notice honours the alert too', () => {
  it('does not tell an assignee who has switched deadline alerts off', async () => {
    await alertsOff('izzah');
    const task = await work('amer', 5);
    await serviceClient()
      .from('task_checklist_items')
      .insert({
        task_id: task.id,
        position: 1,
        action: 'OT fixture step',
        assigned_to: PEOPLE.izzah.id,
        evidence_rule: 'not_required',
        due_at: endOfDay(-2),
      });
    const { data } = await serviceClient().rpc('notify_overdue_contributions', {
      p_task_ids: [task.id],
    });
    expect(data).toMatchObject({ ok: true, notified: 0 });
  });
});
