import { createHash, randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { runEshOutboxWorker } from '@/server/esh/dispatch';

import { PEOPLE, serviceClient, signInAs } from './setup';

/**
 * v200 — what reaches people when ESH decides (§13, §14, §17).
 *
 * Accepting closes the finding and tells the owner, with nothing to open;
 * reassigning stops the old owner's links working and sends the new owner
 * their own. Both are checked through the real worker, so what is sent is
 * what an owner would actually receive.
 */

const ORGANIZATION = 'e5e50000-0000-4000-8000-000000000001';
type Sent = { to: string; subject: string; html: string; text: string };

async function submitted(id: string, owner: string) {
  const service = serviceClient();
  const izzul = await signInAs('izzul');
  const { data: departments } = await izzul.from('departments').select('id').eq('code', 'OPS');
  const { data: saved } = await izzul.rpc('esh_save_finding', {
    p_finding_id: null,
    p_payload: {
      title: `v200 ${id}`,
      description: 'Guard missing on press 2.',
      reported_on: '2026-09-18',
      accountable_department_id: departments?.[0]?.id,
      required_outcome: 'Refit the guard.',
      priority: 'normal',
      owner_email: owner,
      due_date: '2026-12-01',
      no_further_escalation_reason: 'Integration test',
    },
    p_assign: true,
    p_idempotency_key: crypto.randomUUID(),
  });
  const finding = saved as { finding_id: string; action_id: string };
  const { data: contact } = await service
    .from('esh_email_principals')
    .select('id')
    .eq('canonical_email', owner)
    .single();
  await service.from('esh_email_principals').update({ access_enabled: true }).eq('id', contact!.id);
  await service
    .from('esh_notification_outbox')
    .update({ state: 'provider_accepted', sent_at: new Date().toISOString() })
    .eq('action_id', finding.action_id)
    .eq('event_type', 'owner_assignment');

  const token = randomBytes(32).toString('base64url');
  await service.from('esh_access_grants').insert({
    organization_id: ORGANIZATION,
    principal_id: contact!.id,
    purpose: 'owner_action',
    action_id: finding.action_id,
    assignment_version: 1,
    token_hash: createHash('sha256').update(token, 'utf8').digest('hex'),
    issued_reason: 'notification',
    expires_at: new Date(Date.now() + 3_600_000).toISOString(),
  });
  const session = randomBytes(32).toString('base64url');
  await service.rpc('esh_guest_exchange', {
    p_token: token,
    p_new_session: session,
    p_existing_session: null,
    p_challenge: null,
    p_consume: true,
  });
  const { data: started } = await service.rpc('esh_guest_start_upload', {
    p_session: session,
    p_action_id: finding.action_id,
    p_name: 'after.jpg',
    p_size: 2048,
  });
  const assetId = (started as { asset_id: string }).asset_id;
  await service.rpc('esh_guest_finish_upload', {
    p_session: session,
    p_asset_id: assetId,
    p_ok: true,
    p_type: 'image/jpeg',
    p_size: 2048,
    p_sha256: 'a'.repeat(64),
    p_reason: null,
  });
  const { data: submission } = await service.rpc('esh_guest_submit', {
    p_session: session,
    p_action_id: finding.action_id,
    p_body: 'Guard refitted.',
    p_asset_ids: [assetId],
    p_reuse_message_id: null,
    p_client_key: `submit-${id}`,
  });
  return {
    ...finding,
    owner,
    contactId: contact!.id as string,
    session,
    submissionId: (submission as { submission_id: string }).submission_id,
  };
}

async function send(): Promise<Sent[]> {
  const sent: Sent[] = [];
  await runEshOutboxWorker(serviceClient(), {
    appBaseUrl: 'https://tamco-focus.example',
    transport: 'smtp',
    send: async (message) => {
      sent.push(message);
    },
  });
  return sent;
}

describe('v200 verification email', () => {
  it('tells the owner a finding is closed, with nothing to open', async () => {
    const id = crypto.randomUUID().slice(0, 8);
    const work = await submitted(id, `closed.${id}@example.com`);
    await send(); // the review request to ESH

    const lim = await signInAs('lim');
    const service = serviceClient();
    await service.from('esh_staff_access').upsert(
      {
        organization_id: ORGANIZATION,
        user_id: PEOPLE.lim.id,
        enabled: true,
        preset: 'verifier',
        scope_all_departments: true,
      },
      { onConflict: 'organization_id,user_id' },
    );
    const { data: decided } = await lim.rpc('esh_verify_submission', {
      p_submission_id: work.submissionId,
      p_decision: 'accepted',
      p_method: 'document_review',
      p_note: 'Photo matches the required outcome.',
      p_keep_due: null,
      p_due_date: null,
      p_due_time: null,
    });
    expect(decided).toMatchObject({ ok: true, closed: true });

    const sent = await send();
    const closure = sent.filter((message) => message.to === work.owner);
    expect(closure).toHaveLength(1);
    expect(closure[0]!.subject).toContain('Closed:');
    // Nothing to open: a closed action has no live link (§20).
    expect(closure[0]!.text).not.toMatch(/respond\/access/);
    const { data: grants } = await service
      .from('esh_access_grants')
      .select('purpose')
      .eq('action_id', work.action_id)
      .is('revoked_at', null)
      .is('consumed_at', null);
    expect(grants ?? []).toHaveLength(0);
  });

  it('moves an action to a new owner and stops the old links at once', async () => {
    const id = crypto.randomUUID().slice(0, 8);
    const work = await submitted(id, `moved.${id}@example.com`);
    const service = serviceClient();
    // Decide the submission first: an action under review is not reassigned.
    const izzul = await signInAs('izzul');
    const early = await izzul.rpc('esh_reassign_action', {
      p_action_id: work.action_id,
      p_owner_email: `next.${id}@example.com`,
      p_reason: 'Night shift',
    });
    expect(early.data).toMatchObject({ code: 'decide_submission_first' });

    const lim = await signInAs('lim');
    await service.from('esh_staff_access').upsert(
      {
        organization_id: ORGANIZATION,
        user_id: PEOPLE.lim.id,
        enabled: true,
        preset: 'verifier',
        scope_all_departments: true,
      },
      { onConflict: 'organization_id,user_id' },
    );
    await lim.rpc('esh_verify_submission', {
      p_submission_id: work.submissionId,
      p_decision: 'changes_requested',
      p_method: null,
      p_note: 'The whole guard, please.',
      p_keep_due: true,
      p_due_date: null,
      p_due_time: null,
    });

    const moved = await izzul.rpc('esh_reassign_action', {
      p_action_id: work.action_id,
      p_owner_email: `next.${id}@example.com`,
      p_reason: 'Night shift',
    });
    expect(moved.data).toMatchObject({ ok: true });

    // The old owner's session no longer reaches it (FM13).
    const { data: gone } = await service.rpc('esh_guest_action', {
      p_session: work.session,
      p_action_id: work.action_id,
      p_before: null,
    });
    expect(gone).toMatchObject({ ok: false, code: 'not_available' });

    // The new owner is a contact nobody has enabled yet, so their assignment
    // email waits, exactly as a first assignment does (FM105).
    const first = await send();
    expect(first.filter((message) => message.to === `next.${id}@example.com`)).toHaveLength(0);
    const { data: waiting } = await service
      .from('esh_notification_outbox')
      .select('id, state')
      .eq('action_id', work.action_id)
      .eq('event_type', 'owner_assignment')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();
    expect(waiting!.state).toBe('held_rollout');
    const toOld = first.filter((message) => message.to === work.owner);
    expect(toOld.map((message) => message.subject.split(':')[0])).toContain('Handed over');
    expect(toOld.every((message) => !/respond\/access/.test(message.text))).toBe(true);

    const { data: newContact } = await service
      .from('esh_email_principals')
      .select('id')
      .eq('canonical_email', `next.${id}@example.com`)
      .single();
    const admin = await signInAs('admin');
    await admin.rpc('esh_set_contact_access', {
      p_principal_id: newContact!.id,
      p_enabled: true,
      p_reason: 'v200 integration',
    });
    const released = await izzul.rpc('esh_release_notification', { p_outbox_id: waiting!.id });
    expect(released.data).toMatchObject({ ok: true });

    const sent = await send();
    const toNew = sent.filter((message) => message.to === `next.${id}@example.com`);
    expect(toNew).toHaveLength(1);
    expect(toNew[0]!.subject).toContain('Action assigned:');
    expect(toNew[0]!.text).toContain('View finding & respond:');
  });
});
