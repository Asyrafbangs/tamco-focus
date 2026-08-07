import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

import type { Database } from '../src/lib/database.types';
import { sendLocalSmtp } from '../src/server/workers/smtp';
import { runWeeklySummaryWorker } from '../src/server/workers/weekly-summary';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error('Local Supabase URL and service-role key are required.');
const supabaseUrl = url;
const serviceRoleKey = key;

async function main() {
  const client = createClient<Database, 'public'>(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const result = await runWeeklySummaryWorker(client, {
    force: process.argv.includes('--force'),
    timeZone: process.env.ORG_TIMEZONE,
    scheduleDay: process.env.WEEKLY_SUMMARY_DAY,
    scheduleHour: Number(process.env.WEEKLY_SUMMARY_HOUR ?? 8),
    appBaseUrl: process.env.APP_BASE_URL,
    transport: process.env.EMAIL_TRANSPORT === 'inbucket' ? 'inbucket' : 'log',
    send:
      process.env.EMAIL_TRANSPORT === 'inbucket'
        ? (delivery) =>
            sendLocalSmtp(
              { ...delivery, from: process.env.EMAIL_FROM ?? 'focus@tamco.local' },
              {
                host: process.env.EMAIL_SMTP_HOST,
                port: Number(process.env.EMAIL_SMTP_PORT ?? 54325),
              },
            )
        : undefined,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

void main();
