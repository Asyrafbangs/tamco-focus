import { afterEach, describe, expect, it } from 'vitest';

import { createTask, deleteTask, PEOPLE, serviceClient, signInAs } from './setup';

/**
 * v145 §11 — why work exists, recorded as data.
 *
 * Three things this has to keep true, and each of them is a way the feature
 * could quietly become useless:
 *
 *   * Purpose is INDEPENDENT of work class, status and urgency. If anything
 *     starts deriving it, the classification stops being what somebody said
 *     and becomes what the system assumed.
 *   * Old work stays unclassified rather than being guessed at. §11 is explicit
 *     that not every Operational Action is planned operations.
 *   * Only somebody who may edit the work may classify it, because a purpose is
 *     a statement about how a person's day went.
 */

type Rpc = Record<string, unknown> & { ok: boolean; code?: string };

const created: string[] = [];

async function fixture(person: keyof typeof PEOPLE, overrides: Record<string, unknown> = {}) {
  const task = await createTask(person, overrides);
  created.push(task.id);
  return task;
}

async function readPurpose(taskId: string): Promise<string | null> {
  const { data, error } = await serviceClient()
    .from('tasks')
    .select('work_purpose')
    .eq('id', taskId)
    .single();
  // Thrown, not swallowed. A helper that returns null on a refused read makes
  // a permissions failure look exactly like "nobody classified it".
  if (error) throw new Error(`Could not read the purpose: ${error.message}`);
  return (data?.work_purpose as string | null) ?? null;
}

const createdTemplates: string[] = [];

/**
 * A routine template of this test's own, with a known purpose.
 *
 * It used to take the first template the seed happened to leave. The five
 * integration files share one database and run in a fixed order, so "the first
 * template" is whatever an earlier file created — and this failed against one
 * with no purpose, which read as the inheritance trigger being broken.
 */
async function routineTemplate(purpose: string): Promise<string> {
  const { data, error } = await serviceClient()
    .from('routine_templates')
    .insert({
      title: `Purpose fixture template ${crypto.randomUUID().slice(0, 8)}`,
      default_owner_id: PEOPLE.izzah.id,
      created_by: PEOPLE.izzah.id,
      frequency: 'weekly',
      interval_count: 1,
      weekday: 1,
      work_purpose: purpose,
    })
    .select('id')
    .single();
  if (error) throw new Error(`Could not create a routine template: ${error.message}`);
  createdTemplates.push(String(data!.id));
  return String(data!.id);
}

afterEach(async () => {
  while (created.length) await deleteTask(created.pop()!);
  while (createdTemplates.length) {
    await serviceClient().from('routine_templates').delete().eq('id', createdTemplates.pop()!);
  }
});

describe('recording a purpose', () => {
  it('sets one, and says what changed in the audit trail', async () => {
    const client = await signInAs('izzah');
    const task = await fixture('izzah');
    expect(await readPurpose(task.id)).toBeNull();

    const { data } = await client.rpc('set_work_purpose', {
      p_task_id: task.id,
      p_purpose: 'reactive',
      p_expected_version: task.version,
      p_idempotency_key: null,
    });

    const result = data as Rpc;
    expect(result.ok, `refused: ${result.message}`).toBe(true);
    expect(result.code).toBe('work_purpose_set');
    expect(await readPurpose(task.id)).toBe('reactive');

    const { data: events } = await serviceClient()
      .from('audit_events')
      .select('event_type, detail')
      .eq('task_id', task.id)
      .eq('event_type', 'work_purpose_set');

    expect(events).toHaveLength(1);
    expect((events![0]!.detail as Record<string, unknown>).to).toBe('reactive');
  });

  it('does not make stalled work look freshly worked on', async () => {
    /*
     * Classifying is not progress. A task nobody has touched in six weeks must
     * still read as stale after somebody labels it during a tidy-up, or the
     * one signal a manager has for "this has stopped" can be cleared by
     * housekeeping.
     */
    const client = await signInAs('izzah');
    const task = await fixture('izzah');

    const before = (
      await serviceClient()
        .from('tasks')
        .select('last_meaningful_update_at')
        .eq('id', task.id)
        .single()
    ).data!.last_meaningful_update_at;

    await client.rpc('set_work_purpose', {
      p_task_id: task.id,
      p_purpose: 'planned_operations',
      p_expected_version: task.version,
      p_idempotency_key: null,
    });

    const after = (
      await serviceClient()
        .from('tasks')
        .select('last_meaningful_update_at')
        .eq('id', task.id)
        .single()
    ).data!.last_meaningful_update_at;

    expect(after).toBe(before);
  });

  it('can be cleared, because a wrong label is worse than none', async () => {
    const client = await signInAs('izzah');
    const task = await fixture('izzah', { work_purpose: 'reactive' });

    const { data } = await client.rpc('set_work_purpose', {
      p_task_id: task.id,
      p_purpose: null,
      p_expected_version: task.version,
      p_idempotency_key: null,
    });

    expect((data as Rpc).ok).toBe(true);
    expect(await readPurpose(task.id)).toBeNull();
  });

  it('refuses somebody who may not edit the work', async () => {
    const task = await fixture('izzah');
    const outsider = await signInAs('lim');

    const { data } = await outsider.rpc('set_work_purpose', {
      p_task_id: task.id,
      p_purpose: 'reactive',
      p_expected_version: task.version,
      p_idempotency_key: null,
    });

    const result = data as Rpc;
    expect(result.ok).toBe(false);
    expect(result.code).toMatch(/not_authorised|not_found/);
    expect(await readPurpose(task.id)).toBeNull();
  });

  it('respects the version the caller was looking at', async () => {
    const client = await signInAs('izzah');
    const task = await fixture('izzah');

    const { data } = await client.rpc('set_work_purpose', {
      p_task_id: task.id,
      p_purpose: 'reactive',
      p_expected_version: task.version + 5,
      p_idempotency_key: null,
    });

    expect(data as Rpc).toMatchObject({ ok: false, code: 'version_conflict' });
  });
});

describe('what the system may decide for itself', () => {
  it('leaves an ordinary operational action unclassified', async () => {
    /*
     * §11: "Do not blindly map every old Operational Action to Planned
     * operations: some are reactive." Nothing may fill this in from the work
     * class, and nothing may guess from the title.
     */
    const task = await fixture('izzah', {
      title: 'Emergency response to the overnight breakdown',
      work_class: 'operational_action',
      focus_bucket: 'operational',
    });

    expect(await readPurpose(task.id)).toBeNull();
  });

  it('is not changed by the work going overdue', async () => {
    // §11 — being overdue never automatically becomes Reactive work. The
    // reason work exists does not change because time passed.
    const task = await fixture('izzah', {
      work_purpose: 'planned_operations',
      due_at: new Date(Date.now() - 86_400_000).toISOString(),
    });

    const { data } = await serviceClient()
      .from('task_overview')
      .select('is_overdue, work_purpose')
      .eq('id', task.id)
      .single();

    expect(data!.is_overdue).toBe(true);
    expect(data!.work_purpose).toBe('planned_operations');
  });

  it('gives a routine occurrence the purpose of its template', async () => {
    /*
     * §11 — routine occurrences inherit their template's category. Asserted
     * against a direct insert rather than the generator, because the rule lives
     * on the row: occurrences are created by the scheduled run AND by the
     * catch-up when a recurrence changes, and a rule in one of those is a rule
     * the other can forget.
     */
    const template = await routineTemplate('planned_operations');

    const occurrence = await fixture('izzah', {
      work_class: 'routine_occurrence',
      focus_bucket: null,
      routine_template_id: template,
      occurrence_date: new Date().toISOString().slice(0, 10),
      work_purpose: null,
    });

    expect(await readPurpose(occurrence.id)).toBe('planned_operations');
  });

  it('does not overwrite a purpose the occurrence already carries', async () => {
    const template = await routineTemplate('planned_operations');

    const occurrence = await fixture('izzah', {
      work_class: 'routine_occurrence',
      focus_bucket: null,
      routine_template_id: template,
      occurrence_date: new Date().toISOString().slice(0, 10),
      work_purpose: 'reactive',
    });

    expect(await readPurpose(occurrence.id)).toBe('reactive');
  });
});
