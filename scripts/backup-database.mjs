#!/usr/bin/env node
/**
 * Logical backup of a TAMCO Focus database.
 *
 * Supabase's free plan has no scheduled backups and no point-in-time recovery,
 * so on the pilot this script *is* the backup (instruction section 40).
 *
 * It shells out to `supabase db dump` rather than reading rows through the data
 * API. That was the first attempt, and it could not work: `audit_events` revokes
 * INSERT from every role because history is append-only, so a restore through
 * PostgREST would silently drop the audit trail — and the honest fix is to use a
 * mechanism that can carry it, not to weaken the table.
 *
 * Three files per run:
 *
 *   *-schema.sql    every object: tables, functions, policies, triggers
 *   *-data.sql      every row of `auth` and `public`, in dependency order
 *   *-storage.sql   the `storage` schema's own rows, separately
 *
 * The schema file is a convenience; `supabase/migrations` remains authoritative
 * and is what a real rebuild applies. The data file is the part that cannot be
 * reconstructed from the repository, and is what `restore:verify` proves.
 *
 * `storage` is split out because Supabase owns that schema and a hosted project
 * runs a newer Storage than the local CLI bundles. On 30 October 2026
 * production's `storage.buckets` had three columns local's did not, so one
 * INSERT in the middle of a single combined dump failed under ON_ERROR_STOP and
 * took the entire restore proof down with it — a backup reported unprovable for
 * a reason that had nothing to do with the data in it. Splitting it means a skew
 * in a schema we do not own cannot stop us proving the data we do.
 *
 * WHAT THIS DOES NOT BACK UP: the files in the buckets. `storage.objects` is a
 * row per file, not the file. Restoring those rows alone produces a database
 * that believes evidence exists when the bytes are gone, which is why they are
 * kept out of the proven file and out of the restore.
 *
 * Backups are written OUTSIDE the repository so one can never be committed.
 */

import { existsSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveEnvironment } from './lib/environment.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The Postgres connection string for the resolved target.
 *
 * Local is the well-known CLI default. A hosted target must supply its own,
 * because guessing a Production connection string is precisely the class of
 * mistake section 36 exists to prevent.
 */
/**
 * How to reach the target, preferring the route that needs no password.
 *
 * A linked project dumps through the CLI's own access token, so the database
 * password never has to be typed, stored, or passed to this script. That is
 * strictly better than a connection string: one less secret in play, and one
 * less thing to leak into a shell history.
 *
 * `SUPABASE_DB_URL` remains the escape hatch for a project that is not the
 * linked one.
 */
function dumpTarget(environment) {
  const explicit = process.env.SUPABASE_DB_URL;
  if (explicit) return ['--db-url', explicit];

  if (environment === 'local') {
    return ['--db-url', 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'];
  }

  const linked = existsSync(join(repoRoot, 'supabase', '.temp', 'project-ref'));
  if (!linked) {
    throw new Error(
      `Cannot reach ${environment}: no linked project and no SUPABASE_DB_URL. ` +
        'Run `supabase link --project-ref <ref>` first.',
    );
  }
  return ['--linked'];
}

function dump(args, outputFile) {
  const result = spawnSync(
    process.execPath,
    [join(repoRoot, 'scripts', 'supabase-cli.mjs'), 'db', 'dump', ...args, '-f', outputFile],
    { cwd: repoRoot, stdio: 'pipe', encoding: 'utf8', env: process.env },
  );
  if (result.status !== 0) {
    throw new Error(`supabase db dump failed:\n${result.stderr || result.stdout}`);
  }
}

function main() {
  const target = resolveEnvironment();
  const targetArgs = dumpTarget(target.environment);

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const directory = process.env.TAMCO_BACKUP_DIR ?? join(repoRoot, '..', 'tamco-focus-backups');
  mkdirSync(directory, { recursive: true });

  const base = join(directory, `tamco-focus-${target.environment}-${stamp}`);
  const schemaFile = `${base}-schema.sql`;
  const dataFile = `${base}-data.sql`;
  const storageFile = `${base}-storage.sql`;

  console.log(`Backing up ${target.environment} (${target.host})…`);
  dump(targetArgs, schemaFile);
  dump([...targetArgs, '--data-only', '--schema', 'auth,public'], dataFile);
  dump([...targetArgs, '--data-only', '--schema', 'storage'], storageFile);

  console.log(`  schema:  ${schemaFile}`);
  console.log(`  data:    ${dataFile}`);
  console.log(`  storage: ${storageFile}`);
  console.log('\nThe files inside the buckets are not in any of these.');
  console.log('Not proven until `npm run restore:verify` has restored it.');
}

main();
