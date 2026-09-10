import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, describe, expect, it } from 'vitest';

import { createTask, PEOPLE, serviceClient, signInAs } from './setup';

/**
 * v155 — Trackable Steps, stage 2: waiting on others.
 *
 * "Your own task is not overdue yet, but the system tells you: your task is
 * becoming at risk because somebody's contribution is late." That needs two
 * reads — counts on the work, for the Active card, and the late steps
 * themselves, for My Day — and both must describe the same step records the
 * assignee sees in Shared.
 */

const ZONE = 'Asia/Kuala_Lumpur';
const createdTasks: string[] = [];

function endOfDay(days: number): string {
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: ZONE }).format(
    new Date(Date.now() + days * 86_400_000),
  );
  return new Date(`${date}T23:59:59.999+08:00`).toISOString();
}

/** Deleted where possible; binned where history forbids it (see v153). */
async function removeTask(taskId: string) {
  const admin = serviceClient();
  const { error } = await admin.from('tasks').delete().eq('id', taskId);
  if (!error) return;
  const { error: binError } = await admin
    .from('tasks')
    .update({ deleted_at: new Date().toISOString(), deleted_by: PEOPLE.izzah.id })
    .eq('id', taskId);
  if (binError) throw new Error(`Could not remove fixture ${taskId}: ${binError.message}`);
}

afterEach(async () => {
  while (createdTasks.length) await removeTask(createdTasks.pop()!);
});

/**
 * Izzah's work, due in ten days, with a step of her own, a step Amer owes
 * that is already a day late, one Amer owes in three days, and one that simply
 * follows the task.
 */
async function planning(izzah: SupabaseClient) {
  const task = await createTask('izzah', {
    status: 'active',
    due_at: endOfDay(10),
    due_is_date_only: true,
  });
  createdTasks.push(task.id);

  const { data, error } = await izzah
    .from('task_checklist_items')
    .insert([
      { task_id: task.id, position: 1, action: 'Prepare structure', assigned_to: PEOPLE.izzah.id },
      {
        task_id: task.id,
        position: 2,
        action: 'Give department input',
        assigned_to: PEOPLE.amer.id,
        due_at: endOfDay(-1),
      },
      {
        task_id: task.id,
        position: 3,
        action: 'Review final proposal',
        assigned_to: PEOPLE.amer.id,
        due_at: endOfDay(3),
      },
      { task_id: task.id, position: 4, action: 'Sign off', assigned_to: PEOPLE.amer.id },
    ])
    .select('id,action');
  if (error) throw new Error(`Could not add the steps: ${error.message}`);
  return { task, steps: data! };
}

describe('v155 — the work knows whose steps are with others', () => {
  it('counts what is delegated, what is late, and when the next is due', async () => {
    const izzah = await signInAs('izzah');
    const { task } = await planning(izzah);

    const { data, error } = await izzah
      .from('task_overview')
      .select(
        'is_overdue,checklist_total,delegated_open_count,delegated_overdue_count,next_delegated_due_at',
      )
      .eq('id', task.id)
      .single();
    if (error) throw new Error(`Could not read the work: ${error.message}`);

    // Her own step is not delegation; the other three are.
    expect(data!.checklist_total).toBe(4);
    expect(data!.delegated_open_count).toBe(3);
    // One is late — and the work is not, which is the whole point.
    expect(data!.delegated_overdue_count).toBe(1);
    expect(data!.is_overdue).toBe(false);
    // The earliest date among them is the late one.
    expect(new Date(String(data!.next_delegated_due_at)).getTime()).toBe(
      new Date(endOfDay(-1)).getTime(),
    );
  });

  it('stops counting a step once Amer has done it', async () => {
    const izzah = await signInAs('izzah');
    const { task, steps } = await planning(izzah);
    const late = steps.find((step) => step.action === 'Give department input')!;

    const amer = await signInAs('amer');
    const { data: done } = await amer.rpc('complete_checklist_item', {
      p_item_id: late.id,
      p_completion_note: null,
      p_idempotency_key: null,
    });
    expect((done as { ok: boolean }).ok).toBe(true);

    const { data } = await izzah
      .from('task_overview')
      .select('delegated_open_count,delegated_overdue_count')
      .eq('id', task.id)
      .single();
    expect(data!.delegated_open_count).toBe(2);
    expect(data!.delegated_overdue_count).toBe(0);
  });
});

describe('v155 — one step record, seen from both sides', () => {
  it('shows the owner who owes the late step, and the assignee the same row', async () => {
    const izzah = await signInAs('izzah');
    const { task, steps } = await planning(izzah);
    const late = steps.find((step) => step.action === 'Give department input')!;

    // The owner's view: whose it is, by name.
    const { data: owned, error } = await izzah
      .from('shared_contributions')
      .select('checklist_item_id,assignee_name,item_due_at,parent_title')
      .eq('checklist_item_id', late.id)
      .single();
    if (error) throw new Error(`The owner could not see her own delegated step: ${error.message}`);
    expect(owned!.assignee_name).toBe('Amer Hakim');

    // The assignee's view: the very same record, in his Shared list.
    const amer = await signInAs('amer');
    const { data: shared } = await amer
      .from('shared_contributions')
      .select('checklist_item_id,task_id')
      .eq('checklist_item_id', late.id)
      .single();
    expect(shared!.task_id).toBe(task.id);

    // And somebody with no part in the work sees neither side.
    const lim = await signInAs('lim');
    const { data: outsider } = await lim
      .from('shared_contributions')
      .select('checklist_item_id')
      .eq('checklist_item_id', late.id);
    expect(outsider ?? []).toHaveLength(0);
  });
});
