import { describe, expect, it } from 'vitest';

import { runNotificationEmailWorker } from '@/server/workers/notification-email';

import { PEOPLE, createTask, serviceClient, signInAs } from './setup';

describe('v120 notification email delivery', () => {
  it('queues and sends exactly one email for a manager-assigned task', async () => {
    const manager = await signInAs('izzul');
    const title = `Notification email assignment ${crypto.randomUUID().slice(0, 8)}`;
    const { data: result, error } = await manager.rpc('assign_work_to_people', {
      p_title: title,
      p_description: 'Integration coverage for transactional notification email.',
      p_work_class: 'operational_action',
      p_owner_ids: [PEOPLE.izzah.id],
      p_urgency: 'normal',
      p_due_at: null,
      p_due_is_date_only: true,
      p_review_at: null,
      p_idempotency_key: crypto.randomUUID(),
    });
    expect(error).toBeNull();
    expect(result).toMatchObject({ ok: true, created_count: 1 });

    const admin = serviceClient();
    const { data: notification } = await admin
      .from('notifications')
      .select('id,title,recipient_id')
      .eq('recipient_id', PEOPLE.izzah.id)
      .eq('title', 'New work assigned to you')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();
    const { data: queued } = await admin
      .from('notification_email_deliveries')
      .select('id,notification_id,status,recipient_email')
      .eq('notification_id', notification!.id)
      .single();
    expect(queued).toMatchObject({
      notification_id: notification!.id,
      status: 'queued',
      recipient_email: PEOPLE.izzah.email,
    });

    const sent: Array<{ to: string; subject: string; html: string; text: string }> = [];
    const first = await runNotificationEmailWorker(admin, {
      limit: 500,
      appBaseUrl: 'https://focus.example.com',
      send: async (message) => {
        sent.push(message);
      },
    });
    expect(first.failed).toBe(0);
    expect(
      sent.some((message) => message.to === PEOPLE.izzah.email && message.text.includes(title)),
    ).toBe(true);

    const { data: delivered } = await admin
      .from('notification_email_deliveries')
      .select('status,attempt_count,subject,body_html,body_text,sent_at')
      .eq('id', queued!.id)
      .single();
    expect(delivered?.status).toBe('sent');
    expect(delivered?.attempt_count).toBe(1);
    expect(delivered?.subject).toBe('TAMCO Focus — New work assigned to you');
    expect(delivered?.body_html).toContain('Open task');
    expect(delivered?.body_text).toContain(title);
    expect(delivered?.sent_at).not.toBeNull();

    const secondMessages: typeof sent = [];
    const second = await runNotificationEmailWorker(admin, {
      limit: 500,
      appBaseUrl: 'https://focus.example.com',
      send: async (message) => {
        secondMessages.push(message);
      },
    });
    expect(second.failed).toBe(0);
    expect(secondMessages).toHaveLength(0);
  });

  it('queues a checklist contribution email with the exact parent context', async () => {
    const task = await createTask('izzah', { status: 'active' });
    const owner = await signInAs('izzah');
    const action = `Verify isolation ${crypto.randomUUID().slice(0, 8)}`;
    const { error } = await owner.from('task_checklist_items').insert({
      task_id: task.id,
      position: 1,
      action,
      assigned_to: PEOPLE.lim.id,
    });
    expect(error).toBeNull();

    const admin = serviceClient();
    const { data: notification } = await admin
      .from('notifications')
      .select('id,entity_type,entity_id')
      .eq('task_id', task.id)
      .eq('recipient_id', PEOPLE.lim.id)
      .eq('title', 'New contribution assigned')
      .single();
    expect(notification?.entity_type).toBe('checklist_item');
    expect(notification?.entity_id).not.toBeNull();

    const messages: Array<{ to: string; subject: string; html: string; text: string }> = [];
    const outcome = await runNotificationEmailWorker(admin, {
      limit: 500,
      appBaseUrl: 'https://focus.example.com',
      send: async (message) => {
        messages.push(message);
      },
    });
    expect(outcome.failed).toBe(0);
    const message = messages.find((candidate) => candidate.to === PEOPLE.lim.email);
    expect(message?.subject).toBe('TAMCO Focus — New contribution assigned');
    expect(message?.html).toContain('Open contribution');
    expect(message?.text).toContain(action);
    expect(message?.text).toContain(
      `/work?tab=shared&task=${task.id}&item=${notification!.entity_id}`,
    );
  });

  it('lets recipients read only their own delivery outcomes and never claim them', async () => {
    const admin = serviceClient();
    const { data: notification } = await admin
      .from('notifications')
      .insert({
        recipient_id: PEOPLE.izzah.id,
        kind: 'ordinary_assignment',
        channel: 'immediate',
        requires_action: true,
        title: 'RLS notification email fixture',
        body: 'Only Izzah may read this delivery outcome.',
      })
      .select('id')
      .single();

    const izzah = await signInAs('izzah');
    const lim = await signInAs('lim');
    const own = await izzah
      .from('notification_email_deliveries')
      .select('id')
      .eq('notification_id', notification!.id);
    const other = await lim
      .from('notification_email_deliveries')
      .select('id')
      .eq('notification_id', notification!.id);
    expect(own.data).toHaveLength(1);
    expect(other.data).toHaveLength(0);

    const claim = await izzah.rpc('claim_notification_email_delivery', {
      p_delivery_id: own.data![0]!.id,
    });
    expect(claim.error).not.toBeNull();
  });

  it('waits for a failed delivery retry time and then sends it', async () => {
    const admin = serviceClient();
    const { data: notification } = await admin
      .from('notifications')
      .insert({
        recipient_id: PEOPLE.lim.id,
        kind: 'ordinary_assignment',
        channel: 'digest',
        requires_action: false,
        title: 'Retry timing fixture',
        body: 'This message must wait until its retry boundary.',
      })
      .select('id')
      .single();
    const { data: delivery } = await admin
      .from('notification_email_deliveries')
      .select('id')
      .eq('notification_id', notification!.id)
      .single();
    const future = new Date(Date.now() + 60 * 60_000).toISOString();
    await admin
      .from('notification_email_deliveries')
      .update({ status: 'failed', attempt_count: 1, next_retry_at: future })
      .eq('id', delivery!.id);

    const earlyMessages: Array<{ subject: string }> = [];
    await runNotificationEmailWorker(admin, {
      limit: 500,
      appBaseUrl: 'https://focus.example.com',
      send: async (message) => {
        earlyMessages.push(message);
      },
    });
    expect(earlyMessages.some((message) => message.subject.includes('Retry timing fixture'))).toBe(
      false,
    );

    await admin
      .from('notification_email_deliveries')
      .update({ next_retry_at: new Date(Date.now() - 60_000).toISOString() })
      .eq('id', delivery!.id);
    const retryMessages: Array<{ subject: string }> = [];
    await runNotificationEmailWorker(admin, {
      limit: 500,
      appBaseUrl: 'https://focus.example.com',
      send: async (message) => {
        retryMessages.push(message);
      },
    });
    expect(retryMessages.some((message) => message.subject.includes('Retry timing fixture'))).toBe(
      true,
    );
  });
});
