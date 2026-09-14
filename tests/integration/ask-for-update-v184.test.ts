import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, describe, expect, it } from 'vitest';

import { createTask, PEOPLE, serviceClient, signInAs, type PersonKey } from './setup';

/**
 * v184 — Ask for an update, on the work or on one of its steps.
 *
 * Anybody who can see the work may ask: Izzul as Amer's manager, Amer through
 * the visibility grant he holds over Izzah, Izzah about the step she handed to
 * Amer. Who is asked is the owner, or the step's assignee. They are notified
 * and emailed; a written update from them answers, and so does completing the
 * step, and the person who asked is told. One ask per person per day, and
 * closed, binned or reassigned work settles what is still open.
 */

type Rpc = { ok: boolean; code: string; message?: string; detail?: Record<string, unknown> };
type Target = { checklist_item_id: string | null; requested_of: string; again_at: string | null };
type Open = {
  id: string;
  checklist_item_id: string | null;
  requested_by: string;
  requested_of: string;
  answerer: string;
};

const createdTasks: string[] = [];
const clients = new Map<PersonKey, SupabaseClient>();

async function as(person: PersonKey) {
  const held = clients.get(person);
  if (held) return held;
  const client = await signInAs(person);
  clients.set(person, client);
  return client;
}

/** Deleted where possible; binned where history forbids it (see v153). */
async function removeTask(taskId: string) {
  const admin = serviceClient();
  const { error } = await admin.from('tasks').delete().eq('id', taskId);
  if (!error) return;
  const { error: binError } = await admin
    .from('tasks')
    .update({ deleted_at: new Date().toISOString(), deleted_by: PEOPLE.admin.id })
    .eq('id', taskId);
  if (binError) throw new Error(`Could not remove fixture ${taskId}: ${binError.message}`);
  // Binned work keeps its notifications; the seeded bells should not.
  await admin.from('notifications').delete().eq('task_id', taskId);
}

afterEach(async () => {
  while (createdTasks.length) await removeTask(createdTasks.pop()!);
});

async function workOf(person: PersonKey, overrides: Record<string, unknown> = {}) {
  const task = await createTask(person, {
    status: 'active',
    title: `Monthly ESH report ${crypto.randomUUID().slice(0, 6)}`,
    ...overrides,
  });
  createdTasks.push(task.id);
  return task;
}

/** A step on the work, handed to `assignee` (or nobody). */
async function stepOn(
  taskId: string,
  assignee: PersonKey | null,
  action = 'Give department input',
) {
  const admin = serviceClient();
  const { count } = await admin
    .from('task_checklist_items')
    .select('id', { count: 'exact', head: true })
    .eq('task_id', taskId);
  const { data, error } = await admin
    .from('task_checklist_items')
    .insert({
      task_id: taskId,
      position: (count ?? 0) + 1,
      action,
      assigned_to: assignee ? PEOPLE[assignee].id : null,
      evidence_rule: 'not_required',
    })
    .select('id')
    .single();
  if (error) throw new Error(`Could not add the step: ${error.message}`);
  return String(data!.id);
}

async function ask(
  person: PersonKey,
  taskId: string,
  options: { step?: string; message?: string } = {},
) {
  const { data, error } = await (
    await as(person)
  ).rpc('request_task_update', {
    p_task_id: taskId,
    p_checklist_item_id: options.step ?? null,
    p_message: options.message ?? null,
    p_idempotency_key: crypto.randomUUID(),
  });
  if (error) throw new Error(`request_task_update failed: ${error.message}`);
  return data as Rpc & { request_id?: string; times_asked?: number; recipient_name?: string };
}

async function postUpdate(person: PersonKey, taskId: string, body: string) {
  const { data, error } = await (
    await as(person)
  ).rpc('post_task_update', {
    p_task_id: taskId,
    p_body: body,
    p_idempotency_key: crypto.randomUUID(),
  });
  if (error) throw new Error(`post_task_update failed: ${error.message}`);
  return data as Rpc & { update_id: string };
}

async function requests(taskId: string) {
  const { data, error } = await serviceClient()
    .from('task_update_requests')
    .select('*')
    .eq('task_id', taskId)
    .order('requested_at', { ascending: true });
  if (error) throw new Error(`Could not read requests: ${error.message}`);
  return data ?? [];
}

async function notices(taskId: string, recipient: PersonKey) {
  const { data, error } = await serviceClient()
    .from('notifications')
    .select('id,kind,title,body,requires_action,read_at,entity_type,entity_id,quiet,channel')
    .eq('task_id', taskId)
    .eq('recipient_id', PEOPLE[recipient].id)
    .in('kind', ['update_requested', 'update_request_answered'])
    .order('created_at', { ascending: true });
  if (error) throw new Error(`Could not read notifications: ${error.message}`);
  return data ?? [];
}

async function readModel(person: PersonKey, taskId: string) {
  const { data, error } = await (
    await as(person)
  ).rpc('get_task_update_requests', { p_task_id: taskId });
  if (error) throw new Error(`get_task_update_requests failed: ${error.message}`);
  return data as { open: Open[]; targets: Target[] };
}

async function workTarget(person: PersonKey, taskId: string) {
  return (await readModel(person, taskId)).targets.find(
    (target) => target.checklist_item_id === null,
  );
}

describe('v184 — asking about the work', () => {
  it('notifies and emails the owner, with the note, and records it on the work', async () => {
    const task = await workOf('amer');
    const result = await ask('izzul', task.id, { message: 'Has the contractor confirmed Friday?' });
    expect(result).toMatchObject({ ok: true, code: 'update_requested', times_asked: 1 });
    expect(result.recipient_name).toBe('Amer Hakim');

    const [request] = await requests(task.id);
    expect(request).toMatchObject({
      checklist_item_id: null,
      requested_by: PEOPLE.izzul.id,
      requested_of: PEOPLE.amer.id,
      message: 'Has the contractor confirmed Friday?',
      resolved_at: null,
    });

    const [notice] = await notices(task.id, 'amer');
    expect(notice).toMatchObject({
      kind: 'update_requested',
      requires_action: true,
      channel: 'immediate',
      quiet: false,
      entity_type: 'task_update_request',
      entity_id: task.id,
      read_at: null,
    });
    expect(notice!.title).toMatch(/^Update requested: Monthly ESH report/);
    expect(notice!.body).toBe(
      'Izzul Asyraf asked you for an update: "Has the contractor confirmed Friday?"',
    );

    const admin = serviceClient();
    const { data: deliveries } = await admin
      .from('notification_email_deliveries')
      .select('recipient_email')
      .eq('notification_id', notice!.id);
    expect(deliveries).toEqual([expect.objectContaining({ recipient_email: 'amer@tamco.local' })]);

    const { data: audit } = await admin
      .from('audit_events')
      .select('actor_id,subject_user_id')
      .eq('task_id', task.id)
      .eq('event_type', 'update_requested');
    expect(audit).toEqual([{ actor_id: PEOPLE.izzul.id, subject_user_id: PEOPLE.amer.id }]);
  });

  it('says so plainly when there is no note', async () => {
    const task = await workOf('amer');
    expect((await ask('izzul', task.id, { message: '   ' })).ok).toBe(true);
    const [notice] = await notices(task.id, 'amer');
    expect(notice!.body).toBe('Izzul Asyraf asked you for an update on this work.');
    expect((await requests(task.id))[0]!.message).toBeNull();
  });

  it('lets somebody holding a visibility grant ask, not only a manager', async () => {
    const task = await workOf('izzah');
    expect(await ask('amer', task.id)).toMatchObject({ ok: true, code: 'update_requested' });
    expect(await notices(task.id, 'izzah')).toHaveLength(1);
  });

  it('refuses the owner, somebody who cannot see the work, and closed or quick work', async () => {
    const task = await workOf('amer');
    expect(await ask('amer', task.id)).toMatchObject({ ok: false, code: 'own_work' });
    expect(await ask('lim', task.id)).toMatchObject({ ok: false, code: 'not_found' });

    const quick = await workOf('amer', { work_class: 'quick_action', focus_bucket: null });
    expect(await ask('izzul', quick.id)).toMatchObject({ ok: false, code: 'invalid_state' });

    const cancelled = await workOf('amer', {
      status: 'cancelled',
      cancelled_at: new Date().toISOString(),
    });
    expect(await ask('izzul', cancelled.id)).toMatchObject({ ok: false, code: 'invalid_state' });

    expect(await requests(task.id)).toHaveLength(0);
    expect(await notices(task.id, 'amer')).toHaveLength(0);

    // And the read the drawer decides from agrees with every refusal.
    expect(await workTarget('amer', task.id)).toBeUndefined();
    expect(await readModel('lim', task.id)).toEqual({ open: [], targets: [] });
    expect((await readModel('izzul', quick.id)).targets).toEqual([]);
    expect((await readModel('izzul', cancelled.id)).targets).toEqual([]);
    expect(await workTarget('izzul', task.id)).toEqual({
      checklist_item_id: null,
      requested_of: PEOPLE.amer.id,
      again_at: null,
    });
  });

  it('refuses a note longer than 1,000 characters', async () => {
    const task = await workOf('amer');
    expect(await ask('izzul', task.id, { message: 'x'.repeat(1001) })).toMatchObject({
      ok: false,
      code: 'validation_failed',
    });
  });

  it('cannot be written to directly, and is read only by people who see the work', async () => {
    const task = await workOf('amer');
    const { error } = await (await as('izzul')).from('task_update_requests').insert({
      task_id: task.id,
      requested_by: PEOPLE.izzul.id,
      requested_of: PEOPLE.amer.id,
    });
    expect(error).not.toBeNull();
    expect(await requests(task.id)).toHaveLength(0);

    await ask('izzul', task.id);
    const read = async (person: PersonKey) =>
      (await (await as(person)).from('task_update_requests').select('id').eq('task_id', task.id))
        .data ?? [];
    expect(await read('amer')).toHaveLength(1);
    expect(await read('izzul')).toHaveLength(1);
    expect(await read('lim')).toHaveLength(0);
  });
});

describe('v184 — asking about a step', () => {
  it('asks the step’s assignee, not the owner, and opens them at the step', async () => {
    const task = await workOf('izzah');
    const step = await stepOn(task.id, 'amer');

    const result = await ask('izzah', task.id, { step, message: 'Are the costs in?' });
    expect(result).toMatchObject({ ok: true, recipient_name: 'Amer Hakim' });
    expect((await requests(task.id))[0]).toMatchObject({
      checklist_item_id: step,
      requested_of: PEOPLE.amer.id,
    });

    const [notice] = await notices(task.id, 'amer');
    expect(notice).toMatchObject({
      kind: 'update_requested',
      entity_type: 'step_update_request',
      entity_id: step,
      title: 'Update requested: Give department input',
    });
    expect(notice!.body).toMatch(
      /^Izzah Nurul asked you for an update on this step of Monthly ESH report \w+: "Are the costs in\?"$/,
    );
    expect(await notices(task.id, 'izzah')).toHaveLength(0);
  });

  it('asks the owner about a step nobody else holds, and never the assignee themselves', async () => {
    const task = await workOf('amer');
    const unassigned = await stepOn(task.id, null, 'Book the crane');
    const amersOwn = await stepOn(task.id, 'amer', 'Call the contractor');
    const izzulsStep = await stepOn(task.id, 'izzul', 'Approve the budget');

    expect(await ask('izzul', task.id, { step: unassigned })).toMatchObject({
      ok: true,
      recipient_name: 'Amer Hakim',
    });
    expect(await ask('izzul', task.id, { step: izzulsStep })).toMatchObject({
      ok: false,
      code: 'own_work',
      message: 'This step is yours. Add an update instead.',
    });
    expect(await ask('amer', task.id, { step: amersOwn })).toMatchObject({
      ok: false,
      code: 'own_work',
    });

    const targets = (await readModel('izzul', task.id)).targets;
    expect(targets.map((target) => target.checklist_item_id).sort()).toEqual(
      [null, unassigned, amersOwn].sort(),
    );
  });

  it('refuses a completed step, or a step from other work', async () => {
    const task = await workOf('izzah');
    const done = await stepOn(task.id, 'amer');
    await serviceClient()
      .from('task_checklist_items')
      .update({
        state: 'completed',
        completed_by: PEOPLE.amer.id,
        completed_at: new Date().toISOString(),
      })
      .eq('id', done);
    expect(await ask('izzah', task.id, { step: done })).toMatchObject({
      ok: false,
      code: 'invalid_state',
      message: 'This step is already complete.',
    });

    const other = await workOf('izzah');
    const elsewhere = await stepOn(other.id, 'amer');
    expect(await ask('izzah', task.id, { step: elsewhere })).toMatchObject({
      ok: false,
      code: 'not_found',
    });
  });

  it('keeps a request about the work apart from one about its step', async () => {
    const task = await workOf('amer');
    const step = await stepOn(task.id, null);
    expect((await ask('izzul', task.id)).ok).toBe(true);
    expect((await ask('izzul', task.id, { step })).ok).toBe(true);
    expect(await requests(task.id)).toHaveLength(2);
  });

  it('completing the step answers it, and tells the person who asked with the note', async () => {
    const task = await workOf('izzah');
    const step = await stepOn(task.id, 'amer');
    await ask('izzah', task.id, { step });
    await ask('izzul', task.id, { step });

    const { data: done } = await (
      await as('amer')
    ).rpc('complete_checklist_item', {
      p_item_id: step,
      p_completion_note: 'Costs attached to the report.',
      p_idempotency_key: null,
    });
    expect((done as Rpc).ok).toBe(true);

    const all = await requests(task.id);
    expect(all.every((row) => row.resolution === 'step_completed')).toBe(true);
    expect((await notices(task.id, 'amer')).every((row) => row.read_at !== null)).toBe(true);

    for (const asker of ['izzah', 'izzul'] as const) {
      const reply = (await notices(task.id, asker)).find(
        (row) => row.kind === 'update_request_answered',
      );
      expect(reply).toMatchObject({
        title: 'Step completed: Give department input',
        entity_type: 'task_step',
        entity_id: step,
        quiet: false,
      });
      expect(reply!.body).toMatch(/: "Costs attached to the report\."$/);
    }
  });

  it('a written update from the assignee answers it', async () => {
    const task = await workOf('izzah');
    const step = await stepOn(task.id, 'amer');
    await ask('izzah', task.id, { step });
    const posted = await postUpdate('amer', task.id, 'Waiting on two cost centres.');
    expect(posted.ok).toBe(true);
    expect((await requests(task.id))[0]).toMatchObject({
      resolution: 'update_posted',
      update_id: posted.update_id,
    });
    const [reply] = await notices(task.id, 'izzah');
    expect(reply).toMatchObject({ kind: 'update_request_answered', entity_type: 'task_update' });
  });

  it('is not answered by the owner writing about their own part', async () => {
    const task = await workOf('izzah');
    const step = await stepOn(task.id, 'amer');
    await ask('izzul', task.id, { step });
    await postUpdate('izzah', task.id, 'Report drafted.');
    expect((await requests(task.id))[0]!.resolved_at).toBeNull();
  });

  it('reassigning the step clears the old assignee’s notice and lets the asker ask again', async () => {
    const task = await workOf('izzah');
    const step = await stepOn(task.id, 'amer');
    await ask('izzah', task.id, { step });
    await serviceClient()
      .from('task_checklist_items')
      .update({ assigned_to: PEOPLE.ajmal.id })
      .eq('id', step);

    expect((await notices(task.id, 'amer'))[0]!.read_at).not.toBeNull();
    const again = await ask('izzah', task.id, { step });
    expect(again).toMatchObject({ ok: true, times_asked: 2, recipient_name: 'Ajmal Rizani' });
  });

  it('removing the step removes its requests and clears the notice', async () => {
    const task = await workOf('izzah');
    const step = await stepOn(task.id, 'amer');
    await ask('izzah', task.id, { step });
    const { data } = await (
      await as('izzah')
    ).rpc('remove_checklist_step', {
      p_item_id: step,
      p_idempotency_key: null,
    });
    expect((data as Rpc).ok).toBe(true);
    expect(await requests(task.id)).toHaveLength(0);
    expect((await notices(task.id, 'amer'))[0]!.read_at).not.toBeNull();
  });
});

describe('v184 — once a day', () => {
  it('refuses a second ask inside 24 hours and says when the next one is allowed', async () => {
    const task = await workOf('amer');
    await ask('izzul', task.id);
    expect((await workTarget('izzul', task.id))!.again_at).not.toBeNull();

    const again = await ask('izzul', task.id, { message: 'Any news?' });
    expect(again).toMatchObject({ ok: false, code: 'already_requested' });
    expect(again.detail?.again_at).toBeTruthy();
    expect(await notices(task.id, 'amer')).toHaveLength(1);
  });

  it('after a day repeats the same request, replacing the waiting notice', async () => {
    const task = await workOf('amer');
    await ask('izzul', task.id, { message: 'First ask' });
    const [request] = await requests(task.id);
    await serviceClient()
      .from('task_update_requests')
      .update({ last_asked_at: new Date(Date.now() - 25 * 3_600_000).toISOString() })
      .eq('id', request!.id);
    expect((await workTarget('izzul', task.id))!.again_at).toBeNull();

    const again = await ask('izzul', task.id, { message: 'Second ask' });
    expect(again).toMatchObject({ ok: true, times_asked: 2, request_id: request!.id });

    const all = await requests(task.id);
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ times_asked: 2, message: 'Second ask' });

    const bell = await notices(task.id, 'amer');
    expect(bell).toHaveLength(2);
    expect(bell[0]!.read_at).not.toBeNull();
    expect(bell[1]!.read_at).toBeNull();
    expect(bell[1]!.body).toContain('Second ask');
  });

  it('keeps each person’s request apart', async () => {
    const task = await workOf('izzah');
    expect((await ask('izzul', task.id)).ok).toBe(true);
    expect((await ask('amer', task.id)).ok).toBe(true);
    expect(await requests(task.id)).toHaveLength(2);
  });
});

describe('v184 — answering the work', () => {
  it('a written update from the owner answers, clears the notice and tells the asker', async () => {
    const task = await workOf('amer');
    await ask('izzul', task.id, { message: 'Where are we?' });

    const posted = await postUpdate('amer', task.id, 'Contractor confirmed Friday 9am.');
    expect(posted.ok).toBe(true);

    const [request] = await requests(task.id);
    expect(request).toMatchObject({ resolution: 'update_posted', update_id: posted.update_id });

    expect((await notices(task.id, 'amer'))[0]!.read_at).not.toBeNull();

    const [reply] = await notices(task.id, 'izzul');
    expect(reply).toMatchObject({
      kind: 'update_request_answered',
      requires_action: false,
      quiet: false,
      entity_type: 'task_update',
      entity_id: posted.update_id,
    });
    expect(reply!.title).toMatch(/^Update received: Monthly ESH report/);
    expect(reply!.body).toBe('Amer Hakim replied: "Contractor confirmed Friday 9am."');

    const { data: deliveries } = await serviceClient()
      .from('notification_email_deliveries')
      .select('recipient_email')
      .eq('notification_id', reply!.id);
    expect(deliveries).toEqual([expect.objectContaining({ recipient_email: 'izzul@tamco.local' })]);

    // Answered, so asking is open again straight away.
    expect((await workTarget('izzul', task.id))!.again_at).toBeNull();
    expect((await readModel('izzul', task.id)).open).toEqual([]);
  });

  it('tells the asker once when one update answers the work and a step', async () => {
    const task = await workOf('amer');
    const step = await stepOn(task.id, null);
    await ask('izzul', task.id);
    await ask('izzul', task.id, { step });
    await postUpdate('amer', task.id, 'Both moving.');
    expect((await requests(task.id)).every((row) => row.resolution === 'update_posted')).toBe(true);
    expect(await notices(task.id, 'izzul')).toHaveLength(1);
  });

  it('shortens a long reply in the notice', async () => {
    const task = await workOf('amer');
    await ask('izzul', task.id);
    await postUpdate('amer', task.id, 'a'.repeat(400));
    const [reply] = await notices(task.id, 'izzul');
    expect(reply!.body).toBe(`Amer Hakim replied: "${'a'.repeat(297)}..."`);
  });

  it('answers everybody who asked at once', async () => {
    const task = await workOf('izzah');
    await ask('izzul', task.id);
    await ask('amer', task.id);
    await postUpdate('izzah', task.id, 'Draft is with document control.');
    expect((await requests(task.id)).every((row) => row.resolution === 'update_posted')).toBe(true);
    expect(await notices(task.id, 'izzul')).toHaveLength(1);
    expect(await notices(task.id, 'amer')).toHaveLength(1);
  });

  it('is not answered by the person who asked writing an update themselves', async () => {
    const task = await workOf('amer');
    await ask('izzul', task.id);
    expect((await postUpdate('izzul', task.id, 'Chased the contractor myself.')).ok).toBe(true);
    expect((await requests(task.id))[0]!.resolved_at).toBeNull();
    expect(await notices(task.id, 'izzul')).toHaveLength(0);
    // The read model names who can answer it.
    expect((await readModel('izzul', task.id)).open[0]).toMatchObject({
      requested_of: PEOPLE.amer.id,
      answerer: PEOPLE.amer.id,
    });
  });
});

describe('v184 — settling', () => {
  it('closes the request when the work is cancelled, and clears the owner’s notice', async () => {
    const task = await workOf('amer');
    await ask('izzul', task.id);
    const { data } = await (
      await as('izzul')
    ).rpc('cancel_task', {
      p_task_id: task.id,
      p_expected_version: task.version,
      p_reason: 'Superseded by the site-wide report.',
      p_idempotency_key: crypto.randomUUID(),
    });
    expect((data as Rpc).ok).toBe(true);

    expect((await requests(task.id))[0]).toMatchObject({
      resolution: 'work_closed',
      update_id: null,
    });
    expect((await notices(task.id, 'amer'))[0]!.read_at).not.toBeNull();
    expect((await readModel('izzul', task.id)).targets).toEqual([]);
  });

  it('closes the request when the work goes to the Bin', async () => {
    const task = await workOf('amer');
    await ask('izzul', task.id);
    await serviceClient()
      .from('tasks')
      .update({ deleted_at: new Date().toISOString(), deleted_by: PEOPLE.amer.id })
      .eq('id', task.id);
    expect((await requests(task.id))[0]!.resolution).toBe('work_closed');
  });

  it('after reassignment clears the old owner’s notice and lets the asker ask the new owner', async () => {
    const task = await workOf('amer');
    await ask('izzul', task.id);
    await serviceClient()
      .from('tasks')
      .update({ primary_owner_id: PEOPLE.lim.id })
      .eq('id', task.id);

    expect((await notices(task.id, 'amer'))[0]!.read_at).not.toBeNull();
    expect((await workTarget('izzul', task.id))!.again_at).toBeNull();

    const again = await ask('izzul', task.id);
    expect(again).toMatchObject({ ok: true, times_asked: 2 });
    expect((await requests(task.id))[0]!.requested_of).toBe(PEOPLE.lim.id);
    expect(await notices(task.id, 'lim')).toHaveLength(1);
  });
});
