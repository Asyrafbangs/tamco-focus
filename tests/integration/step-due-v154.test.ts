import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, describe, expect, it } from 'vitest';

import { createTask, PEOPLE, serviceClient, signInAs } from './setup';

/**
 * v154 — Trackable Steps, stage 1: a step's date holds.
 *
 * "A child Step normally should not be due after its parent task … Don't
 * silently allow broken planning." And the elegant half: a step that says
 * "same as the task" moves when the task moves, and one given its own date
 * stays where it was put.
 *
 * The rule is one SQL function applied in three places — the trigger on the
 * table, `update_checklist_step`, and `change_task_due_date` — so each place is
 * asked here, and each must give the same answer.
 */

type Rpc = Record<string, unknown> & { ok: boolean; code?: string; message?: string };

const ZONE = 'Asia/Kuala_Lumpur';
const createdTasks: string[] = [];

/** The organisation-local date `days` from today, as `YYYY-MM-DD`. */
function localDate(days: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: ZONE }).format(
    new Date(Date.now() + days * 86_400_000),
  );
}

/** How a date-only commitment is stored: the last instant of that local day. */
function endOfDay(days: number): string {
  return new Date(`${localDate(days)}T23:59:59.999+08:00`).toISOString();
}

async function task(overrides: Record<string, unknown> = {}) {
  const created = await createTask('izzah', {
    status: 'active',
    due_at: endOfDay(10),
    due_is_date_only: true,
    ...overrides,
  });
  createdTasks.push(created.id);
  return created;
}

async function currentVersion(taskId: string): Promise<number> {
  const { data } = await serviceClient().from('tasks').select('version').eq('id', taskId).single();
  return Number(data!.version);
}

/** Adds a step the way Add step does: a direct insert, under the caller's RLS. */
function addStep(client: SupabaseClient, taskId: string, position: number, dueAt: string | null) {
  return client
    .from('task_checklist_items')
    .insert({
      task_id: taskId,
      position,
      action: `Give department input ${position}`,
      assigned_to: PEOPLE.amer.id,
      evidence_rule: 'not_required',
      due_at: dueAt,
    })
    .select('id')
    .single();
}

function moveTask(client: SupabaseClient, taskId: string, version: number, dueAt: string) {
  return client.rpc('change_task_due_date', {
    p_task_id: taskId,
    p_expected_version: version,
    p_new_due_at: dueAt,
    p_due_is_date_only: true,
    p_reason: null,
    p_idempotency_key: null,
  });
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

describe('v154 — a step is not due after its task', () => {
  it('refuses a later step, in words the person can act on', async () => {
    const parent = await task();
    const izzah = await signInAs('izzah');

    const { data, error } = await addStep(izzah, parent.id, 1, endOfDay(14));
    expect(data, 'a step was stored four days after its task').toBeNull();
    expect(error?.hint).toBe('step_due_after_task');
    expect(error?.message).toContain('cannot be due after the task');
    expect(error?.message).toContain('Choose an earlier date for the step');
  });

  it('allows a step on the task’s own day, even when the task has a time', async () => {
    /*
     * The ordinary case the rule must not catch. The step's date is a day; the
     * task is due at half past two on that day. As instants the step is nine
     * hours "later", and a rule written on instants would refuse it.
     */
    const parent = await task({
      due_at: new Date(`${localDate(10)}T14:30:00+08:00`).toISOString(),
      due_is_date_only: false,
    });
    const izzah = await signInAs('izzah');

    const { error } = await addStep(izzah, parent.id, 1, endOfDay(10));
    expect(error, `a same-day step was refused: ${error?.message}`).toBeNull();
  });

  it('refuses a later date through the step editor too, as a message rather than an error', async () => {
    const parent = await task();
    const izzah = await signInAs('izzah');
    const { data: step } = await addStep(izzah, parent.id, 1, endOfDay(5));

    const result = (
      await izzah.rpc('update_checklist_step', {
        p_item_id: step!.id,
        p_action: 'Give department input 1',
        p_assigned_to: PEOPLE.amer.id,
        p_evidence_rule: 'not_required',
        p_due_at: endOfDay(12),
        p_depends_on_item_id: null,
        p_idempotency_key: null,
      })
    ).data as Rpc;

    expect(result.ok).toBe(false);
    expect(result.code).toBe('validation_failed');
    expect(result.message).toContain('cannot be due after the task');
  });

  it('constrains nothing when the task has no date yet', async () => {
    const parent = await task({ due_at: null });
    const izzah = await signInAs('izzah');

    const { error } = await addStep(izzah, parent.id, 1, endOfDay(30));
    expect(error, `a dated step on undated work was refused: ${error?.message}`).toBeNull();
  });
});

describe('v154 — moving the task', () => {
  it('carries a "same as the task" step with it, and is never blocked by one', async () => {
    const parent = await task();
    const izzah = await signInAs('izzah');
    const { data: step } = await addStep(izzah, parent.id, 1, null);

    const moved = (await moveTask(izzah, parent.id, await currentVersion(parent.id), endOfDay(3)))
      .data as Rpc;
    expect(moved.ok, `an inherited step blocked the move: ${moved.message}`).toBe(true);

    // Still inheriting — nothing copied the old date onto it.
    const { data: row } = await serviceClient()
      .from('task_checklist_items')
      .select('due_at')
      .eq('id', step!.id)
      .single();
    expect(row!.due_at).toBeNull();
  });

  it('refuses to move the task before a step with its own date, and names the step', async () => {
    const parent = await task();
    const izzah = await signInAs('izzah');
    await addStep(izzah, parent.id, 1, endOfDay(5));

    const refused = (await moveTask(izzah, parent.id, await currentVersion(parent.id), endOfDay(3)))
      .data as Rpc;
    expect(refused.ok, 'the task was moved ahead of its own step').toBe(false);
    expect(refused.code).toBe('validation_failed');
    expect(refused.message).toContain('Give department input 1');
    expect(refused.message).toContain('Move the step first');

    // A date the step still fits inside is fine.
    const allowed = (await moveTask(izzah, parent.id, await currentVersion(parent.id), endOfDay(7)))
      .data as Rpc;
    expect(allowed.ok, `a valid move was refused: ${allowed.message}`).toBe(true);
  });

  it('is not held back by a step that is already done', async () => {
    const parent = await task();
    const izzah = await signInAs('izzah');
    const { data: step } = await addStep(izzah, parent.id, 1, endOfDay(5));

    // Completed by Amer, through the real route: a record of what happened, not
    // a plan the task must fit.
    const amer = await signInAs('amer');
    const done = (
      await amer.rpc('complete_checklist_item', {
        p_item_id: step!.id,
        p_completion_note: null,
        p_idempotency_key: null,
      })
    ).data as Rpc;
    expect(done.ok, `Amer could not complete his step: ${done.message}`).toBe(true);

    const moved = (await moveTask(izzah, parent.id, await currentVersion(parent.id), endOfDay(3)))
      .data as Rpc;
    expect(moved.ok, `a completed step blocked the move: ${moved.message}`).toBe(true);
  });
});
