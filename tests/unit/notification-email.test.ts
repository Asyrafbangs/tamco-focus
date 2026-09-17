import { describe, expect, it } from 'vitest';

import {
  notificationPath,
  renderNotificationEmail,
  runNotificationEmailWorker,
} from '@/server/workers/notification-email';

const taskNotification = {
  title: 'New work assigned to you',
  body: 'Izzul assigned "Inspect the fire doors". It is waiting in Available until you activate it.',
  kind: 'ordinary_assignment' as const,
  requires_action: true,
  task_id: 'f0c05300-0000-4000-a000-000000000002',
  goal_id: null,
  entity_type: 'task',
  entity_id: 'f0c05300-0000-4000-a000-000000000002',
};

describe('notification email template', () => {
  it('uses the restrained application theme with matching task links and plain text', () => {
    const rendered = renderNotificationEmail({
      notification: taskNotification,
      recipientName: 'Izzah Nurul',
      appBaseUrl: 'https://focus.example.com',
    });

    expect(rendered.subject).toBe('TAMCO Focus — New work assigned to you');
    expect(rendered.href).toBe(
      'https://focus.example.com/work?task=f0c05300-0000-4000-a000-000000000002',
    );
    expect(rendered.html).toContain('background:#0d2342');
    expect(rendered.html).toContain('background:#1668e8');
    expect(rendered.html).toContain('Open task');
    expect(rendered.text).toContain(`Open task: ${rendered.href}`);
    expect(rendered.text).toContain(taskNotification.body);
  });

  it('escapes hostile notification content and strips subject line breaks', () => {
    const rendered = renderNotificationEmail({
      notification: {
        ...taskNotification,
        title: 'Assignment\r\nBcc: outside@example.com',
        body: '<img src=x onerror="alert(1)"> & review',
      },
      recipientName: '<script>Sam</script>',
      appBaseUrl: 'https://focus.example.com',
    });

    expect(rendered.subject).toBe('TAMCO Focus — Assignment Bcc: outside@example.com');
    expect(rendered.html).not.toContain('<script>');
    expect(rendered.html).not.toContain('<img src=x');
    expect(rendered.html).toContain('&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; review');
  });

  it('opens a checklist handoff in its parent task and labels the action as a contribution', () => {
    const rendered = renderNotificationEmail({
      notification: { ...taskNotification, entity_type: 'checklist_item' },
      recipientName: 'Lim Wei Jian',
      appBaseUrl: 'http://localhost:3000',
    });

    expect(notificationPath({ ...taskNotification, entity_type: 'checklist_item' })).toBe(
      '/work?tab=shared&task=f0c05300-0000-4000-a000-000000000002&item=f0c05300-0000-4000-a000-000000000002',
    );
    expect(rendered.html).toContain('Open contribution');
    expect(rendered.text).toContain(
      'Open contribution: http://localhost:3000/work?tab=shared&task=',
    );
  });

  it('opens a step on the recipient’s own work at the step, not in Shared', () => {
    const notification = { ...taskNotification, entity_type: 'task_step' };
    expect(notificationPath(notification)).toBe(
      '/work?task=f0c05300-0000-4000-a000-000000000002&step=f0c05300-0000-4000-a000-000000000002',
    );
    const rendered = renderNotificationEmail({
      notification,
      recipientName: 'Izzah Nurul',
      appBaseUrl: 'http://localhost:3000',
    });
    expect(rendered.html).toContain('Open step');
  });

  it('opens an update request at the composer, and the reply at the updates (v184)', () => {
    const request = {
      ...taskNotification,
      kind: 'update_requested' as const,
      title: 'Update requested: Inspect the fire doors',
      body: 'Izzul Asyraf asked you for an update: "Has the contractor confirmed Friday?"',
      entity_type: 'task_update_request',
      entity_id: 'f0c05300-0000-4000-a000-000000000002',
    };
    expect(notificationPath(request)).toBe(
      '/work?task=f0c05300-0000-4000-a000-000000000002&respond=update',
    );
    const asked = renderNotificationEmail({
      notification: request,
      recipientName: 'Amer Hakim',
      appBaseUrl: 'https://tamco-focus.vercel.app',
    });
    expect(asked.subject).toBe('TAMCO Focus — Update requested: Inspect the fire doors');
    expect(asked.html).toContain('Add your update');
    expect(asked.html).toContain('Has the contractor confirmed Friday?');
    expect(asked.text).toContain(
      'Add your update: https://tamco-focus.vercel.app/work?task=f0c05300-0000-4000-a000-000000000002&respond=update',
    );

    const aboutStep = {
      ...request,
      entity_type: 'step_update_request',
      entity_id: 'f0c05300-0000-4000-a000-000000000077',
    };
    expect(notificationPath(aboutStep)).toBe(
      '/work?task=f0c05300-0000-4000-a000-000000000002&step=f0c05300-0000-4000-a000-000000000077&respond=update',
    );
    expect(
      renderNotificationEmail({
        notification: aboutStep,
        recipientName: 'Amer Hakim',
        appBaseUrl: 'http://localhost:3000',
      }).html,
    ).toContain('Add your update');

    const reply = {
      ...taskNotification,
      kind: 'update_request_answered' as const,
      requires_action: false,
      entity_type: 'task_update',
    };
    expect(notificationPath(reply)).toBe(
      '/work?task=f0c05300-0000-4000-a000-000000000002&section=updates',
    );
    expect(
      renderNotificationEmail({
        notification: reply,
        recipientName: 'Izzul Asyraf',
        appBaseUrl: 'http://localhost:3000',
      }).html,
    ).toContain('Read the update');
  });

  it('sends somebody who lost the work to their own list, not to a page they cannot open (v193)', () => {
    const reassigned = {
      ...taskNotification,
      kind: 'ownership_changed' as const,
      requires_action: false,
      title: 'Work reassigned',
      body: '"Inspect the fire doors" was reassigned to Ajmal Rizani.',
      entity_type: 'released_task',
    };
    expect(notificationPath(reassigned)).toBe('/work');
    const email = renderNotificationEmail({
      notification: reassigned,
      recipientName: 'Lim Wei Sheng',
      appBaseUrl: 'https://tamco-focus.vercel.app',
    });
    expect(email.text).toContain('Open My Work: https://tamco-focus.vercel.app/work');
    expect(email.html).not.toContain('Open task');

    const handedOn = {
      ...reassigned,
      kind: 'collaboration_handoff' as const,
      title: 'Contribution reassigned',
      body: '"Collect permits" has been reassigned. It is no longer on your Shared list.',
      entity_type: 'released_contribution',
    };
    expect(notificationPath(handedOn)).toBe('/work?tab=shared');
    expect(
      renderNotificationEmail({
        notification: handedOn,
        recipientName: 'Lim Wei Sheng',
        appBaseUrl: 'https://tamco-focus.vercel.app',
      }).text,
    ).toContain('Open Shared: https://tamco-focus.vercel.app/work?tab=shared');
  });

  it('opens a barrier at the barrier, and asks only the person it asks to respond (v193)', () => {
    const barrierId = 'f0c05300-0000-4000-a000-000000000099';
    const asked = {
      ...taskNotification,
      kind: 'barrier_raised' as const,
      title: 'Decision needed',
      body: 'Ajmal Rizani needs you on "Contractor safety audit": Approve a delay',
      entity_type: 'barrier',
      entity_id: barrierId,
    };
    const askedEmail = renderNotificationEmail({
      notification: asked,
      recipientName: 'Izzul Asyraf',
      appBaseUrl: 'https://tamco-focus.vercel.app',
    });
    expect(askedEmail.href).toContain(`attention=barrier&barrier=${barrierId}`);
    expect(askedEmail.html).toContain('Respond to request');

    for (const title of [
      'Barrier raised on your work',
      'Barrier resolved — review your work',
      'Decision received',
    ]) {
      const told = renderNotificationEmail({
        notification: { ...asked, title },
        recipientName: 'Izzah Nurul',
        appBaseUrl: 'https://tamco-focus.vercel.app',
      });
      expect(told.href, title).toContain(`barrier=${barrierId}`);
      expect(told.html, title).toContain('Open request');
      expect(told.html, title).not.toContain('Respond to request');
    }
  });

  it('refuses a non-http application origin', () => {
    const rendered = renderNotificationEmail({
      notification: taskNotification,
      recipientName: 'Izzah Nurul',
      appBaseUrl: 'javascript:alert(1)',
    });

    expect(rendered.href).toBe('#');
    expect(rendered.html).not.toContain('javascript:');
  });
});

/**
 * The delivery that would be recorded but never sent.
 *
 * `runNotificationEmailWorker` skips the send when no sender was supplied and
 * marks the row `sent` immediately afterwards either way. Under `smtp` that
 * means every notification is recorded as delivered and discarded, and `sent`
 * is terminal, so nothing retries it. The weekly summary worker shipped with
 * exactly this shape and ran that way in Production for weeks.
 *
 * Neither of these touches a database: the refusal happens before the first
 * query, which is the whole point of putting it there.
 */
describe('sending transports must be able to send', () => {
  const client = {} as Parameters<typeof runNotificationEmailWorker>[0];

  it.each(['smtp', 'inbucket'] as const)(
    'refuses to run under %s with no send function',
    async (transport) => {
      await expect(runNotificationEmailWorker(client, { transport })).rejects.toThrow(
        /no send function was supplied/i,
      );
    },
  );

  it('still allows the log transport, which has nothing to send through', async () => {
    /*
     * Reaching the database is the pass condition: it means the guard let this
     * through. What happens next needs a real Postgres and is covered by the
     * integration suite.
     */
    await expect(runNotificationEmailWorker(client, { transport: 'log' })).rejects.not.toThrow(
      /no send function was supplied/i,
    );
  });
});
