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
  eslint: 'node_modules/eslint/bin/eslint.js',
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
  { name: 'Lint', command: 'node', args: [bin.eslint, '.', '--max-warnings=0'] },
  { name: 'Type check', command: 'node', args: [bin.tsc, '--noEmit'] },
  { name: 'Unit tests', command: 'node', args: [bin.vitest, 'run', '--project', 'unit'] },
  {
    name: 'Production build',
    command: 'node',
    args: [bin.next, 'build'],
    // Built into its own directory so running this never removes the output a
    // dev server is currently serving.
    env: { NEXT_DIST_DIR: '.next-verify' },
  },
  {
    name: 'Production smoke',
    command: 'node',
    args: ['scripts/run-production-smoke.mjs'],
  },

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
  /*
   * The end-to-end suite has to start from the seed, not from whatever the
   * integration suite happened to leave behind.
   *
   * Integration arranges and mutates dozens of fixtures — extra tasks,
   * completed checklist items, resolved barriers. E2E then asserts against
   * lists whose contents it did not create, so a different test failed on
   * almost every run and each looked like a fresh bug. It was one cause:
   * shared, unpredictable state.
   *
   * A reset here costs about fifteen seconds and buys a deterministic suite.
   */
  {
    name: 'Reset before end-to-end',
    command: 'node',
    args: ['scripts/supabase-cli.mjs', 'db', 'reset'],
    needsDatabase: true,
  },
  {
    name: 'End-to-end tests',
    command: 'node',
    args: ['scripts/run-e2e.mjs'],
    needsDatabase: true,
  },
  /*
   * The integration and end-to-end suites arrange their own fixtures, and they
   * cannot tidy up after themselves: deleting a task cascades into
   * `audit_events`, where DELETE is revoked from every role and the append-only
   * trigger would refuse it. Retained history is a product requirement
   * (MASTER_PRODUCT_SPEC.md section 21.3), not an obstacle to work around.
   *
   * So the run ends where it started — on the seed. Without this, the machine
   * is left holding rows like "Integration fixture 6ad646b0" alongside the real
   * fixtures, and whoever opens the app next cannot tell which is which.
   */
  {
    name: 'Restore seed data',
    command: 'node',
    args: ['scripts/supabase-cli.mjs', 'db', 'reset'],
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
    env: { ...process.env, ...(gate.env ?? {}) },
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
