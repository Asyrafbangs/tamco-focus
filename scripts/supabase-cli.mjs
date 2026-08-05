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

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

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

const result = spawnSync(binaryPath, process.argv.slice(2), {
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
