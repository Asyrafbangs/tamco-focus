import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, describe, expect, it } from 'vitest';

import { createTask, PEOPLE, serviceClient, signInAs } from './setup';

/**
 * v156 — Trackable Steps, stage 3: the calendar's rows know about steps.
 *
 * `plan_events` gains one row per open step handed to anybody but its task's
 * owner, dated by its own date or else the task's, and the task's own row
 * counts the steps due that same day. Which rows a person is shown is the
 * page's decision; which rows they may read at all is RLS's, through the
 * security_invoker view — and that is what is asserted here.
 */

const ZONE = 'Asia/Kuala_Lumpur';
const createdTasks: string[] = [];

function endOfDay(days: number): string {
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: ZONE }).format(
    new Date(Date.now() + days * 86_400_000),
  );
  return new Date(`${date}T23:59:59.999+08:00`).toISOString();
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

interface Row {
  task_id: string;
  event_kind: string;
  occurs_at: string;
  step_id: string | null;
  assignee_id: string | null;
  assignee_name: string | null;
  parent_title: string | null;
  parent_due_at: string | null;
  step_has_own_date: boolean | null;
  steps_due_with_task: number;
}

async function rows(client: SupabaseClient, taskId: string): Promise<Row[]> {
  const { data, error } = await client
    .from('plan_events')
    .select(
      'task_id,event_kind,occurs_at,step_id,assignee_id,assignee_name,parent_title,parent_due_at,step_has_own_date,steps_due_with_task',
    )
    .eq('task_id', taskId);
  if (error) throw new Error(`Could not read the calendar: ${error.message}`);
  return (data ?? []) as Row[];
}

/**
 * Izzah's planning work, due in ten days: Amer's input needed back in three,
 * Amer's review simply due with the task, Amer's sign-off given the task's own
 * day, and a step of Izzah's own, which is no delegation at all.
 */
async function planning(izzah: SupabaseClient) {
  const title = `3 Years Planning ${crypto.randomUUID().slice(0, 6)}`;
  const task = await createTask('izzah', {
    title,
    status: 'active',
    due_at: endOfDay(10),
    due_is_date_only: true,
  });
  createdTasks.push(task.id);

  const { data, error } = await izzah
    .from('task_checklist_items')
    .insert([
      {
        task_id: task.id,
        position: 1,
        action: 'Give department input',
        assigned_to: PEOPLE.amer.id,
        due_at: endOfDay(3),
      },
      {
        task_id: task.id,
        position: 2,
        action: 'Review final proposal',
        assigned_to: PEOPLE.amer.id,
      },
      {
        task_id: task.id,
        position: 3,
        action: 'Sign off',
        assigned_to: PEOPLE.amer.id,
        due_at: endOfDay(10),
      },
      { task_id: task.id, position: 4, action: 'Prepare structure', assigned_to: PEOPLE.izzah.id },
    ])
    .select('id,action');
  if (error) throw new Error(`Could not add the steps: ${error.message}`);
  return { task, title, steps: data! };
}

describe('v156 — steps on the calendar', () => {
  it('gives Amer a row for every step he owes, dated by its own date or else the task’s', async () => {
    const izzah = await signInAs('izzah');
    const { task, title } = await planning(izzah);

    const amer = await signInAs('amer');
    const stepRows = (await rows(amer, task.id)).filter((row) => row.event_kind === 'step');

    // Three are Amer's; Izzah's own step is no delegation and has no row.
    expect(stepRows).toHaveLength(3);
    for (const row of stepRows) {
      expect(row.assignee_id).toBe(PEOPLE.amer.id);
      expect(row.assignee_name).toBe('Amer Hakim');
      expect(row.parent_title).toBe(title);
      expect(new Date(String(row.parent_due_at)).getTime()).toBe(new Date(endOfDay(10)).getTime());
    }

    // Its own date where it has one; the task's where it does not.
    const own = stepRows.filter((row) => row.step_has_own_date);
    const inherited = stepRows.filter((row) => !row.step_has_own_date);
    expect(own).toHaveLength(2);
    expect(inherited).toHaveLength(1);
    expect(new Date(inherited[0]!.occurs_at).getTime()).toBe(new Date(endOfDay(10)).getTime());
  });

  it('counts, on the task’s own row, the steps due that same day', async () => {
    const izzah = await signInAs('izzah');
    const { task } = await planning(izzah);

    const due = (await rows(izzah, task.id)).find((row) => row.event_kind === 'due');
    expect(due, 'the task lost its own row').toBeDefined();
    /*
     * The review (inheriting), the sign-off (given the task's own day) and
     * Izzah's own step (inheriting) are all due on the tenth. Amer's input,
     * due on the third, is not — it gets a square of its own when shown.
     */
    expect(due!.steps_due_with_task).toBe(3);
  });

  it('shows nobody outside the work a step row, and drops a step once it is done', async () => {
    const izzah = await signInAs('izzah');
    const { task, steps } = await planning(izzah);

    const lim = await signInAs('lim');
    expect((await rows(lim, task.id)).filter((row) => row.event_kind === 'step')).toHaveLength(0);

    const amer = await signInAs('amer');
    const input = steps.find((step) => step.action === 'Give department input')!;
    const { data } = await amer.rpc('complete_checklist_item', {
      p_item_id: input.id,
      p_completion_note: null,
      p_idempotency_key: null,
    });
    expect((data as { ok: boolean }).ok).toBe(true);

    const remaining = (await rows(amer, task.id)).filter((row) => row.event_kind === 'step');
    expect(remaining.map((row) => row.step_id)).not.toContain(input.id);
    expect(remaining).toHaveLength(2);
  });
});
