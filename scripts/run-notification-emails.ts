import { createClient } from '@supabase/supabase-js';

import type { Database } from '../src/lib/database.types';
import { resolveEmailTransport } from '../src/server/workers/email-transport';
import { runNotificationEmailWorker } from '../src/server/workers/notification-email';

/**
 * Runs the notification email outbox.
 *
 * With no arguments it drains the queue, which is what the scheduled worker
 * wants. That is also the only thing it could do until now, and it made a
 * one-message test impossible: sending a single notification to a real address
 * meant sending everything else that happened to be queued alongside it. The
 * worker has always accepted `deliveryIds`; this exposes it.
 *
 *   npm run worker:notifications
 *   npm run worker:notifications -- <delivery-id> [<delivery-id> ...]
 *   npm run worker:notifications -- --limit=5
 */

function usage(message: string): never {
  process.stderr.write(
    `${message}\n\n` +
      'Usage:\n' +
      '  worker:notifications                       drain the queue\n' +
      '  worker:notifications <id> [<id> ...]       send only these deliveries\n' +
      '  worker:notifications --limit=<n>           cap how many are considered\n',
  );
  process.exit(1);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readArguments(argv: string[]) {
  const deliveryIds: string[] = [];
  let limit: number | undefined;

  for (const argument of argv) {
    const limitMatch = /^--limit=(\d+)$/.exec(argument);
    if (limitMatch) {
      limit = Number(limitMatch[1]);
      if (!Number.isInteger(limit) || limit < 1) usage(`"${argument}" is not a positive count.`);
      continue;
    }
    if (argument.startsWith('--')) usage(`Unknown option "${argument}".`);
    // Checked here rather than passed through, because a mistyped id would
    // otherwise match nothing and read as "there was nothing to send".
    if (!UUID.test(argument)) usage(`"${argument}" is not a delivery id.`);
    deliveryIds.push(argument);
  }

  return { deliveryIds, limit };
}

async function main() {
  const { deliveryIds, limit } = readArguments(process.argv.slice(2));

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
    ...(deliveryIds.length ? { deliveryIds } : {}),
    ...(limit === undefined ? {} : { limit }),
  });

  console.info(
    JSON.stringify({
      worker: 'notification_email',
      transport: transport.name,
      scope: deliveryIds.length ? `${deliveryIds.length} named delivery/deliveries` : 'whole queue',
      ...result,
    }),
  );
}

main().catch((problem: unknown) => {
  console.error(problem instanceof Error ? problem.message : problem);
  process.exitCode = 1;
});
