import { afterEach, describe, expect, it } from 'vitest';

import { createTask, PEOPLE, serviceClient, signInAs, type PersonKey } from './setup';

/**
 * v158 — Trackable Steps, stage 5: who is told what about a step.
 *
 * Assigned, the assignee is told, with the date. Overdue, the assignee is told
 * once per day it was due. Completed, the owner is told quietly — in the bell,
 * never by email. Small edits tell nobody.
 *
 * The overdue procedure is run narrowed to each test's own work, so seeded
 * people's bells are left as the rest of the suite expects them.
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

/** Izzah's work, due in ten days, with one step she hands to Amer. */
async function workWithAmersStep(due: number | null, status: 'active' | 'backlog' = 'active') {
  const task = await createTask('izzah', {
    status,
    due_at: endOfDay(10),
    due_is_date_only: true,
  });
  createdTasks.push(task.id);

  const izzah = await signInAs('izzah');
  const { data, error } = await izzah
    .from('task_checklist_items')
    .insert({
      task_id: task.id,
      position: 1,
      action: 'Give department input',
      assigned_to: PEOPLE.amer.id,
      evidence_rule: 'not_required',
      due_at: due === null ? null : endOfDay(due),
    })
    .select('id')
    .single();
  if (error) throw new Error(`Could not add the step: ${error.message}`);
  return { taskId: task.id, stepId: String(data!.id), izzah };
}

async function notices(recipient: PersonKey, taskId: string, title: string) {
  const { data, error } = await serviceClient()
    .from('notifications')
    .select('id,body,channel,requires_action,quiet,entity_type,entity_id')
    .eq('recipient_id', PEOPLE[recipient].id)
    .eq('task_id', taskId)
    .eq('title', title);
  if (error) throw new Error(`Could not read notifications: ${error.message}`);
  return data ?? [];
}

async function noticeCount(taskId: string) {
  const { count, error } = await serviceClient()
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('task_id', taskId);
  if (error) throw new Error(`Could not count notifications: ${error.message}`);
  return count ?? 0;
}

describe('v158 — assigned: the assignee is told, with the date', () => {
  it('says when a step with its own date is due', async () => {
    const { taskId } = await workWithAmersStep(3);
    const notice = (await notices('amer', taskId, 'New contribution assigned'))[0]!;
    expect(notice.body).toContain(`Due ${shortLabel(3)}.`);
  });

  it('gives a step with no date of its own its work’s date', async () => {
    const { taskId } = await workWithAmersStep(null);
    const notice = (await notices('amer', taskId, 'New contribution assigned'))[0]!;
    expect(notice.body).toContain(`Due ${shortLabel(10)}.`);
  });
});

describe('v158 — small edits are silent', () => {
  it('tells nobody when a step’s wording or date changes', async () => {
    const { taskId, stepId, izzah } = await workWithAmersStep(3);
    const before = await noticeCount(taskId);

    const { data: edited, error } = await izzah.rpc('update_checklist_step', {
      p_item_id: stepId,
      p_action: 'Give department input, with costs',
      p_assigned_to: PEOPLE.amer.id,
      p_evidence_rule: 'not_required',
      p_due_at: endOfDay(5),
      p_depends_on_item_id: null,
    });
    if (error) throw new Error(`Could not edit the step: ${error.message}`);
    expect((edited as { ok: boolean }).ok).toBe(true);

    expect(await noticeCount(taskId)).toBe(before);
  });
});

describe('v158 — completed: the owner is told quietly', () => {
  it('puts it in her bell, opening her work at the step, and sends no email', async () => {
    const { taskId, stepId } = await workWithAmersStep(3);

    const amer = await signInAs('amer');
    const { data: done } = await amer.rpc('complete_checklist_item', {
      p_item_id: stepId,
      p_completion_note: null,
      p_idempotency_key: null,
    });
    expect((done as { ok: boolean }).ok).toBe(true);

    const told = await notices('izzah', taskId, 'Contribution completed');
    expect(told).toHaveLength(1);
    const notice = told[0]!;
    expect(notice.body).toContain('Give department input');
    expect(notice.body).toContain('Completed by Amer Hakim.');
    expect(notice.quiet).toBe(true);
    expect(notice.requires_action).toBe(false);
    expect(notice.entity_type).toBe('task_step');
    expect(notice.entity_id).toBe(stepId);

    const { data: deliveries } = await serviceClient()
      .from('notification_email_deliveries')
      .select('id')
      .eq('notification_id', notice.id);
    expect(deliveries ?? []).toHaveLength(0);
  });
});

describe('v158 — overdue: the assignee is told, once per date', () => {
  it('tells Amer once, tells Izzah nothing, and tells Amer again for a new date', async () => {
    const { taskId, stepId } = await workWithAmersStep(-1);
    const admin = serviceClient();

    const first = await admin.rpc('notify_overdue_contributions', { p_task_ids: [taskId] });
    if (first.error) throw new Error(`The overdue run failed: ${first.error.message}`);
    expect((first.data as { notified: number }).notified).toBe(1);

    // The schedule may run twice in a day; the second run adds nothing.
    const again = await admin.rpc('notify_overdue_contributions', { p_task_ids: [taskId] });
    expect((again.data as { notified: number }).notified).toBe(0);

    const told = await notices('amer', taskId, 'Contribution overdue');
    expect(told).toHaveLength(1);
    const notice = told[0]!;
    expect(notice.body).toContain(`It was due ${shortLabel(-1)}.`);
    expect(notice.requires_action).toBe(true);
    expect(notice.quiet).toBe(false);
    expect(notice.entity_type).toBe('checklist_item');
    expect(notice.entity_id).toBe(stepId);

    // The owner is not sent a notice: Needs attention carries it (v155).
    expect(await notices('izzah', taskId, 'Contribution overdue')).toHaveLength(0);

    // Given another date and missed again, it is told again.
    const { error: moved } = await admin
      .from('task_checklist_items')
      .update({ due_at: endOfDay(-2) })
      .eq('id', stepId);
    if (moved) throw new Error(`Could not move the step: ${moved.message}`);
    const third = await admin.rpc('notify_overdue_contributions', { p_task_ids: [taskId] });
    expect((third.data as { notified: number }).notified).toBe(1);
  });

  it('leaves alone a step on work that has not started', async () => {
    const { taskId } = await workWithAmersStep(-1, 'backlog');
    const run = await serviceClient().rpc('notify_overdue_contributions', {
      p_task_ids: [taskId],
    });
    if (run.error) throw new Error(`The overdue run failed: ${run.error.message}`);
    expect((run.data as { notified: number }).notified).toBe(0);
  });

  it('cannot be run by a person', async () => {
    const amer = await signInAs('amer');
    const { error } = await amer.rpc('notify_overdue_contributions', { p_task_ids: [] });
    expect(error).not.toBeNull();
  });
});
