import { describe, expect, it } from 'vitest';

import { createTask, PEOPLE, serviceClient, signInAs } from './setup';
import { runWeeklySummaryWorker } from '@/server/workers/weekly-summary';

/**
 * Transactional behaviour against the real stack.
 *
 * Every assertion here goes through the same path the application uses: an
 * authenticated client calling a SECURITY DEFINER procedure, with RLS active.
 * The unit tests cover the pure rules; these cover what only a database can
 * enforce — locking, version checks, idempotency, and audit.
 */

/**
 * Fixture tasks are deliberately NOT cleaned up afterwards. A task that has
 * accrued audit events cannot be deleted by any role — that is the retention
 * guarantee working. `global-setup.ts` resets the database once before the
 * suite instead.
 */
async function fixture(person: Parameters<typeof createTask>[0], overrides = {}) {
  return createTask(person, overrides);
}

type Rpc = Record<string, unknown> & { ok: boolean; code: string };

describe('settings, visibility, and local workers (sections 22 and 31B)', () => {
  it('updates personal preferences atomically and writes audit history', async () => {
    const client = await signInAs('izzah');
    const { data, error } = await client.rpc('update_my_preferences', {
      p_default_landing_page: 'work',
      p_daily_brief_mode: 'workdays',
      p_daily_brief_hour: 8,
      p_quiet_hours_enabled: true,
      p_quiet_hours_start: 18,
      p_quiet_hours_end: 8,
      p_first_day_of_week: 1,
      p_theme_preference: 'system',
      p_text_size: 'large',
      p_reduced_motion: true,
      p_status_labels_always_visible: true,
      p_shortcut_hints: true,
      p_personal_summary_mode: 'focused',
      p_barrier_involving_me: true,
      p_assignment_changes: true,
      p_collaboration_handoff: true,
      p_due_today_and_deadlines: true,
      p_routine_upcoming: true,
    });
    expect(error).toBeNull();
    expect(data).toMatchObject({ ok: true, code: 'preferences_updated' });

    const admin = serviceClient();
    const [{ data: profile }, { count }] = await Promise.all([
      admin
        .from('user_profiles')
        .select('default_landing_page,text_size,reduced_motion,personal_summary_mode')
        .eq('id', PEOPLE.izzah.id)
        .single(),
      admin
        .from('audit_events')
        .select('id', { count: 'exact', head: true })
        .eq('event_type', 'settings_changed')
        .eq('subject_user_id', PEOPLE.izzah.id),
    ]);
    expect(profile).toMatchObject({
      default_landing_page: 'work',
      text_size: 'large',
      reduced_motion: true,
      personal_summary_mode: 'focused',
    });
    expect(count).toBeGreaterThan(0);
  });

  it('saves visibility through the administrator transaction and previews effective access', async () => {
    const admin = await signInAs('admin');
    const { data, error } = await admin.rpc('set_user_visibility', {
      p_viewer_id: PEOPLE.amer.id,
      p_mode: 'specific_only',
      p_subject_ids: [PEOPLE.izzah.id, PEOPLE.ajmal.id],
      p_reason: 'Integration coverage',
    });
    expect(error).toBeNull();
    expect(data).toMatchObject({ ok: true, code: 'visibility_updated' });

    const preview = await admin.rpc('preview_effective_visibility', {
      p_viewer_id: PEOPLE.amer.id,
    });
    expect(preview.error).toBeNull();
    expect(preview.data?.map((row: { user_id: string }) => row.user_id)).toEqual(
      expect.arrayContaining([PEOPLE.amer.id, PEOPLE.izzah.id, PEOPLE.ajmal.id]),
    );
  });

  it('generates one weekly delivery per eligible person and never duplicates a period', async () => {
    const client = serviceClient();
    const now = new Date('2026-08-06T02:00:00.000Z');
    const first = await runWeeklySummaryWorker(client, { now, force: true });
    const second = await runWeeklySummaryWorker(client, { now, force: true });
    expect(first.generated).toBeGreaterThan(0);
    expect(first.failed).toBe(0);
    expect(second.generated).toBe(0);
    expect(second.skipped).toBe(first.generated);

    const { data: deliveries } = await client
      .from('email_deliveries')
      .select('recipient_id,period_start,status,body_text')
      .eq('period_start', first.periodStart);
    expect(deliveries?.every((delivery) => delivery.status === 'sent')).toBe(true);
    expect(deliveries?.every((delivery) => delivery.body_text.includes('Open My Day'))).toBe(true);
  });

  it('runs routine generation idempotently through the authoritative procedure', async () => {
    const client = serviceClient();
    const through = '2026-09-30';
    const first = (await client.rpc('generate_routine_occurrences', { p_through: through }))
      .data as Rpc;
    const second = (await client.rpc('generate_routine_occurrences', { p_through: through }))
      .data as Rpc;
    expect(first.ok).toBe(true);
    expect(second).toMatchObject({ ok: true, created: 0 });
  });
});

describe('Capture Work (section 8)', () => {
  it('persists the recommendation and creates a self-initiated Quick Action', async () => {
    const client = await signInAs('izzah');
    const { data: capture, error } = await client
      .from('work_captures')
      .insert({
        captured_by: PEOPLE.izzah.id,
        title: 'Replace the faded label on cabinet 4',
        timing_choice: 'today',
        recommended_destination: 'quick_action',
        recommendation_reason: 'Same-day work with no continued follow-up.',
        followup_question: 'Will this require continued follow-up after today?',
        followup_answer: 'no',
      })
      .select('id')
      .single();
    expect(error).toBeNull();

    const { data, error: rpcError } = await client.rpc('confirm_work_capture', {
      p_capture_id: capture!.id,
      p_destination: 'quick_action',
      p_parent_task_id: null,
      p_idempotency_key: crypto.randomUUID(),
    });
    expect(rpcError).toBeNull();
    const result = data as Rpc;
    expect(result.ok).toBe(true);
    expect(result.code).toBe('work_created');

    const { data: task } = await serviceClient()
      .from('tasks')
      .select('status,work_class,origin,primary_owner_id')
      .eq('id', result.task_id as string)
      .single();
    expect(task).toMatchObject({
      status: 'active',
      work_class: 'quick_action',
      origin: 'self_initiated',
      primary_owner_id: PEOPLE.izzah.id,
    });
  });

  it('cannot create mandatory work from wording alone', async () => {
    const client = await signInAs('izzah');
    const { data: capture } = await client
      .from('work_captures')
      .insert({
        captured_by: PEOPLE.izzah.id,
        title: 'Review safety labels',
        timing_choice: 'today',
        recommended_destination: 'operational_available_work',
        recommendation_reason: 'The wording requires an explicit urgency answer.',
        urgency_question_asked: true,
        urgency_question_answer: false,
      })
      .select('id')
      .single();

    const { data } = await client.rpc('confirm_work_capture', {
      p_capture_id: capture!.id,
      p_destination: 'mandatory_operational_action',
      p_parent_task_id: null,
      p_idempotency_key: crypto.randomUUID(),
    });
    expect((data as Rpc).ok).toBe(false);
    expect((data as Rpc).code).toBe('invalid_state');
  });
});

describe('task detail updates and private attachments (sections 10–12)', () => {
  const taskId = 'f0c05300-0000-4000-a000-000000000002';

  it('commits an update, private attachment metadata, task age, and audit together', async () => {
    const client = await signInAs('izzah');
    const attachmentId = crypto.randomUUID();
    const path = `tasks/${taskId}/${attachmentId}-integration-evidence.txt`;
    const body = new Blob(['machine guarding evidence'], { type: 'text/plain' });
    const upload = await client.storage.from('task-attachments').upload(path, body, {
      contentType: 'text/plain',
      upsert: false,
    });
    expect(upload.error).toBeNull();

    const { data, error } = await client.rpc('post_task_update', {
      p_task_id: taskId,
      p_body: 'Operations supplied the first machine guarding record.',
      p_is_evidence_only: false,
      p_checklist_item_id: null,
      p_mention_ids: [],
      p_attachments: [
        {
          id: attachmentId,
          storage_path: path,
          file_name: 'integration-evidence.txt',
          mime_type: 'text/plain',
          byte_size: body.size,
          is_evidence: true,
        },
      ],
      p_idempotency_key: crypto.randomUUID(),
    });

    expect(error).toBeNull();
    const result = data as Rpc;
    expect(result).toMatchObject({ ok: true, code: 'update_posted', attachment_count: 1 });

    const admin = serviceClient();
    const [{ data: update }, { data: attachment }, { data: audit }] = await Promise.all([
      admin
        .from('task_updates')
        .select('task_id,author_id,body')
        .eq('id', result.update_id as string)
        .single(),
      admin
        .from('attachments')
        .select('task_id,update_id,storage_path,is_evidence,uploaded_by')
        .eq('id', attachmentId)
        .single(),
      admin
        .from('audit_events')
        .select('event_type')
        .eq('task_id', taskId)
        .eq('event_type', 'attachment_added')
        .order('occurred_at', { ascending: false })
        .limit(1)
        .single(),
    ]);
    expect(update).toMatchObject({
      task_id: taskId,
      author_id: PEOPLE.izzah.id,
      body: 'Operations supplied the first machine guarding record.',
    });
    expect(attachment).toMatchObject({
      task_id: taskId,
      update_id: result.update_id,
      storage_path: path,
      is_evidence: true,
      uploaded_by: PEOPLE.izzah.id,
    });
    expect(audit?.event_type).toBe('attachment_added');
  });

  it('keeps view permission separate from contribution permission', async () => {
    const client = await signInAs('amer');
    const { data: capabilities } = await client.rpc('get_task_capabilities', {
      p_task_id: taskId,
    });
    expect(capabilities).toMatchObject({
      can_view: true,
      can_contribute: false,
      can_edit: false,
    });

    const { data } = await client.rpc('post_task_update', {
      p_task_id: taskId,
      p_body: 'A visibility grant must not permit this update.',
      p_is_evidence_only: false,
      p_checklist_item_id: null,
      p_mention_ids: [],
      p_attachments: [],
      p_idempotency_key: crypto.randomUUID(),
    });
    expect(data).toMatchObject({ ok: false, code: 'not_authorised' });
  });
});

describe('activation (section 7)', () => {
  it('activates within target in one call, with no confirmation', async () => {
    const client = await signInAs('ajmal');
    const task = await fixture('ajmal');

    const { data } = await client.rpc('activate_task', {
      p_task_id: task.id,
      p_expected_version: task.version,
      p_reason_code: null,
      p_reason_note: null,
      p_idempotency_key: null,
    });

    const result = data as Rpc;
    expect(result.ok).toBe(true);
    expect(result.code).toBe('activated');
    expect(result.over_target).toBe(false);
  });

  it('asks exactly one reason question when the target would be crossed', async () => {
    const client = await signInAs('ajmal');

    // Ajmal's operational target is 5. Fill it, then attempt one more.
    const tasks = await Promise.all(Array.from({ length: 6 }, () => fixture('ajmal')));

    let reasonRequired: Rpc | null = null;

    for (const task of tasks) {
      const { data } = await client.rpc('activate_task', {
        p_task_id: task.id,
        p_expected_version: task.version,
        p_reason_code: null,
        p_reason_note: null,
        p_idempotency_key: null,
      });

      const result = data as Rpc;
      if (!result.ok && result.code === 'reason_required') {
        reasonRequired = result;
        break;
      }
    }

    expect(reasonRequired).not.toBeNull();

    const detail = reasonRequired!.detail as { count_after: number; target: number };
    expect(detail.count_after).toBeGreaterThan(detail.target);
    // The message states both counts and the target (section 7.4).
    expect(reasonRequired!.message).toContain('Why is this additional focus needed now?');
  });

  it('proceeds once a reason is given, without any approval step', async () => {
    const client = await signInAs('ajmal');
    const tasks = await Promise.all(Array.from({ length: 7 }, () => fixture('ajmal')));

    let activatedOverTarget = false;

    for (const task of tasks) {
      const { data } = await client.rpc('activate_task', {
        p_task_id: task.id,
        p_expected_version: task.version,
        p_reason_code: 'urgent_deadline',
        p_reason_note: null,
        p_idempotency_key: null,
      });

      const result = data as Rpc;
      if (result.ok && result.over_target === true) {
        activatedOverTarget = true;
        break;
      }
    }

    expect(activatedOverTarget).toBe(true);
  });

  it('rejects "Other" without a note', async () => {
    const client = await signInAs('ajmal');
    const tasks = await Promise.all(Array.from({ length: 7 }, () => fixture('ajmal')));

    let noteRequired = false;

    for (const task of tasks) {
      const { data } = await client.rpc('activate_task', {
        p_task_id: task.id,
        p_expected_version: task.version,
        p_reason_code: 'other',
        p_reason_note: '   ',
        p_idempotency_key: null,
      });

      const result = data as Rpc;
      if (result.code === 'reason_note_required') {
        noteRequired = true;
        break;
      }
    }

    expect(noteRequired).toBe(true);
  });
});

describe('concurrency (PRODUCTION_LOGIC.md section 6)', () => {
  it('rejects a stale version with a conflict the user can act on', async () => {
    const client = await signInAs('ajmal');
    const task = await fixture('ajmal');

    // A reason is supplied so this activation always proceeds. These tests are
    // about versioning, not focus targets, and earlier tests in this file
    // deliberately leave the owner over target.
    await client.rpc('activate_task', {
      p_task_id: task.id,
      p_expected_version: task.version,
      p_reason_code: 'workload_peak',
      p_reason_note: null,
      p_idempotency_key: null,
    });

    // Second caller still holds the pre-activation version.
    const { data } = await client.rpc('move_task_to_available', {
      p_task_id: task.id,
      p_expected_version: task.version,
      p_idempotency_key: null,
    });

    const result = data as Rpc;
    expect(result.ok).toBe(false);
    expect(result.code).toBe('version_conflict');
    expect(result.message).toContain('updated by another user');
  });

  it('absorbs a repeated click through the idempotency key', async () => {
    const client = await signInAs('ajmal');
    const task = await fixture('ajmal');
    const key = crypto.randomUUID();

    const args = {
      p_task_id: task.id,
      p_expected_version: task.version,
      p_reason_code: 'workload_peak',
      p_reason_note: null,
      p_idempotency_key: key,
    };

    const first = (await client.rpc('activate_task', args)).data as Rpc;
    const second = (await client.rpc('activate_task', args)).data as Rpc;

    expect(first.ok).toBe(true);
    expect(second.audit_event_id).toBe(first.audit_event_id);

    const { count } = await serviceClient()
      .from('audit_events')
      .select('id', { count: 'exact', head: true })
      .eq('task_id', task.id)
      .in('event_type', ['task_activated', 'over_target_activation']);

    expect(count).toBe(1);
  });

  it('runs concurrent activations without double-counting', async () => {
    const client = await signInAs('ajmal');
    const tasks = await Promise.all(Array.from({ length: 3 }, () => fixture('ajmal')));

    await Promise.all(
      tasks.map((task) =>
        client.rpc('activate_task', {
          p_task_id: task.id,
          p_expected_version: task.version,
          p_reason_code: 'workload_peak',
          p_reason_note: null,
          p_idempotency_key: crypto.randomUUID(),
        }),
      ),
    );

    // The count must equal what the database actually holds, not the number of
    // calls that were issued.
    const admin = serviceClient();
    const { count: activeCount } = await admin
      .from('tasks')
      .select('id', { count: 'exact', head: true })
      .eq('primary_owner_id', PEOPLE.ajmal.id)
      .eq('focus_bucket', 'operational')
      .eq('status', 'active');

    const { data: summary } = await admin
      .from('focus_summary')
      .select('active_count')
      .eq('user_id', PEOPLE.ajmal.id)
      .eq('bucket', 'operational')
      .single();

    expect((summary as { active_count: number }).active_count).toBe(activeCount);
  });
});

describe('undo (section 24.3)', () => {
  it('reverses the transition and preserves both events', async () => {
    const client = await signInAs('ajmal');
    const task = await fixture('ajmal');

    const activation = (
      await client.rpc('activate_task', {
        p_task_id: task.id,
        p_expected_version: task.version,
        p_reason_code: 'workload_peak',
        p_reason_note: null,
        p_idempotency_key: null,
      })
    ).data as Rpc;

    const undone = (
      await client.rpc('undo_event', {
        p_event_id: activation.audit_event_id,
        p_idempotency_key: null,
      })
    ).data as Rpc;

    expect(undone.ok).toBe(true);

    const admin = serviceClient();

    const { data: task_ } = await admin.from('tasks').select('status').eq('id', task.id).single();
    expect((task_ as { status: string }).status).toBe('backlog');

    // History is never erased: the original and its reversal both survive.
    const { data: events } = await admin
      .from('audit_events')
      .select('event_type, reversal_of_event_id')
      .eq('task_id', task.id);

    const rows = events as { event_type: string; reversal_of_event_id: string | null }[];
    expect(
      rows.some((row) => ['task_activated', 'over_target_activation'].includes(row.event_type)),
    ).toBe(true);
    expect(rows.some((row) => row.reversal_of_event_id === activation.audit_event_id)).toBe(true);
  });
});

describe('completion (section 20.1)', () => {
  it('refuses to complete while required evidence is missing, and says what', async () => {
    const client = await signInAs('ajmal');
    const task = await fixture('ajmal');
    const admin = serviceClient();

    await admin.from('task_checklist_items').insert({
      task_id: task.id,
      position: 0,
      action: 'Attach the calibration certificate',
      evidence_rule: 'required',
      state: 'ready',
    });

    const { data } = await client.rpc('complete_task', {
      p_task_id: task.id,
      p_expected_version: task.version,
      p_completion_note: null,
      p_idempotency_key: null,
    });

    const result = data as Rpc;
    expect(result.ok).toBe(false);
    expect(result.code).toBe('evidence_missing');

    const detail = result.detail as { incomplete_items: string[] };
    expect(detail.incomplete_items).toContain('Attach the calibration certificate');
  });
});

describe('barriers (section 14.3)', () => {
  it('does not pause the task unless work genuinely cannot continue', async () => {
    const client = await signInAs('ajmal');
    const task = await fixture('ajmal', { status: 'active' });

    const { data } = await client.rpc('raise_barrier', {
      p_task_id: task.id,
      p_description: 'Waiting on a quotation from the supplier.',
      p_support_needed: 'Approval to use the alternative supplier.',
      p_impact: 'may_delay',
      p_add_to_meeting_queue: false,
      p_idempotency_key: null,
    });

    expect((data as Rpc).ok).toBe(true);
    expect((data as Rpc).task_paused).toBe(false);

    const { data: after } = await serviceClient()
      .from('tasks')
      .select('status')
      .eq('id', task.id)
      .single();

    expect((after as { status: string }).status).toBe('active');
  });

  it('pauses the task when work cannot continue', async () => {
    const client = await signInAs('ajmal');
    const task = await fixture('ajmal', { status: 'active' });

    const { data } = await client.rpc('raise_barrier', {
      p_task_id: task.id,
      p_description: 'The line is isolated and cannot be worked on.',
      p_support_needed: 'A decision on when the line can be released.',
      p_impact: 'cannot_continue',
      p_add_to_meeting_queue: true,
      p_idempotency_key: null,
    });

    expect((data as Rpc).task_paused).toBe(true);

    const { data: after } = await serviceClient()
      .from('tasks')
      .select('status')
      .eq('id', task.id)
      .single();

    expect((after as { status: string }).status).toBe('paused');
  });
});
