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

import { assertLocal } from './lib/environment.mjs';

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
    if (!existsSync(explicit)) throw new Error(`No such backup file: ${explicit}`);
    return explicit;
  }
  const directory = process.env.TAMCO_BACKUP_DIR ?? join(repoRoot, '..', 'tamco-focus-backups');
  const candidates = readdirSync(directory)
    .filter((name) => name.endsWith('-data.sql'))
    .map((name) => join(directory, name))
    .sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs);
  if (!candidates.length) {
    throw new Error(`No *-data.sql backup found in ${directory}. Run \`npm run backup:database\`.`);
  }
  return candidates[0];
}

function main() {
  assertLocal('restore a backup');

  const dumpFile = newestDataDump();
  console.log(`Restoring ${dumpFile}\n`);

  const tables = applicationTables();
  const before = counts(tables);
  const populated = Object.entries(before).filter(([, count]) => count > 0);
  console.log(`Before: ${populated.length} of ${tables.length} tables hold data.`);

  /*
   * `auth.users` and `storage.objects` are emptied too.
   *
   * The dump carries them — a restore without identities is a database nobody
   * can sign in to — so leaving them in place turns the restore into a
   * duplicate-key failure. Truncating `auth.users` cascades through identities,
   * sessions and refresh tokens, which is what a real recovery does.
   */
  const list = [
    ...tables.map((table) => `public.${table}`),
    'auth.users',
    'storage.objects',
    'storage.buckets',
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
      input: readFileSync(dumpFile, 'utf8'),
      maxBuffer: 256 * 1024 * 1024,
    },
  );
  if (restore.status !== 0) {
    console.error(restore.stderr || restore.stdout);
    throw new Error('The data dump did not load. RESTORE NOT PROVEN.');
  }
  console.log('Loaded the data dump.\n');

  const after = counts(tables);
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
  console.log('Local now holds the restored data. `npm run db:reset` returns it to fixtures.');
}

main();
