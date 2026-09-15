import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, describe, expect, it } from 'vitest';

import { createTask, PEOPLE, serviceClient, signInAs, type PersonKey } from './setup';

/**
 * v186 — My Alerts, honoured.
 *
 * "Barrier or support involving me", "Assignment and reassignment" and
 * "Collaborative handoff" now do what they say. Switched off, the notice is
 * still written to the bell — quiet, so the outbox sends no email — because
 * each of them asks somebody to act and the bell is where the red count is
 * explained. A barrier about a safety or compliance risk, and every notice
 * about mandatory work, is sent whatever the switch says; that includes the
 * v185 deadline notices.
 */

type Alert =
  | 'barrier_involving_me'
  | 'assignment_changes'
  | 'collaboration_handoff'
  | 'due_today_and_deadlines';
type Rpc = { ok: boolean; code: string; message?: string };

const ZONE = 'Asia/Kuala_Lumpur';
const MARK = 'MA fixture';
const EVERYONE: PersonKey[] = ['amer', 'izzul', 'izzah', 'ajmal', 'lim'];

const createdTasks: string[] = [];
const createdBarriers: string[] = [];
const restoreGoals: Array<{ id: string; health: string; version: number }> = [];
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

async function removeBarriers(column: 'id' | 'task_id', value: string) {
  const admin = serviceClient();
  const { data } = await admin.from('barriers').select('id').eq(column, value);
  const ids = (data ?? []).map((row) => String(row.id));
  if (ids.length === 0) return;
  await admin.from('notifications').delete().in('barrier_id', ids);
  await admin.from('barrier_responses').delete().in('barrier_id', ids);
  const { error } = await admin.from('barriers').delete().in('id', ids);
  if (error) throw new Error(`Could not remove fixture barriers: ${error.message}`);
}

/**
 * Deleted where possible; binned where history forbids it (see v153). A binned
 * task's open barriers would still be waiting on somebody, so they go first.
 */
async function removeTask(taskId: string) {
  const admin = serviceClient();
  await removeBarriers('task_id', taskId);
  await admin.from('routine_findings').delete().eq('created_task_id', taskId);
  const { error } = await admin.from('tasks').delete().eq('id', taskId);
  if (!error) return;
  const { error: binError } = await admin
    .from('tasks')
    .update({ deleted_at: new Date().toISOString(), deleted_by: PEOPLE.admin.id })
    .eq('id', taskId);
  if (binError) throw new Error(`Could not remove fixture ${taskId}: ${binError.message}`);
  await admin.from('notifications').delete().eq('task_id', taskId);
}

afterEach(async () => {
  const admin = serviceClient();
  while (createdTasks.length) await removeTask(createdTasks.pop()!);
  while (createdBarriers.length) await removeBarriers('id', createdBarriers.pop()!);
  while (restoreGoals.length) {
    const goal = restoreGoals.pop()!;
    await admin
      .from('goals')
      .update({ health: goal.health, version: goal.version })
      .eq('id', goal.id);
  }
  await admin.from('notifications').delete().like('body', `%${MARK}%`);
  await admin
    .from('user_alert_preferences')
    .update({
      barrier_involving_me: true,
      assignment_changes: true,
      collaboration_handoff: true,
      due_today_and_deadlines: true,
    })
    .in(
      'user_id',
      EVERYONE.map((person) => PEOPLE[person].id),
    );
});

async function setAlert(person: PersonKey, alert: Alert, on: boolean) {
  const { error } = await serviceClient()
    .from('user_alert_preferences')
    .update({ [alert]: on })
    .eq('user_id', PEOPLE[person].id);
  if (error) throw new Error(`Could not set ${alert}: ${error.message}`);
}

async function work(person: PersonKey, overrides: Record<string, unknown> = {}) {
  const task = await createTask(person, {
    status: 'active',
    title: `${MARK} ${crypto.randomUUID().slice(0, 6)}`,
    due_at: endOfDay(10),
    due_is_date_only: true,
    ...overrides,
  });
  createdTasks.push(task.id);
  return task;
}

const MANDATORY = {
  is_mandatory: true,
  mandatory_justification: `${MARK}: statutory inspection`,
};

type Notice = {
  id: string;
  kind: string;
  title: string;
  requires_action: boolean;
  quiet: boolean;
  emailed: boolean;
};

/**
 * What the person was told, read back from the bell and the email outbox:
 * `notifications` for the notice, `notification_email_deliveries` for whether
 * an email was queued for it.
 */
async function told(
  recipient: PersonKey,
  where: { title: string; taskId?: string; goalId?: string },
): Promise<Notice[]> {
  const admin = serviceClient();
  let query = admin
    .from('notifications')
    .select('id,kind,title,requires_action,quiet')
    .eq('recipient_id', PEOPLE[recipient].id)
    .eq('title', where.title)
    .order('created_at', { ascending: true });
  if (where.taskId) query = query.eq('task_id', where.taskId);
  if (where.goalId) query = query.eq('goal_id', where.goalId);
  const { data, error } = await query;
  if (error) throw new Error(`Could not read notifications: ${error.message}`);
  const rows = data ?? [];
  if (rows.length === 0) return [];

  const { data: deliveries, error: deliveryError } = await admin
    .from('notification_email_deliveries')
    .select('notification_id')
    .in(
      'notification_id',
      rows.map((row) => row.id),
    );
  if (deliveryError) throw new Error(`Could not read deliveries: ${deliveryError.message}`);
  const emailed = new Set((deliveries ?? []).map((row) => String(row.notification_id)));

  return rows.map((row) => ({
    id: String(row.id),
    kind: String(row.kind),
    title: String(row.title),
    requires_action: Boolean(row.requires_action),
    quiet: Boolean(row.quiet),
    emailed: emailed.has(String(row.id)),
  }));
}

const inTheBellOnly = { quiet: true, emailed: false };
const inTheBellAndEmailed = { quiet: false, emailed: true };

async function raiseBarrier(
  person: PersonKey,
  taskId: string,
  options: { impact?: string; from?: PersonKey } = {},
) {
  const { data, error } = await (
    await as(person)
  ).rpc('raise_barrier', {
    p_task_id: taskId,
    p_description: `${MARK}: the supplier cannot deliver`,
    p_support_needed: `${MARK}: choose the alternative supplier`,
    p_impact: options.impact ?? 'may_delay',
    p_action_type: 'decision',
    p_action_required_from: PEOPLE[options.from ?? 'izzul'].id,
    p_add_to_meeting_queue: false,
    p_idempotency_key: crypto.randomUUID(),
  });
  if (error) throw new Error(`raise_barrier failed: ${error.message}`);
  const result = data as Rpc & { barrier_id: string };
  expect(result.ok, result.message).toBe(true);
  return result.barrier_id;
}

async function addStep(
  client: SupabaseClient,
  taskId: string,
  step: { action: string; assignee: PersonKey; dependsOn?: string; position?: number },
) {
  const { data, error } = await client
    .from('task_checklist_items')
    .insert({
      task_id: taskId,
      position: step.position ?? 1,
      action: `${MARK} ${step.action}`,
      assigned_to: PEOPLE[step.assignee].id,
      evidence_rule: 'not_required',
      depends_on_item_id: step.dependsOn ?? null,
    })
    .select('id')
    .single();
  if (error) throw new Error(`Could not add the step: ${error.message}`);
  return String(data!.id);
}

describe('v186 — Barrier or support involving me', () => {
  it('switched off, stops the email to the person asked and keeps the notice in the bell', async () => {
    const task = await work('amer');
    await setAlert('izzul', 'barrier_involving_me', false);
    await raiseBarrier('amer', task.id);

    const [quiet] = await told('izzul', { title: 'Decision needed', taskId: task.id });
    expect(quiet).toMatchObject({
      kind: 'barrier_raised',
      requires_action: true,
      ...inTheBellOnly,
    });

    await setAlert('izzul', 'barrier_involving_me', true);
    await raiseBarrier('amer', task.id);
    const notices = await told('izzul', { title: 'Decision needed', taskId: task.id });
    expect(notices).toHaveLength(2);
    expect(notices[1]).toMatchObject(inTheBellAndEmailed);
  });

  it('covers the owner, the reply and the resolution', async () => {
    const task = await work('amer');
    // Izzah owes a step on Amer's work, which is what lets her raise a barrier on it.
    await addStep(serviceClient(), task.id, { action: 'Collect the quotes', assignee: 'izzah' });
    await setAlert('amer', 'barrier_involving_me', false);
    await setAlert('izzah', 'barrier_involving_me', false);

    const barrierId = await raiseBarrier('izzah', task.id);
    expect(await told('amer', { title: 'Barrier raised on your work', taskId: task.id })).toEqual([
      expect.objectContaining({ requires_action: true, ...inTheBellOnly }),
    ]);

    const { data: answered } = await (
      await as('izzul')
    ).rpc('post_barrier_response', {
      p_barrier_id: barrierId,
      p_message: `${MARK}: use the alternative supplier`,
      p_expected_version: null,
      p_kind: 'answer',
      p_idempotency_key: crypto.randomUUID(),
    });
    expect((answered as Rpc).ok).toBe(true);
    expect(await told('izzah', { title: 'Decision received', taskId: task.id })).toEqual([
      expect.objectContaining({ requires_action: true, ...inTheBellOnly }),
    ]);

    const { data: resolved } = await (
      await as('izzul')
    ).rpc('resolve_barrier', {
      p_barrier_id: barrierId,
      p_resolution_note: `${MARK}: the alternative supplier delivered`,
    });
    expect((resolved as Rpc).ok).toBe(true);
    expect(await told('izzah', { title: 'Barrier resolved', taskId: task.id })).toEqual([
      expect.objectContaining(inTheBellOnly),
    ]);
    expect(
      await told('amer', { title: 'Barrier resolved — review your work', taskId: task.id }),
    ).toEqual([expect.objectContaining({ requires_action: true, ...inTheBellOnly })]);
  });

  it('covers a Goal support request and its answer', async () => {
    const admin = serviceClient();
    const { data: goal } = await admin
      .from('goals')
      .select('id,health,version')
      .eq('owner_id', PEOPLE.amer.id)
      .eq('status', 'active')
      .order('created_at', { ascending: true })
      .limit(1)
      .single();
    restoreGoals.push({ id: goal!.id, health: goal!.health, version: goal!.version });
    await setAlert('izzul', 'barrier_involving_me', false);
    await setAlert('amer', 'barrier_involving_me', false);

    const { data: raised } = await (
      await as('amer')
    ).rpc('raise_goal_support_request', {
      p_goal_id: goal!.id,
      p_description: `${MARK}: a cross-team decision is blocking the result`,
      p_support_needed: `${MARK}: confirm which team owns the interface`,
      p_action_required_from: PEOPLE.izzul.id,
      p_idempotency_key: crypto.randomUUID(),
    });
    const request = raised as Rpc & { request_id: string };
    expect(request.ok, request.message).toBe(true);
    createdBarriers.push(request.request_id);
    expect(await told('izzul', { title: 'Support requested', goalId: goal!.id })).toEqual([
      expect.objectContaining({ kind: 'goal_support_requested', ...inTheBellOnly }),
    ]);

    const { data: answered } = await (
      await as('izzul')
    ).rpc('post_barrier_response', {
      p_barrier_id: request.request_id,
      p_message: `${MARK}: Operations owns it`,
      p_expected_version: null,
      p_kind: 'answer',
      p_idempotency_key: crypto.randomUUID(),
    });
    expect((answered as Rpc).ok).toBe(true);
    expect(await told('amer', { title: 'Response received', goalId: goal!.id })).toEqual([
      expect.objectContaining({ requires_action: true, ...inTheBellOnly }),
    ]);
  });

  it('still emails a safety or compliance risk', async () => {
    const task = await work('amer');
    await setAlert('izzul', 'barrier_involving_me', false);
    await raiseBarrier('amer', task.id, { impact: 'safety_or_compliance_risk' });
    expect(await told('izzul', { title: 'Decision needed', taskId: task.id })).toEqual([
      expect.objectContaining(inTheBellAndEmailed),
    ]);
  });

  it('still emails a barrier on mandatory work', async () => {
    const task = await work('amer', MANDATORY);
    await setAlert('izzul', 'barrier_involving_me', false);
    await raiseBarrier('amer', task.id, { impact: 'cannot_continue' });
    expect(await told('izzul', { title: 'Decision needed', taskId: task.id })).toEqual([
      expect.objectContaining(inTheBellAndEmailed),
    ]);
  });
});

describe('v186 — Assignment and reassignment', () => {
  async function assign(title: string) {
    const { data, error } = await (
      await as('izzul')
    ).rpc('assign_work_to_people', {
      p_title: `${MARK} ${title}`,
      p_description: null,
      p_work_class: 'operational_action',
      p_owner_ids: [PEOPLE.amer.id],
      p_idempotency_key: crypto.randomUUID(),
    });
    if (error) throw new Error(`assign_work_to_people failed: ${error.message}`);
    const result = data as Rpc & { task_ids: string[] };
    expect(result.ok, result.message).toBe(true);
    createdTasks.push(...result.task_ids);
    return result.task_ids[0]!;
  }

  it('switched off, stops the email about new work and keeps the notice in the bell', async () => {
    await setAlert('amer', 'assignment_changes', false);
    const quietTask = await assign('Check the pumps');
    expect(await told('amer', { title: 'New work assigned to you', taskId: quietTask })).toEqual([
      expect.objectContaining({
        kind: 'ordinary_assignment',
        requires_action: true,
        ...inTheBellOnly,
      }),
    ]);

    await setAlert('amer', 'assignment_changes', true);
    const loudTask = await assign('Check the valves');
    expect(await told('amer', { title: 'New work assigned to you', taskId: loudTask })).toEqual([
      expect.objectContaining(inTheBellAndEmailed),
    ]);
  });

  it('keeps a step added to that work from sending a notice of its own', async () => {
    // The unread assignment in the bell is what v161 reads to leave the step
    // to it. Dropping the notice would have sent one more per step instead.
    await setAlert('amer', 'assignment_changes', false);
    const taskId = await assign('Service the compressor');
    await addStep(await as('izzul'), taskId, { action: 'Order the filter', assignee: 'amer' });
    expect(await told('amer', { title: 'New step on your work', taskId })).toHaveLength(0);
  });

  it('covers both people in a reassignment', async () => {
    const task = await work('amer');
    await setAlert('amer', 'assignment_changes', false);
    await setAlert('izzah', 'assignment_changes', false);

    const { data } = await (
      await as('izzul')
    ).rpc('reassign_task', {
      p_task_id: task.id,
      p_expected_version: task.version,
      p_new_owner_id: PEOPLE.izzah.id,
      p_idempotency_key: crypto.randomUUID(),
    });
    expect((data as Rpc).ok, (data as Rpc).message).toBe(true);

    expect(await told('izzah', { title: 'Work assigned to you', taskId: task.id })).toEqual([
      expect.objectContaining({ kind: 'reassignment', requires_action: true, ...inTheBellOnly }),
    ]);
    expect(await told('amer', { title: 'Work reassigned', taskId: task.id })).toEqual([
      expect.objectContaining({ kind: 'ownership_changed', ...inTheBellOnly }),
    ]);
  });

  it('still emails a reassignment of mandatory work', async () => {
    const task = await work('amer', MANDATORY);
    await setAlert('izzah', 'assignment_changes', false);
    const { data } = await (
      await as('izzul')
    ).rpc('reassign_task', {
      p_task_id: task.id,
      p_expected_version: task.version,
      p_new_owner_id: PEOPLE.izzah.id,
      p_idempotency_key: crypto.randomUUID(),
    });
    expect((data as Rpc).ok, (data as Rpc).message).toBe(true);
    expect(await told('izzah', { title: 'Work assigned to you', taskId: task.id })).toEqual([
      expect.objectContaining(inTheBellAndEmailed),
    ]);
  });

  it('covers follow-up work from a routine finding, and not an immediate risk', async () => {
    const { data: occurrence } = await serviceClient()
      .from('tasks')
      .select('id')
      .eq('work_class', 'routine_occurrence')
      .eq('primary_owner_id', PEOPLE.izzah.id)
      .is('deleted_at', null)
      .order('created_at', { ascending: true })
      .limit(1)
      .single();
    await setAlert('amer', 'assignment_changes', false);

    async function finding(severity: string) {
      const { data } = await (
        await as('izzah')
      ).rpc('record_routine_finding', {
        p_occurrence_task_id: occurrence!.id,
        p_severity: severity,
        p_description: `${MARK} ${severity}: the guard interlock is intermittent`,
        p_follow_up_owner_id: PEOPLE.amer.id,
      });
      const result = data as Rpc & { created_task_id: string };
      expect(result.ok, result.message).toBe(true);
      createdTasks.push(result.created_task_id);
      return result.created_task_id;
    }

    const followUp = await finding('significant');
    expect(await told('amer', { title: 'Follow-up work created', taskId: followUp })).toEqual([
      expect.objectContaining({ kind: 'ordinary_assignment', ...inTheBellOnly }),
    ]);

    const risk = await finding('immediate_risk');
    expect(await told('amer', { title: 'Immediate risk raised', taskId: risk })).toEqual([
      expect.objectContaining({ kind: 'mandatory_action', ...inTheBellAndEmailed }),
    ]);
  });
});

describe('v186 — Collaborative handoff', () => {
  it('switched off, covers a contribution assigned, handed on and removed', async () => {
    const task = await work('amer');
    const amer = await as('amer');
    await setAlert('izzah', 'collaboration_handoff', false);

    const stepId = await addStep(amer, task.id, { action: 'Measure the room', assignee: 'izzah' });
    expect(await told('izzah', { title: 'New contribution assigned', taskId: task.id })).toEqual([
      expect.objectContaining({
        kind: 'collaboration_handoff',
        requires_action: true,
        ...inTheBellOnly,
      }),
    ]);

    const { data: moved } = await amer.rpc('update_checklist_step', {
      p_item_id: stepId,
      p_action: `${MARK} Measure the room`,
      p_assigned_to: PEOPLE.ajmal.id,
      p_evidence_rule: 'not_required',
      p_due_at: null,
      p_depends_on_item_id: null,
      p_idempotency_key: crypto.randomUUID(),
    });
    expect((moved as Rpc).ok, (moved as Rpc).message).toBe(true);
    expect(await told('izzah', { title: 'Contribution reassigned', taskId: task.id })).toEqual([
      expect.objectContaining(inTheBellOnly),
    ]);
    // Ajmal's switch is on: the same notice reaches his inbox.
    expect(await told('ajmal', { title: 'New contribution assigned', taskId: task.id })).toEqual([
      expect.objectContaining(inTheBellAndEmailed),
    ]);

    await setAlert('ajmal', 'collaboration_handoff', false);
    const { data: removed } = await amer.rpc('remove_checklist_step', {
      p_item_id: stepId,
      p_idempotency_key: crypto.randomUUID(),
    });
    expect((removed as Rpc).ok, (removed as Rpc).message).toBe(true);
    expect(await told('ajmal', { title: 'Contribution removed', taskId: task.id })).toEqual([
      expect.objectContaining(inTheBellOnly),
    ]);
  });

  it('covers a contribution that becomes ready', async () => {
    const task = await work('amer');
    const amer = await as('amer');
    const first = await addStep(amer, task.id, { action: 'Isolate the line', assignee: 'amer' });
    await setAlert('izzah', 'collaboration_handoff', false);
    await addStep(amer, task.id, {
      action: 'Replace the bearing',
      assignee: 'izzah',
      dependsOn: first,
      position: 2,
    });

    const { data } = await amer.rpc('complete_checklist_item', {
      p_item_id: first,
      p_completion_note: null,
      p_idempotency_key: crypto.randomUUID(),
    });
    expect((data as Rpc).ok, (data as Rpc).message).toBe(true);

    expect(await told('izzah', { title: 'Your contribution is ready', taskId: task.id })).toEqual([
      expect.objectContaining({ requires_action: true, ...inTheBellOnly }),
    ]);
    expect(await told('izzah', { title: 'Your step is ready', taskId: task.id })).toEqual([
      expect.objectContaining({ requires_action: true, ...inTheBellOnly }),
    ]);
  });

  it('covers a step somebody else puts on your own work', async () => {
    const task = await work('amer');
    await setAlert('amer', 'collaboration_handoff', false);
    await addStep(await as('izzul'), task.id, { action: 'Sign the permit', assignee: 'amer' });
    expect(await told('amer', { title: 'New step on your work', taskId: task.id })).toEqual([
      expect.objectContaining({ requires_action: true, ...inTheBellOnly }),
    ]);
  });

  it('still emails a contribution on mandatory work', async () => {
    const task = await work('amer', MANDATORY);
    await setAlert('izzah', 'collaboration_handoff', false);
    await addStep(await as('amer'), task.id, { action: 'Witness the test', assignee: 'izzah' });
    expect(await told('izzah', { title: 'New contribution assigned', taskId: task.id })).toEqual([
      expect.objectContaining(inTheBellAndEmailed),
    ]);
  });
});

describe('v186 — Due-today and selection deadlines never silence mandatory work', () => {
  it('tells the owner mandatory work is overdue, and only that', async () => {
    await setAlert('amer', 'due_today_and_deadlines', false);
    const ordinary = await work('amer', { due_at: endOfDay(-2) });
    const mandatory = await work('amer', { due_at: endOfDay(-2), ...MANDATORY });

    const { data, error } = await serviceClient().rpc('notify_overdue_work', {
      p_task_ids: [ordinary.id, mandatory.id],
    });
    if (error) throw new Error(`notify_overdue_work failed: ${error.message}`);
    expect(data).toMatchObject({ ok: true, notified: 1, work: 2 });

    expect(await told('amer', { title: 'Work overdue', taskId: mandatory.id })).toEqual([
      expect.objectContaining(inTheBellAndEmailed),
    ]);
    const { count } = await serviceClient()
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('recipient_id', PEOPLE.amer.id)
      .eq('kind', 'work_overdue')
      .like('body', `%${MARK}%`);
    expect(count).toBe(1);
  });

  it('tells the assignee a step on mandatory work is overdue', async () => {
    await setAlert('izzah', 'due_today_and_deadlines', false);
    const task = await work('amer', MANDATORY);
    await serviceClient()
      .from('task_checklist_items')
      .insert({
        task_id: task.id,
        position: 1,
        action: `${MARK} Witness the test`,
        assigned_to: PEOPLE.izzah.id,
        evidence_rule: 'not_required',
        due_at: endOfDay(-2),
      });
    const { data } = await serviceClient().rpc('notify_overdue_contributions', {
      p_task_ids: [task.id],
    });
    expect(data).toMatchObject({ ok: true, notified: 1 });
    expect(await told('izzah', { title: 'Contribution overdue', taskId: task.id })).toEqual([
      expect.objectContaining(inTheBellAndEmailed),
    ]);
  });

  it('tells the manager a mandatory due date was pushed back', async () => {
    await setAlert('izzul', 'due_today_and_deadlines', false);
    const task = await work('amer', { due_at: endOfDay(1), ...MANDATORY });
    const { data } = await (
      await as('amer')
    ).rpc('change_task_due_date', {
      p_task_id: task.id,
      p_expected_version: task.version,
      p_new_due_at: endOfDay(5),
      p_due_is_date_only: true,
      p_reason: null,
      p_idempotency_key: crypto.randomUUID(),
    });
    expect((data as Rpc).ok, (data as Rpc).message).toBe(true);
    const notices = await serviceClient()
      .from('notifications')
      .select('id')
      .eq('recipient_id', PEOPLE.izzul.id)
      .eq('kind', 'due_date_changed')
      .eq('task_id', task.id);
    expect(notices.data).toHaveLength(1);
  });
});
