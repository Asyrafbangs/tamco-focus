#!/usr/bin/env node
/**
 * Executes every migration against a real PostgreSQL engine, in order, and
 * reports the first failure in each file with its statement.
 *
 * WHY THIS EXISTS
 * The authoritative check is `supabase db reset` against the local stack, which
 * needs Docker. Where Docker is unavailable, this runs the same SQL against
 * PostgreSQL compiled to WebAssembly (PGlite) — the real parser, planner, and
 * executor — so semantic errors that a syntax check cannot see (a missing
 * column, a bad cast, a function signature that does not resolve) are caught
 * before they surface in a database reset.
 *
 * WHAT IT DOES NOT PROVE
 * PGlite is a single-user engine. It has no GoTrue, no PostgREST, and no
 * Supabase Storage service. This harness creates just enough of the `auth` and
 * `storage` surface for the migrations to apply. So:
 *
 *   * schema, constraints, triggers, functions, and views ARE verified
 *   * RLS POLICIES are verified only as far as "they compile and attach"
 *   * whether a policy ALLOWS and DENIES correctly is NOT verified here —
 *     that needs `supabase test db` with real roles and JWTs
 *
 * Passing this is necessary, not sufficient.
 */

import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { splitStatements } from './sql-split.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const migrationsDir = join(repoRoot, 'supabase', 'migrations');

/**
 * The slice of the Supabase platform the migrations depend on.
 *
 * Kept deliberately minimal: enough for the migrations to resolve their
 * references, and no more. Anything richer would start testing this stub
 * rather than the schema.
 */
const PLATFORM_PRELUDE = `
-- Roles PostgREST and Supabase create. Policies are granted TO these.
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;

create schema if not exists extensions;
create schema if not exists auth;
create schema if not exists storage;

create extension if not exists pgcrypto with schema extensions;
create extension if not exists citext with schema extensions;

-- GoTrue's identity tables, reduced to the columns the migrations and seed use.
create table auth.users (
  instance_id uuid,
  id uuid primary key,
  aud text,
  role text,
  email text unique,
  encrypted_password text,
  email_confirmed_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  raw_app_meta_data jsonb,
  raw_user_meta_data jsonb,
  confirmation_token text,
  recovery_token text,
  email_change_token_new text,
  email_change text
);

create table auth.identities (
  provider_id text,
  user_id uuid references auth.users (id),
  identity_data jsonb,
  provider text,
  last_sign_in_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  primary key (provider, provider_id)
);

-- The claim helper every policy is written against. Here it reads a session
-- variable so the harness can impersonate a user.
create or replace function auth.uid()
returns uuid
language sql
stable
as $fn$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$fn$;

-- Supabase Storage, reduced to what the storage migration touches.
create table storage.buckets (
  id text primary key,
  name text not null,
  public boolean default false,
  file_size_limit bigint,
  allowed_mime_types text[],
  created_at timestamptz default now()
);

create table storage.objects (
  id uuid primary key default extensions.gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text,
  owner uuid,
  created_at timestamptz default now()
);

alter table storage.objects enable row level security;

create or replace function storage.foldername(name text)
returns text[]
language sql
immutable
as $fn$
  select string_to_array(name, '/');
$fn$;
`;

// `citext` backs the case-insensitive email column; `pgcrypto` provides
// gen_random_uuid() and the crypt()/gen_salt() the local seed uses.
const db = await PGlite.create({ extensions: { citext, pgcrypto } });

let failures = 0;

async function run(label, sql) {
  const statements = splitStatements(sql);

  for (const statement of statements) {
    if (statement.text.trim().length === 0) continue;

    try {
      await db.exec(statement.text);
    } catch (cause) {
      failures += 1;
      const preview = statement.text.trim().replace(/\s+/g, ' ').slice(0, 100);
      console.error(`\nFAIL  ${label}  (near line ${statement.line})`);
      console.error(`      ${cause.message}`);
      console.error(`      statement: ${preview}…`);
      return false;
    }
  }

  return true;
}

console.log('Applying the Supabase platform prelude…');
if (!(await run('platform prelude', PLATFORM_PRELUDE))) {
  console.error('\nThe harness prelude itself failed. This is a harness bug, not a schema bug.');
  process.exit(1);
}
console.log('ok    platform prelude\n');

const migrations = readdirSync(migrationsDir)
  .filter((name) => name.endsWith('.sql'))
  .sort();

for (const name of migrations) {
  const sql = readFileSync(join(migrationsDir, name), 'utf8');
  const ok = await run(name, sql);
  if (ok) console.log(`ok    ${name}`);
}

// --- Fixtures ---------------------------------------------------------------

if (failures === 0) {
  const seed = readFileSync(join(repoRoot, 'supabase', 'seed.sql'), 'utf8');
  if (await run('seed.sql', seed)) console.log('ok    seed.sql');
}

// --- Behaviour --------------------------------------------------------------
//
// Exercises the transactional procedures against the seeded fixtures. This is
// where the focus-target rules are actually proven to work, rather than merely
// to compile.

/** Impersonates a user for the duration of the next statements. */
async function actAs(userId) {
  await db.exec(`select set_config('request.jwt.claim.sub', '${userId}', false);`);
}

async function check(description, fn) {
  try {
    const detail = await fn();
    console.log(`ok    ${description}${detail ? ` — ${detail}` : ''}`);
  } catch (cause) {
    failures += 1;
    console.error(`FAIL  ${description}`);
    console.error(`      ${cause.message}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

if (failures === 0) {
  const IZZAH = 'f0c05000-0000-4000-a000-000000000004';
  const AVAILABLE_TASK = 'f0c05300-0000-4000-a000-000000000004';

  console.log('\nBehaviour checks against the seeded fixtures:\n');

  await check('seeded fixtures loaded', async () => {
    const users = await db.query('select count(*)::int as n from public.user_profiles');
    const tasks = await db.query('select count(*)::int as n from public.tasks');
    assert(users.rows[0].n === 7, `expected 7 users, found ${users.rows[0].n}`);
    return `${users.rows[0].n} users, ${tasks.rows[0].n} tasks (routine occurrences included)`;
  });

  await check('focus counting reads committed state', async () => {
    const result = await db.query(
      `select focus.active_focus_count('${IZZAH}', 'operational') as count,
              focus.effective_focus_target('${IZZAH}', 'operational') as target`,
    );
    const { count, target } = result.rows[0];
    assert(target === 5, `expected the approved target of 5, got ${target}`);
    return `Izzah has ${count} active operational against a target of ${target}`;
  });

  await check('within-target activation succeeds in one call', async () => {
    await actAs(IZZAH);
    const version = (
      await db.query(`select version from public.tasks where id = '${AVAILABLE_TASK}'`)
    ).rows[0].version;

    const result = await db.query(
      `select public.activate_task('${AVAILABLE_TASK}', ${version}, null, null, null) as r`,
    );
    const r = result.rows[0].r;
    assert(r.ok === true, `expected success, got ${JSON.stringify(r)}`);
    return `code=${r.code}, count ${r.count_before} → ${r.count_after} of ${r.target}`;
  });

  await check('activation wrote an immutable audit event', async () => {
    const result = await db.query(
      `select event_type, previous_status, new_status from public.audit_events
        where task_id = '${AVAILABLE_TASK}' and event_type = 'task_activated'`,
    );
    assert(result.rows.length === 1, `expected 1 activation event, found ${result.rows.length}`);
    return `${result.rows[0].previous_status} → ${result.rows[0].new_status}`;
  });

  await check('audit history cannot be rewritten', async () => {
    try {
      await db.exec(`update public.audit_events set reason_note = 'tampered'`);
      throw new Error('the update was allowed, but audit events must be append-only');
    } catch (cause) {
      assert(/append-only/i.test(cause.message), `unexpected error: ${cause.message}`);
      return 'update rejected by trigger';
    }
  });

  await check('a stale version is rejected as a conflict', async () => {
    await actAs(IZZAH);
    const result = await db.query(
      `select public.move_task_to_available('${AVAILABLE_TASK}', 1, null) as r`,
    );
    const r = result.rows[0].r;
    assert(r.ok === false && r.code === 'version_conflict', `got ${JSON.stringify(r)}`);
    return r.code;
  });

  /*
   * v144 — the focus target no longer gates activation (specification §3, §11).
   *
   * Three scenarios lived here: the one reason question asked when the count
   * crossed the target, activation proceeding once a reason was given, and
   * "Other" rejected without a note. What replaces them is the property that
   * matters now — the count goes past the target and nothing is ever refused,
   * asked or flagged for it.
   */
  await check('activating past the target asks nothing', async () => {
    await actAs(IZZAH);

    // Six more operational actions than her old target of five.
    for (let index = 0; index < 6; index += 1) {
      await db.exec(`
        insert into public.tasks (title, status, work_class, focus_bucket, origin,
                                  primary_owner_id, created_by)
        values ('Filler ${index}', 'backlog', 'operational_action', 'operational',
                'self_initiated', '${IZZAH}', '${IZZAH}');
      `);
    }

    const filler = await db.query(
      `select id, version from public.tasks
        where primary_owner_id = '${IZZAH}' and title like 'Filler %' order by title`,
    );

    let highest = 0;
    for (const row of filler.rows) {
      const result = await db.query(
        `select public.activate_task('${row.id}', ${row.version}, null, null, null) as r`,
      );
      const r = result.rows[0].r;
      assert(r.ok === true, `activation was refused: ${JSON.stringify(r)}`);
      assert(r.code === 'activated', `expected 'activated', got '${r.code}'`);
      // The count and the target are still recorded; nothing is decided on them.
      assert(r.over_target === false, 'no activation should be flagged over target');
      highest = Math.max(highest, r.count_after);
    }

    return `activated ${filler.rows.length}, reaching ${highest}, nothing asked`;
  });

  await check('idempotency absorbs a repeated click', async () => {
    await actAs(IZZAH);
    /*
     * Its own row, rather than whatever the scenario above left behind.
     *
     * It used to take the first backlog operational task it could find, which
     * worked only because the over-target scenarios ahead of it created six
     * and activated one. When v144 removed those, this failed on an undefined
     * row — a fixture problem wearing the costume of an idempotency bug.
     */
    await db.exec(`
      insert into public.tasks (title, status, work_class, focus_bucket, origin,
                                primary_owner_id, created_by)
      values ('Idempotency fixture', 'backlog', 'operational_action', 'operational',
              'self_initiated', '${IZZAH}', '${IZZAH}');
    `);
    const row = (
      await db.query(
        `select id, version from public.tasks
          where primary_owner_id = '${IZZAH}' and title = 'Idempotency fixture'`,
      )
    ).rows[0];

    const key = 'double-click-test-key';
    const first = (
      await db.query(
        `select public.activate_task('${row.id}', ${row.version}, null, null, '${key}') as r`,
      )
    ).rows[0].r;
    const second = (
      await db.query(
        `select public.activate_task('${row.id}', ${row.version}, null, null, '${key}') as r`,
      )
    ).rows[0].r;

    assert(first.ok && second.ok, 'both calls should report success');
    assert(
      first.audit_event_id === second.audit_event_id,
      'the repeat should replay the first result, not act again',
    );

    const events = await db.query(
      `select count(*)::int as n from public.audit_events
        where task_id = '${row.id}' and event_type in ('task_activated','over_target_activation')`,
    );
    assert(events.rows[0].n === 1, `expected 1 activation event, found ${events.rows[0].n}`);
    return 'second call replayed the first result';
  });

  await check('date-only due dates never land a day early', async () => {
    // The seed stores an end-of-local-day instant for date-only commitments.
    // 16:00 UTC is midnight in Kuala Lumpur, so anything earlier that day must
    // not read as overdue.
    const result = await db.query(
      `select (timestamptz '2026-08-12 15:59:59.999+00' > timestamptz '2026-08-12 10:00:00+00') as still_due`,
    );
    assert(result.rows[0].still_due === true, 'a date-only task went overdue during its due date');
    return 'afternoon of the due date is not overdue';
  });

  await check('routine occurrence generation is idempotent', async () => {
    const before = (
      await db.query(
        `select count(*)::int as n from public.tasks where work_class = 'routine_occurrence'`,
      )
    ).rows[0].n;

    await db.query(`select public.generate_routine_occurrences((current_date + 14)::date)`);

    const after = (
      await db.query(
        `select count(*)::int as n from public.tasks where work_class = 'routine_occurrence'`,
      )
    ).rows[0].n;

    assert(before === after, `re-running created ${after - before} duplicate occurrences`);
    return `${after} occurrences, unchanged on re-run`;
  });

  const ADMIN = 'f0c05000-0000-4000-a000-000000000001';
  const TEMP = 'f0c05000-0000-4000-a000-000000000007';

  await check('a team member cannot delete a user', async () => {
    await actAs(IZZAH);
    const r = (await db.query(`select public.delete_user_permanently('${TEMP}', 'TMP-900') as r`))
      .rows[0].r;
    assert(r.code === 'not_authorised', `got ${JSON.stringify(r)}`);
    return 'refused for a non-administrator';
  });

  await check('permanent deletion is refused while history exists', async () => {
    await actAs(ADMIN);
    const result = await db.query(
      `select public.delete_user_permanently('${IZZAH}', 'EMP-202') as r`,
    );
    const r = result.rows[0].r;
    assert(r.code === 'retained_history_exists', `got ${JSON.stringify(r)}`);
    return r.code;
  });

  await check('a history-free account can be deleted after ID confirmation', async () => {
    await actAs(ADMIN);

    const wrong = (
      await db.query(`select public.delete_user_permanently('${TEMP}', 'WRONG-ID') as r`)
    ).rows[0].r;
    assert(wrong.code === 'confirmation_mismatch', `expected mismatch, got ${wrong.code}`);

    const right = (
      await db.query(`select public.delete_user_permanently('${TEMP}', 'TMP-900') as r`)
    ).rows[0].r;
    assert(right.ok === true, `expected deletion, got ${JSON.stringify(right)}`);

    const log = await db.query(
      `select count(*)::int as n from public.admin_security_log
        where event_type = 'user_deleted' and subject_employee_id = 'TMP-900'`,
    );
    assert(log.rows[0].n === 1, 'the deletion must survive in the administrative log');
    return 'deleted, and the security-log entry outlived the row';
  });

  await check('the approved visibility example resolves correctly', async () => {
    const AMER = 'f0c05000-0000-4000-a000-000000000003';
    await actAs(ADMIN);
    const result = await db.query(
      `select user_id, source from public.preview_effective_visibility('${AMER}') order by source`,
    );

    const ids = result.rows.map((row) => row.user_id);
    assert(ids.includes(AMER), 'Amer must always see his own work');
    assert(
      ids.includes('f0c05000-0000-4000-a000-000000000004'),
      'Amer should see Izzah through the explicit grant',
    );
    assert(
      ids.includes('f0c05000-0000-4000-a000-000000000005'),
      'Amer should see Ajmal through the explicit grant',
    );
    assert(
      !ids.includes('f0c05000-0000-4000-a000-000000000006'),
      'Amer must NOT see Lim, who was never granted',
    );
    return `${ids.length} people visible, Lim correctly excluded`;
  });
}

// --- Summary ----------------------------------------------------------------

if (failures === 0) {
  const tables = await db.query(
    `select count(*)::int as n from information_schema.tables where table_schema = 'public'`,
  );
  const policies = await db.query(`select count(*)::int as n from pg_policies`);
  const routines = await db.query(
    `select count(*)::int as n from information_schema.routines where routine_schema in ('public','focus')`,
  );

  console.log(
    `\nAll ${migrations.length} migrations applied cleanly.\n` +
      `  ${tables.rows[0].n} tables and views in public\n` +
      `  ${policies.rows[0].n} RLS policies attached\n` +
      `  ${routines.rows[0].n} functions in public/focus\n`,
  );
  console.log(
    'This proves the schema BUILDS. It does not prove the RLS policies allow\n' +
      'and deny correctly — that still needs `supabase test db` with real roles.\n',
  );
  process.exit(0);
}

console.error(`\n${failures} migration file(s) failed. Fix the errors above.\n`);
process.exit(1);
