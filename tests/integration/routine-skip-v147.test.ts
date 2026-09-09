import { afterEach, describe, expect, it } from 'vitest';

import { createTask, deleteTask, PEOPLE, serviceClient, signInAs } from './setup';

/**
 * v147 §15 — a skip request, and the two ways out of it.
 *
 * "While a skip request is pending, the employee can withdraw it and complete
 * the work through the normal flow. Withdrawal and completion must be
 * consistent so the manager cannot accept a stale request afterward."
 *
 * The second sentence is the one that matters. Before this, an employee could
 * complete the inspection with its evidence attached, the pending request would
 * sit in the manager's queue, and accepting it the next morning cancelled the
 * completed occurrence and recorded "not required" against work that had been
 * done — two mutually exclusive outcomes, in that order.
 *
 * Acceptance A17.
 */

type Rpc = Record<string, unknown> & { ok: boolean; code?: string; message?: string };

const created: string[] = [];
const createdTemplates: string[] = [];

/** A routine occurrence of this test's own, owned by Izzah. */
async function occurrence(overrides: Record<string, unknown> = {}) {
  const admin = serviceClient();
  const { data: template, error } = await admin
    .from('routine_templates')
    .insert({
      title: `Skip fixture template ${crypto.randomUUID().slice(0, 8)}`,
      default_owner_id: PEOPLE.izzah.id,
      created_by: PEOPLE.izzah.id,
      frequency: 'weekly',
      interval_count: 1,
      weekday: 1,
    })
    .select('id')
    .single();
  if (error) throw new Error(`Could not create a routine template: ${error.message}`);
  createdTemplates.push(String(template!.id));

  const task = await createTask('izzah', {
    title: `Skip fixture occurrence ${crypto.randomUUID().slice(0, 8)}`,
    work_class: 'routine_occurrence',
    focus_bucket: null,
    routine_template_id: template!.id,
    occurrence_date: new Date().toISOString().slice(0, 10),
    status: 'backlog',
    ...overrides,
  });
  created.push(task.id);
  return task;
}

async function raiseSkip(taskId: string, as: 'izzah' = 'izzah') {
  const client = await signInAs(as);
  const { data } = await client.rpc('mark_routine_not_required', {
    p_task_id: taskId,
    p_reason_code: 'no_applicable_work',
    p_reason_note: null,
    p_idempotency_key: null,
  });
  const result = data as Rpc;
  if (!result.ok) throw new Error(`Could not raise the request: ${result.message}`);

  const { data: row, error } = await serviceClient()
    .from('routine_occurrence_exceptions')
    .select('id, state')
    .eq('task_id', taskId)
    .single();
  // Thrown, not swallowed: a refused read here looks exactly like "no request
  // was created", which is the thing under test.
  if (error) throw new Error(`Could not read the request: ${error.message}`);
  return row as { id: string; state: string };
}

async function readState(exceptionId: string) {
  const { data, error } = await serviceClient()
    .from('routine_occurrence_exceptions')
    .select('state, withdrawn_at, decided_by')
    .eq('id', exceptionId)
    .single();
  if (error) throw new Error(`Could not read the request: ${error.message}`);
  return data as { state: string; withdrawn_at: string | null; decided_by: string | null };
}

afterEach(async () => {
  while (created.length) await deleteTask(created.pop()!);
  while (createdTemplates.length) {
    await serviceClient().from('routine_templates').delete().eq('id', createdTemplates.pop()!);
  }
});

describe('taking a skip request back', () => {
  it('lets the person who raised it withdraw, and leaves the work open', async () => {
    const task = await occurrence();
    const request = await raiseSkip(task.id);
    expect(request.state).toBe('pending');

    const izzah = await signInAs('izzah');
    const { data } = await izzah.rpc('withdraw_routine_exception', {
      p_exception_id: request.id,
      p_idempotency_key: null,
    });

    expect(data as Rpc).toMatchObject({ ok: true, code: 'exception_withdrawn' });

    const after = await readState(request.id);
    expect(after.state).toBe('withdrawn');
    // A withdrawal is not a decision, so nobody is recorded as having made one.
    expect(after.decided_by).toBeNull();
    expect(after.withdrawn_at).not.toBeNull();

    // And the occurrence is exactly where it was: open, and theirs to do.
    const { data: occurrenceRow } = await serviceClient()
      .from('tasks')
      .select('status')
      .eq('id', task.id)
      .single();
    expect(occurrenceRow!.status).toBe('backlog');
  });

  it('refuses somebody who did not raise it', async () => {
    const task = await occurrence();
    const request = await raiseSkip(task.id);

    // Their manager, who has every other authority over this occurrence.
    const manager = await signInAs('izzul');
    const { data } = await manager.rpc('withdraw_routine_exception', {
      p_exception_id: request.id,
      p_idempotency_key: null,
    });

    expect(data as Rpc).toMatchObject({ ok: false, code: 'not_authorised' });
    expect((await readState(request.id)).state).toBe('pending');
  });

  it('cannot be used to undo a decision somebody made', async () => {
    const task = await occurrence();
    const request = await raiseSkip(task.id);

    const manager = await signInAs('izzul');
    const decided = (
      await manager.rpc('decide_routine_exception', {
        p_exception_id: request.id,
        p_accept: true,
        p_note: null,
        p_idempotency_key: null,
      })
    ).data as Rpc;
    expect(decided.ok, `the manager could not accept: ${decided.message}`).toBe(true);

    const izzah = await signInAs('izzah');
    const { data } = await izzah.rpc('withdraw_routine_exception', {
      p_exception_id: request.id,
      p_idempotency_key: null,
    });

    // Reported as success so a second click reads as done, but the accepted
    // decision stands.
    expect(data as Rpc).toMatchObject({ ok: true, code: 'already_resolved' });
    expect((await readState(request.id)).state).toBe('accepted');
  });
});

describe('completing the work answers the question', () => {
  it('withdraws a pending request, and the manager cannot then accept it', async () => {
    const task = await occurrence({ status: 'active' });
    const request = await raiseSkip(task.id);

    // The employee finds the area open after all and simply does the walk.
    const izzah = await signInAs('izzah');
    const completed = (
      await izzah.rpc('complete_task', {
        p_task_id: task.id,
        p_expected_version: null,
        p_completion_note: null,
        p_idempotency_key: null,
      })
    ).data as Rpc;
    expect(completed.ok, `completion was refused: ${completed.message}`).toBe(true);

    // The request went with it. Nothing is left in the manager's queue.
    expect((await readState(request.id)).state).toBe('withdrawn');

    const manager = await signInAs('izzul');
    const { data } = await manager.rpc('decide_routine_exception', {
      p_exception_id: request.id,
      p_accept: true,
      p_note: null,
      p_idempotency_key: null,
    });

    /*
     * Already resolved, so there is nothing to decide. Asserted rather than
     * assumed: the failure this replaces was silent — the accept succeeded,
     * cancelled a completed occurrence, and recorded "not required" against
     * work whose evidence was still attached.
     */
    expect((data as Rpc).ok).toBe(true);
    expect((data as Rpc).code).toBe('already_decided');

    const { data: occurrenceRow } = await serviceClient()
      .from('tasks')
      .select('status')
      .eq('id', task.id)
      .single();
    expect(occurrenceRow!.status).toBe('completed');
  });

  it('refuses a decision on a request left pending against closed work', async () => {
    const task = await occurrence({ status: 'active' });
    const request = await raiseSkip(task.id);

    const izzah = await signInAs('izzah');
    await izzah.rpc('complete_task', {
      p_task_id: task.id,
      p_expected_version: null,
      p_completion_note: null,
      p_idempotency_key: null,
    });

    /*
     * The state this guard exists for: a completed occurrence with a request
     * still pending against it.
     *
     * The trigger prevents it from v147 onwards, so it is put back by hand
     * here — rows exactly like this are already in the database, written by
     * the code that had no trigger. Set AFTER the completion, so changing the
     * status does not simply withdraw it again.
     */
    await serviceClient()
      .from('routine_occurrence_exceptions')
      .update({ state: 'pending', withdrawn_at: null })
      .eq('id', request.id);

    const manager = await signInAs('izzul');
    const { data } = await manager.rpc('decide_routine_exception', {
      p_exception_id: request.id,
      p_accept: true,
      p_note: null,
      p_idempotency_key: null,
    });

    expect(data as Rpc).toMatchObject({ ok: false, code: 'invalid_state' });
    expect((data as Rpc).message).toMatch(/already been closed/i);

    // And the completion is untouched.
    const { data: occurrenceRow } = await serviceClient()
      .from('tasks')
      .select('status')
      .eq('id', task.id)
      .single();
    expect(occurrenceRow!.status).toBe('completed');
  });
});
