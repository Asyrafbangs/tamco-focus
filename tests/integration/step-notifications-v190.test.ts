import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, describe, expect, it } from 'vitest';

import { createTask, PEOPLE, serviceClient, signInAs, type PersonKey } from './setup';

/**
 * v190 — Step notifications (Product Owner, 15 September 2026).
 *
 *   assigned          the assignee                   unchanged
 *   reassigned        the old and new assignee       unchanged
 *   due tomorrow      the assignee, bell and email   new
 *   overdue           the assignee and the owner     the owner is new
 *   completed         the owner, quietly             unchanged; evidence adds nothing
 *   reopened          the assignee, straight away    new
 *   due date changed  the assignee, for a new day    new
 *
 * Nobody is told about their own act, nobody is told twice, and My Alerts is
 * honoured as v186 set it. Scheduled procedures run narrowed to each test's own
 * work, so the seeded people's bells stay as the rest of the suite expects.
 */

type Rpc = { ok: boolean; code: string; message?: string };

const ZONE = 'Asia/Kuala_Lumpur';
const MARK = 'SN fixture';
const EVERYONE: PersonKey[] = ['amer', 'izzul', 'izzah', 'ajmal', 'lim'];

const createdTasks: string[] = [];
const createdFiles: string[] = [];
const clients = new Map<PersonKey, SupabaseClient>();

async function as(person: PersonKey) {
  const held = clients.get(person);
  if (held) return held;
  const client = await signInAs(person);
  clients.set(person, client);
  return client;
}

function localDate(days: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: ZONE }).format(
    new Date(Date.now() + days * 86_400_000),
  );
}

function endOfDay(days: number): string {
  return new Date(`${localDate(days)}T23:59:59.999+08:00`).toISOString();
}

/** How the database writes a date: "16 Sep". */
function shortLabel(days: number): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: ZONE,
    day: 'numeric',
    month: 'short',
  }).formatToParts(new Date(Date.now() + days * 86_400_000));
  const read = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${read('day')} ${read('month')}`;
}

async function removeTask(taskId: string) {
  const admin = serviceClient();
  await admin.from('notifications').delete().eq('task_id', taskId);
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
  if (createdFiles.length) {
    await admin.storage.from('task-attachments').remove(createdFiles.splice(0));
  }
  while (createdTasks.length) await removeTask(createdTasks.pop()!);
  await admin.from('notifications').delete().like('body', `%${MARK}%`);
  await admin
    .from('user_alert_preferences')
    .update({ collaboration_handoff: true, due_today_and_deadlines: true })
    .in(
      'user_id',
      EVERYONE.map((person) => PEOPLE[person].id),
    );
});

async function work(
  owner: PersonKey,
  days: number | null,
  overrides: Record<string, unknown> = {},
): Promise<{ id: string; title: string }> {
  const title = `${MARK} ${crypto.randomUUID().slice(0, 6)}`;
  const task = await createTask(owner, {
    status: 'active',
    title,
    due_at: days === null ? null : endOfDay(days),
    due_is_date_only: true,
    ...overrides,
  });
  createdTasks.push(task.id);
  return { id: task.id, title };
}

let position = 0;

async function step(
  taskId: string,
  options: {
    action?: string;
    assignee: PersonKey | null;
    due: number | null;
    state?: 'ready' | 'completed';
    evidence?: 'not_required' | 'required';
  },
): Promise<{ id: string; action: string }> {
  position += 1;
  const action = options.action ?? `Step ${crypto.randomUUID().slice(0, 4)}`;
  const { data, error } = await serviceClient()
    .from('task_checklist_items')
    .insert({
      task_id: taskId,
      position,
      action,
      assigned_to: options.assignee ? PEOPLE[options.assignee].id : null,
      evidence_rule: options.evidence ?? 'not_required',
      due_at: options.due === null ? null : endOfDay(options.due),
      ...(options.state === 'completed'
        ? {
            state: 'completed',
            completed_at: new Date().toISOString(),
            completed_by: PEOPLE[options.assignee ?? 'izzah'].id,
          }
        : {}),
    })
    .select('id')
    .single();
  if (error) throw new Error(`Could not add the step: ${error.message}`);
  return { id: String(data!.id), action };
}

type Notice = {
  id: string;
  kind: string;
  title: string;
  body: string;
  channel: string;
  requires_action: boolean;
  quiet: boolean;
  entity_type: string | null;
  entity_id: string | null;
  read_at: string | null;
  emailed: boolean;
};

/** What the person was told about the work, with whether an email was queued. */
async function told(recipient: PersonKey, taskId: string, title?: string): Promise<Notice[]> {
  const admin = serviceClient();
  let query = admin
    .from('notifications')
    .select('id,kind,title,body,channel,requires_action,quiet,entity_type,entity_id,read_at')
    .eq('recipient_id', PEOPLE[recipient].id)
    .eq('task_id', taskId)
    .order('created_at', { ascending: true });
  if (title) query = query.eq('title', title);
  const { data, error } = await query;
  if (error) throw new Error(`Could not read notifications: ${error.message}`);
  const rows = data ?? [];
  if (rows.length === 0) return [];
  const { data: deliveries } = await admin
    .from('notification_email_deliveries')
    .select('notification_id')
    .in(
      'notification_id',
      rows.map((row) => row.id),
    );
  const emailed = new Set((deliveries ?? []).map((row) => String(row.notification_id)));
  return rows.map((row) => ({ ...(row as Omit<Notice, 'emailed'>), emailed: emailed.has(row.id) }));
}

/** Everything written since `since`, for "nothing else was sent". */
async function everythingAbout(taskId: string, since: string) {
  const { data, error } = await serviceClient()
    .from('notifications')
    .select('recipient_id,title')
    .eq('task_id', taskId)
    .gt('created_at', since);
  if (error) throw new Error(`Could not read notifications: ${error.message}`);
  return data ?? [];
}

async function setAlert(
  person: PersonKey,
  alert: 'collaboration_handoff' | 'due_today_and_deadlines',
  on: boolean,
) {
  const { error } = await serviceClient()
    .from('user_alert_preferences')
    .update({ [alert]: on })
    .eq('user_id', PEOPLE[person].id);
  if (error) throw new Error(`Could not set ${alert}: ${error.message}`);
}

async function dueTomorrow(...ids: string[]) {
  const { data, error } = await serviceClient().rpc('notify_steps_due_tomorrow', {
    p_task_ids: ids,
  });
  if (error) throw new Error(`notify_steps_due_tomorrow failed: ${error.message}`);
  return data as { ok: boolean; notified: number };
}

async function overdue(...ids: string[]) {
  const { data, error } = await serviceClient().rpc('notify_overdue_contributions', {
    p_task_ids: ids,
  });
  if (error) throw new Error(`notify_overdue_contributions failed: ${error.message}`);
  return data as { ok: boolean; notified: number; owners: number };
}

async function editStep(
  person: PersonKey,
  stepId: string,
  changes: { action?: string; assignee?: PersonKey; dueAt?: string | null },
) {
  const { data: current } = await serviceClient()
    .from('task_checklist_items')
    .select('action,assigned_to,evidence_rule,due_at,depends_on_item_id')
    .eq('id', stepId)
    .single();
  const { data, error } = await (
    await as(person)
  ).rpc('update_checklist_step', {
    p_item_id: stepId,
    p_action: changes.action ?? current!.action,
    p_assigned_to: changes.assignee ? PEOPLE[changes.assignee].id : current!.assigned_to,
    p_evidence_rule: current!.evidence_rule,
    p_due_at: changes.dueAt === undefined ? current!.due_at : changes.dueAt,
    p_depends_on_item_id: current!.depends_on_item_id,
  });
  if (error) throw new Error(`update_checklist_step failed: ${error.message}`);
  expect((data as Rpc).ok, (data as Rpc).message).toBe(true);
}

async function moveWork(person: PersonKey, taskId: string, days: number) {
  const { data: task } = await serviceClient()
    .from('tasks')
    .select('version')
    .eq('id', taskId)
    .single();
  const { data, error } = await (
    await as(person)
  ).rpc('change_task_due_date', {
    p_task_id: taskId,
    p_expected_version: task!.version,
    p_new_due_at: endOfDay(days),
    p_due_is_date_only: true,
    p_reason: null,
    p_idempotency_key: crypto.randomUUID(),
  });
  if (error) throw new Error(`change_task_due_date failed: ${error.message}`);
  expect((data as Rpc).ok, (data as Rpc).message).toBe(true);
}

async function reopen(person: PersonKey, stepId: string, reason: string | null = null) {
  const { data, error } = await (
    await as(person)
  ).rpc('reopen_checklist_item', { p_item_id: stepId, p_reason: reason });
  if (error) throw new Error(`reopen_checklist_item failed: ${error.message}`);
  expect((data as Rpc).ok, (data as Rpc).message).toBe(true);
}

const MANDATORY = {
  is_mandatory: true,
  mandatory_justification: `${MARK}: statutory inspection`,
};

describe('v190 — due tomorrow: the assignee is reminded, once, by bell and email', () => {
  it('names the step, the work and the date, and a second run adds nothing', async () => {
    const task = await work('izzah', 10);
    const owed = await step(task.id, { action: 'Collect training data', assignee: 'amer', due: 1 });

    expect(await dueTomorrow(task.id)).toEqual({ ok: true, notified: 1 });
    expect(await dueTomorrow(task.id)).toEqual({ ok: true, notified: 0 });

    const [notice, ...rest] = await told('amer', task.id, 'Contribution due tomorrow');
    expect(rest).toHaveLength(0);
    expect(notice).toMatchObject({
      kind: 'due_soon',
      channel: 'immediate',
      requires_action: false,
      quiet: false,
      emailed: true,
      entity_type: 'checklist_item',
      entity_id: owed.id,
    });
    expect(notice!.body).toBe(
      `Collect training data · Part of "${task.title}". It is due tomorrow, ${shortLabel(1)}.`,
    );
    // The owner hears nothing: the step is on her My Day.
    expect(await told('izzah', task.id, 'Contribution due tomorrow')).toHaveLength(0);
  });

  it('reminds a step that is due with its work, and only steps due tomorrow', async () => {
    const withWork = await work('izzah', 1);
    await step(withWork.id, { assignee: 'amer', due: null });

    const other = await work('izzah', 10);
    await step(other.id, { assignee: 'amer', due: 0 });
    await step(other.id, { assignee: 'amer', due: 2 });
    await step(other.id, { assignee: 'amer', due: 1, state: 'completed' });
    await step(other.id, { assignee: 'izzah', due: 1 });
    await step(other.id, { assignee: null, due: 1 });

    const waiting = await work('izzah', 10, { status: 'backlog' });
    await step(waiting.id, { assignee: 'amer', due: 1 });

    expect(await dueTomorrow(withWork.id)).toEqual({ ok: true, notified: 1 });
    expect(await dueTomorrow(other.id, waiting.id)).toEqual({ ok: true, notified: 0 });
  });

  it('is once per due date: a new time that day is not a new reminder, a new day is', async () => {
    const task = await work('izzah', 10);
    const owed = await step(task.id, { assignee: 'amer', due: 1 });
    expect((await dueTomorrow(task.id)).notified).toBe(1);

    await serviceClient()
      .from('task_checklist_items')
      .update({ due_at: new Date(`${localDate(1)}T12:00:00+08:00`).toISOString() })
      .eq('id', owed.id);
    expect((await dueTomorrow(task.id)).notified).toBe(0);

    // A reminder sent for the date it had before does not stand in for this one.
    const admin = serviceClient();
    await admin.from('notifications').delete().eq('task_id', task.id).eq('kind', 'due_soon');
    const { error } = await admin.from('notifications').insert({
      recipient_id: PEOPLE.amer.id,
      kind: 'due_soon',
      channel: 'immediate',
      requires_action: false,
      title: 'Contribution due tomorrow',
      body: `${MARK} an earlier date`,
      task_id: task.id,
      entity_type: 'checklist_item',
      entity_id: owed.id,
      dedupe_key: `step_due_tomorrow:${owed.id}:${localDate(-4)}`,
      quiet: true,
    });
    if (error) throw new Error(`Could not seed the earlier reminder: ${error.message}`);
    expect((await dueTomorrow(task.id)).notified).toBe(1);
  });

  it('honours the deadline alert, except on mandatory work', async () => {
    await setAlert('amer', 'due_today_and_deadlines', false);
    const ordinary = await work('izzah', 10);
    await step(ordinary.id, { assignee: 'amer', due: 1 });
    const mandatory = await work('izzah', 10, MANDATORY);
    await step(mandatory.id, { assignee: 'amer', due: 1 });

    expect(await dueTomorrow(ordinary.id, mandatory.id)).toEqual({ ok: true, notified: 1 });
    expect(await told('amer', mandatory.id, 'Contribution due tomorrow')).toHaveLength(1);
  });

  it('cannot be run by a person', async () => {
    const { error } = await (await as('amer')).rpc('notify_steps_due_tomorrow', { p_task_ids: [] });
    expect(error).not.toBeNull();
  });
});

describe('v190 — overdue: the owner is told as well', () => {
  it('tells the assignee and the owner once each, and a second run adds nothing', async () => {
    const task = await work('izzah', 10);
    const owed = await step(task.id, {
      action: 'Give department input',
      assignee: 'amer',
      due: -2,
    });

    expect(await overdue(task.id)).toEqual({ ok: true, notified: 1, owners: 1 });
    expect(await overdue(task.id)).toEqual({ ok: true, notified: 0, owners: 0 });

    expect(await told('amer', task.id, 'Contribution overdue')).toHaveLength(1);
    const [notice, ...rest] = await told('izzah', task.id, 'Contribution overdue on your work');
    expect(rest).toHaveLength(0);
    expect(notice).toMatchObject({
      channel: 'immediate',
      requires_action: false,
      quiet: false,
      emailed: true,
      entity_type: 'task_step',
      entity_id: owed.id,
    });
    expect(notice!.body).toBe(
      `Give department input · Waiting on Amer Hakim. Part of "${task.title}". It was due ${shortLabel(-2)}.`,
    );
  });

  it('leaves a step due with its work to v185’s “Work overdue”', async () => {
    const task = await work('izzah', -2);
    await step(task.id, { assignee: 'amer', due: null });
    expect(await overdue(task.id)).toEqual({ ok: true, notified: 1, owners: 0 });
  });

  it('tells an owner who is also the assignees’ manager as the owner only, once per step', async () => {
    const task = await work('izzul', 10);
    await step(task.id, { assignee: 'amer', due: -1 });
    await step(task.id, { assignee: 'izzah', due: -1 });
    await overdue(task.id);

    const titles = (await told('izzul', task.id)).map((notice) => notice.title);
    expect(titles.filter((title) => title === 'Contribution overdue on your work')).toHaveLength(2);
    expect(titles.filter((title) => title === 'Contribution overdue')).toHaveLength(0);
  });

  it('honours the owner’s deadline alert without silencing the assignee', async () => {
    await setAlert('izzah', 'due_today_and_deadlines', false);
    const task = await work('izzah', 10);
    await step(task.id, { assignee: 'amer', due: -1 });
    expect(await overdue(task.id)).toEqual({ ok: true, notified: 1, owners: 0 });
  });

  it('answers both notices when the step is completed', async () => {
    const task = await work('izzah', 10);
    const owed = await step(task.id, { assignee: 'amer', due: -1 });
    await overdue(task.id);

    const { data } = await (
      await as('amer')
    ).rpc('complete_checklist_item', {
      p_item_id: owed.id,
      p_completion_note: null,
      p_idempotency_key: null,
    });
    expect((data as Rpc).ok).toBe(true);

    const [assignee] = await told('amer', task.id, 'Contribution overdue');
    const [owner] = await told('izzah', task.id, 'Contribution overdue on your work');
    expect(assignee!.read_at).not.toBeNull();
    expect(owner!.read_at).not.toBeNull();
  });

  it('answers both notices when the step is given a date ahead', async () => {
    const task = await work('izzah', 10);
    const owed = await step(task.id, { assignee: 'amer', due: -1 });
    await overdue(task.id);
    await editStep('izzah', owed.id, { dueAt: endOfDay(4) });

    expect((await told('amer', task.id, 'Contribution overdue'))[0]!.read_at).not.toBeNull();
    expect(
      (await told('izzah', task.id, 'Contribution overdue on your work'))[0]!.read_at,
    ).not.toBeNull();
  });
});

describe('v190 — completed: the owner is told quietly, and evidence adds nothing', () => {
  it('sends one quiet notice when a step is completed with evidence', async () => {
    const task = await work('izzah', 10);
    const owed = await step(task.id, { assignee: 'amer', due: 3, evidence: 'required' });
    const since = new Date().toISOString();

    const amer = await as('amer');
    const attachmentId = crypto.randomUUID();
    const path = `tasks/${task.id}/${attachmentId}-inspection.txt`;
    const body = new Blob(['Inspection passed'], { type: 'text/plain' });
    const { error: uploadError } = await amer.storage
      .from('task-attachments')
      .upload(path, body, { contentType: 'text/plain', upsert: false });
    expect(uploadError).toBeNull();
    createdFiles.push(path);

    const { data } = await amer.rpc('complete_checklist_item_with_evidence', {
      p_item_id: owed.id,
      p_attachments: [
        {
          id: attachmentId,
          storage_path: path,
          file_name: 'inspection.txt',
          mime_type: 'text/plain',
          byte_size: body.size,
          is_evidence: true,
        },
      ],
      p_completion_note: 'Passed.',
      p_idempotency_key: crypto.randomUUID(),
    });
    expect((data as Rpc).ok, (data as Rpc).message).toBe(true);

    expect(await everythingAbout(task.id, since)).toEqual([
      { recipient_id: PEOPLE.izzah.id, title: 'Contribution completed' },
    ]);
    const [notice] = await told('izzah', task.id, 'Contribution completed');
    expect(notice).toMatchObject({ quiet: true, emailed: false });
  });
});

describe('v190 — reopened: whoever owes the step is told straight away', () => {
  it('tells the assignee when the owner reopens it, with the reason, by email', async () => {
    const task = await work('izzah', 10);
    const owed = await step(task.id, {
      action: 'Witness the test',
      assignee: 'amer',
      due: 3,
      state: 'completed',
    });
    await reopen('izzah', owed.id, 'The photo is of the wrong panel.');

    const [notice, ...rest] = await told('amer', task.id, 'Contribution reopened');
    expect(rest).toHaveLength(0);
    expect(notice).toMatchObject({
      kind: 'collaboration_handoff',
      channel: 'immediate',
      requires_action: true,
      quiet: false,
      emailed: true,
      entity_type: 'checklist_item',
      entity_id: owed.id,
    });
    expect(notice!.body).toBe(
      `Witness the test · Part of "${task.title}". Reopened by Izzah Nurul. Reason: "The photo is of the wrong panel".`,
    );
  });

  it('tells nobody when the assignee reopens their own step', async () => {
    const task = await work('izzah', 10);
    const owed = await step(task.id, { assignee: 'amer', due: 3, state: 'completed' });
    const since = new Date().toISOString();
    await reopen('amer', owed.id);
    expect(await everythingAbout(task.id, since)).toEqual([]);
  });

  it('tells the owner when their manager reopens a step of their own', async () => {
    const task = await work('izzah', 10);
    const own = await step(task.id, { assignee: null, due: 3, state: 'completed' });
    await reopen('izzul', own.id);
    expect(await told('izzah', task.id, 'Step reopened')).toEqual([
      expect.objectContaining({ entity_type: 'task_step', entity_id: own.id, emailed: true }),
    ]);
  });

  it('keeps it in the bell only when Collaborative handoff is off', async () => {
    await setAlert('amer', 'collaboration_handoff', false);
    const task = await work('izzah', 10);
    const owed = await step(task.id, { assignee: 'amer', due: 3, state: 'completed' });
    await reopen('izzah', owed.id);
    expect(await told('amer', task.id, 'Contribution reopened')).toEqual([
      expect.objectContaining({ quiet: true, emailed: false }),
    ]);
  });
});

describe('v190 — a step’s due date changed: the assignee is told', () => {
  it('when the day moves, saying from and to; not for wording or the time of day', async () => {
    const task = await work('izzah', 10);
    const owed = await step(task.id, { action: 'Review the quote', assignee: 'amer', due: 3 });

    await editStep('izzah', owed.id, { action: 'Review the revised quote' });
    await editStep('izzah', owed.id, {
      dueAt: new Date(`${localDate(3)}T12:00:00+08:00`).toISOString(),
    });
    expect(await told('amer', task.id, 'Contribution due date changed')).toHaveLength(0);

    await editStep('izzah', owed.id, { dueAt: endOfDay(6) });
    const [notice, ...rest] = await told('amer', task.id, 'Contribution due date changed');
    expect(rest).toHaveLength(0);
    expect(notice).toMatchObject({
      kind: 'due_date_changed',
      requires_action: false,
      quiet: false,
      emailed: true,
      entity_type: 'checklist_item',
      entity_id: owed.id,
    });
    expect(notice!.body).toBe(
      `Review the revised quote · Part of "${task.title}". Izzah Nurul moved it from ${shortLabel(3)} to ${shortLabel(6)}.`,
    );

    // Its own date removed: it is due with the work now.
    await editStep('izzah', owed.id, { dueAt: null });
    const notices = await told('amer', task.id, 'Contribution due date changed');
    expect(notices.at(-1)!.body).toContain(`from ${shortLabel(6)} to ${shortLabel(10)}.`);
  });

  it('says nothing more than the assignment when the step is reassigned with a new date', async () => {
    const task = await work('izzah', 10);
    const owed = await step(task.id, { assignee: 'amer', due: 3 });
    const since = new Date().toISOString();
    await editStep('izzah', owed.id, { assignee: 'lim', dueAt: endOfDay(5) });

    const titles = (await everythingAbout(task.id, since)).map((row) => row.title).sort();
    expect(titles).toEqual(['Contribution reassigned', 'New contribution assigned']);
  });

  it('tells the owner when their manager moves a step of their own', async () => {
    const task = await work('izzah', 10);
    const own = await step(task.id, { assignee: 'izzah', due: 3 });
    await editStep('izzul', own.id, { dueAt: endOfDay(5) });
    expect(await told('izzah', task.id, 'Step due date changed')).toEqual([
      expect.objectContaining({ entity_type: 'task_step', entity_id: own.id }),
    ]);
    // And the owner moving her own step tells nobody.
    const since = new Date().toISOString();
    await editStep('izzah', own.id, { dueAt: endOfDay(7) });
    expect(await everythingAbout(task.id, since)).toEqual([]);
  });

  it('honours the deadline alert, except on mandatory work', async () => {
    await setAlert('amer', 'due_today_and_deadlines', false);
    const ordinary = await work('izzah', 10);
    const first = await step(ordinary.id, { assignee: 'amer', due: 3 });
    const mandatory = await work('izzah', 10, MANDATORY);
    const second = await step(mandatory.id, { assignee: 'amer', due: 3 });

    await editStep('izzah', first.id, { dueAt: endOfDay(5) });
    await editStep('izzah', second.id, { dueAt: endOfDay(5) });
    expect(await told('amer', ordinary.id, 'Contribution due date changed')).toHaveLength(0);
    expect(await told('amer', mandatory.id, 'Contribution due date changed')).toHaveLength(1);
  });
});

describe('v190 — the work’s date moved: steps due with it are told', () => {
  it('tells each person once, leaves dated steps alone, and does not repeat v185', async () => {
    const task = await work('izzah', 5);
    await step(task.id, { action: 'Collect data', assignee: 'amer', due: null });
    await step(task.id, { action: 'Check the form', assignee: 'amer', due: null });
    await step(task.id, { assignee: 'lim', due: 3 });
    // Izzul is Izzah's manager, and owes a step.
    await step(task.id, { assignee: 'izzul', due: null });

    // Pushed later: Izzul hears as her manager (v185), not again for his step.
    await moveWork('izzah', task.id, 8);
    const [amer, ...more] = await told('amer', task.id, 'Contribution due date changed');
    expect(more).toHaveLength(0);
    expect(amer!.body).toBe(
      `Collect data; Check the form · Part of "${task.title}". Izzah Nurul moved the work from ${shortLabel(5)} to ${shortLabel(8)}, and your steps with it.`,
    );
    expect(amer).toMatchObject({ quiet: false, emailed: true, entity_type: 'checklist_item' });
    expect(await told('lim', task.id, 'Contribution due date changed')).toHaveLength(0);
    expect(await told('izzul', task.id, `Due date moved: ${task.title}`)).toHaveLength(1);
    expect(await told('izzul', task.id, 'Contribution due date changed')).toHaveLength(0);

    // Brought earlier: v185 tells nobody, so Izzul hears for his step.
    await moveWork('izzah', task.id, 6);
    expect(await told('amer', task.id, 'Contribution due date changed')).toHaveLength(2);
    expect(await told('izzul', task.id, 'Contribution due date changed')).toEqual([
      expect.objectContaining({
        body: expect.stringContaining(`from ${shortLabel(8)} to ${shortLabel(6)}, and your step`),
      }),
    ]);
  });

  it('answers the overdue notice of a step due with the work when the work moves ahead', async () => {
    const task = await work('izzah', -2);
    await step(task.id, { assignee: 'amer', due: null });
    await overdue(task.id);
    expect((await told('amer', task.id, 'Contribution overdue'))[0]!.read_at).toBeNull();

    await moveWork('izzah', task.id, 3);
    expect((await told('amer', task.id, 'Contribution overdue'))[0]!.read_at).not.toBeNull();
  });
});
