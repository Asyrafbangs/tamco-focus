import { afterEach, describe, expect, it } from 'vitest';

import { createTask, PEOPLE, serviceClient, signInAs, type PersonKey } from './setup';

/**
 * v157 — Trackable Steps, stage 4: My Team sees the steps people owe.
 *
 * My Team reads `shared_contributions` as the manager, filtered to the people
 * on the roster. These pin down what that read holds: a report's step on work
 * the manager can see, with the date the row shows and whose work it is for;
 * nothing on work outside the manager's visibility, the rule the Completed
 * split has followed since v87; nothing on work in the Bin, for anybody; and
 * nothing once the step is done.
 */

const ZONE = 'Asia/Kuala_Lumpur';
const createdTasks: Array<{ id: string; owner: PersonKey }> = [];

function endOfDay(days: number): string {
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: ZONE }).format(
    new Date(Date.now() + days * 86_400_000),
  );
  return new Date(`${date}T23:59:59.999+08:00`).toISOString();
}

/** Deleted where possible; binned where history forbids it (see v153). */
async function removeTask(taskId: string, owner: PersonKey) {
  const admin = serviceClient();
  const { error } = await admin.from('tasks').delete().eq('id', taskId);
  if (!error) return;
  const { error: binError } = await admin
    .from('tasks')
    .update({ deleted_at: new Date().toISOString(), deleted_by: PEOPLE[owner].id })
    .eq('id', taskId);
  if (binError) throw new Error(`Could not remove fixture ${taskId}: ${binError.message}`);
}

afterEach(async () => {
  while (createdTasks.length) {
    const task = createdTasks.pop()!;
    await removeTask(task.id, task.owner);
  }
});

/** Work owned by `owner`, due in ten days, with steps Amer owes on it. */
async function workWithAmersSteps(
  owner: PersonKey,
  steps: Array<{ action: string; due: number | null }>,
) {
  const task = await createTask(owner, {
    status: 'active',
    due_at: endOfDay(10),
    due_is_date_only: true,
  });
  createdTasks.push({ id: task.id, owner });

  const { data, error } = await serviceClient()
    .from('task_checklist_items')
    .insert(
      steps.map((step, index) => ({
        task_id: task.id,
        position: index + 1,
        action: step.action,
        assigned_to: PEOPLE.amer.id,
        evidence_rule: 'not_required',
        due_at: step.due === null ? null : endOfDay(step.due),
      })),
    )
    .select('id,action');
  if (error) throw new Error(`Could not add the steps: ${error.message}`);
  return { task, steps: data! };
}

describe('v157 — the steps a report owes, as their manager reads them', () => {
  it('holds a report’s step on work the manager can see, dated and attributed', async () => {
    const { task } = await workWithAmersSteps('izzah', [
      { action: 'Collect incident data', due: -1 },
      { action: 'Draft the summary', due: null },
    ]);

    const izzul = await signInAs('izzul');
    const { data, error } = await izzul
      .from('shared_contributions')
      .select('title,assignee_id,primary_owner_name,parent_title,item_due_at,parent_due_at')
      .in('assignee_id', [PEOPLE.amer.id])
      .eq('task_id', task.id)
      .order('position', { ascending: true });
    if (error) throw new Error(`The manager could not read the contributions: ${error.message}`);

    expect(data).toHaveLength(2);
    const late = data![0]!;
    const inherited = data![1]!;
    // Whose work it is for, which is what "For Izzah Nurul" on the row says.
    expect(late.primary_owner_name).toBe('Izzah Nurul');
    // Its own date, a day gone.
    expect(new Date(String(late.item_due_at)).getTime()).toBe(new Date(endOfDay(-1)).getTime());
    // No date of its own: it is due when its work is.
    expect(inherited.item_due_at).toBeNull();
    expect(new Date(String(inherited.parent_due_at)).getTime()).toBe(
      new Date(endOfDay(10)).getTime(),
    );
  });

  it('holds nothing on work outside the manager’s visibility', async () => {
    const { steps } = await workWithAmersSteps('admin', [
      { action: 'Check the licence register', due: null },
    ]);
    const step = steps[0]!;

    // Amer sees it: it is on his own Shared list.
    const amer = await signInAs('amer');
    const { data: his } = await amer
      .from('shared_contributions')
      .select('checklist_item_id')
      .eq('checklist_item_id', step.id);
    expect(his ?? []).toHaveLength(1);

    // His manager does not, because the work belongs to somebody outside
    // their reporting tree — so My Team neither lists it nor counts it.
    const izzul = await signInAs('izzul');
    const { data: theirs } = await izzul
      .from('shared_contributions')
      .select('checklist_item_id')
      .eq('checklist_item_id', step.id);
    expect(theirs ?? []).toHaveLength(0);
  });

  it('holds nothing on work in the Bin, for anybody', async () => {
    const { task, steps } = await workWithAmersSteps('izzah', [
      { action: 'Collect incident data', due: -1 },
    ]);
    const step = steps[0]!;
    const { error } = await serviceClient()
      .from('tasks')
      .update({ deleted_at: new Date().toISOString(), deleted_by: PEOPLE.izzah.id })
      .eq('id', task.id);
    if (error) throw new Error(`Could not bin the work: ${error.message}`);

    // Not on Amer's Shared list, not on Izzah's Waiting on others, not on My Team.
    for (const person of ['amer', 'izzah', 'izzul'] as const) {
      const client = await signInAs(person);
      const { data } = await client
        .from('shared_contributions')
        .select('checklist_item_id')
        .eq('checklist_item_id', step.id);
      expect(data ?? [], `${person} still sees a step on binned work`).toHaveLength(0);
    }
  });

  it('drops a step once Amer has done it', async () => {
    const { task, steps } = await workWithAmersSteps('izzah', [
      { action: 'Collect incident data', due: -1 },
      { action: 'Draft the summary', due: null },
    ]);
    const late = steps.find((step) => step.action === 'Collect incident data')!;

    const amer = await signInAs('amer');
    const { data: done } = await amer.rpc('complete_checklist_item', {
      p_item_id: late.id,
      p_completion_note: null,
      p_idempotency_key: null,
    });
    expect((done as { ok: boolean }).ok).toBe(true);

    const izzul = await signInAs('izzul');
    const { data } = await izzul
      .from('shared_contributions')
      .select('title')
      .eq('task_id', task.id);
    expect((data ?? []).map((row) => row.title)).toEqual(['Draft the summary']);
  });
});
