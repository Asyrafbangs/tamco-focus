#!/usr/bin/env node
/**
 * Runs the Supabase CLI through its Node wrapper.
 *
 * The `supabase` npm package downloads a platform binary and exposes it via a
 * `.bin` shim, whose name and location differ across platforms. Resolving the
 * package's own entrypoint and delegating to it keeps every caller — scripts,
 * verify gates, npm scripts — using one path that works the same everywhere.
 */

import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';

import { assertLocal, EnvironmentError } from './lib/environment.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

/*
 * `db reset` is gated on positive environment identification (sections 36, 44).
 *
 * It is the only Supabase subcommand that destroys without being asked to: it
 * drops the database and rebuilds it, and against Production that is somebody's
 * work gone. "I was sure it was local" is not a control, so the guard runs
 * before the binary is spawned and there is nothing to interrupt.
 *
 * Deliberately narrow. The first version of this refused anything carrying
 * `--linked` or `--db-url`, on the theory that aiming at a remote project was
 * itself the danger. That blocked `db dump` — refusing to *back up* Production
 * is precisely backwards, and on a free plan with no managed backups it would
 * have removed the only protection there is. Remoteness is not the risk;
 * dropping things is.
 *
 * `db push` and `db query` are not gated either. Both are deliberate operations
 * a person invokes against a named environment, both are how a release and an
 * administrative fix actually happen, and both sit behind the approval gates in
 * `MIGRATION_STATUS.md`. A guard that blocked them would only teach people to
 * work around the guard.
 */
const rawArgs = process.argv.slice(2);
const destroysTheDatabase = rawArgs[0] === 'db' && rawArgs[1] === 'reset';

if (destroysTheDatabase) {
  config({ path: join(repoRoot, '.env.local'), quiet: true });
  try {
    assertLocal(`run \`supabase ${rawArgs.join(' ')}\``);
  } catch (error) {
    if (error instanceof EnvironmentError) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }
}

let binaryPath;
try {
  // The package resolves to the downloaded binary for this platform.
  binaryPath = require('supabase/bin/supabase');
} catch {
  binaryPath = null;
}

if (typeof binaryPath !== 'string') {
  // Fall back to the shim npm installs into node_modules/.bin.
  binaryPath = join(
    repoRoot,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'supabase.cmd' : 'supabase',
  );
}

// Node 18.20+ refuses to spawn a `.cmd` or `.bat` shim without `shell: true`
// (the CVE-2024-27980 fix) and fails with EINVAL. Windows npm shims are exactly
// that, so the shim is run through a shell with its path quoted; every other
// platform spawns the binary directly, with no shell involved.
const isWindowsShim = /\.(cmd|bat)$/i.test(binaryPath);
const args = process.argv.slice(2);

const result = isWindowsShim
  ? spawnSync(`"${binaryPath}" ${args.map((arg) => `"${arg}"`).join(' ')}`, {
      cwd: repoRoot,
      stdio: 'inherit',
      env: process.env,
      shell: true,
    })
  : spawnSync(binaryPath, args, {
      cwd: repoRoot,
      stdio: 'inherit',
      env: process.env,
    });

if (result.error) {
  console.error(
    `Could not run the Supabase CLI: ${result.error.message}\n` +
      'Run `npm install` to restore it — it is a pinned dev dependency.',
  );
  process.exit(1);
}

process.exit(result.status ?? 1);
