import { after } from 'next/server';

import { requestOrigin } from '@/lib/env';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/server';
import { resolveEmailTransport } from '@/server/workers/email-transport';
import { runNotificationEmailWorker } from '@/server/workers/notification-email';

/**
 * Delivers notification email after a successful Server Action response.
 *
 * PostgreSQL has already committed both the notification and its unique outbox
 * row. Failure here cannot roll back the user's work; it leaves that row
 * retryable for the scheduled worker instead.
 */
export async function scheduleNotificationEmailDispatch() {
  // Read request-bound headers while the Server Action is still active. The
  // deferred callback then works only with captured data and server services.
  const appBaseUrl = await requestOrigin();
  after(async () => {
    try {
      const transport = resolveEmailTransport();
      if ('error' in transport) throw new Error(transport.error);
      const client = createSupabaseServiceRoleClient();
      const recentCutoff = new Date(Date.now() - 5_000).toISOString();
      const { data: recentDeliveries, error: recentError } = await client
        .from('notification_email_deliveries')
        .select('id')
        .eq('status', 'queued')
        .gte('queued_at', recentCutoff)
        .order('queued_at', { ascending: false })
        .limit(100);
      if (recentError) throw recentError;
      if (!recentDeliveries.length) return;

      const result = await runNotificationEmailWorker(client, {
        appBaseUrl,
        deliveryIds: recentDeliveries.map((delivery) => delivery.id),
        transport: transport.name,
        send: transport.send,
      });
      if (result.failed > 0) {
        console.error(`[notification-email] ${result.failed} delivery attempt(s) failed.`);
      }
    } catch (problem) {
      const message = problem instanceof Error ? problem.message : 'unknown error';
      console.error(`[notification-email] dispatch failed: ${message}`);
    }
  });
}
