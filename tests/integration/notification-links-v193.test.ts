import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, describe, expect, it } from 'vitest';

import { notificationHref } from '@/domain/notification-link';

import { createTask, PEOPLE, serviceClient, signInAs, type PersonKey } from './setup';

/**
 * v193 — Every notice links to the right place.
 *
 * Found by reconciling Production's notifications on 17 September 2026. Every
 * event had told the right people, but:
 *
 * - three step triggers linked their notice with an update matching every
 *   unread, unlinked notice the person had on that work, so an unread
 *   "Decision needed" or "Work reassigned" was re-pointed at a step;
 * - notices telling somebody that work or a step had left them linked to the
 *   work they could no longer open;
 * - barrier notices on work had no link to the barrier.
 */

type Rpc = { ok: boolean; code: string; message?: string; barrier_id?: string };

const ZONE = 'Asia/Kuala_Lumpur';
const MARK = 'NL fixture';
const createdTasks: string[] = [];
const clients = new Map<PersonKey, SupabaseClient>();

async function as(person: PersonKey) {
  const held = clients.get(person);
  if (held) return held;
  const client = await signInAs(person);
  clients.set(person, client);
  return client;
}

function endOfDay(days: number) {
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: ZONE }).format(
    new Date(Date.now() + days * 86_400_000),
  );
  return new Date(`${date}T23:59:59.999+08:00`).toISOString();
}

afterEach(async () => {
  const admin = serviceClient();
  while (createdTasks.length) {
    const id = createdTasks.pop()!;
    await admin.from('notifications').delete().eq('task_id', id);
    await admin.from('barriers').delete().eq('task_id', id);
    const { error } = await admin.from('tasks').delete().eq('id', id);
    if (error) {
      await admin
        .from('tasks')
        .update({ deleted_at: new Date().toISOString(), deleted_by: PEOPLE.admin.id })
        .eq('id', id);
    }
    await admin.from('notifications').delete().eq('task_id', id);
  }
});

async function work(owner: PersonKey, overrides: Record<string, unknown> = {}) {
  const task = await createTask(owner, {
    status: 'active',
    title: `${MARK} ${crypto.randomUUID().slice(0, 6)}`,
    due_at: endOfDay(10),
    due_is_date_only: true,
    ...overrides,
  });
  createdTasks.push(task.id);
  return task;
}

async function rpc(person: PersonKey, name: string, args: Record<string, unknown>) {
  const { data, error } = await (await as(person)).rpc(name, args);
  if (error) throw new Error(`${name}: ${error.message}`);
  const result = data as Rpc;
  expect(result.ok, `${name}: ${result.message}`).toBe(true);
  return result;
}

async function addStep(
  person: PersonKey,
  taskId: string,
  assignee: PersonKey,
  position: number,
  extra: Record<string, unknown> = {},
) {
  const { data, error } = await (
    await as(person)
  )
    .from('task_checklist_items')
    .insert({
      task_id: taskId,
      position,
      action: `${MARK} step ${position}`,
      assigned_to: PEOPLE[assignee].id,
      evidence_rule: 'not_required',
      ...extra,
    })
    .select('id')
    .single();
  if (error) throw new Error(`Could not add the step: ${error.message}`);
  return String(data!.id);
}

async function notice(recipient: PersonKey, taskId: string, title: string) {
  const { data, error } = await serviceClient()
    .from('notifications')
    .select('id,title,task_id,goal_id,entity_type,entity_id,barrier_id,read_at')
    .eq('recipient_id', PEOPLE[recipient].id)
    .eq('task_id', taskId)
    .eq('title', title);
  if (error) throw new Error(error.message);
  expect(data, `${recipient}: ${title}`).toHaveLength(1);
  return data![0]!;
}

async function version(taskId: string) {
  const { data } = await serviceClient().from('tasks').select('version').eq('id', taskId).single();
  return Number(data!.version);
}

async function raiseFor(raiser: PersonKey, taskId: string, from: PersonKey) {
  return rpc(raiser, 'raise_barrier', {
    p_task_id: taskId,
    p_description: `${MARK} Permit office closed`,
    p_support_needed: 'Approve a delay',
    p_impact: 'management_decision_required',
    p_action_type: 'decision',
    p_action_required_from: PEOPLE[from].id,
    p_add_to_meeting_queue: false,
    p_idempotency_key: crypto.randomUUID(),
  });
}

describe('v193 — a barrier notice opens the barrier', () => {
  it('links the person asked, and the owner, to the barrier', async () => {
    const task = await work('izzah');
    await addStep('izzah', task.id, 'ajmal', 1);
    const raised = await raiseFor('ajmal', task.id, 'izzul');
    const { data: barrier } = await serviceClient()
      .from('barriers')
      .select('id')
      .eq('task_id', task.id)
      .single();
    const barrierId = String(raised.barrier_id ?? barrier!.id);

    for (const [who, title] of [
      ['izzul', 'Decision needed'],
      ['izzah', 'Barrier raised on your work'],
    ] as const) {
      const row = await notice(who, task.id, title);
      expect(row).toMatchObject({ entity_type: 'barrier', entity_id: barrierId });
      expect(notificationHref(row)).toBe(
        `/work?task=${task.id}&attention=barrier&barrier=${barrierId}`,
      );
    }
  });

  it('is not re-pointed at a step handed to the same person while it is unread', async () => {
    const task = await work('izzah');
    await addStep('izzah', task.id, 'ajmal', 1);
    await raiseFor('ajmal', task.id, 'izzul');
    const before = await notice('izzul', task.id, 'Decision needed');

    // Izzah hands Izzul a step on the same work, with his decision still unread.
    const stepId = await addStep('izzah', task.id, 'izzul', 2);

    const after = await notice('izzul', task.id, 'Decision needed');
    expect(after.entity_type).toBe('barrier');
    expect(after.entity_id).toBe(before.entity_id);
    const assigned = await notice('izzul', task.id, 'New contribution assigned');
    expect(assigned).toMatchObject({ entity_type: 'checklist_item', entity_id: stepId });
  });
});

describe('v193 — work that has left somebody links to their own list', () => {
  it('sends the previous owner to My Work, and does not re-point it later', async () => {
    const task = await work('lim', { assigned_by: PEOPLE.izzul.id, origin: 'manager_assigned' });
    await rpc('izzul', 'reassign_task', {
      p_task_id: task.id,
      p_expected_version: await version(task.id),
      p_new_owner_id: PEOPLE.ajmal.id,
      p_idempotency_key: crypto.randomUUID(),
    });
    const reassigned = await notice('lim', task.id, 'Work reassigned');
    expect(reassigned).toMatchObject({ entity_type: 'released_task', entity_id: task.id });
    expect(notificationHref(reassigned)).toBe('/work');

    // The new owner hands Lim a step on it; the old notice keeps its link.
    const stepId = await addStep('ajmal', task.id, 'lim', 1);
    expect((await notice('lim', task.id, 'Work reassigned')).entity_type).toBe('released_task');
    expect(await notice('lim', task.id, 'New contribution assigned')).toMatchObject({
      entity_type: 'checklist_item',
      entity_id: stepId,
    });
  });

  it('sends a step’s previous holder to Shared when it is handed on, withdrawn or removed', async () => {
    const task = await work('izzah');
    const handed = await addStep('izzah', task.id, 'lim', 1, { due_at: endOfDay(4) });
    const update = (item: string, assignee: PersonKey) =>
      rpc('izzah', 'update_checklist_step', {
        p_item_id: item,
        p_action: `${MARK} step`,
        p_assigned_to: PEOPLE[assignee].id,
        p_evidence_rule: 'not_required',
        p_due_at: endOfDay(4),
        p_depends_on_item_id: null,
      });

    await update(handed, 'ajmal');
    const reassigned = await notice('lim', task.id, 'Contribution reassigned');
    expect(reassigned).toMatchObject({ entity_type: 'released_contribution', entity_id: handed });
    expect(notificationHref(reassigned)).toBe('/work?tab=shared');
    expect(await notice('ajmal', task.id, 'New contribution assigned')).toMatchObject({
      entity_type: 'checklist_item',
      entity_id: handed,
    });

    await update(handed, 'izzah');
    expect(await notice('ajmal', task.id, 'Contribution withdrawn')).toMatchObject({
      entity_type: 'released_contribution',
      entity_id: handed,
    });

    const removed = await addStep('izzah', task.id, 'amer', 2);
    await rpc('izzah', 'remove_checklist_step', {
      p_item_id: removed,
      p_idempotency_key: crypto.randomUUID(),
    });
    const gone = await notice('amer', task.id, 'Contribution removed');
    expect(gone.entity_type).toBe('released_contribution');
    expect(notificationHref(gone)).toBe('/work?tab=shared');
  });
});

describe('v193 — each step notice links to its own step', () => {
  it('links two steps that become ready together to their own steps', async () => {
    const task = await work('izzah', { status: 'backlog' });
    const first = await addStep('izzah', task.id, 'amer', 1);
    const second = await addStep('izzah', task.id, 'amer', 2);
    await rpc('izzah', 'activate_task', {
      p_task_id: task.id,
      p_expected_version: await version(task.id),
      p_idempotency_key: crypto.randomUUID(),
    });
    const { data } = await serviceClient()
      .from('notifications')
      .select('title,entity_type,entity_id')
      .eq('recipient_id', PEOPLE.amer.id)
      .eq('task_id', task.id)
      .order('created_at', { ascending: true });
    const assigned = (data ?? []).filter((row) => row.title === 'New contribution assigned');
    const ready = (data ?? []).filter((row) => row.title === 'Your contribution is ready');
    expect(assigned.map((row) => row.entity_id).sort()).toEqual([first, second].sort());
    expect(ready.map((row) => row.entity_id).sort()).toEqual([first, second].sort());
    expect((data ?? []).every((row) => row.entity_type === 'checklist_item')).toBe(true);
  });
});
