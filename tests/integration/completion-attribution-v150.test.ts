import { afterEach, describe, expect, it } from 'vitest';

import { createTask, deleteTask, PEOPLE, serviceClient, signInAs } from './setup';

/**
 * v150 §20 — a completion stays attributed to whoever did it.
 *
 * "Store the completion actor separately if a permitted person completes on
 * someone's behalf. Never rewrite historical attribution merely because
 * today's owner/manager changed."
 *
 * Delivery figures read `primary_owner_id`, which is who owns the work NOW.
 * Reassigning a finished task therefore moved its completion out of one
 * person's history and into another's months later, and last quarter's numbers
 * changed with it — quietly, and in a direction nobody chose.
 *
 * Acceptance A29 and A38.
 */

type Rpc = Record<string, unknown> & { ok: boolean; code?: string; message?: string };

const created: string[] = [];

async function fixture(person: keyof typeof PEOPLE, overrides: Record<string, unknown> = {}) {
  const task = await createTask(person, { status: 'active', ...overrides });
  created.push(task.id);
  return task;
}

async function readAttribution(taskId: string) {
  const { data, error } = await serviceClient()
    .from('tasks')
    .select('status,primary_owner_id,completed_owner_id,completed_by,completed_at')
    .eq('id', taskId)
    .single();
  if (error) throw new Error(`Could not read the task: ${error.message}`);
  return data as {
    status: string;
    primary_owner_id: string;
    completed_owner_id: string | null;
    completed_by: string | null;
    completed_at: string | null;
  };
}

afterEach(async () => {
  while (created.length) await deleteTask(created.pop()!);
});

describe('who a completion belongs to', () => {
  it('records the owner and the actor at the moment it is finished', async () => {
    const task = await fixture('izzah');

    const izzah = await signInAs('izzah');
    const { data } = await izzah.rpc('complete_task', {
      p_task_id: task.id,
      p_expected_version: null,
      p_completion_note: null,
      p_idempotency_key: null,
    });
    expect((data as Rpc).ok, `completion was refused: ${(data as Rpc).message}`).toBe(true);

    const after = await readAttribution(task.id);
    expect(after.completed_owner_id).toBe(PEOPLE.izzah.id);
    expect(after.completed_by).toBe(PEOPLE.izzah.id);
  });

  it('separates the actor from the owner when a manager finishes it', async () => {
    /*
     * §20 — "Store the completion actor separately if a permitted person
     * completes on someone's behalf." The delivery is still the employee's;
     * what changes is that the record says who pressed the button.
     */
    const task = await fixture('izzah');

    const manager = await signInAs('izzul');
    const { data } = await manager.rpc('complete_task', {
      p_task_id: task.id,
      p_expected_version: null,
      p_completion_note: null,
      p_idempotency_key: null,
    });
    expect((data as Rpc).ok, `the manager could not complete it: ${(data as Rpc).message}`).toBe(
      true,
    );

    const after = await readAttribution(task.id);
    expect(after.completed_owner_id).toBe(PEOPLE.izzah.id);
    expect(after.completed_by).toBe(PEOPLE.izzul.id);
  });

  it('does not move when the work is reassigned afterwards', async () => {
    const task = await fixture('izzah');

    const izzah = await signInAs('izzah');
    await izzah.rpc('complete_task', {
      p_task_id: task.id,
      p_expected_version: null,
      p_completion_note: null,
      p_idempotency_key: null,
    });

    // Months later, somebody tidies up ownership of a finished record.
    await serviceClient()
      .from('tasks')
      .update({ primary_owner_id: PEOPLE.ajmal.id })
      .eq('id', task.id);

    const after = await readAttribution(task.id);
    expect(after.primary_owner_id).toBe(PEOPLE.ajmal.id);
    // The delivery is still Izzah's, which is the whole point.
    expect(after.completed_owner_id).toBe(PEOPLE.izzah.id);

    const { data: view } = await serviceClient()
      .from('task_overview')
      .select('completed_owner_id')
      .eq('id', task.id)
      .single();
    expect(view!.completed_owner_id).toBe(PEOPLE.izzah.id);
  });

  it('clears when the work is reopened, so it is not counted twice', async () => {
    /*
     * §20 — "Currently reopened work is excluded from current completed
     * totals." A stale frozen owner would put it back the moment anything read
     * that column rather than the status.
     */
    const task = await fixture('izzah');

    const izzah = await signInAs('izzah');
    await izzah.rpc('complete_task', {
      p_task_id: task.id,
      p_expected_version: null,
      p_completion_note: null,
      p_idempotency_key: null,
    });
    expect((await readAttribution(task.id)).completed_owner_id).toBe(PEOPLE.izzah.id);

    await serviceClient()
      .from('tasks')
      .update({ status: 'active', completed_at: null })
      .eq('id', task.id);

    const after = await readAttribution(task.id);
    expect(after.completed_owner_id).toBeNull();
    expect(after.completed_by).toBeNull();
  });

  it('leaves work that was never completed with no attribution at all', async () => {
    const task = await fixture('izzah');
    const row = await readAttribution(task.id);
    expect(row.completed_owner_id).toBeNull();
    expect(row.completed_by).toBeNull();
  });
});
