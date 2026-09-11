import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, describe, expect, it } from 'vitest';

import { createTask, PEOPLE, serviceClient, signInAs } from './setup';

/**
 * v159 — the owner's own steps, which the calendar and the card missed.
 *
 * A step Izzah gave herself, or left unassigned, with a date of its own had no
 * row on the calendar and no count on her work, while one she handed to Amer
 * had both. These pin the two reads that close that gap.
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

interface StepRow {
  title: string;
  event_kind: string;
  step_id: string | null;
  assignee_id: string | null;
  assignee_name: string | null;
  step_has_own_date: boolean | null;
}

async function stepRows(client: SupabaseClient, taskId: string): Promise<StepRow[]> {
  const { data, error } = await client
    .from('plan_events')
    .select('title,event_kind,step_id,assignee_id,assignee_name,step_has_own_date')
    .eq('task_id', taskId)
    .eq('event_kind', 'step');
  if (error) throw new Error(`Could not read the calendar: ${error.message}`);
  return (data ?? []) as StepRow[];
}

/**
 * Izzah's work, due in ten days: a step she gave herself due in three, one she
 * left unassigned that was due yesterday, one of hers with no date of its own,
 * and one she handed to Amer that is two days late.
 */
async function planning(izzah: SupabaseClient) {
  const task = await createTask('izzah', {
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
        action: 'Prepare structure',
        assigned_to: PEOPLE.izzah.id,
        due_at: endOfDay(3),
      },
      { task_id: task.id, position: 2, action: 'Draft outline', due_at: endOfDay(-1) },
      { task_id: task.id, position: 3, action: 'Final check', assigned_to: PEOPLE.izzah.id },
      {
        task_id: task.id,
        position: 4,
        action: 'Give department input',
        assigned_to: PEOPLE.amer.id,
        due_at: endOfDay(-2),
      },
    ])
    .select('id,action');
  if (error) throw new Error(`Could not add the steps: ${error.message}`);
  return { task, steps: data! };
}

describe('v159 — the owner’s own steps', () => {
  it('gives Izzah a calendar row for each of her own dated steps, naming her', async () => {
    const izzah = await signInAs('izzah');
    const { task } = await planning(izzah);

    const rows = await stepRows(izzah, task.id);
    const byTitle = new Map(rows.map((row) => [row.title, row]));

    // Assigned to herself, and unassigned: both hers, both named as hers.
    for (const title of ['Prepare structure', 'Draft outline']) {
      const row = byTitle.get(title);
      expect(row, `${title} has no row`).toBeDefined();
      expect(row!.assignee_id).toBe(PEOPLE.izzah.id);
      expect(row!.assignee_name).toBe('Izzah Nurul');
      expect(row!.step_has_own_date).toBe(true);
    }
    // No date of its own: due with the work, counted on its row, not drawn.
    expect(byTitle.has('Final check')).toBe(false);
    // Delegation is as it was.
    expect(byTitle.get('Give department input')?.assignee_id).toBe(PEOPLE.amer.id);
    expect(rows).toHaveLength(3);
  });

  it('counts her own late steps on the work, apart from the delegated ones', async () => {
    const izzah = await signInAs('izzah');
    const { task } = await planning(izzah);

    const { data, error } = await izzah
      .from('task_overview')
      .select('own_step_overdue_count,next_own_step_due_at,delegated_overdue_count,is_overdue')
      .eq('id', task.id)
      .single();
    if (error) throw new Error(`Could not read the work: ${error.message}`);

    expect(data!.own_step_overdue_count).toBe(1);
    expect(data!.delegated_overdue_count).toBe(1);
    expect(data!.is_overdue).toBe(false);
    // The earliest own date among her open steps, late or not.
    expect(new Date(String(data!.next_own_step_due_at)).getTime()).toBe(
      new Date(endOfDay(-1)).getTime(),
    );
  });

  it('drops a step she has done from both', async () => {
    const izzah = await signInAs('izzah');
    const { task, steps } = await planning(izzah);
    const outline = steps.find((step) => step.action === 'Draft outline')!;

    const { data: done } = await izzah.rpc('complete_checklist_item', {
      p_item_id: outline.id,
      p_completion_note: null,
      p_idempotency_key: null,
    });
    expect((done as { ok: boolean }).ok).toBe(true);

    const { data } = await izzah
      .from('task_overview')
      .select('own_step_overdue_count')
      .eq('id', task.id)
      .single();
    expect(data!.own_step_overdue_count).toBe(0);
    expect((await stepRows(izzah, task.id)).map((row) => row.title)).not.toContain('Draft outline');
  });

  it('still gives nobody outside the work a step row', async () => {
    const izzah = await signInAs('izzah');
    const { task } = await planning(izzah);

    const lim = await signInAs('lim');
    expect(await stepRows(lim, task.id)).toHaveLength(0);
  });
});
