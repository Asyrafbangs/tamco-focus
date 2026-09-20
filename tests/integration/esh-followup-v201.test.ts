import { randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { runEshOutboxWorker } from '@/server/esh/dispatch';

import { serviceClient, signInAs } from './setup';

type Sent = { to: string; subject: string; html: string; text: string };

async function assigned(id: string) {
  const owner = `owner.v201.${id}@example.com`;
  const escalation = `supervisor.v201.${id}@example.com`;
  const izzul = await signInAs('izzul');
  const { data: departments } = await izzul.from('departments').select('id').eq('code', 'OPS');
  const { data, error } = await izzul.rpc('esh_save_finding', {
    p_finding_id: null,
    p_payload: {
      title: `v201 follow-up ${id}`,
      description: 'An overdue correction used to verify follow-up.',
      reported_on: '2026-09-18',
      accountable_department_id: departments?.[0]?.id,
      required_outcome: 'Complete the correction and show ESH.',
      priority: 'high',
      owner_email: owner,
      due_date: '2026-12-10',
      escalation: [{ level: 1, email: escalation }],
    },
    p_assign: true,
    p_idempotency_key: crypto.randomUUID(),
  });
  expect(error).toBeNull();
  expect(data).toMatchObject({ ok: true });
  const work = data as { action_id: string; finding_id: string };
  const service = serviceClient();
  await service
    .from('esh_email_principals')
    .update({ access_enabled: true })
    .in('canonical_email', [owner, escalation]);
  await service
    .from('esh_notification_outbox')
    .update({ state: 'provider_accepted', sent_at: new Date().toISOString() })
    .eq('action_id', work.action_id)
    .eq('event_type', 'owner_assignment');
  return { ...work, owner, escalation };
}

describe('v201 Finding follow-up and escalation', () => {
  it('sends a recipient-specific escalation link with support-only authority', async () => {
    const work = await assigned(crypto.randomUUID().slice(0, 8));
    const service = serviceClient();
    const run = await service.rpc('esh_run_followups', {
      p_now: '2026-12-12T01:00:00.000Z',
    });
    expect(run.error).toBeNull();

    const sent: Sent[] = [];
    await runEshOutboxWorker(service, {
      appBaseUrl: 'https://tamco-focus.example',
      transport: 'smtp',
      send: async (message) => {
        sent.push(message);
      },
    });
    const escalationMail = sent.find((message) => message.to === work.escalation);
    expect(escalationMail?.subject).toContain('Escalation level 1');
    expect(escalationMail?.text).not.toContain('View All My Actions');
    const url = /Open the action: (\S+)/.exec(escalationMail?.text ?? '')?.[1];
    expect(url).toMatch(/^https:\/\/tamco-focus\.example\/respond\/access\?for=action#/);

    const { data: outbox } = await service
      .from('esh_notification_outbox')
      .select('id')
      .eq('action_id', work.action_id)
      .eq('event_type', 'escalation')
      .single();
    const { data: grants } = await service
      .from('esh_access_grants')
      .select('purpose')
      .eq('outbox_id', outbox!.id);
    expect(grants).toEqual([{ purpose: 'escalation_action' }]);

    const session = randomBytes(32).toString('base64url');
    const opened = await service.rpc('esh_guest_exchange', {
      p_token: new URL(url!).hash.slice(1),
      p_new_session: session,
      p_existing_session: null,
      p_challenge: null,
      p_consume: true,
    });
    expect(opened.data).toMatchObject({
      ok: true,
      destination: `/respond/actions/${work.action_id}`,
    });
    const detail = await service.rpc('esh_guest_action', {
      p_session: session,
      p_action_id: work.action_id,
      p_before: null,
    });
    expect(detail.data).toMatchObject({ ok: true, mode: 'escalation', escalation_level: 1 });
    const inbox = await service.rpc('esh_guest_my_actions', {
      p_session: session,
      p_filter: 'needs',
      p_search: null,
      p_offset: 0,
      p_limit: 20,
    });
    expect(inbox.error).toBeNull();
    expect(inbox.data).toMatchObject({ ok: false, code: 'no_inbox_scope' });
    const submit = await service.rpc('esh_guest_submit', {
      p_session: session,
      p_action_id: work.action_id,
      p_body: 'I completed it.',
      p_asset_ids: [],
      p_reuse_message_id: null,
      p_client_key: `submit-${crypto.randomUUID()}`,
    });
    expect(submit.data).toMatchObject({ ok: false, code: 'not_available' });
    const reply = await service.rpc('esh_guest_send_message', {
      p_session: session,
      p_action_id: work.action_id,
      p_body: 'I will support the owner today.',
      p_client_key: `reply-${crypto.randomUUID()}`,
      p_asset_ids: [],
    });
    expect(reply.data).toMatchObject({ ok: true, notifications: expect.any(Number) });
    await runEshOutboxWorker(service, {
      appBaseUrl: 'https://tamco-focus.example',
      transport: 'smtp',
      send: async (message) => {
        sent.push(message);
      },
    });
    expect(sent.some((message) => message.subject.startsWith('Escalation response:'))).toBe(true);
    const acknowledged = await service.rpc('esh_guest_acknowledge', {
      p_session: session,
      p_action_id: work.action_id,
    });
    expect(acknowledged.data).toMatchObject({ ok: true, level: 1 });

    const { data: action } = await service
      .from('esh_finding_actions')
      .select('state')
      .eq('id', work.action_id)
      .single();
    expect(action?.state).toBe('assigned');
  });

  it('suppresses a queued reminder when ESH changes the due date before dispatch', async () => {
    const work = await assigned(crypto.randomUUID().slice(0, 8));
    const service = serviceClient();
    await service.rpc('esh_run_followups', { p_now: '2026-12-12T01:00:00.000Z' });
    const izzul = await signInAs('izzul');
    const changed = await izzul.rpc('esh_change_due', {
      p_action_id: work.action_id,
      p_due_date: '2026-12-30',
      p_due_time: null,
      p_reason: 'Parts arrive later',
    });
    expect(changed.data).toMatchObject({ ok: true });

    const sent: Sent[] = [];
    await runEshOutboxWorker(service, {
      appBaseUrl: 'https://tamco-focus.example',
      transport: 'smtp',
      send: async (message) => {
        sent.push(message);
      },
    });
    expect(
      sent.some((message) => message.to === work.owner && message.subject.startsWith('Overdue')),
    ).toBe(false);
    expect(sent.some((message) => message.to === work.escalation)).toBe(false);
    const { data: stale } = await service
      .from('esh_notification_outbox')
      .select('state, state_reason')
      .eq('action_id', work.action_id)
      .in('event_type', ['owner_reminder', 'escalation']);
    expect(stale).toEqual(
      expect.arrayContaining([
        { state: 'suppressed', state_reason: 'schedule_changed' },
        { state: 'suppressed', state_reason: 'schedule_changed' },
      ]),
    );
  });
});
