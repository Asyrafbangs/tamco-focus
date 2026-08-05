#!/usr/bin/env node
/**
 * Writes the Supabase connection values into .env.local, preserving every other
 * line and comment in the file.
 *
 * Values are read from the running stack (`supabase status -o env`) rather than
 * hard-coded, so the file stays correct even if the CLI changes its local
 * defaults. Shared by both setup scripts so Windows and Unix cannot drift.
 */

import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = join(repoRoot, '.env.local');
const examplePath = join(repoRoot, '.env.example');

if (!existsSync(envPath)) {
  copyFileSync(examplePath, envPath);
  console.log('Created .env.local from .env.example');
}

// Routed through the wrapper rather than `npx`, which cannot be spawned
// directly on Windows: Node 18.20+ rejects `.cmd` shims without a shell.
let status;
try {
  status = execFileSync(
    process.execPath,
    [join(repoRoot, 'scripts', 'supabase-cli.mjs'), 'status', '-o', 'env'],
    {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
} catch (cause) {
  console.error(
    'Could not read the Supabase status. The local stack must be running.\n' +
      'Start it with `npm run supabase:start`, then try again.\n' +
      `Underlying error: ${cause.message}`,
  );
  process.exit(1);
}

function readStatus(key) {
  const match = new RegExp(`^${key}="?([^"\\r\\n]+)"?$`, 'm').exec(status);
  return match?.[1] ?? null;
}

const values = {
  NEXT_PUBLIC_SUPABASE_URL: readStatus('API_URL'),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: readStatus('ANON_KEY'),
  SUPABASE_SERVICE_ROLE_KEY: readStatus('SERVICE_ROLE_KEY'),
};

const missing = Object.entries(values)
  .filter(([, value]) => !value)
  .map(([key]) => key);

if (missing.length > 0) {
  console.error(`Supabase status did not report: ${missing.join(', ')}`);
  process.exit(1);
}

let contents = readFileSync(envPath, 'utf8');

for (const [key, value] of Object.entries(values)) {
  const pattern = new RegExp(`^${key}=.*$`, 'm');
  const line = `${key}=${value}`;
  contents = pattern.test(contents) ? contents.replace(pattern, line) : `${contents}\n${line}\n`;
}

writeFileSync(envPath, contents);

console.log('Wrote Supabase URL, anon key, and service-role key into .env.local');
