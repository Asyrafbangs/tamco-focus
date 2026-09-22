import { createHash, randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { serviceClient, signInAs } from './setup';

/** The one organisation the fixtures live in. */
const ORGANIZATION = 'e5e50000-0000-4000-8000-000000000001';

/**
 * v206 — one owner with many actions, doing several at once.
 *
 * Against the real database: the owner's own inbox session, the same routines
 * the single-action chat uses, and the per-item answer the screen shows.
 */

const secret = () => randomBytes(32).toString('base64url');
const hash = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');

describe('v206 bulk operations', () => {
  it('updates, asks for more time and submits several actions, each on its own', async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const owner = `bulk.owner.${suffix}@example.com`;
    const service = serviceClient();
    const izzul = await signInAs('izzul');
    const { data: departments } = await izzul.from('departments').select('id,code');
    const ops = departments?.find((department) => department.code === 'OPS')?.id;

    const actions: string[] = [];
    for (const title of ['walkway', 'guard', 'label']) {
      const saved = await izzul.rpc('esh_save_finding', {
        p_finding_id: null,
        p_payload: {
          title: `v206 ${title} ${suffix}`,
          description: 'Bulk fixture',
          reported_on: '2026-09-10',
          accountable_department_id: ops,
          required_outcome: 'Put it right',
          priority: 'normal',
          owner_email: owner,
          due_date: '2026-12-10',
          escalation: [],
          no_further_escalation_reason: 'Fixture needs no route.',
        },
        p_assign: true,
        p_idempotency_key: crypto.randomUUID(),
      });
      expect(saved.data).toMatchObject({ ok: true });
      actions.push(saved.data.action_id as string);
    }

    const { data: principal } = await service
      .from('esh_email_principals')
      .select('id')
      .eq('canonical_email', owner)
      .single();
    await service
      .from('esh_email_principals')
      .update({ access_enabled: true })
      .eq('id', principal!.id);

    // Two of these can be answered in words. The third still wants a
    // photograph, which is what makes the mixed result below a real one.
    await service
      .from('esh_finding_actions')
      .update({
        evidence_rule: 'no_file_exception',
        evidence_exception_reason: 'Fixture: the work speaks for itself',
      })
      .in('id', actions.slice(0, 2));

    // The owner's own inbox link, exchanged for a session the way the page does.
    const inboxSecret = secret();
    const sessionSecret = secret();
    await service.from('esh_access_grants').insert({
      organization_id: ORGANIZATION,
      principal_id: principal!.id,
      purpose: 'owner_inbox',
      token_hash: hash(inboxSecret),
      issued_reason: 'notification',
      expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    });
    const exchanged = await service.rpc('esh_guest_exchange', {
      p_token: inboxSecret,
      p_new_session: sessionSecret,
      p_existing_session: null,
      p_challenge: null,
      p_consume: true,
    });
    expect(exchanged.data).toMatchObject({ ok: true });

    // One update, three actions, three attributed messages, nothing submitted.
    const updated = await service.rpc('esh_guest_bulk_update', {
      p_session: sessionSecret,
      p_action_ids: actions,
      p_body: 'Parts ordered; fitting on Friday.',
      p_operation_key: `update-${suffix}`,
    });
    expect(updated.data).toMatchObject({ ok: true, succeeded: 3, failed: 0, skipped: 0 });

    const messages = await service
      .from('esh_action_messages')
      .select('action_id, author_kind, body')
      .in('action_id', actions)
      .eq('body', 'Parts ordered; fitting on Friday.');
    expect(messages.data?.length).toBe(3);
    expect(messages.data?.every((message) => message.author_kind === 'owner')).toBe(true);

    const submissions = await service
      .from('esh_action_submissions')
      .select('id', { count: 'exact', head: true })
      .in('action_id', actions);
    expect(submissions.count).toBe(0);

    // The same press again is the same operation.
    const again = await service.rpc('esh_guest_bulk_update', {
      p_session: sessionSecret,
      p_action_ids: actions,
      p_body: 'Parts ordered; fitting on Friday.',
      p_operation_key: `update-${suffix}`,
    });
    expect(again.data).toMatchObject({ succeeded: 3 });
    const messagesAgain = await service
      .from('esh_action_messages')
      .select('id', { count: 'exact', head: true })
      .in('action_id', actions)
      .eq('body', 'Parts ordered; fitting on Friday.');
    expect(messagesAgain.count).toBe(3);

    // Asking for more time changes no deadline.
    const asked = await service.rpc('esh_guest_bulk_extension', {
      p_session: sessionSecret,
      p_action_ids: actions.slice(0, 2),
      p_body: 'Waiting on the contractor.',
      p_proposed_date: '2027-01-15',
      p_operation_key: `time-${suffix}`,
    });
    expect(asked.data).toMatchObject({ ok: true, succeeded: 2 });
    const unchanged = await service
      .from('esh_finding_actions')
      .select('due_at')
      .in('id', actions.slice(0, 2));
    expect(unchanged.data?.every((action) => String(action.due_at).startsWith('2026-12-10'))).toBe(
      true,
    );
    const proposals = await service
      .from('esh_action_messages')
      .select('id', { count: 'exact', head: true })
      .in('action_id', actions.slice(0, 2))
      .eq('proposed_due_date', '2027-01-15');
    expect(proposals.count).toBe(2);

    // Submitting two is two submissions, each waiting on its own verification.
    const submitted = await service.rpc('esh_guest_bulk_submit', {
      p_session: sessionSecret,
      p_rows: [
        { action_id: actions[0], result_text: 'Guard refitted and tested.' },
        { action_id: actions[1], result_text: 'Label replaced.' },
      ],
      p_operation_key: `submit-${suffix}`,
    });
    expect(submitted.data).toMatchObject({ ok: true, succeeded: 2 });
    const pending = await service
      .from('esh_action_submissions')
      .select('action_id, version, state')
      .in('action_id', actions);
    expect(pending.data?.length).toBe(2);
    expect(pending.data?.every((row) => row.state === 'pending' && row.version === 1)).toBe(true);

    // Talking about an action that is with ESH is still allowed; what a batch
    // cannot do is submit it again.
    const mixed = await service.rpc('esh_guest_bulk_update', {
      p_session: sessionSecret,
      p_action_ids: actions,
      p_body: 'One more note.',
      p_operation_key: `mixed-${suffix}`,
    });
    expect(mixed.data).toMatchObject({ ok: true, succeeded: 3, skipped: 0 });

    const resubmit = await service.rpc('esh_guest_bulk_submit', {
      p_session: sessionSecret,
      p_rows: actions.map((actionId) => ({ action_id: actionId, result_text: 'Again.' })),
      p_operation_key: `resubmit-${suffix}`,
    });
    // The two already with ESH are skipped; the third still wants a photograph.
    expect(resubmit.data).toMatchObject({ ok: true, succeeded: 0, skipped: 2, failed: 1 });
    const items = (resubmit.data.items ?? []) as Array<{
      action_id: string;
      state: string;
      code: string | null;
    }>;
    expect(
      items
        .filter((item) => item.state === 'skipped')
        .map((item) => item.action_id)
        .sort(),
    ).toEqual(actions.slice(0, 2).sort());
    expect(items.find((item) => item.state === 'failed')?.code).toBe('evidence_incomplete');
  }, 120_000);

  it('refuses batch work from an action-only link', async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const owner = `bulk.single.${suffix}@example.com`;
    const service = serviceClient();
    const izzul = await signInAs('izzul');
    const { data: departments } = await izzul.from('departments').select('id,code');
    const saved = await izzul.rpc('esh_save_finding', {
      p_finding_id: null,
      p_payload: {
        title: `v206 single ${suffix}`,
        description: 'Bulk fixture',
        reported_on: '2026-09-10',
        accountable_department_id: departments?.find((d) => d.code === 'OPS')?.id,
        required_outcome: 'Put it right',
        priority: 'normal',
        owner_email: owner,
        due_date: '2026-12-10',
        escalation: [],
        no_further_escalation_reason: 'Fixture needs no route.',
      },
      p_assign: true,
      p_idempotency_key: crypto.randomUUID(),
    });
    const actionId = saved.data.action_id as string;
    const { data: principal } = await service
      .from('esh_email_principals')
      .select('id')
      .eq('canonical_email', owner)
      .single();
    await service
      .from('esh_email_principals')
      .update({ access_enabled: true })
      .eq('id', principal!.id);

    const linkSecret = secret();
    const sessionSecret = secret();
    await service.from('esh_access_grants').insert({
      organization_id: ORGANIZATION,
      principal_id: principal!.id,
      purpose: 'owner_action',
      action_id: actionId,
      assignment_version: 1,
      token_hash: hash(linkSecret),
      issued_reason: 'notification',
      expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    });
    await service.rpc('esh_guest_exchange', {
      p_token: linkSecret,
      p_new_session: sessionSecret,
      p_existing_session: null,
      p_challenge: null,
      p_consume: true,
    });

    const refused = await service.rpc('esh_guest_bulk_update', {
      p_session: sessionSecret,
      p_action_ids: [actionId],
      p_body: 'Trying it from the wrong link.',
      p_operation_key: `single-${suffix}`,
    });
    expect(refused.data).toMatchObject({ ok: false, code: 'not_available' });
  }, 60_000);
});
