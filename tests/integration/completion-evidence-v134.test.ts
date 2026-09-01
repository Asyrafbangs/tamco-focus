import { describe, expect, it } from 'vitest';

import { createTask, PEOPLE, serviceClient, signInAs } from './setup';

type Rpc = Record<string, unknown> & { ok: boolean; code: string; message?: string };

/**
 * The completion evidence rule, enforced where it has to be.
 *
 * The form disables its own button, which is right for telling somebody what
 * is outstanding and worth nothing as a guarantee: a Server Action is an HTTP
 * endpoint, and the rule is only real if the database refuses. These tests
 * call `complete_task` directly, which is exactly what a caller bypassing the
 * form would reach.
 */

async function setRule(
  taskId: string,
  rule: 'optional' | 'file_or_note' | 'file',
  instruction: string | null = null,
) {
  const admin = serviceClient();
  const { error } = await admin
    .from('tasks')
    .update({
      completion_evidence_rule: rule,
      completion_evidence_instruction: instruction,
    })
    .eq('id', taskId);
  if (error) throw new Error(`Could not set the evidence rule: ${error.message}`);
}

/** Evidence as the product records it: attached to the work, not to an update. */
async function attachEvidence(taskId: string, uploaderId: string) {
  const admin = serviceClient();
  const { error } = await admin.from('attachments').insert({
    task_id: taskId,
    storage_path: `tasks/${taskId}/${crypto.randomUUID()}-proof.pdf`,
    file_name: 'proof.pdf',
    mime_type: 'application/pdf',
    byte_size: 2048,
    is_evidence: true,
    uploaded_by: uploaderId,
  });
  if (error) throw new Error(`Could not attach evidence: ${error.message}`);
}

async function complete(person: 'amer', taskId: string, version: number, note?: string) {
  const client = await signInAs(person);
  return (
    await client.rpc('complete_task', {
      p_task_id: taskId,
      p_expected_version: version,
      p_completion_note: note ?? null,
      p_idempotency_key: crypto.randomUUID(),
    })
  ).data as Rpc;
}

describe('v134 completion evidence rule', () => {
  it('lets ordinary work close with nothing attached', async () => {
    // Most work asks for nothing in particular, and a rule that applied
    // everywhere would be a rule nobody could satisfy honestly.
    const task = await createTask('amer', { title: 'Ordinary work' });
    const result = await complete('amer', task.id, task.version);
    expect(result).toMatchObject({ ok: true });
  });

  it('refuses to close work that requires a file until one exists', async () => {
    const task = await createTask('amer', { title: 'Dust hazard assessment' });
    await setRule(task.id, 'file', 'Attach the completed DHA report.');

    const refused = await complete('amer', task.id, task.version, 'All done.');
    // A note does not satisfy `file`: the point of that rule is the artefact,
    // and an inspection with no photograph has not produced its evidence.
    expect(refused.ok).toBe(false);
    expect(refused.code).toBe('evidence_missing');

    await attachEvidence(task.id, PEOPLE.amer.id);

    const accepted = await complete('amer', task.id, task.version);
    expect(accepted).toMatchObject({ ok: true });
  });

  it('accepts a written result where the rule allows one', async () => {
    const task = await createTask('amer', { title: 'Discuss the contractor change' });
    await setRule(task.id, 'file_or_note');

    const refused = await complete('amer', task.id, task.version);
    expect(refused.code).toBe('evidence_missing');

    /*
     * The reason this value exists. A conversation produces no artefact, and a
     * rule that demanded one anyway would be satisfied with a blank document
     * or a duplicate photograph — which is worse than no rule, because it
     * makes the evidence that does arrive impossible to trust.
     */
    const accepted = await complete(
      'amer',
      task.id,
      task.version,
      'Agreed with the contractor to defer to next quarter.',
    );
    expect(accepted).toMatchObject({ ok: true });
  });

  it('counts evidence attached to a step, rather than asking for it twice', async () => {
    const task = await createTask('amer', { title: 'Measurement round' });
    await setRule(task.id, 'file');

    await attachEvidence(task.id, PEOPLE.amer.id);

    // Whitespace is not a note, and a step's proof is still proof.
    const accepted = await complete('amer', task.id, task.version, '   ');
    expect(accepted).toMatchObject({ ok: true });
  });

  it('exposes the effective rule and the evidence count to the interface', async () => {
    const task = await createTask('amer', { title: 'Site inspection' });
    await setRule(task.id, 'file', 'Attach a site photograph.');

    const owner = await signInAs('amer');
    const { data } = await owner
      .from('task_overview')
      .select('completion_evidence_rule, completion_evidence_instruction, evidence_count')
      .eq('id', task.id)
      .single();

    expect(data?.completion_evidence_rule).toBe('file');
    expect(data?.completion_evidence_instruction).toBe('Attach a site photograph.');
    expect(data?.evidence_count).toBe(0);
  });
});
