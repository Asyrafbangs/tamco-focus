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
 * A complete run directory contains:
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
 *   storage-manifest.json and objects/  private bucket bytes and their hashes
 *
 * Backups are written OUTSIDE the repository so one can never be committed.
 */

import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

import { createClient } from '@supabase/supabase-js';

import { resolveEnvironment } from './lib/environment.mjs';
import { assertOutsideRepository, backupStorage } from './lib/storage-backup.mjs';

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
  if (explicit) {
    // A wrong DB URL beside the right Storage URL would create a plausible but
    // unusable mixed-project backup. Check identity without printing the URL.
    let parsed;
    try {
      parsed = new URL(explicit);
    } catch {
      throw new Error('SUPABASE_DB_URL is not a valid connection URL.');
    }
    const localHost = ['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname);
    if ((environment === 'local') !== localHost) {
      throw new Error('Database URL and declared Storage environment disagree.');
    }
    if (environment !== 'local') {
      const projectRef = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname.split('.')[0];
      const databaseRef = parsed.hostname.startsWith('db.')
        ? parsed.hostname.split('.')[1]
        : decodeURIComponent(parsed.username).split('.')[1];
      if (!projectRef || databaseRef !== projectRef) {
        throw new Error('Database URL and Storage URL do not identify the same project.');
      }
    }
    return ['--db-url', explicit];
  }

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
    // CLI diagnostics can repeat --db-url, which may contain a password.
    throw new Error(
      'supabase db dump failed; inspect the CLI locally without sharing credentials.',
    );
  }
}

function storageClient(target) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required to back up private storage.');
  // The same positively identified URL drives the environment check and Storage API.
  return createClient(target.url, key, { auth: { persistSession: false } });
}

function assertLinkedTarget(targetArgs, target) {
  if (!targetArgs.includes('--linked')) return;
  const ref = readFileSync(join(repoRoot, 'supabase', '.temp', 'project-ref'), 'utf8').trim();
  const host = new URL(target.url).hostname;
  if (!ref || host !== `${ref}.supabase.co`) {
    throw new Error('Linked database and Supabase Storage URL do not identify the same project.');
  }
}

async function main() {
  const target = resolveEnvironment();
  const targetArgs = dumpTarget(target.environment);
  assertLinkedTarget(targetArgs, target);
  const client = storageClient(target);

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const directory = process.env.TAMCO_BACKUP_DIR ?? join(repoRoot, '..', 'tamco-focus-backups');
  assertOutsideRepository(directory, repoRoot);
  mkdirSync(directory, { recursive: true });
  assertOutsideRepository(realpathSync(directory), realpathSync(repoRoot));

  const name = `tamco-focus-${target.environment}-${stamp}-${randomBytes(3).toString('hex')}`;
  const runDirectory = join(directory, `${name}.incomplete`);
  const completeDirectory = join(directory, name);
  mkdirSync(runDirectory, { mode: 0o700 });
  const base = join(runDirectory, name);
  const schemaFile = `${base}-schema.sql`;
  const dataFile = `${base}-data.sql`;
  const storageFile = `${base}-storage.sql`;

  console.log(`Backing up ${target.environment} (${target.host})…`);
  dump(targetArgs, schemaFile);
  dump([...targetArgs, '--data-only', '--schema', 'auth,public'], dataFile);
  dump([...targetArgs, '--data-only', '--schema', 'storage'], storageFile);
  const manifest = await backupStorage(client, runDirectory);
  renameSync(runDirectory, completeDirectory);

  console.log(`  complete run: ${completeDirectory}`);
  console.log(`  private storage objects copied: ${manifest.count}`);
  console.log('Not proven until `npm run restore:verify` has restored it.');
}

main().catch((error) => {
  console.error(`Backup incomplete: ${error.message}`);
  process.exitCode = 1;
});
