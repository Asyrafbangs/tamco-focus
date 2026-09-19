import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { runEshOutboxWorker } from '@/server/esh/dispatch';
import { PermanentDeliveryError } from '@/server/workers/smtp-transport';

import { serviceClient, signInAs } from './setup';

/**
 * v198 — Finding Management email, end to end against the local database.
 *
 * Assign → the email is held → an administrator enables the contact → ESH
 * releases it → the worker mints two links, sends one email and keeps only
 * the links' hashes → each link opens on its own. And when sending fails,
 * the links it minted stop working (§22), and a permanent failure is put in
 * front of ESH rather than retried for ever (§17).
 */

type Sent = { to: string; subject: string; html: string; text: string };

const hash = (secret: string) => createHash('sha256').update(secret, 'utf8').digest('hex');

async function assignTo(owner: string, title: string) {
  const izzul = await signInAs('izzul');
  const { data: departments } = await izzul.from('departments').select('id').eq('code', 'OPS');
  const { data, error } = await izzul.rpc('esh_save_finding', {
    p_finding_id: null,
    p_payload: {
      title,
      description: 'Integration coverage for v198 email links.',
      reported_on: '2026-09-18',
      accountable_department_id: departments?.[0]?.id,
      location: 'BR2',
      required_outcome: 'Put it right.',
      priority: 'high',
      owner_email: owner,
      due_date: '2026-12-01',
      no_further_escalation_reason: 'Integration test',
    },
    p_assign: true,
    p_idempotency_key: crypto.randomUUID(),
  });
  expect(error).toBeNull();
  expect(data).toMatchObject({ ok: true, notification: 'held_rollout' });
  return data as { finding_id: string; action_id: string };
}

async function enableAndRelease(owner: string, actionId: string) {
  const service = serviceClient();
  const { data: contact } = await service
    .from('esh_email_principals')
    .select('id')
    .eq('canonical_email', owner.toLowerCase())
    .single();
  const admin = await signInAs('admin');
  const enabled = await admin.rpc('esh_set_contact_access', {
    p_principal_id: contact!.id,
    p_enabled: true,
    p_reason: 'v198 integration',
  });
  expect(enabled.data).toMatchObject({ ok: true });

  const { data: outbox } = await service
    .from('esh_notification_outbox')
    .select('id, state')
    .eq('action_id', actionId)
    .eq('event_type', 'owner_assignment')
    .single();
  expect(outbox!.state).toBe('held_rollout');
  const izzul = await signInAs('izzul');
  const released = await izzul.rpc('esh_release_notification', { p_outbox_id: outbox!.id });
  expect(released.data).toMatchObject({ ok: true });
  return { contactId: contact!.id as string, outboxId: outbox!.id as string };
}

describe('v198 Finding Management email', () => {
  it('sends one email with two independent links, and stores only their hashes', async () => {
    const id = crypto.randomUUID().slice(0, 8);
    const owner = `owner.${id}@example.com`;
    const title = `v198 email ${id}`;
    const { action_id: actionId } = await assignTo(owner, title);
    const { outboxId } = await enableAndRelease(owner, actionId);

    const sent: Sent[] = [];
    const service = serviceClient();
    const result = await runEshOutboxWorker(service, {
      appBaseUrl: 'https://tamco-focus.example',
      transport: 'smtp',
      send: async (message) => {
        sent.push(message);
      },
    });
    expect(result.failed).toBe(0);
    const mine = sent.filter((message) => message.to === owner);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.subject).toContain(title);

    const action = /View finding & respond: (\S+)/.exec(mine[0]!.text)?.[1];
    const inbox = /View All My Actions: (\S+)/.exec(mine[0]!.text)?.[1];
    expect(action).toMatch(/^https:\/\/tamco-focus\.example\/respond\/access\?for=action#/);
    expect(inbox).toMatch(/^https:\/\/tamco-focus\.example\/respond\/access\?for=actions#/);
    const actionSecret = new URL(action!).hash.slice(1);
    const inboxSecret = new URL(inbox!).hash.slice(1);
    expect(actionSecret).not.toBe(inboxSecret);

    const { data: grants } = await service
      .from('esh_access_grants')
      .select('purpose, token_hash')
      .eq('outbox_id', outboxId)
      .order('purpose');
    expect(grants).toEqual([
      { purpose: 'owner_action', token_hash: hash(actionSecret) },
      { purpose: 'owner_inbox', token_hash: hash(inboxSecret) },
    ]);
    const { data: outbox } = await service
      .from('esh_notification_outbox')
      .select('state')
      .eq('id', outboxId)
      .single();
    expect(outbox!.state).toBe('provider_accepted');

    // Each link opens on its own (FM11): spending one leaves the other.
    const opened = await service.rpc('esh_guest_exchange', {
      p_token: actionSecret,
      p_new_session: `${crypto.randomUUID()}${crypto.randomUUID()}`,
      p_existing_session: null,
      p_challenge: null,
      p_consume: true,
    });
    expect(opened.data).toMatchObject({ ok: true, destination: `/respond/actions/${actionId}` });
    const inboxOpened = await service.rpc('esh_guest_exchange', {
      p_token: inboxSecret,
      p_new_session: `${crypto.randomUUID()}${crypto.randomUUID()}`,
      p_existing_session: null,
      p_challenge: null,
      p_consume: true,
    });
    expect(inboxOpened.data).toMatchObject({ ok: true, destination: '/respond/my-actions' });

    // A second run sends nothing more (FM39).
    const again: Sent[] = [];
    await runEshOutboxWorker(service, {
      appBaseUrl: 'https://tamco-focus.example',
      transport: 'smtp',
      send: async (message) => {
        again.push(message);
      },
    });
    expect(again.filter((message) => message.to === owner)).toHaveLength(0);
  });

  it('revokes the links of a failed send, and stops on a permanent refusal', async () => {
    const id = crypto.randomUUID().slice(0, 8);
    const owner = `bounce.${id}@example.com`;
    const title = `v198 bounce ${id}`;
    const { action_id: actionId, finding_id: findingId } = await assignTo(owner, title);
    const { outboxId } = await enableAndRelease(owner, actionId);

    const service = serviceClient();
    const refused = await runEshOutboxWorker(service, {
      appBaseUrl: 'https://tamco-focus.example',
      transport: 'smtp',
      send: async (message) => {
        if (message.to === owner) throw new PermanentDeliveryError('550 mailbox unavailable');
      },
    });
    expect(refused.failed).toBeGreaterThanOrEqual(1);

    const { data: outbox } = await service
      .from('esh_notification_outbox')
      .select('state, next_attempt_at, last_error')
      .eq('id', outboxId)
      .single();
    expect(outbox).toMatchObject({ state: 'failed', next_attempt_at: null });
    expect(outbox!.last_error).toContain('550');

    const { data: grants } = await service
      .from('esh_access_grants')
      .select('revoked_reason')
      .eq('outbox_id', outboxId);
    expect(grants!.map((grant) => grant.revoked_reason)).toEqual(['send_failed', 'send_failed']);

    // ESH sees it, as a delivery problem rather than the owner ignoring it.
    const izzul = await signInAs('izzul');
    const { data: row } = await izzul
      .from('esh_register_rows')
      .select('needs_attention, notification_failed')
      .eq('finding_id', findingId)
      .single();
    expect(row).toEqual({ needs_attention: true, notification_failed: true });
  });

  it('re-checks access at the moment of sending, and holds the email if it is off', async () => {
    const id = crypto.randomUUID().slice(0, 8);
    const owner = `paused.${id}@example.com`;
    const { action_id: actionId } = await assignTo(owner, `v198 paused ${id}`);
    const { contactId, outboxId } = await enableAndRelease(owner, actionId);

    // Switched off behind the procedure's back, so what is tested is the
    // worker's own re-check at the moment of sending (§43.3), not the
    // procedure that would also have held it.
    const paused = await serviceClient()
      .from('esh_email_principals')
      .update({ access_enabled: false })
      .eq('id', contactId);
    expect(paused.error).toBeNull();

    const sent: Sent[] = [];
    await runEshOutboxWorker(serviceClient(), {
      appBaseUrl: 'https://tamco-focus.example',
      transport: 'smtp',
      send: async (message) => {
        sent.push(message);
      },
    });
    expect(sent.filter((message) => message.to === owner)).toHaveLength(0);
    const { data: outbox } = await serviceClient()
      .from('esh_notification_outbox')
      .select('state, state_reason')
      .eq('id', outboxId)
      .single();
    expect(outbox).toEqual({ state: 'held_rollout', state_reason: 'access_not_enabled' });
  });
});
