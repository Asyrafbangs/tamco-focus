import { describe, expect, it } from 'vitest';

import { createTask, PEOPLE, serviceClient, signInAs } from './setup';

type Rpc = Record<string, unknown> & { ok: boolean; code: string; message?: string };

/**
 * Creates a checklist step directly, so a test can set up the state it wants
 * to act on without asserting anything about the creation path.
 */
async function seedStep(
  taskId: string,
  overrides: Record<string, unknown> = {},
): Promise<{ id: string }> {
  const admin = serviceClient();
  const { data, error } = await admin
    .from('task_checklist_items')
    .insert({
      task_id: taskId,
      position: Number(overrides.position ?? 1),
      action: 'Obtain contractor quotation',
      assigned_to: PEOPLE.izzah.id,
      ...overrides,
    })
    .select('id')
    .single();

  if (error) throw new Error(`Could not seed checklist step: ${error.message}`);
  return data as { id: string };
}

describe('v45 Part A — checklist collaboration is not bounded by the reporting line', () => {
  /*
   * Lim reports to Izzul and is visible to nobody: `visible_people` is empty
   * and no one manages them. Under the old rule Izzah could not hand Lim a
   * step at all, which is the exact case the specification calls out — "do not
   * restrict checklist collaboration based on manager hierarchy".
   */
  it('lets an owner assign a step to a peer they cannot otherwise see', async () => {
    const task = await createTask('izzah', { status: 'active' });
    const owner = await signInAs('izzah');

    const { error } = await owner.from('task_checklist_items').insert({
      task_id: task.id,
      position: 1,
      action: 'Confirm the isolation certificate',
      assigned_to: PEOPLE.lim.id,
    });

    expect(error).toBeNull();

    // And it reaches Lim as a Shared contribution, which is the point of
    // assigning it — a row nobody can see is not collaboration.
    const lim = await signInAs('lim');
    const { data: shared } = await lim
      .from('shared_contributions')
      .select('title, primary_owner_name, readiness')
      .eq('task_id', task.id);

    expect(shared).toHaveLength(1);
    expect(shared?.[0]).toMatchObject({
      title: 'Confirm the isolation certificate',
      // The owner is outside Lim's reporting line, and is still named: being
      // handed work by an anonymous stranger is not collaboration either.
      primary_owner_name: 'Izzah Nurul',
      readiness: 'ready',
    });
  });
});

describe('v45 Part B — editing a checklist step', () => {
  it('records only the fields that changed, and recalculates readiness', async () => {
    const task = await createTask('izzah', { status: 'active' });
    const first = await seedStep(task.id, { action: 'Draft the scope', position: 1 });
    const second = await seedStep(task.id, { action: 'Review the scope', position: 2 });
    const owner = await signInAs('izzah');

    const result = (
      await owner.rpc('update_checklist_step', {
        p_item_id: second.id,
        p_action: 'Review the scope with Operations',
        p_assigned_to: PEOPLE.lim.id,
        p_evidence_rule: 'required',
        p_due_at: null,
        p_depends_on_item_id: first.id,
        p_idempotency_key: crypto.randomUUID(),
      })
    ).data as Rpc & { changed: Record<string, unknown> };

    expect(result).toMatchObject({ ok: true, code: 'checklist_step_updated' });
    expect(Object.keys(result.changed).sort()).toEqual([
      'action',
      'assigned_to',
      'depends_on_item_id',
      'evidence_rule',
    ]);

    const admin = serviceClient();
    const { data: persisted } = await admin
      .from('task_checklist_items')
      .select('action, assigned_to, evidence_rule, depends_on_item_id, state')
      .eq('id', second.id)
      .single();

    expect(persisted).toMatchObject({
      action: 'Review the scope with Operations',
      assigned_to: PEOPLE.lim.id,
      evidence_rule: 'required',
      depends_on_item_id: first.id,
      // The prerequisite is not finished, so the step is no longer startable.
      state: 'waiting',
    });

    const { data: events } = await admin
      .from('audit_events')
      .select('actor_id, detail')
      .eq('task_id', task.id)
      .eq('event_type', 'checklist_item_updated');

    expect(events).toHaveLength(1);
    expect((events as Array<{ actor_id: string }>)[0]?.actor_id).toBe(PEOPLE.izzah.id);
  });

  it('reports no change rather than writing an empty audit event', async () => {
    const task = await createTask('izzah', { status: 'active' });
    const step = await seedStep(task.id);
    const owner = await signInAs('izzah');

    const result = (
      await owner.rpc('update_checklist_step', {
        p_item_id: step.id,
        p_action: 'Obtain contractor quotation',
        p_assigned_to: PEOPLE.izzah.id,
        p_evidence_rule: 'not_required',
        p_due_at: null,
        p_depends_on_item_id: null,
        p_idempotency_key: crypto.randomUUID(),
      })
    ).data as Rpc;

    expect(result).toMatchObject({ ok: true, code: 'checklist_step_unchanged' });

    const { data: events } = await serviceClient()
      .from('audit_events')
      .select('id')
      .eq('task_id', task.id)
      .eq('event_type', 'checklist_item_updated');

    expect(events).toHaveLength(0);
  });

  it('refuses to let a contributor restructure the work they contribute to', async () => {
    const task = await createTask('izzah', { status: 'active' });
    const step = await seedStep(task.id, { assigned_to: PEOPLE.lim.id });
    const contributor = await signInAs('lim');

    const refused = (
      await contributor.rpc('update_checklist_step', {
        p_item_id: step.id,
        p_action: 'Something else entirely',
        p_assigned_to: PEOPLE.lim.id,
        p_evidence_rule: 'not_required',
        p_due_at: null,
        p_depends_on_item_id: null,
        p_idempotency_key: crypto.randomUUID(),
      })
    ).data as Rpc;

    expect(refused).toMatchObject({ ok: false, code: 'not_authorised' });

    /*
     * The RPC is not the only door. A contributor may legitimately UPDATE this
     * row — that is how completing a step works — so the column-level rule has
     * to hold against a direct write too, or the guard is theatre.
     */
    const { error } = await contributor
      .from('task_checklist_items')
      .update({ action: 'Something else entirely' })
      .eq('id', step.id);

    expect(error).not.toBeNull();

    const { data: persisted } = await serviceClient()
      .from('task_checklist_items')
      .select('action')
      .eq('id', step.id)
      .single();

    expect((persisted as { action: string }).action).toBe('Obtain contractor quotation');
  });

  it('still lets the assignee complete their own step', async () => {
    const task = await createTask('izzah', { status: 'active' });
    const step = await seedStep(task.id, { assigned_to: PEOPLE.lim.id });
    const assignee = await signInAs('lim');

    const result = (
      await assignee.rpc('complete_checklist_item', {
        p_item_id: step.id,
        p_completion_note: null,
        p_idempotency_key: crypto.randomUUID(),
      })
    ).data as Rpc;

    expect(result.ok).toBe(true);
  });

  it('refuses to rewrite a completed step, and says what to do instead', async () => {
    const task = await createTask('izzah', { status: 'active' });
    const step = await seedStep(task.id, {
      state: 'completed',
      completed_by: PEOPLE.izzah.id,
      completed_at: new Date().toISOString(),
    });
    const owner = await signInAs('izzah');

    const refused = (
      await owner.rpc('update_checklist_step', {
        p_item_id: step.id,
        p_action: 'Rewritten after the fact',
        p_assigned_to: PEOPLE.izzah.id,
        p_evidence_rule: 'not_required',
        p_due_at: null,
        p_depends_on_item_id: null,
        p_idempotency_key: crypto.randomUUID(),
      })
    ).data as Rpc;

    expect(refused.ok).toBe(false);
    expect(refused.code).toBe('invalid_state');
    expect(refused.message).toContain('Reopen');
  });

  it('refuses a prerequisite that would make two steps wait for each other', async () => {
    const task = await createTask('izzah', { status: 'active' });
    const first = await seedStep(task.id, { action: 'Step one', position: 1 });
    const second = await seedStep(task.id, {
      action: 'Step two',
      position: 2,
      depends_on_item_id: first.id,
    });
    const owner = await signInAs('izzah');

    const refused = (
      await owner.rpc('update_checklist_step', {
        p_item_id: first.id,
        p_action: 'Step one',
        p_assigned_to: PEOPLE.izzah.id,
        p_evidence_rule: 'not_required',
        p_due_at: null,
        p_depends_on_item_id: second.id,
        p_idempotency_key: crypto.randomUUID(),
      })
    ).data as Rpc;

    expect(refused).toMatchObject({ ok: false, code: 'validation_failed' });
    expect(refused.message).toContain('wait for each other');
  });
});

describe('v45 Part B — removing a checklist step', () => {
  it('tells the assignee, records the removal, and deletes the row', async () => {
    const task = await createTask('izzah', { status: 'active' });
    const step = await seedStep(task.id, { assigned_to: PEOPLE.lim.id });
    const owner = await signInAs('izzah');

    const result = (
      await owner.rpc('remove_checklist_step', {
        p_item_id: step.id,
        p_idempotency_key: crypto.randomUUID(),
      })
    ).data as Rpc;

    expect(result).toMatchObject({ ok: true, code: 'checklist_step_removed' });

    const admin = serviceClient();
    const [{ data: rows }, { data: events }, { data: notifications }] = await Promise.all([
      admin.from('task_checklist_items').select('id').eq('id', step.id),
      admin
        .from('audit_events')
        .select('detail')
        .eq('task_id', task.id)
        .eq('event_type', 'checklist_item_removed'),
      admin
        .from('notifications')
        .select('title')
        .eq('recipient_id', PEOPLE.lim.id)
        .eq('task_id', task.id)
        .eq('title', 'Contribution removed'),
    ]);

    expect(rows).toHaveLength(0);
    expect(events).toHaveLength(1);
    expect(notifications).toHaveLength(1);
  });

  it('refuses while another step is waiting for it', async () => {
    const task = await createTask('izzah', { status: 'active' });
    const first = await seedStep(task.id, { action: 'Step one', position: 1 });
    await seedStep(task.id, {
      action: 'Step two',
      position: 2,
      depends_on_item_id: first.id,
    });
    const owner = await signInAs('izzah');

    const refused = (
      await owner.rpc('remove_checklist_step', {
        p_item_id: first.id,
        p_idempotency_key: crypto.randomUUID(),
      })
    ).data as Rpc;

    expect(refused).toMatchObject({ ok: false, code: 'invalid_state' });
    expect(refused.message).toContain('waiting for this one');

    const { data: rows } = await serviceClient()
      .from('task_checklist_items')
      .select('id')
      .eq('id', first.id);
    expect(rows).toHaveLength(1);
  });

  it('refuses to delete completed work', async () => {
    const task = await createTask('izzah', { status: 'active' });
    const step = await seedStep(task.id, {
      state: 'completed',
      completed_by: PEOPLE.izzah.id,
      completed_at: new Date().toISOString(),
    });
    const owner = await signInAs('izzah');

    const refused = (
      await owner.rpc('remove_checklist_step', {
        p_item_id: step.id,
        p_idempotency_key: crypto.randomUUID(),
      })
    ).data as Rpc;

    expect(refused).toMatchObject({ ok: false, code: 'invalid_state' });
  });
});

/**
 * v45 sections 37-38, 42-45 and 70 — the specification's own critical
 * acceptance test: answering a request clears the manager's obligation without
 * pretending the work is unblocked.
 */
describe('v45 barrier request and response', () => {
  async function raiseDecisionRequest() {
    const task = await createTask('izzah', { status: 'active' });
    const employee = await signInAs('izzah');

    const raised = (
      await employee.rpc('raise_barrier', {
        p_task_id: task.id,
        p_description: 'The shutdown window overlaps the audit.',
        p_support_needed: 'Confirm whether the shutdown can proceed.',
        p_impact: 'may_delay',
        p_add_to_meeting_queue: false,
        p_action_type: 'decision',
        p_action_required_from: PEOPLE.izzul.id,
        p_idempotency_key: crypto.randomUUID(),
      })
    ).data as Rpc & { barrier_id: string };

    expect(raised.ok).toBe(true);
    return { task, barrierId: raised.barrier_id };
  }

  it('puts the request on the named manager, action pending', async () => {
    const { barrierId } = await raiseDecisionRequest();

    const { data: barrier } = await serviceClient()
      .from('barriers')
      .select('action_required_from, action_type, action_pending, status')
      .eq('id', barrierId)
      .single();

    expect(barrier).toMatchObject({
      action_required_from: PEOPLE.izzul.id,
      action_type: 'decision',
      action_pending: true,
      status: 'open',
    });
  });

  it('clears the obligation on reply but leaves the barrier open', async () => {
    const { task, barrierId } = await raiseDecisionRequest();
    const manager = await signInAs('izzul');

    const answered = (
      await manager.rpc('post_barrier_response', {
        p_barrier_id: barrierId,
        p_message: 'Proceed on the 14th. Operations have been told.',
        p_expected_version: null,
        p_kind: 'answer',
        p_idempotency_key: crypto.randomUUID(),
      })
    ).data as Rpc;

    expect(answered).toMatchObject({ ok: true, code: 'barrier_response_posted' });

    const admin = serviceClient();
    const [{ data: barrier }, { data: notifications }, { data: parent }] = await Promise.all([
      admin.from('barriers').select('action_pending, status').eq('id', barrierId).single(),
      admin
        .from('notifications')
        .select('title, body')
        .eq('recipient_id', PEOPLE.izzah.id)
        .eq('barrier_id', barrierId),
      admin.from('tasks').select('status').eq('id', task.id).single(),
    ]);

    // The manager has answered…
    expect((barrier as { action_pending: boolean }).action_pending).toBe(false);
    // …and the work is still blocked until somebody says otherwise (section 45).
    expect((barrier as { status: string }).status).toBe('open');
    // …and nothing resumed on its own (section 47).
    expect((parent as { status: string }).status).toBe('active');

    expect(notifications).toHaveLength(1);
    expect((notifications as Array<{ title: string }>)[0]?.title).toBe('Decision received');
  });

  it('refuses a reply to a barrier somebody already resolved', async () => {
    const { barrierId } = await raiseDecisionRequest();
    const employee = await signInAs('izzah');

    const resolved = (
      await employee.rpc('resolve_barrier', {
        p_barrier_id: barrierId,
        p_resolution_note: 'The audit moved, so the window is clear.',
      })
    ).data as Rpc;
    expect(resolved.ok).toBe(true);

    const manager = await signInAs('izzul');
    const refused = (
      await manager.rpc('post_barrier_response', {
        p_barrier_id: barrierId,
        p_message: 'Proceed on the 14th.',
        p_expected_version: null,
        p_kind: 'answer',
        p_idempotency_key: crypto.randomUUID(),
      })
    ).data as Rpc;

    expect(refused).toMatchObject({ ok: false, code: 'invalid_state' });
    expect(refused.message).toContain('already been resolved');

    // Resolving is the one thing that ends the obligation too (section 44).
    const { data: barrier } = await serviceClient()
      .from('barriers')
      .select('action_pending')
      .eq('id', barrierId)
      .single();
    expect((barrier as { action_pending: boolean }).action_pending).toBe(false);
  });

  it('records which answer an approval received, and names it in the notification', async () => {
    const task = await createTask('izzah', { status: 'active' });
    const employee = await signInAs('izzah');

    const raised = (
      await employee.rpc('raise_barrier', {
        p_task_id: task.id,
        p_description: 'The revised scope exceeds the approved budget.',
        p_support_needed: 'Approve the revised scope, or tell us what to change.',
        p_impact: 'cannot_continue',
        p_add_to_meeting_queue: false,
        p_action_type: 'approval',
        p_action_required_from: PEOPLE.izzul.id,
        p_idempotency_key: crypto.randomUUID(),
      })
    ).data as Rpc & { barrier_id: string };
    expect(raised.ok).toBe(true);

    const manager = await signInAs('izzul');
    const answered = (
      await manager.rpc('post_barrier_response', {
        p_barrier_id: raised.barrier_id,
        p_message: 'Reduce the scope to the two critical lines and resubmit.',
        p_expected_version: null,
        p_kind: 'changes_requested',
        p_idempotency_key: crypto.randomUUID(),
      })
    ).data as Rpc;

    expect(answered).toMatchObject({ ok: true, response_kind: 'changes_requested' });

    const admin = serviceClient();
    const [{ data: responses }, { data: notifications }] = await Promise.all([
      admin.from('barrier_responses').select('kind').eq('barrier_id', raised.barrier_id),
      admin
        .from('notifications')
        .select('title')
        .eq('recipient_id', PEOPLE.izzah.id)
        .eq('barrier_id', raised.barrier_id),
    ]);

    expect((responses as Array<{ kind: string }>)[0]?.kind).toBe('changes_requested');
    expect((notifications as Array<{ title: string }>)[0]?.title).toBe('Changes requested');
  });

  it('refuses an approval verdict on a request that never asked for one', async () => {
    const { barrierId } = await raiseDecisionRequest();
    const manager = await signInAs('izzul');

    const refused = (
      await manager.rpc('post_barrier_response', {
        p_barrier_id: barrierId,
        p_message: 'Approved.',
        p_expected_version: null,
        p_kind: 'approved',
        p_idempotency_key: crypto.randomUUID(),
      })
    ).data as Rpc;

    expect(refused).toMatchObject({ ok: false, code: 'validation_failed' });
  });

  it('refuses a reply written against a stale version', async () => {
    const { barrierId } = await raiseDecisionRequest();
    const manager = await signInAs('izzul');

    const stale = (
      await manager.rpc('post_barrier_response', {
        p_barrier_id: barrierId,
        p_message: 'Written against an older view of this barrier.',
        p_expected_version: 99,
        p_kind: 'answer',
        p_idempotency_key: crypto.randomUUID(),
      })
    ).data as Rpc;

    expect(stale).toMatchObject({ ok: false, code: 'version_conflict' });
  });
});
