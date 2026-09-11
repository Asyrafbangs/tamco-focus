import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, describe, expect, it } from 'vitest';

import { createTask, PEOPLE, serviceClient, signInAs } from './setup';

/**
 * v153 — what the Monthly Plan needs in order to move a due date, and the
 * contract it relies on when it does.
 *
 * The calendar offers a drag only where `plan_events.can_reschedule` says the
 * viewer may make the change, and quotes `task_version` back so that a stale
 * grid is refused rather than obeyed. Neither column is the control:
 * `change_task_due_date` decides again on every call. So the assertions that
 * matter most here are the ones that ask the column and the procedure the same
 * question and require the same answer — a calendar that offered a drag the
 * server refused would be a broken control, and one that hid a drag the server
 * would allow would be a missing one.
 */

type Rpc = Record<string, unknown> & {
  ok: boolean;
  code?: string;
  message?: string;
  version?: number;
};

interface PlanRow {
  task_id: string;
  event_kind: string;
  occurs_at: string;
  task_version: number | null;
  can_reschedule: boolean;
}

const createdTasks: string[] = [];
const createdTemplates: string[] = [];

/**
 * The last instant of a Kuala Lumpur day `days` from now, which is how the
 * application stores a date-only commitment. UTC+8 has no daylight saving.
 */
function endOfDayFromNow(days: number): string {
  const at = new Date();
  at.setUTCDate(at.getUTCDate() + days);
  at.setUTCHours(15, 59, 59, 999);
  return at.toISOString();
}

async function planRows(client: SupabaseClient, taskId: string): Promise<PlanRow[]> {
  const { data, error } = await client
    .from('plan_events')
    .select('task_id,event_kind,occurs_at,task_version,can_reschedule')
    .eq('task_id', taskId);
  if (error) throw new Error(`Could not read the calendar: ${error.message}`);
  return (data ?? []) as PlanRow[];
}

function dueRow(rows: PlanRow[]): PlanRow | undefined {
  return rows.find((row) => row.event_kind === 'due' || row.event_kind === 'overdue');
}

async function datedTask(overrides: Record<string, unknown> = {}) {
  const task = await createTask('izzah', {
    status: 'active',
    due_at: endOfDayFromNow(4),
    due_is_date_only: true,
    ...overrides,
  });
  createdTasks.push(task.id);
  return task;
}

function moveDue(client: SupabaseClient, taskId: string, version: number | null, dueAt: string) {
  return client.rpc('change_task_due_date', {
    p_task_id: taskId,
    p_expected_version: version,
    p_new_due_at: dueAt,
    p_due_is_date_only: true,
    p_reason: null,
    p_idempotency_key: null,
  });
}

/**
 * Deleted where possible, binned where history forbids it.
 *
 * `setup.deleteTask` ignores its result, and a task with audit events cannot
 * be deleted at all — `audit_events_no_delete` stops the cascade — so the
 * contract test's fixture used to stay behind as active work for every file
 * after this one.
 */
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
  const admin = serviceClient();
  while (createdTasks.length) await removeTask(createdTasks.pop()!);
  while (createdTemplates.length) {
    await admin.from('routine_templates').delete().eq('id', createdTemplates.pop()!);
  }
});

describe('v153 — who the calendar offers a move to', () => {
  it('offers the owner their own due date, with the version to quote', async () => {
    const task = await datedTask();
    const izzah = await signInAs('izzah');

    const row = dueRow(await planRows(izzah, task.id));
    expect(row, 'the owner could not see her own due date').toBeDefined();
    expect(row!.can_reschedule).toBe(true);
    expect(row!.task_version).toBe(task.version);
  });

  it('offers the owner’s manager the same date', async () => {
    /*
     * The drawer lets a manager correct a report's due date; the calendar
     * must not be stricter than the drawer, or a manager looking at the Team
     * calendar would find the dates they are responsible for frozen.
     */
    const task = await datedTask();
    const manager = await signInAs('izzul');

    const row = dueRow(await planRows(manager, task.id));
    expect(row, 'the manager could not see the report’s due date').toBeDefined();
    expect(row!.can_reschedule).toBe(true);
  });

  it('does not offer a colleague who can see the work but not edit it — and the procedure agrees', async () => {
    /*
     * Section 3.4 keeps seeing separate from editing, and shared work is where
     * the two part: a collaborator is committed to the date, so the date
     * reaches their calendar, but it is not theirs to move.
     */
    const task = await datedTask();
    const { error } = await serviceClient()
      .from('task_collaborators')
      .insert({ task_id: task.id, user_id: PEOPLE.lim.id, added_by: PEOPLE.izzah.id });
    if (error) throw new Error(`Could not share the work: ${error.message}`);

    const lim = await signInAs('lim');
    const row = dueRow(await planRows(lim, task.id));
    expect(row, 'a collaborator could not see the shared date at all').toBeDefined();
    expect(row!.can_reschedule, 'the calendar offered a move it cannot make').toBe(false);

    // Asked the same question, the procedure gives the same answer.
    const refused = (await moveDue(lim, task.id, row!.task_version, endOfDayFromNow(9)))
      .data as Rpc;
    expect(refused.ok).toBe(false);
    expect(refused.code).toBe('not_authorised');
  });

  it('offers nothing on closed work, routine occurrences or review deadlines', async () => {
    const izzah = await signInAs('izzah');

    // Completed work is off the calendar altogether (v162): nothing to move.
    const completed = await datedTask({
      status: 'completed',
      completed_at: new Date().toISOString(),
      completed_owner_id: PEOPLE.izzah.id,
      completed_by: PEOPLE.izzah.id,
    });
    expect(
      dueRow(await planRows(izzah, completed.id)),
      'completed work is still on the calendar',
    ).toBeUndefined();

    // A routine occurrence follows its template's schedule.
    const { data: template, error: templateError } = await serviceClient()
      .from('routine_templates')
      .insert({
        title: `Calendar template ${crypto.randomUUID().slice(0, 8)}`,
        default_owner_id: PEOPLE.izzah.id,
        created_by: PEOPLE.izzah.id,
        frequency: 'weekly',
        interval_count: 1,
        weekday: 1,
      })
      .select('id')
      .single();
    if (templateError) throw new Error(`Could not create a template: ${templateError.message}`);
    createdTemplates.push(String(template!.id));

    const occurrence = await datedTask({
      work_class: 'routine_occurrence',
      focus_bucket: null,
      routine_template_id: template!.id,
      occurrence_date: endOfDayFromNow(4).slice(0, 10),
    });
    const routineRows = await planRows(izzah, occurrence.id);
    expect(routineRows.map((row) => row.event_kind)).toContain('routine');
    expect(routineRows.every((row) => row.can_reschedule === false)).toBe(true);

    // A review deadline belongs to the review.
    const reviewed = await createTask('izzah', {
      status: 'active',
      review_at: endOfDayFromNow(3),
    });
    createdTasks.push(reviewed.id);
    const reviewRows = await planRows(izzah, reviewed.id);
    expect(reviewRows.map((row) => row.event_kind)).toEqual(['review']);
    expect(reviewRows[0]!.can_reschedule).toBe(false);
  });
});

describe('v153 — the contract a drop relies on', () => {
  it('moves the date on a current version, refuses a stale one, and moves back', async () => {
    const original = endOfDayFromNow(4);
    const moved = endOfDayFromNow(11);
    const task = await datedTask({ due_at: original });
    const izzah = await signInAs('izzah');

    const before = dueRow(await planRows(izzah, task.id))!;

    // The drop: the version the calendar was drawn with.
    const drop = (await moveDue(izzah, task.id, before.task_version, moved)).data as Rpc;
    expect(drop.ok, `the drop was refused: ${drop.message}`).toBe(true);

    const after = dueRow(await planRows(izzah, task.id))!;
    expect(new Date(after.occurs_at).getTime()).toBe(new Date(moved).getTime());
    expect(after.task_version).toBe(before.task_version! + 1);

    /*
     * A second drop from the same, now-stale grid. This is the tab left open
     * since this morning, and the reason the calendar quotes a version at all:
     * without it the older view would silently win.
     */
    const stale = (await moveDue(izzah, task.id, before.task_version, endOfDayFromNow(13)))
      .data as Rpc;
    expect(stale.ok).toBe(false);
    expect(stale.code).toBe('version_conflict');

    // Undo: a change back, quoting the version the move produced.
    const back = (await moveDue(izzah, task.id, drop.version ?? null, original)).data as Rpc;
    expect(back.ok, `Undo was refused: ${back.message}`).toBe(true);

    /*
     * And the history says what happened — moved, then moved back — rather
     * than nothing. An undo that erased the first event would leave a manager
     * unable to see that a deadline was ever touched.
     */
    const { data: events, error } = await serviceClient()
      .from('audit_events')
      .select('event_type,detail,occurred_at')
      .eq('task_id', task.id)
      .eq('event_type', 'task_due_date_changed')
      .order('occurred_at', { ascending: true });
    if (error) throw new Error(`Could not read the history: ${error.message}`);
    expect(events).toHaveLength(2);

    const [first, second] = events as Array<{ detail: Record<string, string> }>;
    expect(new Date(first!.detail.previous_due_at!).getTime()).toBe(new Date(original).getTime());
    expect(new Date(first!.detail.new_due_at!).getTime()).toBe(new Date(moved).getTime());
    expect(new Date(second!.detail.new_due_at!).getTime()).toBe(new Date(original).getTime());
  });
});
