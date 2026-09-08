import { afterEach, describe, expect, it } from 'vitest';

import { createTask, deleteTask, PEOPLE, serviceClient, signInAs } from './setup';

/**
 * v140 §8 — "Working on" is a statement, not an inference.
 *
 * My Team has shown a "Current focus" since v132, derived from whichever Active
 * task had the most recent `last_meaningful_update_at`. That is a guess: opening
 * a task to read it, or an automated touch, could make something look like the
 * work somebody had chosen. It is now set by the person, and the rules that
 * keep it honest live in the database rather than in whichever screen offers
 * the button.
 */

type Rpc = Record<string, unknown> & { ok: boolean; code?: string };

const created: string[] = [];

async function fixture(person: keyof typeof PEOPLE, overrides: Record<string, unknown> = {}) {
  const task = await createTask(person, overrides);
  created.push(task.id);
  return task;
}

/** A step on `taskId`, assigned to somebody and still open. */
async function addStep(taskId: string, assignee: keyof typeof PEOPLE, action: string) {
  const { data, error } = await serviceClient()
    .from('task_checklist_items')
    .insert({
      task_id: taskId,
      position: 1,
      action,
      assigned_to: PEOPLE[assignee].id,
      state: 'ready',
    })
    .select('id')
    .single();
  if (error) throw new Error(`Could not add fixture step: ${error.message}`);
  return data.id as string;
}

/**
 * Move a fixture task, and fail loudly if the database refuses.
 *
 * An ignored error here is worse than a failing test: the row stays as it was,
 * the assertion that follows checks the wrong state, and the result reads as a
 * finding about the trigger under test. That is exactly what happened when this
 * file first set `status: 'cancelled'` without `cancelled_at`, which
 * `tasks_cancelled_at_consistent` rejects.
 */
async function moveTask(taskId: string, patch: Record<string, unknown>) {
  const { error } = await serviceClient().from('tasks').update(patch).eq('id', taskId);
  if (error) throw new Error(`Could not move fixture task: ${error.message}`);
}

async function focusOf(person: keyof typeof PEOPLE) {
  const { data } = await serviceClient()
    .from('current_focus')
    .select('task_id,checklist_item_id,selected_at,confirmed_at')
    .eq('user_id', PEOPLE[person].id)
    .maybeSingle();
  return data;
}

afterEach(async () => {
  // The selection is per person and the fixtures are shared, so a test that
  // left one behind would change the next test's starting state.
  await serviceClient()
    .from('current_focus')
    .delete()
    .in('user_id', [PEOPLE.amer.id, PEOPLE.izzah.id, PEOPLE.ajmal.id]);
  while (created.length) await deleteTask(created.pop()!);
});

describe('v140 setting the current focus', () => {
  it('records the work, and replaces rather than accumulates', async () => {
    const first = await fixture('amer', { status: 'active' });
    const second = await fixture('amer', { status: 'active' });
    const amer = await signInAs('amer');

    expect(((await amer.rpc('set_current_focus', { p_task_id: first.id })).data as Rpc).ok).toBe(
      true,
    );
    expect(((await amer.rpc('set_current_focus', { p_task_id: second.id })).data as Rpc).ok).toBe(
      true,
    );

    // One per person: choosing another is a replacement, not a second answer.
    const { count } = await serviceClient()
      .from('current_focus')
      .select('user_id', { count: 'exact', head: true })
      .eq('user_id', PEOPLE.amer.id);
    expect(count).toBe(1);
    expect((await focusOf('amer'))?.task_id).toBe(second.id);
  });

  it('refuses work nobody has started', async () => {
    /*
     * §8: an Available task is started first. Without this, "what I am working
     * on" would be answerable with something not yet begun, which is what the
     * Available list already says.
     */
    const waiting = await fixture('amer', { status: 'backlog' });
    const amer = await signInAs('amer');
    const result = (await amer.rpc('set_current_focus', { p_task_id: waiting.id })).data as Rpc;
    expect(result).toMatchObject({ ok: false, code: 'not_started' });
    expect(await focusOf('amer')).toBeNull();
  });

  it('refuses a step belonging to somebody else', async () => {
    const task = await fixture('amer', { status: 'active' });
    const step = await addStep(task.id, 'izzah', 'Deliver the briefing');
    const amer = await signInAs('amer');

    const result = (
      await amer.rpc('set_current_focus', { p_task_id: task.id, p_checklist_item_id: step })
    ).data as Rpc;
    expect(result).toMatchObject({ ok: false, code: 'step_not_yours' });
  });

  it('lets a contributor choose the step they were actually given', async () => {
    const task = await fixture('amer', { status: 'active' });
    const step = await addStep(task.id, 'izzah', 'Deliver the briefing');
    const izzah = await signInAs('izzah');

    const result = (
      await izzah.rpc('set_current_focus', { p_task_id: task.id, p_checklist_item_id: step })
    ).data as Rpc;
    expect(result.ok).toBe(true);
    expect((await focusOf('izzah'))?.checklist_item_id).toBe(step);
  });

  it('confirms without pretending the choice was made again', async () => {
    const task = await fixture('amer', { status: 'active' });
    const amer = await signInAs('amer');
    await amer.rpc('set_current_focus', { p_task_id: task.id });
    const before = await focusOf('amer');

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(((await amer.rpc('confirm_current_focus')).data as Rpc).ok).toBe(true);

    const after = await focusOf('amer');
    // The confirmation moves; the moment of the decision does not.
    expect(after!.selected_at).toBe(before!.selected_at);
    expect(new Date(after!.confirmed_at).getTime()).toBeGreaterThan(
      new Date(before!.confirmed_at).getTime(),
    );
  });

  it("is nobody else's to set", async () => {
    // §22: own selection only, and no silent impersonation of an employee's.
    const task = await fixture('izzah', { status: 'active' });
    const izzul = await signInAs('izzul');
    const { error } = await izzul
      .from('current_focus')
      .insert({ user_id: PEOPLE.izzah.id, task_id: task.id });
    expect(error).not.toBeNull();
    expect(await focusOf('izzah')).toBeNull();
  });
});

describe('v140 clearing the current focus', () => {
  it('clears when the chosen work is completed', async () => {
    const task = await fixture('amer', { status: 'active' });
    const amer = await signInAs('amer');
    await amer.rpc('set_current_focus', { p_task_id: task.id });

    await moveTask(task.id, { status: 'completed', completed_at: new Date().toISOString() });

    expect(await focusOf('amer')).toBeNull();
  });

  it('clears when the chosen work is cancelled or binned', async () => {
    const cancelled = await fixture('amer', { status: 'active' });
    const amer = await signInAs('amer');
    await amer.rpc('set_current_focus', { p_task_id: cancelled.id });
    // `tasks_cancelled_at_consistent`: the status and the timestamp travel
    // together, in both directions.
    await moveTask(cancelled.id, {
      status: 'cancelled',
      cancelled_at: new Date().toISOString(),
    });
    expect(await focusOf('amer')).toBeNull();

    const binned = await fixture('amer', { status: 'active' });
    await amer.rpc('set_current_focus', { p_task_id: binned.id });
    await moveTask(binned.id, { deleted_at: new Date().toISOString() });
    expect(await focusOf('amer')).toBeNull();
  });

  it('clears a chosen STEP without disturbing somebody on the parent', async () => {
    /*
     * The distinction §8 draws, and the reason the row carries the step id:
     * finishing one step of a task is not finishing the task. The contributor
     * who chose that step is done with it; the owner who chose the whole task
     * is not.
     */
    const task = await fixture('amer', { status: 'active' });
    const step = await addStep(task.id, 'izzah', 'Deliver the briefing');

    const izzah = await signInAs('izzah');
    await izzah.rpc('set_current_focus', { p_task_id: task.id, p_checklist_item_id: step });
    const amer = await signInAs('amer');
    await amer.rpc('set_current_focus', { p_task_id: task.id });

    await serviceClient()
      .from('task_checklist_items')
      .update({
        state: 'completed',
        completed_at: new Date().toISOString(),
        completed_by: PEOPLE.izzah.id,
      })
      .eq('id', step);

    expect(await focusOf('izzah')).toBeNull();
    expect((await focusOf('amer'))?.task_id).toBe(task.id);
  });

  it('clears when the step is handed to somebody else', async () => {
    const task = await fixture('amer', { status: 'active' });
    const step = await addStep(task.id, 'izzah', 'Deliver the briefing');
    const izzah = await signInAs('izzah');
    await izzah.rpc('set_current_focus', { p_task_id: task.id, p_checklist_item_id: step });

    await serviceClient()
      .from('task_checklist_items')
      .update({ assigned_to: PEOPLE.ajmal.id })
      .eq('id', step);

    expect(await focusOf('izzah')).toBeNull();
  });

  it('clears on request, and says so when there was nothing to clear', async () => {
    const task = await fixture('amer', { status: 'active' });
    const amer = await signInAs('amer');
    await amer.rpc('set_current_focus', { p_task_id: task.id });

    expect(((await amer.rpc('clear_current_focus')).data as Rpc).ok).toBe(true);
    expect(await focusOf('amer')).toBeNull();
    expect((await amer.rpc('confirm_current_focus')).data as Rpc).toMatchObject({
      ok: false,
      code: 'nothing_selected',
    });
  });
});

describe('v140 reading the current focus', () => {
  it('is visible to somebody authorised to see that person, and to nobody else', async () => {
    const task = await fixture('izzah', { status: 'active', title: 'Machine guarding survey' });
    const izzah = await signInAs('izzah');
    await izzah.rpc('set_current_focus', { p_task_id: task.id });

    // Amer supervises Izzah through the approved visibility grant.
    const amer = await signInAs('amer');
    const seen = await amer
      .from('current_focus_overview')
      .select('user_id,focus_title,is_step')
      .eq('user_id', PEOPLE.izzah.id);
    expect(seen.data).toHaveLength(1);
    expect(seen.data![0]).toMatchObject({ focus_title: 'Machine guarding survey', is_step: false });

    // Lim has no visibility of anybody.
    const lim = await signInAs('lim');
    const hidden = await lim
      .from('current_focus_overview')
      .select('user_id')
      .eq('user_id', PEOPLE.izzah.id);
    expect(hidden.data).toHaveLength(0);
  });

  it('names the step when a step was chosen', async () => {
    const task = await fixture('amer', { status: 'active', title: 'Fire drill' });
    const step = await addStep(task.id, 'izzah', 'Deliver the pre-drill briefing');
    const izzah = await signInAs('izzah');
    await izzah.rpc('set_current_focus', { p_task_id: task.id, p_checklist_item_id: step });

    const { data } = await izzah
      .from('current_focus_overview')
      .select('focus_title,task_title,is_step')
      .eq('user_id', PEOPLE.izzah.id)
      .single();
    // The step is what they are on; the task is the context around it.
    expect(data).toMatchObject({
      focus_title: 'Deliver the pre-drill briefing',
      task_title: 'Fire drill',
      is_step: true,
    });
  });
});
