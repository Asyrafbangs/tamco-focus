import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, describe, expect, it } from 'vitest';

import { createTask, PEOPLE, serviceClient, signInAs, type PersonKey } from './setup';

/**
 * v161 — who is told when a step is the owner's.
 *
 * A step a manager adds to Izzah's work for Izzah, or hands back to her, is
 * "assigned" as surely as one handed to Amer, and she is told. Amer is told
 * when his step leaves his Shared list, wherever it goes. Nobody is told about
 * their own act, and a step added while the assignment of the work itself is
 * still unread is left to that notice.
 */

const ZONE = 'Asia/Kuala_Lumpur';
const createdTasks: string[] = [];

function endOfDay(days: number): string {
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: ZONE }).format(
    new Date(Date.now() + days * 86_400_000),
  );
  return new Date(`${date}T23:59:59.999+08:00`).toISOString();
}

/** How a message writes a date: "10 Sep". */
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
  const { error: binError } = await admin
    .from('tasks')
    .update({ deleted_at: new Date().toISOString(), deleted_by: PEOPLE.izzah.id })
    .eq('id', taskId);
  if (binError) throw new Error(`Could not remove fixture ${taskId}: ${binError.message}`);
}

afterEach(async () => {
  while (createdTasks.length) await removeTask(createdTasks.pop()!);
});

async function izzahsWork() {
  const task = await createTask('izzah', {
    status: 'active',
    due_at: endOfDay(10),
    due_is_date_only: true,
  });
  createdTasks.push(task.id);
  return task.id;
}

async function addStep(
  client: SupabaseClient,
  taskId: string,
  step: { action: string; assignee: PersonKey; due?: number },
) {
  const { data, error } = await client
    .from('task_checklist_items')
    .insert({
      task_id: taskId,
      position: 1,
      action: step.action,
      assigned_to: PEOPLE[step.assignee].id,
      evidence_rule: 'not_required',
      due_at: step.due === undefined ? null : endOfDay(step.due),
    })
    .select('id')
    .single();
  if (error) throw new Error(`Could not add the step: ${error.message}`);
  return String(data!.id);
}

async function reassign(client: SupabaseClient, stepId: string, action: string, to: string | null) {
  const { data, error } = await client.rpc('update_checklist_step', {
    p_item_id: stepId,
    p_action: action,
    p_assigned_to: to,
    p_evidence_rule: 'not_required',
    p_due_at: null,
    p_depends_on_item_id: null,
  });
  if (error) throw new Error(`Could not reassign the step: ${error.message}`);
  expect((data as { ok: boolean }).ok).toBe(true);
}

async function notices(recipient: PersonKey, taskId: string, title: string) {
  const { data, error } = await serviceClient()
    .from('notifications')
    .select('id,body,requires_action,entity_type,entity_id')
    .eq('recipient_id', PEOPLE[recipient].id)
    .eq('task_id', taskId)
    .eq('title', title);
  if (error) throw new Error(`Could not read notifications: ${error.message}`);
  return data ?? [];
}

describe('v161 — a step on your own work, put there by somebody else', () => {
  it('tells Izzah when her manager adds a step for her, and opens her work at it', async () => {
    const taskId = await izzahsWork();
    const izzul = await signInAs('izzul');
    const stepId = await addStep(izzul, taskId, {
      action: 'Review the permit',
      assignee: 'izzah',
      due: 3,
    });

    const told = await notices('izzah', taskId, 'New step on your work');
    expect(told).toHaveLength(1);
    const notice = told[0]!;
    expect(notice.entity_type).toBe('task_step');
    expect(notice.entity_id).toBe(stepId);
    expect(notice.requires_action).toBe(true);
    expect(notice.body).toContain(`Due ${shortLabel(3)}.`);
    expect(notice.body).toContain('Added by Izzul Asyraf.');
  });

  it('tells nobody about a step Izzah gives herself', async () => {
    const taskId = await izzahsWork();
    const izzah = await signInAs('izzah');
    await addStep(izzah, taskId, { action: 'Prepare structure', assignee: 'izzah', due: 3 });

    expect(await notices('izzah', taskId, 'New step on your work')).toHaveLength(0);
  });

  it('leaves it to the assignment of the work while that is still unread', async () => {
    const taskId = await izzahsWork();
    const { error } = await serviceClient().from('notifications').insert({
      recipient_id: PEOPLE.izzah.id,
      kind: 'ordinary_assignment',
      channel: 'immediate',
      requires_action: true,
      title: 'New work assigned to you',
      body: 'Izzul Asyraf assigned this work to you.',
      task_id: taskId,
      actor_id: PEOPLE.izzul.id,
    });
    if (error) throw new Error(`Could not stand in for the assignment: ${error.message}`);

    const izzul = await signInAs('izzul');
    await addStep(izzul, taskId, { action: 'Review the permit', assignee: 'izzah' });

    expect(await notices('izzah', taskId, 'New step on your work')).toHaveLength(0);
  });
});

describe('v161 — a step moved off a contributor', () => {
  it('tells Izzah when her manager hands Amer’s step to her, and Amer that it left him', async () => {
    const taskId = await izzahsWork();
    const izzah = await signInAs('izzah');
    const stepId = await addStep(izzah, taskId, { action: 'Collect data', assignee: 'amer' });

    const izzul = await signInAs('izzul');
    await reassign(izzul, stepId, 'Collect data', PEOPLE.izzah.id);

    const hers = await notices('izzah', taskId, 'New step on your work');
    expect(hers).toHaveLength(1);
    expect(hers[0]!.body).toContain('Assigned to you by Izzul Asyraf.');
    expect(await notices('amer', taskId, 'Contribution withdrawn')).toHaveLength(1);
  });

  it('tells Amer when Izzah takes his step back, and tells Izzah nothing', async () => {
    const taskId = await izzahsWork();
    const izzah = await signInAs('izzah');
    const stepId = await addStep(izzah, taskId, { action: 'Collect data', assignee: 'amer' });

    await reassign(izzah, stepId, 'Collect data', PEOPLE.izzah.id);

    expect(await notices('amer', taskId, 'Contribution withdrawn')).toHaveLength(1);
    expect(await notices('izzah', taskId, 'New step on your work')).toHaveLength(0);
  });

  it('tells Amer when his step is left to nobody', async () => {
    const taskId = await izzahsWork();
    const izzah = await signInAs('izzah');
    const stepId = await addStep(izzah, taskId, { action: 'Collect data', assignee: 'amer' });

    /*
     * Not through update_checklist_step, which insists somebody is
     * responsible. The table itself allows it to anybody who may edit the
     * work, and the trigger answers for every route into the table.
     */
    const { error } = await izzah
      .from('task_checklist_items')
      .update({ assigned_to: null })
      .eq('id', stepId);
    if (error) throw new Error(`Could not leave the step to nobody: ${error.message}`);

    const withdrawn = await notices('amer', taskId, 'Contribution withdrawn');
    expect(withdrawn).toHaveLength(1);
    expect(withdrawn[0]!.body).toBe(
      '"Collect data" is no longer yours to do. It has left your Shared list.',
    );
  });

  it('still says "reassigned" when his step goes to somebody else', async () => {
    const taskId = await izzahsWork();
    const izzah = await signInAs('izzah');
    const stepId = await addStep(izzah, taskId, { action: 'Collect data', assignee: 'amer' });

    await reassign(izzah, stepId, 'Collect data', PEOPLE.lim.id);

    expect(await notices('amer', taskId, 'Contribution reassigned')).toHaveLength(1);
    expect(await notices('amer', taskId, 'Contribution withdrawn')).toHaveLength(0);
    expect(await notices('lim', taskId, 'New contribution assigned')).toHaveLength(1);
  });
});
