#!/usr/bin/env node
/**
 * Proves a backup can be restored, by restoring it (instruction section 41).
 *
 * Restores into the LOCAL stack only. `assertLocal` refuses anything else,
 * including Staging: a restore overwrites, and Staging may be mid-verification
 * for somebody else.
 *
 * The loop is deliberately the whole loop, because each step alone proves
 * nothing:
 *
 *   1. count every table                    what we expect back
 *   2. empty every application table        a real restore target
 *   3. confirm it is empty                  the emptying actually happened
 *   4. load the data dump                   the restore
 *   5. count again and compare              the proof
 *
 * Emptying runs as `postgres` inside the database container rather than through
 * the data API, because `audit_events` revokes DELETE from every role — history
 * is append-only by design. TRUNCATE by the owner is not blocked by those
 * grants, and does not fire the immutability trigger.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

import { assertLocal } from './lib/environment.mjs';
import { readVerifiedManifest, restoreStorage } from './lib/storage-backup.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const CONTAINER = process.env.TAMCO_DB_CONTAINER ?? 'supabase_db_tamco-focus';

function psql(sql, { input } = {}) {
  const args = ['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', 'postgres', '-q'];
  if (sql) args.push('-t', '-A', '-c', sql);
  const result = spawnSync('docker', args, {
    encoding: 'utf8',
    input: input ?? '',
    maxBuffer: 256 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`psql failed:\n${result.stderr || result.stdout}`);
  }
  return result.stdout.trim();
}

/** Every application table, newest-dependency-last, straight from the catalogue. */
function applicationTables() {
  return psql(
    `select table_name from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE'
      order by table_name`,
  )
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function counts(tables) {
  const selects = tables
    .map((table) => `select '${table}' as t, count(*)::bigint as c from public.${table}`)
    .join(' union all ');
  const rows = psql(`${selects} order by t`).split('\n').filter(Boolean);
  return Object.fromEntries(rows.map((row) => row.split('|')).map(([t, c]) => [t, Number(c)]));
}

function newestDataDump() {
  const explicit = process.argv[2];
  if (explicit) {
    const file = statSync(explicit).isDirectory()
      ? readdirSync(explicit)
          .filter((name) => name.endsWith('-data.sql'))
          .map((name) => join(explicit, name))[0]
      : explicit;
    if (!file || !existsSync(file)) throw new Error(`No such backup data file: ${explicit}`);
    return file;
  }
  const directory = process.env.TAMCO_BACKUP_DIR ?? join(repoRoot, '..', 'tamco-focus-backups');
  const candidates = readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.endsWith('.incomplete'))
    .flatMap((entry) =>
      readdirSync(join(directory, entry.name))
        .filter((name) => name.endsWith('-data.sql'))
        .map((name) => join(directory, entry.name, name)),
    )
    .sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs);
  if (!candidates.length) {
    throw new Error(`No *-data.sql backup found in ${directory}. Run \`npm run backup:database\`.`);
  }
  return candidates[0];
}

/**
 * Which database the dump came from, read off its own name.
 *
 * This decides what "proved" can mean. A local dump restored into local has a
 * baseline: the counts this database held a moment ago. A Production dump
 * restored into local has none — the two hold different data, and on
 * 30 October 2026 comparing the two reported twelve tables "short" on a restore
 * that had in fact loaded perfectly, because the fixtures populate
 * `goal_milestones` and Production does not. A proof that cries wolf on a good
 * backup is worse than no proof, so cross-environment runs are checked against
 * the dump instead.
 */
function dumpSource(file) {
  const match = /tamco-focus-([a-z]+)-\d{4}-/.exec(file.replace(/\\/g, '/').split('/').pop() ?? '');
  return match?.[1] ?? 'unknown';
}

/** Every table the dump carries rows for, qualified, in the order it writes them. */
function tablesInDump(text, schema) {
  const pattern = new RegExp(`INSERT INTO "(${schema ?? '[a-z_]+'})"\\."([a-z0-9_]+)"`, 'g');
  const found = new Set();
  for (const match of text.matchAll(pattern)) found.add(`${match[1]}.${match[2]}`);
  return [...found].sort();
}

async function main() {
  const local = assertLocal('restore a backup');

  const dumpFile = newestDataDump();
  const runDirectory = dirname(dumpFile);
  // Validate saved bytes before the database is truncated.
  const manifest = await readVerifiedManifest(runDirectory);
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('Local service role key is required for storage restore verification.');
  const storageClient = createClient(local.url, key, { auth: { persistSession: false } });
  const source = dumpSource(dumpFile);
  const dumpText = readFileSync(dumpFile, 'utf8');
  console.log(`Restoring ${dumpFile}\n`);

  const tables = applicationTables();
  const before = counts(tables);
  const populated = Object.entries(before).filter(([, count]) => count > 0);
  console.log(`Before: ${populated.length} of ${tables.length} tables hold data.`);

  /*
   * What to empty is read off the dump, not listed by hand.
   *
   * The dump's `auth` rows have to go somewhere empty or the load collides on a
   * primary key, and the hand-written list was wrong twice for the same reason:
   * it named `auth.users` and trusted the cascade. `auth.flow_state`,
   * `auth.mfa_amr_claims` and `auth.sessions` are not all children of `users`,
   * so a second run against the same dump failed on `flow_state_pkey` — a
   * backup reported unprovable because the restore target was not actually a
   * restore target. Whatever the dump writes, this empties.
   *
   * `storage` is deliberately left alone. Its rows are backed up to their own
   * file and are not restored here: Supabase owns that schema, a hosted project
   * runs a newer Storage than the local CLI bundles, and in October 2026 three
   * columns of difference in `storage.buckets` were enough to fail an otherwise
   * perfect restore under ON_ERROR_STOP. More to the point, `storage.objects` is
   * a row per file rather than the file, so restoring it would prove nothing
   * except that a database can be made to claim evidence it does not have.
   */
  const list = [
    ...new Set([...tables.map((table) => `public.${table}`), ...tablesInDump(dumpText, 'auth')]),
  ].join(', ');
  // No RESTART IDENTITY: the auth sequences belong to `supabase_auth_admin`,
  // and the dump carries its own sequence values regardless.
  psql(`truncate ${list} cascade`);

  const emptied = counts(tables);
  const stillPopulated = Object.entries(emptied).filter(([, count]) => count > 0);
  if (stillPopulated.length) {
    throw new Error(
      `Restore target was not emptied: ${stillPopulated.map(([t]) => t).join(', ')}. ` +
        'Aborting rather than reporting a restore that never had to do anything.',
    );
  }
  console.log('Emptied every application table.');

  const restore = spawnSync(
    'docker',
    [
      'exec',
      '-i',
      CONTAINER,
      'psql',
      '-U',
      'postgres',
      '-d',
      'postgres',
      '-q',
      '-v',
      'ON_ERROR_STOP=1',
    ],
    {
      encoding: 'utf8',
      input: dumpText,
      maxBuffer: 256 * 1024 * 1024,
    },
  );
  if (restore.status !== 0) {
    console.error(restore.stderr || restore.stdout);
    throw new Error('The data dump did not load. RESTORE NOT PROVEN.');
  }
  console.log('Loaded the data dump.\n');

  const after = counts(tables);
  const carried = tablesInDump(dumpText, 'public').map((name) => name.replace('public.', ''));
  const identities = Number(psql('select count(*) from auth.users'));

  if (source === 'local') {
    /*
     * Same database in and out, so the counts it held a moment ago are a real
     * baseline and every one of them must come back.
     */
    const short = populated
      .map(([table, expected]) => ({ table, expected, restored: after[table] ?? 0 }))
      .filter((row) => row.restored < row.expected);

    console.table(
      populated.map(([table, expected]) => ({ table, expected, restored: after[table] ?? 0 })),
    );

    if (short.length) {
      console.error('\nRESTORE NOT PROVEN — these tables came back short:');
      for (const row of short) console.error(`  ${row.table}: ${row.restored}/${row.expected}`);
      process.exit(1);
    }
    console.log('\nRestore verified: every populated table came back with its full row count.');
  } else {
    /*
     * A dump from somewhere else. There is no baseline here, so the dump is the
     * baseline: every table it carries an INSERT for must hold rows afterwards,
     * and identities must exist, or it is a restore nobody can sign in to.
     *
     * Checking it the other way round — against what this database happened to
     * hold before — reported twelve tables "short" on a perfect Production
     * restore, because the fixtures populate tables Production does not use.
     */
    console.table(carried.map((table) => ({ table, restored: after[table] ?? 0 })));

    const missing = carried.filter((table) => (after[table] ?? 0) === 0);
    if (missing.length || identities === 0) {
      console.error(`\nRESTORE NOT PROVEN — the dump is from ${source}, and after loading it:`);
      for (const table of missing) console.error(`  ${table}: carries rows, restored 0`);
      if (identities === 0) console.error('  auth.users: nobody could sign in to this restore');
      process.exit(1);
    }
    console.log(
      `\nRestore verified: the ${source} dump loaded without a single error, and all ` +
        `${carried.length} tables it carries hold rows (${identities} identities).`,
    );
    console.log('Row counts are the dump’s, not this database’s previous contents —');
    console.log(`read the table above as "is this what ${source} looks like?".`);
  }

  const restored = await restoreStorage(storageClient, runDirectory, manifest);
  console.log(
    `\nStorage verified: ${restored} private objects uploaded to local Storage and read back`,
  );
  console.log('with the manifest byte sizes and SHA-256 hashes.');
  console.log('The hosted Storage schema rows are retained separately, not loaded into local.');
  console.log('Local now holds the restored data. `npm run db:reset` returns it to fixtures.');
}

main().catch((error) => {
  console.error(`RESTORE NOT PROVEN: ${error.message}`);
  process.exitCode = 1;
});
