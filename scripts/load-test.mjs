#!/usr/bin/env node
/**
 * Simulates concurrent users against the running stack and reports latency
 * percentiles plus correctness under contention.
 *
 * Two things are being measured, and the second matters more:
 *
 *   1. Latency — whether reads stay responsive as concurrency rises.
 *   2. CORRECTNESS UNDER CONTENTION — whether the focus count stays consistent
 *      when many users activate work simultaneously. A load test that only
 *      reports milliseconds would miss a lost update, which is the failure that
 *      would actually corrupt this product.
 *
 * Usage: node scripts/load-test.mjs [--users 20] [--seconds 10]
 */

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

config({ path: '.env.local', quiet: true });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const password = process.env.SEED_USER_PASSWORD ?? 'LocalFocus123!';

if (!url || !anonKey || !serviceKey) {
  console.error('Supabase settings missing. Run `node scripts/write-env.mjs`.');
  process.exit(1);
}

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : Number(process.argv[index + 1]);
}

const VIRTUAL_USERS = arg('users', 20);
const DURATION_SECONDS = arg('seconds', 10);

const ACCOUNTS = [
  'izzah@tamco.local',
  'amer@tamco.local',
  'ajmal@tamco.local',
  'lim@tamco.local',
  'izzul@tamco.local',
];

const service = createClient(url, serviceKey, { auth: { persistSession: false } });

function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return Math.round(sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]);
}

function summarise(label, samples, errors) {
  if (samples.length === 0) {
    console.log(`  ${label.padEnd(26)} no samples`);
    return;
  }
  const mean = Math.round(samples.reduce((a, b) => a + b, 0) / samples.length);
  console.log(
    `  ${label.padEnd(26)} n=${String(samples.length).padStart(5)}  ` +
      `mean ${String(mean).padStart(4)}ms  p50 ${String(percentile(samples, 50)).padStart(4)}ms  ` +
      `p95 ${String(percentile(samples, 95)).padStart(5)}ms  p99 ${String(percentile(samples, 99)).padStart(5)}ms  ` +
      `errors ${errors}`,
  );
}

async function timed(fn) {
  const started = performance.now();
  const result = await fn();
  return { ms: performance.now() - started, result };
}

console.log(
  `\nLoad test — ${VIRTUAL_USERS} virtual users for ${DURATION_SECONDS}s against ${url}\n`,
);

// --- Sign in every virtual user ---------------------------------------------

const signInSamples = [];
let signInErrors = 0;

const clients = await Promise.all(
  Array.from({ length: VIRTUAL_USERS }, async (_, index) => {
    const email = ACCOUNTS[index % ACCOUNTS.length];
    const client = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { ms, result } = await timed(() => client.auth.signInWithPassword({ email, password }));
    signInSamples.push(ms);
    if (result.error) signInErrors += 1;

    return client;
  }),
);

console.log('Authentication');
summarise('sign-in', signInSamples, signInErrors);

// --- Read load ---------------------------------------------------------------
//
// Mirrors what My Day and Work actually issue, so the numbers correspond to a
// real page rather than a synthetic query.

const reads = {
  'task_overview (My Day)': { samples: [], errors: 0 },
  focus_summary: { samples: [], errors: 0 },
  team_load_summary: { samples: [], errors: 0 },
  plan_events: { samples: [], errors: 0 },
  'notifications (badge)': { samples: [], errors: 0 },
};

const deadline = Date.now() + DURATION_SECONDS * 1000;
let iterations = 0;

await Promise.all(
  clients.map(async (client) => {
    while (Date.now() < deadline) {
      iterations += 1;

      const queries = [
        [
          'task_overview (My Day)',
          () =>
            client
              .from('task_overview')
              .select('*')
              .in('status', ['backlog', 'active', 'paused'])
              .limit(300),
        ],
        ['focus_summary', () => client.from('focus_summary').select('*').limit(10)],
        ['team_load_summary', () => client.from('team_load_summary').select('*').limit(50)],
        ['plan_events', () => client.from('plan_events').select('*').limit(200)],
        [
          'notifications (badge)',
          () =>
            client
              .from('notifications')
              .select('id', { count: 'exact', head: true })
              .is('read_at', null),
        ],
      ];

      for (const [label, run] of queries) {
        const { ms, result } = await timed(run);
        reads[label].samples.push(ms);
        if (result.error) reads[label].errors += 1;
      }
    }
  }),
);

console.log(`\nRead latency (${iterations} rounds across ${VIRTUAL_USERS} users)`);
for (const [label, stats] of Object.entries(reads)) {
  summarise(label, stats.samples, stats.errors);
}

// --- Write contention --------------------------------------------------------
//
// The correctness half. Many users activate their own work at once; afterwards
// the reported focus count must equal the committed row count exactly.

console.log('\nWrite contention');

const OWNER = 'f0c05000-0000-4000-a000-000000000005'; // Ajmal
const CONTENDERS = 25;

const { data: seeded } = await service
  .from('tasks')
  .insert(
    Array.from({ length: CONTENDERS }, (_, index) => ({
      title: `Load fixture ${index}`,
      status: 'backlog',
      work_class: 'operational_action',
      focus_bucket: 'operational',
      origin: 'self_initiated',
      primary_owner_id: OWNER,
      created_by: OWNER,
    })),
  )
  .select('id, version');

const ajmal = createClient(url, anonKey, { auth: { persistSession: false } });
await ajmal.auth.signInWithPassword({ email: 'ajmal@tamco.local', password });

const activationSamples = [];
let activationErrors = 0;
let activated = 0;

await Promise.all(
  (seeded ?? []).map(async (task) => {
    const { ms, result } = await timed(() =>
      ajmal.rpc('activate_task', {
        p_task_id: task.id,
        p_expected_version: task.version,
        p_reason_code: 'workload_peak',
        p_reason_note: null,
        p_idempotency_key: crypto.randomUUID(),
      }),
    );

    activationSamples.push(ms);
    if (result.error) activationErrors += 1;
    else if (result.data?.ok) activated += 1;
  }),
);

summarise('concurrent activate_task', activationSamples, activationErrors);

// --- Consistency check -------------------------------------------------------

const { count: committedActive } = await service
  .from('tasks')
  .select('id', { count: 'exact', head: true })
  .eq('primary_owner_id', OWNER)
  .eq('focus_bucket', 'operational')
  .eq('status', 'active');

const { data: summary } = await service
  .from('focus_summary')
  .select('active_count')
  .eq('user_id', OWNER)
  .eq('bucket', 'operational')
  .maybeSingle();

const reported = summary?.active_count ?? -1;
const consistent = reported === committedActive;

// A double-activation would write two audit events for one task.
const { data: auditRows } = await service
  .from('audit_events')
  .select('task_id')
  .in('event_type', ['task_activated', 'over_target_activation'])
  .in(
    'task_id',
    (seeded ?? []).map((task) => task.id),
  );

const perTask = new Map();
for (const row of auditRows ?? []) {
  perTask.set(row.task_id, (perTask.get(row.task_id) ?? 0) + 1);
}
const doubleCounted = [...perTask.values()].filter((count) => count > 1).length;

console.log('\nConsistency after contention');
console.log(`  activations accepted        ${activated} of ${CONTENDERS}`);
console.log(`  committed active rows       ${committedActive}`);
console.log(`  focus_summary reports       ${reported}`);
console.log(
  `  count consistent            ${consistent ? 'yes' : 'NO — reported and committed disagree'}`,
);
console.log(
  `  tasks activated twice       ${doubleCounted}${doubleCounted === 0 ? '' : ' — LOST UPDATE'}`,
);

console.log('');

if (!consistent || doubleCounted > 0) {
  console.error('Correctness failure under contention.\n');
  process.exit(1);
}
