import { createClient } from '@supabase/supabase-js';

import type { Database } from '../src/lib/database.types';
import { resolveEmailTransport } from '../src/server/workers/email-transport';
import { runNotificationEmailWorker } from '../src/server/workers/notification-email';

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) throw new Error('Local Supabase service configuration is missing.');

  const transport = resolveEmailTransport();
  if ('error' in transport) throw new Error(transport.error);

  const client = createClient<Database, 'public'>(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const result = await runNotificationEmailWorker(client, {
    appBaseUrl: process.env.APP_BASE_URL ?? 'http://localhost:3000',
    transport: transport.name,
    send: transport.send,
  });

  console.info(
    JSON.stringify({ worker: 'notification_email', transport: transport.name, ...result }),
  );
}

main().catch((problem: unknown) => {
  console.error(problem instanceof Error ? problem.message : problem);
  process.exitCode = 1;
});
