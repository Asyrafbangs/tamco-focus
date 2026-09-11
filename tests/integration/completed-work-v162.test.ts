import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, describe, expect, it } from 'vitest';

import { createTask, PEOPLE, serviceClient, signInAs, type PersonKey } from './setup';

/**
 * v162 — completed work leaves the calendar, and whoever assigned it is told.
 *
 * The calendar kept every task that was not cancelled, so a finished month
 * read like an unfinished one. It can let finished work go because finishing
 * it is announced: work that needs a completion review tells its reviewer
 * ("Completion review needed"), and now work that does not — a quick action,
 * by default — tells whoever assigned it, quietly.
 */

const createdTasks: string[] = [];

/** The last instant of a Kuala Lumpur day `days` from now. */
function endOfDayFromNow(days: number): string {
  const at = new Date();
  at.setUTCDate(at.getUTCDate() + days);
  at.setUTCHours(15, 59, 59, 999);
  return at.toISOString();
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

/** Izzah's work, due in four days. */
async function work(overrides: Record<string, unknown> = {}) {
  const task = await createTask('izzah', {
    status: 'active',
    due_at: endOfDayFromNow(4),
    due_is_date_only: true,
    ...overrides,
  });
  createdTasks.push(task.id);
  return task;
}

/** A quick action: by default the one kind of work that needs no completion review. */
const quickAction = { work_class: 'quick_action', focus_bucket: null };

async function complete(client: SupabaseClient, task: { id: string; version: number }) {
  const { data, error } = await client.rpc('complete_task', {
    p_task_id: task.id,
    p_expected_version: task.version,
    p_completion_note: null,
    p_idempotency_key: null,
  });
  if (error) throw new Error(`Could not complete the work: ${error.message}`);
  const result = data as { ok: boolean; code?: string; message?: string };
  expect(result.ok, result.message).toBe(true);
  return result.code;
}

async function calendarKinds(client: SupabaseClient, taskId: string) {
  const { data, error } = await client
    .from('plan_events')
    .select('event_kind')
    .eq('task_id', taskId);
  if (error) throw new Error(`Could not read the calendar: ${error.message}`);
  return (data ?? []).map((row) => String(row.event_kind));
}

async function notices(recipient: PersonKey, taskId: string, title: string) {
  const { data, error } = await serviceClient()
    .from('notifications')
    .select('id,body,quiet,requires_action,entity_type,entity_id')
    .eq('recipient_id', PEOPLE[recipient].id)
    .eq('task_id', taskId)
    .eq('title', title);
  if (error) throw new Error(`Could not read notifications: ${error.message}`);
  return data ?? [];
}

describe('v162 — completed work leaves the calendar', () => {
  it('drops a task from the calendar once it is completed', async () => {
    const izzah = await signInAs('izzah');
    const task = await work();
    expect(await calendarKinds(izzah, task.id)).toContain('due');

    await complete(izzah, task);

    expect(await calendarKinds(izzah, task.id)).toHaveLength(0);
  });
});

describe('v162 — whoever assigned the work is told it is done', () => {
  it('tells Izzul, quietly, when Izzah completes a quick action he assigned her', async () => {
    const task = await work({ ...quickAction, assigned_by: PEOPLE.izzul.id });
    const izzah = await signInAs('izzah');

    expect(await complete(izzah, task)).toBe('completed');

    const told = await notices('izzul', task.id, 'Work completed');
    expect(told).toHaveLength(1);
    const notice = told[0]!;
    expect(notice.body).toContain('Completed by Izzah Nurul.');
    expect(notice.quiet).toBe(true);
    expect(notice.requires_action).toBe(false);
    expect(notice.entity_type).toBe('task');
    expect(notice.entity_id).toBe(task.id);

    // The bell, not the inbox.
    const { data: deliveries } = await serviceClient()
      .from('notification_email_deliveries')
      .select('id')
      .eq('notification_id', notice.id);
    expect(deliveries ?? []).toHaveLength(0);
  });

  it('leaves it to the review when he is the one asked to review it', async () => {
    // Operational work needs a completion review, and Izzul is Izzah's manager.
    const task = await work({ assigned_by: PEOPLE.izzul.id });
    const izzah = await signInAs('izzah');

    expect(await complete(izzah, task)).toBe('completed_pending_review');

    expect(await notices('izzul', task.id, 'Completion review needed')).toHaveLength(1);
    expect(await notices('izzul', task.id, 'Work completed')).toHaveLength(0);
  });

  it('tells nobody when Izzul completes it himself', async () => {
    const task = await work({ ...quickAction, assigned_by: PEOPLE.izzul.id });
    const izzul = await signInAs('izzul');

    await complete(izzul, task);

    expect(await notices('izzul', task.id, 'Work completed')).toHaveLength(0);
  });

  it('tells nobody about work nobody assigned', async () => {
    const task = await work(quickAction);
    const izzah = await signInAs('izzah');

    await complete(izzah, task);

    const { count, error } = await serviceClient()
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('task_id', task.id)
      .eq('title', 'Work completed');
    if (error) throw new Error(`Could not count notifications: ${error.message}`);
    expect(count ?? 0).toBe(0);
  });
});
