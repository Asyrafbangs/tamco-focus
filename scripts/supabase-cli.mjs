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
 * Destructive subcommands are gated on positive environment identification
 * (instruction sections 36 and 44).
 *
 * `db reset` drops and rebuilds; `--linked` and `--db-url` aim the CLI at a
 * remote project. Any of them against Production would destroy real work, and
 * "I was sure it was local" is not a control. The guard runs before the binary
 * is spawned, so there is nothing to interrupt.
 */
const rawArgs = process.argv.slice(2);
const destructiveCommand =
  rawArgs[0] === 'db' && ['reset', 'dump'].includes(rawArgs[1] ?? '') && rawArgs[1] === 'reset';
const aimedAtRemote = rawArgs.some((arg) => arg === '--linked' || arg.startsWith('--db-url'));

if (destructiveCommand || aimedAtRemote) {
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
