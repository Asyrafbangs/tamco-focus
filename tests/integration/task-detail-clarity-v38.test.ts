import { describe, expect, it } from 'vitest';

import { createTask, PEOPLE, serviceClient, signInAs } from './setup';

type Rpc = Record<string, unknown> & { ok: boolean; code: string };

describe('v38 task-detail commitments', () => {
  it('changes a due date with version, authority, and immutable before/after history', async () => {
    const previousDue = '2026-08-03T15:59:59.999Z';
    const nextDue = '2026-08-10T15:59:59.999Z';
    const task = await createTask('izzah', {
      due_at: previousDue,
      due_is_date_only: true,
    });
    const owner = await signInAs('izzah');
    const reason = 'Waiting for supplier confirmation';

    const changed = (
      await owner.rpc('change_task_due_date', {
        p_task_id: task.id,
        p_expected_version: task.version,
        p_new_due_at: nextDue,
        p_due_is_date_only: true,
        p_reason: reason,
        p_idempotency_key: crypto.randomUUID(),
      })
    ).data as Rpc & { version: number };
    expect(changed).toMatchObject({
      ok: true,
      code: 'task_due_date_changed',
      due_is_date_only: true,
      version: task.version + 1,
    });
    expect(new Date(String(changed.due_at)).toISOString()).toBe(nextDue);

    const viewer = await signInAs('amer');
    const refused = (
      await viewer.rpc('change_task_due_date', {
        p_task_id: task.id,
        p_expected_version: task.version + 1,
        p_new_due_at: '2026-08-12T15:59:59.999Z',
        p_due_is_date_only: true,
        p_reason: null,
        p_idempotency_key: crypto.randomUUID(),
      })
    ).data as Rpc;
    expect(refused).toMatchObject({ ok: false, code: 'not_authorised' });

    const admin = serviceClient();
    const [{ data: persisted }, { data: events }] = await Promise.all([
      admin.from('tasks').select('due_at,due_is_date_only,version').eq('id', task.id).single(),
      admin
        .from('audit_events')
        .select('actor_id,occurred_at,detail')
        .eq('task_id', task.id)
        .eq('event_type', 'task_due_date_changed'),
    ]);
    expect(persisted).toMatchObject({
      due_is_date_only: true,
      version: task.version + 1,
    });
    expect(new Date(String(persisted?.due_at)).toISOString()).toBe(nextDue);
    expect(events).toHaveLength(1);
    expect(events?.[0]).toMatchObject({
      actor_id: PEOPLE.izzah.id,
      occurred_at: expect.any(String),
      detail: expect.objectContaining({
        previous_due_is_date_only: true,
        new_due_is_date_only: true,
        reason,
      }),
    });
    const auditDetail = events?.[0]?.detail as Record<string, unknown>;
    expect(new Date(String(auditDetail.previous_due_at)).toISOString()).toBe(previousDue);
    expect(new Date(String(auditDetail.new_due_at)).toISOString()).toBe(nextDue);
  });

  it('derives progress from permanent checklist items and commits required evidence with completion', async () => {
    const task = await createTask('izzah', { progress_percent: 80 });
    const admin = serviceClient();
    const completedItemId = crypto.randomUUID();
    const requiredItemId = crypto.randomUUID();
    const optionalItemId = crypto.randomUUID();
    const completedAt = new Date().toISOString();
    const { error: checklistError } = await admin.from('task_checklist_items').insert([
      {
        id: completedItemId,
        task_id: task.id,
        position: 0,
        action: 'Confirm initial preparation',
        evidence_rule: 'not_required',
        state: 'completed',
        completed_by: PEOPLE.izzah.id,
        completed_at: completedAt,
      },
      {
        id: requiredItemId,
        task_id: task.id,
        position: 1,
        action: 'Obtain machine guarding sign-off',
        evidence_rule: 'required',
        state: 'ready',
      },
      {
        id: optionalItemId,
        task_id: task.id,
        position: 2,
        action: 'Confirm training records updated',
        evidence_rule: 'optional',
        state: 'ready',
      },
    ]);
    expect(checklistError).toBeNull();

    const { data: derived } = await admin
      .from('tasks')
      .select('progress_percent')
      .eq('id', task.id)
      .single();
    expect(derived?.progress_percent).toBe(33);

    const owner = await signInAs('izzah');
    const attachmentId = crypto.randomUUID();
    const path = `tasks/${task.id}/${attachmentId}-guarding-sign-off.txt`;
    const body = new Blob(['Machine guarding approved'], { type: 'text/plain' });
    const { error: uploadError } = await owner.storage
      .from('task-attachments')
      .upload(path, body, { contentType: 'text/plain', upsert: false });
    expect(uploadError).toBeNull();

    try {
      const completed = (
        await owner.rpc('complete_checklist_item_with_evidence', {
          p_item_id: requiredItemId,
          p_attachments: [
            {
              id: attachmentId,
              storage_path: path,
              file_name: 'guarding-sign-off.txt',
              mime_type: 'text/plain',
              byte_size: body.size,
              is_evidence: true,
            },
          ],
          p_completion_note: 'Approval received from the guarding inspector.',
          p_idempotency_key: crypto.randomUUID(),
        })
      ).data as Rpc;
      expect(completed).toMatchObject({
        ok: true,
        code: 'completed_with_evidence',
        attachment_count: 1,
        progress_percent: 66,
      });

      const [{ data: item }, { data: attachment }, { data: persisted }, { data: events }] =
        await Promise.all([
          admin
            .from('task_checklist_items')
            .select('state,completed_at,completed_by,completion_note')
            .eq('id', requiredItemId)
            .single(),
          admin
            .from('attachments')
            .select('checklist_item_id,uploaded_by,created_at,is_evidence')
            .eq('id', attachmentId)
            .single(),
          admin.from('tasks').select('progress_percent').eq('id', task.id).single(),
          admin
            .from('audit_events')
            .select('event_type,occurred_at,detail')
            .eq('task_id', task.id)
            .in('event_type', ['update_posted', 'attachment_added', 'checklist_item_completed'])
            .order('occurred_at'),
        ]);
      expect(item).toMatchObject({
        state: 'completed',
        completed_by: PEOPLE.izzah.id,
        completion_note: 'Approval received from the guarding inspector.',
      });
      expect(attachment).toMatchObject({
        checklist_item_id: requiredItemId,
        uploaded_by: PEOPLE.izzah.id,
        is_evidence: true,
      });
      expect(attachment?.created_at).toBe(item?.completed_at);
      expect(persisted?.progress_percent).toBe(66);
      expect(events).toHaveLength(3);
      expect(new Set(events?.map((event) => event.occurred_at))).toHaveProperty('size', 1);
      expect(events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            event_type: 'checklist_item_completed',
            detail: expect.objectContaining({
              action: 'Obtain machine guarding sign-off',
              progress_percent: 66,
              attachment_count: 1,
            }),
          }),
          expect.objectContaining({ event_type: 'attachment_added' }),
        ]),
      );
    } finally {
      await owner.storage.from('task-attachments').remove([path]);
    }
  });
});
