import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

import type { Database } from '../src/lib/database.types';
import { localDateString } from '../src/domain/duration';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error('Local Supabase URL and service-role key are required.');
const supabaseUrl = url;
const serviceRoleKey = key;

async function main() {
  const client = createClient<Database, 'public'>(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const timeZone = process.env.ORG_TIMEZONE ?? 'Asia/Kuala_Lumpur';
  const { data: setting } = await client
    .from('org_settings')
    .select('value')
    .eq('key', 'routine.occurrence_lead_days')
    .single();
  const leadDays = Number(setting?.value ?? 14);
  const through = new Date(Date.now() + leadDays * 86_400_000);
  const { data, error } = await client.rpc('generate_routine_occurrences', {
    p_through: localDateString(through, timeZone),
  });
  if (error) throw error;
  process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
}

void main();
