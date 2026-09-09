import { afterEach, describe, expect, it } from 'vitest';

import { createTask, deleteTask, PEOPLE, serviceClient, signInAs } from './setup';

/**
 * v149 §14 — an occurrence keeps what it was generated with.
 *
 * A routine occurrence is an event that happened on a date. Its template is a
 * schedule that keeps changing. Reading the second to describe the first is
 * how a completed inspection ends up claiming it required a photograph that
 * was never asked for, and how the Upcoming tab becomes permission to sign off
 * next month's walk today.
 *
 * Acceptance A16 and A21.
 */

type Rpc = Record<string, unknown> & { ok: boolean; code?: string; message?: string };

const createdTasks: string[] = [];
const createdTemplates: string[] = [];

async function template(overrides: Record<string, unknown> = {}) {
  const { data, error } = await serviceClient()
    .from('routine_templates')
    .insert({
      title: `Snapshot template ${crypto.randomUUID().slice(0, 8)}`,
      default_owner_id: PEOPLE.izzah.id,
      created_by: PEOPLE.izzah.id,
      frequency: 'weekly',
      interval_count: 1,
      weekday: 1,
      ...overrides,
    })
    .select('id')
    .single();
  if (error) throw new Error(`Could not create a template: ${error.message}`);
  createdTemplates.push(String(data!.id));
  return String(data!.id);
}

/** `yyyy-mm-dd`, `days` from today. */
function isoDay(days: number): string {
  const at = new Date();
  at.setDate(at.getDate() + days);
  return at.toISOString().slice(0, 10);
}

async function occurrence(templateId: string, occurrenceDate: string) {
  const task = await createTask('izzah', {
    title: `Snapshot occurrence ${crypto.randomUUID().slice(0, 8)}`,
    work_class: 'routine_occurrence',
    focus_bucket: null,
    routine_template_id: templateId,
    occurrence_date: occurrenceDate,
    status: 'active',
  });
  createdTasks.push(task.id);
  return task;
}

async function readOccurrence(taskId: string) {
  const { data, error } = await serviceClient()
    .from('task_overview')
    .select(
      'completion_evidence_rule,completion_evidence_instruction,routine_area,routine_completion_opens_on',
    )
    .eq('id', taskId)
    .single();
  if (error) throw new Error(`Could not read the occurrence: ${error.message}`);
  return data as {
    completion_evidence_rule: string;
    completion_evidence_instruction: string | null;
    routine_area: string | null;
    routine_completion_opens_on: string | null;
  };
}

afterEach(async () => {
  while (createdTasks.length) await deleteTask(createdTasks.pop()!);
  while (createdTemplates.length) {
    await serviceClient().from('routine_templates').delete().eq('id', createdTemplates.pop()!);
  }
});

describe('what an occurrence inherits', () => {
  it('takes the evidence rule, instruction and area from its schedule', async () => {
    const templateId = await template({
      evidence_required: true,
      evidence_instruction: 'Photograph every extinguisher tag.',
      area: 'Production Hall B',
    });
    const task = await occurrence(templateId, isoDay(0));

    const row = await readOccurrence(task.id);
    expect(row.completion_evidence_rule).toBe('file');
    expect(row.completion_evidence_instruction).toBe('Photograph every extinguisher tag.');
    expect(row.routine_area).toBe('Production Hall B');
  });

  it('does not change when the schedule changes afterwards', async () => {
    /*
     * The rule §14 exists for. Tightening a weekly walk today must not rewrite
     * what an occurrence generated last month says it required — the record
     * would stop describing what the person was actually held to.
     */
    const templateId = await template({ evidence_required: false, area: 'Hall A' });
    const task = await occurrence(templateId, isoDay(0));
    expect((await readOccurrence(task.id)).completion_evidence_rule).toBe('optional');

    await serviceClient()
      .from('routine_templates')
      .update({
        evidence_required: true,
        evidence_instruction: 'Now a photograph is required.',
        area: 'Hall C',
      })
      .eq('id', templateId);

    const after = await readOccurrence(task.id);
    expect(after.completion_evidence_rule).toBe('optional');
    expect(after.completion_evidence_instruction).toBeNull();
    expect(after.routine_area).toBe('Hall A');
  });

  it('applies the new rule to occurrences generated after the change', async () => {
    // §14 — "Template changes affect future occurrences according to existing
    // schedule rules." The snapshot is not a freeze on the schedule.
    const templateId = await template({ evidence_required: false });
    await occurrence(templateId, isoDay(0));

    await serviceClient()
      .from('routine_templates')
      .update({ evidence_required: true, area: 'Hall D' })
      .eq('id', templateId);

    const later = await occurrence(templateId, isoDay(7));
    const row = await readOccurrence(later.id);
    expect(row.completion_evidence_rule).toBe('file');
    expect(row.routine_area).toBe('Hall D');
  });
});

describe('the completion window', () => {
  it('refuses an occurrence that is not due yet', async () => {
    const templateId = await template();
    const task = await occurrence(templateId, isoDay(14));
    expect((await readOccurrence(task.id)).routine_completion_opens_on).toBe(isoDay(14));

    const izzah = await signInAs('izzah');
    const { data } = await izzah.rpc('complete_task', {
      p_task_id: task.id,
      p_expected_version: null,
      p_completion_note: null,
      p_idempotency_key: null,
    });

    const result = data as Rpc;
    expect(result.ok).toBe(false);
    expect(result.code).toBe('too_early');
    // The refusal says when, because "not yet" alone is not actionable.
    expect(result.message).toMatch(/cannot be completed before/i);

    const { data: after } = await serviceClient()
      .from('tasks')
      .select('status')
      .eq('id', task.id)
      .single();
    expect(after!.status).toBe('active');
  });

  it('allows one whose date has arrived', async () => {
    const templateId = await template();
    const task = await occurrence(templateId, isoDay(0));

    const izzah = await signInAs('izzah');
    const { data } = await izzah.rpc('complete_task', {
      p_task_id: task.id,
      p_expected_version: null,
      p_completion_note: null,
      p_idempotency_key: null,
    });

    expect((data as Rpc).ok, `completion was refused: ${(data as Rpc).message}`).toBe(true);
  });

  it('honours a schedule that allows the work early', async () => {
    /*
     * §14 — the window belongs to the template. A monthly report that can
     * legitimately be written in the last week says so, and 0 is only the
     * default rather than a rule about all routine work.
     */
    const templateId = await template({ completion_opens_days_before: 7 });
    const task = await occurrence(templateId, isoDay(3));
    expect((await readOccurrence(task.id)).routine_completion_opens_on).toBe(isoDay(-4));

    const izzah = await signInAs('izzah');
    const { data } = await izzah.rpc('complete_task', {
      p_task_id: task.id,
      p_expected_version: null,
      p_completion_note: null,
      p_idempotency_key: null,
    });

    expect((data as Rpc).ok, `completion was refused: ${(data as Rpc).message}`).toBe(true);
  });

  it('does not move the window on work already generated', async () => {
    // Snapshotted, like the evidence rule: narrowing the window today must not
    // retrospectively make yesterday's completion premature.
    const templateId = await template({ completion_opens_days_before: 7 });
    const task = await occurrence(templateId, isoDay(3));

    await serviceClient()
      .from('routine_templates')
      .update({ completion_opens_days_before: 0 })
      .eq('id', templateId);

    expect((await readOccurrence(task.id)).routine_completion_opens_on).toBe(isoDay(-4));
  });

  it('leaves ordinary work alone', async () => {
    // Nothing but a dated occurrence has a window, and Focus work must not
    // acquire one by accident.
    const task = await createTask('izzah', { status: 'active' });
    createdTasks.push(task.id);
    expect((await readOccurrence(task.id)).routine_completion_opens_on).toBeNull();

    const izzah = await signInAs('izzah');
    const { data } = await izzah.rpc('complete_task', {
      p_task_id: task.id,
      p_expected_version: null,
      p_completion_note: null,
      p_idempotency_key: null,
    });
    expect((data as Rpc).ok).toBe(true);
  });
});
