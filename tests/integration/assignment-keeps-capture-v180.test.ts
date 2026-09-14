import { afterAll, describe, expect, it } from 'vitest';

import { PEOPLE, serviceClient, signInAs } from './setup';

/**
 * v180 — work assigned from New Work keeps what was chosen for it.
 *
 * A manager choosing somebody else as Primary owner used to have the draft
 * thrown away after assignment: the completion evidence rule arrived as
 * optional and the files were deleted. These cases give the procedure a draft
 * the way the form saves one — rule, instruction, description and a file row —
 * and check the task that comes out carries all of it.
 */

interface RpcResult {
  ok: boolean;
  code?: string;
  message?: string;
  task_ids?: string[];
}

const createdTasks: string[] = [];

afterAll(async () => {
  // Binned rather than deleted: a task with an audit trail refuses deletion.
  if (createdTasks.length) {
    await serviceClient()
      .from('tasks')
      .update({ deleted_at: new Date().toISOString(), deleted_by: PEOPLE.izzul.id })
      .in('id', createdTasks);
  }
});

async function draftFor(capturedBy: string, title: string) {
  const service = serviceClient();
  const { data: capture, error } = await service
    .from('work_captures')
    .insert({
      captured_by: capturedBy,
      title,
      description: 'Why this is being set up.',
      timing_choice: 'no_date',
      recommended_destination: 'operational_available_work',
      recommendation_reason: 'Ordinary work.',
      classification_rule_code: 'test',
      classification_rule_text: 'Ordinary work.',
      completion_evidence_rule: 'file',
      completion_evidence_instruction: 'Attach the signed checklist.',
    })
    .select('id')
    .single();
  if (error || !capture) throw new Error(`Could not save the draft: ${error?.message}`);
  const captureId = (capture as { id: string }).id;
  const attachment = await service.from('work_capture_attachments').insert({
    capture_id: captureId,
    storage_path: `captures/${captureId}/checklist.pdf`,
    file_name: 'checklist.pdf',
    mime_type: 'application/pdf',
    byte_size: 1024,
  });
  if (attachment.error) throw new Error(`Could not attach: ${attachment.error.message}`);
  return captureId;
}

describe('v180 assignment from New Work keeps the draft', () => {
  it('carries the evidence rule, instruction, description and files onto the task', async () => {
    const manager = await signInAs('izzul');
    const title = `V180 assigned with evidence ${crypto.randomUUID().slice(0, 8)}`;
    const captureId = await draftFor(PEOPLE.izzul.id, title);

    const { data, error } = await manager.rpc('assign_work_to_people', {
      p_title: title,
      p_description: '',
      p_work_class: 'operational_action',
      p_owner_ids: [PEOPLE.amer.id],
      p_idempotency_key: crypto.randomUUID(),
      p_capture_id: captureId,
    });
    if (error) throw new Error(`assign_work_to_people failed: ${error.message}`);
    const result = data as RpcResult;
    expect(result.ok, result.message).toBe(true);
    const taskId = result.task_ids?.[0];
    expect(taskId).toBeTruthy();
    createdTasks.push(taskId!);

    const service = serviceClient();
    const { data: task } = await service
      .from('tasks')
      .select(
        'primary_owner_id,status,completion_evidence_rule,completion_evidence_instruction,description',
      )
      .eq('id', taskId!)
      .single();
    expect(task).toEqual({
      primary_owner_id: PEOPLE.amer.id,
      status: 'backlog',
      completion_evidence_rule: 'file',
      completion_evidence_instruction: 'Attach the signed checklist.',
      description: 'Why this is being set up.',
    });

    const { data: files } = await service
      .from('attachments')
      .select('file_name,storage_path')
      .eq('task_id', taskId!);
    expect(files).toEqual([
      { file_name: 'checklist.pdf', storage_path: `captures/${captureId}/checklist.pdf` },
    ]);

    // Resolved, not discarded — discarding is what deleted the files.
    const { data: capture } = await service
      .from('work_captures')
      .select('status,created_task_id')
      .eq('id', captureId)
      .single();
    expect(capture).toEqual({ status: 'confirmed', created_task_id: taskId });
  });

  it("refuses somebody else's draft, and a draft split between several people", async () => {
    const manager = await signInAs('izzul');
    const captureId = await draftFor(
      PEOPLE.admin.id,
      `V180 not yours ${crypto.randomUUID().slice(0, 8)}`,
    );

    const { data: notYours } = await manager.rpc('assign_work_to_people', {
      p_title: 'Not yours',
      p_description: '',
      p_work_class: 'operational_action',
      p_owner_ids: [PEOPLE.amer.id],
      p_idempotency_key: crypto.randomUUID(),
      p_capture_id: captureId,
    });
    expect((notYours as RpcResult).code).toBe('not_found');

    const mine = await draftFor(
      PEOPLE.izzul.id,
      `V180 two people ${crypto.randomUUID().slice(0, 8)}`,
    );
    const { data: split } = await manager.rpc('assign_work_to_people', {
      p_title: 'Two people',
      p_description: '',
      p_work_class: 'operational_action',
      p_owner_ids: [PEOPLE.amer.id, PEOPLE.izzah.id],
      p_idempotency_key: crypto.randomUUID(),
      p_capture_id: mine,
    });
    expect((split as RpcResult).code).toBe('validation_failed');
  });

  it('still assigns without a draft, as optional work', async () => {
    const manager = await signInAs('izzul');
    const { data } = await manager.rpc('assign_work_to_people', {
      p_title: `V180 plain assignment ${crypto.randomUUID().slice(0, 8)}`,
      p_description: '',
      p_work_class: 'operational_action',
      p_owner_ids: [PEOPLE.amer.id],
      p_idempotency_key: crypto.randomUUID(),
    });
    const result = data as RpcResult;
    expect(result.ok, result.message).toBe(true);
    createdTasks.push(...(result.task_ids ?? []));
    const { data: task } = await serviceClient()
      .from('tasks')
      .select('completion_evidence_rule')
      .eq('id', result.task_ids![0]!)
      .single();
    expect(task).toEqual({ completion_evidence_rule: 'optional' });
  });
});
