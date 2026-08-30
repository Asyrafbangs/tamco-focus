import { describe, expect, it } from 'vitest';

import { notificationPath, renderNotificationEmail } from '@/server/workers/notification-email';

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
