import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

import type { Database } from '../src/lib/database.types';
import { resolveEmailTransport } from '../src/server/workers/email-transport';
import { runWeeklySummaryWorker } from '../src/server/workers/weekly-summary';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error('Local Supabase URL and service-role key are required.');
const supabaseUrl = url;
const serviceRoleKey = key;

async function main() {
  const transport = resolveEmailTransport();

  // A misconfigured transport stops the run. Continuing would mark every
  // delivery sent while discarding it, and the queue would then never retry.
  if ('error' in transport) {
    process.stderr.write(`${transport.error}\n`);
    process.exitCode = 1;
    return;
  }

  process.stdout.write(`transport: ${transport.description}\n`);

  const client = createClient<Database, 'public'>(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const result = await runWeeklySummaryWorker(client, {
    force: process.argv.includes('--force'),
    timeZone: process.env.ORG_TIMEZONE,
    scheduleDay: process.env.WEEKLY_SUMMARY_DAY,
    scheduleHour: Number(process.env.WEEKLY_SUMMARY_HOUR ?? 8),
    appBaseUrl: process.env.APP_BASE_URL,
    transport: transport.name,
    send: transport.send,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

void main();
