import { createClient } from '@supabase/supabase-js';

import type { Database } from '../src/lib/database.types';
import { resolveEmailTransport } from '../src/server/workers/email-transport';
import { runNotificationEmailWorker } from '../src/server/workers/notification-email';

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const recipientEmail = process.env.NOTIFICATION_TEST_RECIPIENT;
  if (!url || !serviceRoleKey || !recipientEmail) {
    throw new Error('Local Supabase configuration and NOTIFICATION_TEST_RECIPIENT are required.');
  }

  const hostname = new URL(url).hostname;
  if (!['127.0.0.1', 'localhost', '::1'].includes(hostname)) {
    throw new Error('The notification test-send command is restricted to local Supabase.');
  }

  const transport = resolveEmailTransport({
    ...process.env,
    EMAIL_TRANSPORT: 'inbucket',
    EMAIL_SMTP_HOST: '127.0.0.1',
    EMAIL_SMTP_PORT: '54325',
    EMAIL_FROM: 'focus@tamco.local',
  });
  if ('error' in transport) throw new Error(transport.error);

  const client = createClient<Database, 'public'>(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: recipient, error: recipientError } = await client
    .from('user_profiles')
    .select('id,email,status')
    .eq('email', recipientEmail)
    .eq('status', 'active')
    .single();
  if (recipientError || !recipient) {
    throw new Error(`No active local profile uses ${recipientEmail}.`);
  }

  const { data: notification, error: notificationError } = await client
    .from('notifications')
    .insert({
      recipient_id: recipient.id,
      kind: 'ordinary_assignment',
      channel: 'digest',
      requires_action: false,
      title: 'Test notification email',
      body: 'This local test confirms that TAMCO Focus notification email is configured and readable.',
    })
    .select('id')
    .single();
  if (notificationError || !notification) {
    throw new Error(notificationError?.message ?? 'Could not create the local test notification.');
  }

  const { data: delivery, error: deliveryError } = await client
    .from('notification_email_deliveries')
    .select('id')
    .eq('notification_id', notification.id)
    .single();
  if (deliveryError || !delivery) {
    throw new Error(
      deliveryError?.message ?? 'The test notification did not create an email delivery.',
    );
  }

  const result = await runNotificationEmailWorker(client, {
    appBaseUrl: process.env.APP_BASE_URL ?? 'http://localhost:3000',
    deliveryIds: [delivery.id],
    transport: transport.name,
    send: transport.send,
  });
  if (result.sent !== 1 || result.failed !== 0) {
    const { data: failedDelivery } = await client
      .from('notification_email_deliveries')
      .select('status,last_error')
      .eq('id', delivery.id)
      .single();
    throw new Error(
      `Test notification was not sent: ${JSON.stringify({ ...result, delivery: failedDelivery })}`,
    );
  }

  console.info(
    JSON.stringify({
      worker: 'notification_email_test',
      transport: transport.name,
      recipient: recipient.email,
      notificationId: notification.id,
      deliveryId: delivery.id,
      ...result,
    }),
  );
}

main().catch((problem: unknown) => {
  console.error(problem instanceof Error ? problem.message : problem);
  process.exitCode = 1;
});
