import { afterEach, describe, expect, it } from 'vitest';

import { PEOPLE, serviceClient, signInAs } from './setup';

/**
 * v148 — "Report urgent issue" creates the work.
 *
 * It did not. `confirm_work_capture` writes an activation audit event for the
 * mandatory destination, and that call passed an uncast `case` over two string
 * literals as its event type. Postgres resolves that to `text`;
 * `focus.write_audit` declares `public.audit_event_type`; no function matches,
 * 42883 is raised inside the procedure, and the whole confirmation rolls back.
 *
 * The branch runs only for `mandatory_operational_action`, so every ordinary
 * capture worked and the urgent one silently created nothing — which is the
 * worst possible place for this to have been.
 *
 * The only existing test of that destination asserted a REFUSAL (the urgency
 * question unanswered) and returned before reaching the audit call, which is
 * how it survived. This one goes all the way through.
 */

type Rpc = Record<string, unknown> & { ok: boolean; code?: string; task_id?: string };

const createdTasks: string[] = [];
const createdCaptures: string[] = [];

afterEach(async () => {
  const admin = serviceClient();
  while (createdTasks.length) await admin.from('tasks').delete().eq('id', createdTasks.pop()!);
  while (createdCaptures.length) {
    await admin.from('work_captures').delete().eq('id', createdCaptures.pop()!);
  }
});

async function urgentDraft(title: string) {
  const { data, error } = await serviceClient()
    .from('work_captures')
    .insert({
      captured_by: PEOPLE.izzah.id,
      title,
      timing_choice: 'today',
      recommended_destination: 'mandatory_operational_action',
      recommendation_reason: 'Reported as an urgent safety issue.',
      // The database refuses a mandatory outcome unless the question was asked
      // and answered, which is the check the old test stopped at.
      urgency_question_asked: true,
      urgency_question_answer: true,
    })
    .select('id')
    .single();
  if (error) throw new Error(`Could not create the draft: ${error.message}`);
  createdCaptures.push(String(data!.id));
  return String(data!.id);
}

describe('reporting an urgent issue', () => {
  it('creates mandatory work that has already started', async () => {
    const title = `Urgent fixture ${crypto.randomUUID().slice(0, 8)}`;
    const captureId = await urgentDraft(title);

    const izzah = await signInAs('izzah');
    const { data } = await izzah.rpc('confirm_work_capture', {
      p_capture_id: captureId,
      p_destination: 'mandatory_operational_action',
      p_parent_task_id: null,
      p_idempotency_key: null,
    });

    const result = data as Rpc;
    expect(result.ok, `the urgent route was refused: ${JSON.stringify(result)}`).toBe(true);
    expect(result.code).toBe('work_created');
    expect(result.task_id).toBeTruthy();
    createdTasks.push(String(result.task_id));

    const { data: task, error } = await serviceClient()
      .from('tasks')
      .select('status, is_mandatory, title')
      .eq('id', result.task_id!)
      .single();
    if (error) throw new Error(`Could not read the task: ${error.message}`);

    // Urgent work does not wait in Available for somebody to decide to start it.
    expect(task!.status).toBe('active');
    expect(task!.is_mandatory).toBe(true);
    expect(task!.title).toBe(title);
  });

  it('records the activation in the audit trail', async () => {
    const captureId = await urgentDraft(`Urgent audit ${crypto.randomUUID().slice(0, 8)}`);

    const izzah = await signInAs('izzah');
    const result = (
      await izzah.rpc('confirm_work_capture', {
        p_capture_id: captureId,
        p_destination: 'mandatory_operational_action',
        p_parent_task_id: null,
        p_idempotency_key: null,
      })
    ).data as Rpc;
    expect(result.ok).toBe(true);
    createdTasks.push(String(result.task_id));

    const { data: events, error } = await serviceClient()
      .from('audit_events')
      .select('event_type')
      .eq('task_id', result.task_id!);
    if (error) throw new Error(`Could not read the audit trail: ${error.message}`);

    const types = (events ?? []).map((row) => String(row.event_type));
    expect(types).toContain('task_created');
    expect(types).toContain('task_activated');
    /*
     * And not `over_target_activation`. v144 (§3) retired the focus target as
     * something the product draws conclusions from, and this was the one place
     * still emitting that event.
     */
    expect(types).not.toContain('over_target_activation');
  });
});
