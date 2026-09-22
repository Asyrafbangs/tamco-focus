import { describe, expect, it } from 'vitest';

import { runEshOutboxWorker } from '@/server/esh/dispatch';

import { serviceClient, signInAs } from './setup';

/**
 * v207 — one letter instead of eleven, sent by the real worker.
 *
 * The scheduler raises a reminder per action, the builder gathers them, and
 * the worker sends one message listing them with one link to the owner's own
 * list. A second run sends nothing more.
 */

interface Sent {
  to: string;
  subject: string;
  text: string;
  html: string;
}

describe('v207 consolidated notices', () => {
  it('sends one letter covering several overdue actions, and only once', async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const owner = `digest.owner.${suffix}@example.com`;
    const service = serviceClient();
    const izzul = await signInAs('izzul');
    const { data: departments } = await izzul.from('departments').select('id,code');
    const ops = departments?.find((department) => department.code === 'OPS')?.id;

    // Three overdue actions whose reminders fall on the same cycle.
    const titles = [`v207 walkway ${suffix}`, `v207 guard ${suffix}`, `v207 label ${suffix}`];
    const dues = ['2026-09-04', '2026-09-06', '2026-09-08'];
    for (let index = 0; index < titles.length; index += 1) {
      const saved = await izzul.rpc('esh_save_finding', {
        p_finding_id: null,
        p_payload: {
          title: titles[index],
          description: 'Digest fixture',
          reported_on: '2026-09-01',
          accountable_department_id: ops,
          required_outcome: 'Put it right',
          priority: 'normal',
          owner_email: owner,
          due_date: dues[index],
          escalation: [],
          no_further_escalation_reason: 'Fixture needs no route.',
        },
        p_assign: true,
        p_idempotency_key: crypto.randomUUID(),
      });
      expect(saved.data).toMatchObject({ ok: true });
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
    // The assignment emails are a separate matter; this test is about the
    // reminders, so they are taken out of the post.
    await service
      .from('esh_notification_outbox')
      .update({ state: 'cancelled' })
      .eq('recipient_principal_id', principal!.id)
      .eq('event_type', 'owner_assignment');

    const followed = await service.rpc('esh_run_followups', {
      p_now: '2026-09-20T01:00:00.000Z',
    });
    expect(followed.error).toBeNull();
    const { count: reminders } = await service
      .from('esh_notification_outbox')
      .select('id', { count: 'exact', head: true })
      .eq('recipient_principal_id', principal!.id)
      .eq('event_type', 'owner_reminder')
      .eq('state', 'queued');
    expect(reminders).toBe(3);

    const built = await service.rpc('esh_build_digests', {});
    expect(built.data).toMatchObject({ ok: true });

    const sent: Sent[] = [];
    const result = await runEshOutboxWorker(service, {
      appBaseUrl: 'https://tamco-focus.example',
      transport: 'smtp',
      send: async (message) => {
        sent.push(message as Sent);
      },
    });
    expect(result.failed).toBe(0);

    const mine = sent.filter((message) => message.to === owner);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.subject).toContain('3 actions need your attention');
    for (const title of titles) expect(mine[0]!.text).toContain(title);

    // One link, to their own list — not one per action.
    const inbox = /View All My Actions: (\S+)/.exec(mine[0]!.text)?.[1];
    expect(inbox).toMatch(/^https:\/\/tamco-focus\.example\/respond\/access\?for=actions#/);
    expect(mine[0]!.text.match(/https:\/\/tamco-focus\.example/g)).toHaveLength(1);

    // Every reminder it carried is recorded as sent, against its own event.
    const { count: accepted } = await service
      .from('esh_notification_outbox')
      .select('id', { count: 'exact', head: true })
      .eq('recipient_principal_id', principal!.id)
      .eq('event_type', 'owner_reminder')
      .eq('state', 'provider_accepted');
    expect(accepted).toBe(3);

    // A second drain sends nothing more.
    const again: Sent[] = [];
    await runEshOutboxWorker(service, {
      appBaseUrl: 'https://tamco-focus.example',
      transport: 'smtp',
      send: async (message) => {
        again.push(message as Sent);
      },
    });
    expect(again.filter((message) => message.to === owner)).toHaveLength(0);
  }, 120_000);
});
