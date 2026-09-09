import { afterEach, describe, expect, it } from 'vitest';

import { createTask, deleteTask, PEOPLE, serviceClient, signInAs } from './setup';

/**
 * v151 — the §26 scenarios the suite could not yet prove.
 *
 * Everything else in §26 is covered somewhere: the person expansion by
 * `person-expansion-v143`, the week by `weekly-commitments-v141`, the skip flow
 * by `routine-skip-v147`, and so on. Two were true only structurally — nothing
 * asserted them, so nothing would notice if they stopped being true.
 *
 * A21: prior occurrence has evidence, current occurrence does not.
 * A29: work reopens and completes again.
 */

type Rpc = Record<string, unknown> & { ok: boolean; code?: string; message?: string };

const createdTasks: string[] = [];
const createdTemplates: string[] = [];

async function template(overrides: Record<string, unknown> = {}) {
  const { data, error } = await serviceClient()
    .from('routine_templates')
    .insert({
      title: `Acceptance template ${crypto.randomUUID().slice(0, 8)}`,
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

function isoDay(days: number): string {
  const at = new Date();
  at.setDate(at.getDate() + days);
  return at.toISOString().slice(0, 10);
}

async function occurrence(templateId: string, occurrenceDate: string) {
  const task = await createTask('izzah', {
    title: `Acceptance occurrence ${crypto.randomUUID().slice(0, 8)}`,
    work_class: 'routine_occurrence',
    focus_bucket: null,
    routine_template_id: templateId,
    occurrence_date: occurrenceDate,
    status: 'active',
  });
  createdTasks.push(task.id);
  return task;
}

/** A file on the record, the way the upload action leaves one. */
async function attachEvidence(taskId: string) {
  const { error } = await serviceClient()
    .from('attachments')
    .insert({
      task_id: taskId,
      storage_bucket: 'task-attachments',
      storage_path: `acceptance/${crypto.randomUUID()}.csv`,
      file_name: 'reading.csv',
      mime_type: 'text/csv',
      byte_size: 12,
      is_evidence: true,
      uploaded_by: PEOPLE.izzah.id,
    });
  if (error) throw new Error(`Could not attach evidence: ${error.message}`);
}

afterEach(async () => {
  const admin = serviceClient();
  while (createdTasks.length) await deleteTask(createdTasks.pop()!);
  while (createdTemplates.length) {
    await admin.from('routine_templates').delete().eq('id', createdTemplates.pop()!);
  }
});

describe('A21 — last month’s proof is not this month’s', () => {
  it('does not let evidence on an earlier occurrence satisfy a later one', async () => {
    /*
     * Each occurrence is its own event and its own record. A weekly walk that
     * required a photograph in August is not evidenced by the photograph taken
     * in July, and a rule that let it be would turn a recurring inspection
     * into one inspection with fifty-one signatures.
     *
     * Structurally true — evidence hangs off a task id — but nothing said so,
     * which is exactly how a well-meaning "reuse the last one" convenience
     * gets added later.
     */
    const templateId = await template({ evidence_required: true });
    const july = await occurrence(templateId, isoDay(-7));
    const august = await occurrence(templateId, isoDay(0));

    await attachEvidence(july.id);

    const izzah = await signInAs('izzah');
    const refused = (
      await izzah.rpc('complete_task', {
        p_task_id: august.id,
        p_expected_version: null,
        p_completion_note: null,
        p_idempotency_key: null,
      })
    ).data as Rpc;

    expect(refused.ok).toBe(false);
    expect(refused.code).toBe('evidence_missing');

    // And the earlier one, which does have its proof, closes normally.
    const allowed = (
      await izzah.rpc('complete_task', {
        p_task_id: july.id,
        p_expected_version: null,
        p_completion_note: null,
        p_idempotency_key: null,
      })
    ).data as Rpc;
    expect(allowed.ok, `the evidenced occurrence was refused: ${allowed.message}`).toBe(true);
  });
});

describe('A29 — work that reopens and is completed again', () => {
  it('counts once, and keeps both completions in the history', async () => {
    /*
     * Reopened the way the product actually reopens work: a completion review
     * that asks for changes. An earlier draft of this test set the status back
     * by hand and hit `completion_reviews_one_open_per_task` — which was the
     * fixture being wrong rather than the product, but it is worth saying that
     * the constraint is there and that the real path clears the review.
     */
    const task = await createTask('izzah', {
      status: 'active',
      is_mandatory: true,
      mandatory_justification: 'Acceptance fixture for A29.',
    });
    createdTasks.push(task.id);

    const izzah = await signInAs('izzah');
    const first = (
      await izzah.rpc('complete_task', {
        p_task_id: task.id,
        p_expected_version: null,
        p_completion_note: 'First pass.',
        p_idempotency_key: null,
      })
    ).data as Rpc;
    expect(first.ok, `the first completion was refused: ${first.message}`).toBe(true);

    const manager = await signInAs('izzul');
    const returned = (
      await manager.rpc('decide_completion_review', {
        p_task_id: task.id,
        p_decision: 'changes_requested',
        p_note: 'The reading on line two is missing.',
        p_idempotency_key: null,
      })
    ).data as Rpc;
    expect(returned.ok, `the review could not be returned: ${returned.message}`).toBe(true);

    const { data: reopened } = await serviceClient()
      .from('tasks')
      .select('status,completed_at,completed_owner_id')
      .eq('id', task.id)
      .single();
    // §20 — reopened work is not a current completion, and carries no
    // attribution while it is open.
    expect(reopened!.status).not.toBe('completed');
    expect(reopened!.completed_owner_id).toBeNull();

    const second = (
      await izzah.rpc('complete_task', {
        p_task_id: task.id,
        p_expected_version: null,
        p_completion_note: 'Second pass, with the reading.',
        p_idempotency_key: null,
      })
    ).data as Rpc;
    expect(second.ok, `the second completion was refused: ${second.message}`).toBe(true);

    /*
     * One row, one current completion. §20: "Completing again counts once as a
     * current completed item using the latest valid completion, not multiple
     * tasks."
     */
    const { data: rows, error } = await serviceClient()
      .from('task_overview')
      .select('id,status,completed_owner_id')
      .eq('id', task.id);
    if (error) throw new Error(`Could not read the task: ${error.message}`);
    expect(rows).toHaveLength(1);
    expect(rows![0]!.status).toBe('completed');
    expect(rows![0]!.completed_owner_id).toBe(PEOPLE.izzah.id);

    // And the history keeps everything, so the reopening is not erased.
    const { data: events } = await serviceClient()
      .from('audit_events')
      .select('event_type')
      .eq('task_id', task.id);
    const types = (events ?? []).map((row) => String(row.event_type));
    // `completion_submitted` is what completing writes; both attempts are
    // there, and so is the decision that sent the first one back.
    expect(types.filter((type) => type === 'completion_submitted').length).toBeGreaterThanOrEqual(
      2,
    );
    expect(types).toContain('changes_requested');
  });
});
