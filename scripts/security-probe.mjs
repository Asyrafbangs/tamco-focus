#!/usr/bin/env node
/**
 * Live security probe against the running stack.
 *
 * Static analysis proves what the code says; this proves what the database
 * actually does when an authenticated but unprivileged caller asks for things
 * they should not get. Every probe is an ATTACK: it passes when the attack
 * fails.
 *
 * Complements the pgTAP suite, which runs as a database role. This runs over
 * HTTP through PostgREST with a real JWT, which is the surface an attacker
 * would actually reach.
 */

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

config({ path: '.env.local', quiet: true });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const password = process.env.SEED_USER_PASSWORD ?? 'LocalFocus123!';

if (!url || !anonKey) {
  console.error('Supabase settings missing. Run `node scripts/write-env.mjs`.');
  process.exit(1);
}

const PEOPLE = {
  admin: 'admin@tamco.local',
  izzul: 'izzul@tamco.local',
  amer: 'amer@tamco.local',
  izzah: 'izzah@tamco.local',
  lim: 'lim@tamco.local',
};

async function signIn(who) {
  const client = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await client.auth.signInWithPassword({ email: PEOPLE[who], password });
  if (error) throw new Error(`sign-in failed for ${who}: ${error.message}`);
  return client;
}

let failures = 0;
let passes = 0;

function report(ok, description, detail) {
  if (ok) {
    passes += 1;
    console.log(`  ok    ${description}${detail ? ` — ${detail}` : ''}`);
  } else {
    failures += 1;
    console.error(`  VULN  ${description}${detail ? ` — ${detail}` : ''}`);
  }
}

console.log('\nLive security probe (each probe passes when the attack fails)\n');

const anon = createClient(url, anonKey, { auth: { persistSession: false } });
const amer = await signIn('amer');
const lim = await signIn('lim');
const izzah = await signIn('izzah');

// ---------------------------------------------------------------------------
// 1. Unauthenticated reach
// ---------------------------------------------------------------------------

for (const table of [
  'tasks',
  'user_profiles',
  'audit_events',
  'attachments',
  'org_settings',
  'admin_security_log',
  'email_deliveries',
  'operation_log',
]) {
  const { data, error } = await anon.from(table).select('*').limit(1);
  report(
    Boolean(error) || (data ?? []).length === 0,
    `anon cannot read ${table}`,
    error?.code ?? 'empty',
  );
}

// ---------------------------------------------------------------------------
// 2. Privilege escalation through direct writes
// ---------------------------------------------------------------------------

// Resolve Amer's OWN id from his session. Selecting the first visible profile
// row returns whoever sorts first — his manager, as it turned out — which would
// silently point the self-promotion probe at the wrong record.
const {
  data: { user: amerUser },
} = await amer.auth.getUser();
const amerProfile = { id: amerUser?.id };

{
  const { data: self } = await amer
    .from('user_profiles')
    .select('role')
    .eq('id', amerProfile.id)
    .maybeSingle();
  report(
    self?.role === 'team_member',
    'probe precondition: Amer is a team member',
    `role is ${self?.role}`,
  );
}

{
  // Self-promotion to administrator.
  const { error } = await amer
    .from('user_profiles')
    .update({ role: 'administrator' })
    .eq('id', amerProfile?.id ?? '00000000-0000-0000-0000-000000000000');

  const { data: after } = await amer
    .from('user_profiles')
    .select('role')
    .eq('id', amerProfile?.id ?? '')
    .maybeSingle();

  report(
    Boolean(error) || after?.role !== 'administrator',
    'a team member cannot promote themselves to administrator',
    error?.code ?? `role stayed ${after?.role}`,
  );
}

{
  // Granting themselves visibility of someone they cannot see.
  const { error } = await amer.from('visibility_grants').insert({
    viewer_id: amerProfile?.id,
    subject_id: '00000000-0000-4000-a000-000000000000',
    granted_by: amerProfile?.id,
  });
  report(Boolean(error), 'a team member cannot grant themselves visibility', error?.code);
}

{
  // Forging audit history.
  const { error } = await amer
    .from('audit_events')
    .insert({ event_type: 'task_activated', actor_id: amerProfile?.id });
  report(Boolean(error), 'a team member cannot forge an audit event', error?.code);
}

{
  // Rewriting audit history.
  const { error } = await amer
    .from('audit_events')
    .update({ reason_note: 'rewritten' })
    .neq('id', '');
  report(Boolean(error), 'a team member cannot rewrite audit history', error?.code);
}

{
  // Claiming an idempotency key to suppress someone else's action.
  const { error } = await amer
    .from('operation_log')
    .insert({ actor_id: amerProfile?.id, idempotency_key: 'x', operation: 'y', result: {} });
  report(Boolean(error), 'a team member cannot write to the operation log', error?.code);
}

// ---------------------------------------------------------------------------
// 3. Horizontal access — the approved visibility example
// ---------------------------------------------------------------------------

{
  const { data } = await amer.from('task_overview').select('owner_name');
  const owners = new Set((data ?? []).map((row) => row.owner_name));
  report(
    !owners.has('Lim Wei Sheng'),
    'Amer cannot see Lim, who was never granted',
    `${owners.size} owners visible`,
  );
}

{
  const { data } = await lim.from('task_overview').select('owner_name');
  const owners = new Set((data ?? []).map((row) => row.owner_name));
  report(
    owners.size <= 1 && !owners.has('Izzah Nurul'),
    'Lim, whose mode is none, sees only himself',
    `${owners.size} owner(s) visible`,
  );
}

{
  // View does not confer edit (section 3.4).
  const { data: izzahTask } = await izzah
    .from('task_overview')
    .select('id,version')
    .eq('status', 'backlog')
    .limit(1)
    .maybeSingle();

  if (izzahTask) {
    const { data: result } = await amer.rpc('activate_task', {
      p_task_id: izzahTask.id,
      p_expected_version: izzahTask.version,
      p_reason_code: null,
      p_reason_note: null,
      p_idempotency_key: null,
    });
    report(
      result?.ok === false && result?.code === 'not_authorised',
      'Amer can view but cannot activate work he does not own',
      result?.code,
    );

    const { error: directError } = await amer
      .from('tasks')
      .update({ title: 'tampered' })
      .eq('id', izzahTask.id);
    const { data: check } = await izzah
      .from('tasks')
      .select('title')
      .eq('id', izzahTask.id)
      .maybeSingle();
    report(
      Boolean(directError) || check?.title !== 'tampered',
      'a direct UPDATE on viewable-but-not-editable work changes nothing',
      directError?.code ?? 'unchanged',
    );
  }
}

// ---------------------------------------------------------------------------
// 4. Privileged procedures refuse unprivileged callers
// ---------------------------------------------------------------------------

for (const [rpc, args] of [
  [
    'deactivate_user',
    { p_user_id: '00000000-0000-4000-a000-000000000000', p_allow_open_work: true },
  ],
  [
    'delete_user_permanently',
    { p_user_id: '00000000-0000-4000-a000-000000000000', p_employee_id_confirmation: 'X' },
  ],
  [
    'set_user_visibility',
    {
      p_viewer_id: amerProfile?.id,
      p_mode: 'direct_reports_plus',
      p_subject_ids: [],
      p_reason: null,
    },
  ],
]) {
  const { data, error } = await amer.rpc(rpc, args);
  report(
    Boolean(error) || data?.ok === false,
    `a team member cannot call ${rpc}`,
    error?.code ?? data?.code,
  );
}

{
  // Provisioning is granted to service_role only.
  const { error } = await amer.rpc('provision_user_profile', {
    p_user_id: '00000000-0000-4000-a000-000000000000',
    p_employee_id: 'HACK-1',
    p_email: 'hack@tamco.local',
    p_full_name: 'Hacker',
    p_department_id: null,
    p_role: 'administrator',
  });
  report(Boolean(error), 'a team member cannot call provision_user_profile', error?.code);
}

// ---------------------------------------------------------------------------
// 5. Injection attempts through PostgREST filters and RPC arguments
// ---------------------------------------------------------------------------

{
  const payloads = [
    "'; drop table public.tasks; --",
    "' or '1'='1",
    '\\x27 union select * from auth.users --',
  ];

  let survived = true;
  for (const payload of payloads) {
    await amer.from('task_overview').select('id').eq('title', payload).limit(1);
    await amer.rpc('activate_task', {
      p_task_id: '00000000-0000-4000-a000-000000000000',
      p_expected_version: 1,
      p_reason_code: null,
      p_reason_note: payload,
      p_idempotency_key: payload,
    });
  }

  const { error: aliveError } = await anon.auth.getSession();
  const { data: stillThere } = await amer.from('task_overview').select('id').limit(1);
  survived = !aliveError && Array.isArray(stillThere);

  report(survived, 'SQL injection payloads through filters and RPC arguments are inert');
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${passes} probes passed, ${failures} vulnerabilities found.\n`);
process.exit(failures > 0 ? 1 : 0);
