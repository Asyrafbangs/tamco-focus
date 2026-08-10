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
 * Two files per run:
 *
 *   *-roles-schema.sql   every object: tables, functions, policies, triggers
 *   *-data.sql           every row, in dependency order
 *
 * The schema file is a convenience; `supabase/migrations` remains authoritative
 * and is what a real rebuild applies. The data file is the part that cannot be
 * reconstructed from the repository.
 *
 * Backups are written OUTSIDE the repository so one can never be committed.
 */

import { mkdirSync } from 'node:fs';
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
function connectionString(environment) {
  if (environment === 'local') {
    return process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
  }
  const url = process.env.SUPABASE_DB_URL;
  if (!url) {
    throw new Error(
      `SUPABASE_DB_URL is required to back up ${environment}. Take it from the Supabase ` +
        'dashboard (Project settings → Database → Connection string) and pass it in the ' +
        'environment for this command only. Never commit it.',
    );
  }
  return url;
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
  const dbUrl = connectionString(target.environment);

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const directory = process.env.TAMCO_BACKUP_DIR ?? join(repoRoot, '..', 'tamco-focus-backups');
  mkdirSync(directory, { recursive: true });

  const base = join(directory, `tamco-focus-${target.environment}-${stamp}`);
  const schemaFile = `${base}-schema.sql`;
  const dataFile = `${base}-data.sql`;

  console.log(`Backing up ${target.environment} (${target.host})…`);
  dump(['--db-url', dbUrl], schemaFile);
  dump(['--db-url', dbUrl, '--data-only'], dataFile);

  console.log(`  schema: ${schemaFile}`);
  console.log(`  data:   ${dataFile}`);
  console.log('\nNot proven until `npm run restore:verify` has restored it.');
}

main();
