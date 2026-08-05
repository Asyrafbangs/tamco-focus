#!/usr/bin/env node
/**
 * Runs every verification gate and reports honestly.
 *
 * Gates that need the local Supabase stack are SKIPPED, not silently passed,
 * when Docker is unavailable. BUILD_ACCEPTANCE_GATES.md requires failures to be
 * reported honestly, and a skipped gate reported as green would be the exact
 * dishonesty the build standard forbids.
 *
 * Exit code 0 means every gate that could run, passed, AND none were skipped.
 * Exit code 2 means everything that ran passed but some gates were skipped.
 * Exit code 1 means something failed.
 */

import { spawnSync, execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

function dockerAvailable() {
  try {
    execFileSync('docker', ['info', '--format', '{{.ServerVersion}}'], {
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

const hasDocker = dockerAvailable();

/**
 * Local tool entrypoints, invoked with `node` directly.
 *
 * Not `npx`: resolving a `.cmd` shim depends on the shell, and under Git Bash
 * on Windows the spawn fails with ENOENT — which previously showed up as four
 * gates "failing" with no output at all. Naming the JavaScript entrypoint is
 * shell-independent and cannot be silently mis-resolved.
 */
const bin = {
  prettier: 'node_modules/prettier/bin/prettier.cjs',
  tsc: 'node_modules/typescript/bin/tsc',
  vitest: 'node_modules/vitest/vitest.mjs',
  next: 'node_modules/next/dist/bin/next',
  playwright: 'node_modules/@playwright/test/cli.js',
};

/** @type {{name: string, command: string, args: string[], needsDatabase?: boolean}[]} */
const GATES = [
  { name: 'SQL syntax', command: 'node', args: ['scripts/check-sql-syntax.mjs'] },
  // Executes every migration and the seed against a real PostgreSQL engine
  // (PGlite), then exercises the transactional procedures. Needs no Docker, so
  // it runs everywhere and catches semantic errors a syntax check cannot.
  { name: 'Schema executes', command: 'node', args: ['scripts/check-schema.mjs'] },
  { name: 'Secret scan', command: 'node', args: ['scripts/scan-secrets.mjs'] },
  { name: 'Format check', command: 'node', args: [bin.prettier, '--check', '.'] },
  { name: 'Type check', command: 'node', args: [bin.tsc, '--noEmit'] },
  { name: 'Unit tests', command: 'node', args: [bin.vitest, 'run', '--project', 'unit'] },
  { name: 'Production build', command: 'node', args: [bin.next, 'build'] },

  {
    name: 'Database reset',
    command: 'node',
    args: ['scripts/supabase-cli.mjs', 'db', 'reset'],
    needsDatabase: true,
  },
  {
    name: 'Generated types match',
    command: 'node',
    args: ['scripts/check-generated-types.mjs'],
    needsDatabase: true,
  },
  {
    name: 'RLS / database tests',
    command: 'node',
    args: ['scripts/run-rls-tests.mjs'],
    needsDatabase: true,
  },
  {
    name: 'Integration tests',
    command: 'node',
    args: [bin.vitest, 'run', '--project', 'integration'],
    needsDatabase: true,
  },
  {
    name: 'End-to-end tests',
    command: 'node',
    args: [bin.playwright, 'test'],
    needsDatabase: true,
  },
];

const outcomes = [];

for (const gate of GATES) {
  if (gate.needsDatabase && !hasDocker) {
    outcomes.push({ name: gate.name, status: 'skipped' });
    console.log(`\n── ${gate.name} — SKIPPED (Docker is not available)`);
    continue;
  }

  console.log(`\n── ${gate.name}`);

  const result = spawnSync(gate.command, gate.args, {
    cwd: repoRoot,
    stdio: 'inherit',
    env: process.env,
  });

  // A spawn that never started reports `status: null`. Saying so is the
  // difference between "this gate failed" and "this gate did not run", and
  // conflating them is how a broken runner masquerades as a broken build.
  if (result.error) {
    console.error(`Could not run this gate: ${result.error.message}`);
    outcomes.push({ name: gate.name, status: 'failed' });
    continue;
  }

  outcomes.push({ name: gate.name, status: result.status === 0 ? 'passed' : 'failed' });
}

// --- Report -----------------------------------------------------------------

const width = Math.max(...outcomes.map((entry) => entry.name.length));

console.log('\n\nVerification summary\n');
for (const outcome of outcomes) {
  const label = { passed: 'PASS', failed: 'FAIL', skipped: 'SKIP' }[outcome.status];
  console.log(`  ${label}  ${outcome.name.padEnd(width)}`);
}

const failed = outcomes.filter((entry) => entry.status === 'failed');
const skipped = outcomes.filter((entry) => entry.status === 'skipped');

console.log(
  `\n${outcomes.filter((entry) => entry.status === 'passed').length} passed, ` +
    `${failed.length} failed, ${skipped.length} skipped.\n`,
);

if (skipped.length > 0) {
  console.log(
    'Skipped gates need the local Supabase stack, which needs Docker.\n' +
      'Run `npm run preflight` for the specific remedy. These gates are NOT\n' +
      'passing — they have not been run.\n',
  );
}

if (failed.length > 0) process.exit(1);
if (skipped.length > 0) process.exit(2);
process.exit(0);
