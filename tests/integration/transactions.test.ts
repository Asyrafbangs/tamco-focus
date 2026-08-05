import { describe, expect, it } from 'vitest';

import { createTask, PEOPLE, serviceClient, signInAs } from './setup';

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
