#!/usr/bin/env node
/**
 * Runs the pgTAP RLS suite — and refuses to report success when there is no
 * suite to run.
 *
 * `supabase test db` exits 0 against an empty test directory, which turns the
 * single most security-critical gate green while proving nothing. An empty
 * suite is a missing gate, not a passing one, so this fails loudly instead.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const testsDir = join(repoRoot, 'supabase', 'tests');

const testFiles = existsSync(testsDir)
  ? readdirSync(testsDir).filter((name) => name.endsWith('.sql'))
  : [];

if (testFiles.length === 0) {
  console.error(
    'No RLS tests found in supabase/tests/.\n\n' +
      'This gate covers the security properties nothing else can: that a policy\n' +
      'ALLOWS and DENIES the right rows for the right role. The schema executing\n' +
      'and the policies attaching do not establish that.\n\n' +
      'At minimum this suite needs:\n' +
      '  - Amer can view Izzah and Ajmal, and cannot view Lim\n' +
      '  - Amer can view but NOT activate, reassign, or accept completion\n' +
      '    on work he does not own (MASTER_PRODUCT_SPEC.md section 3.4)\n' +
      '  - a deactivated account reads nothing\n' +
      '  - anon reads nothing, anywhere\n' +
      '  - attachment rows and Storage objects follow the owning task\n',
  );
  process.exit(1);
}

const result = spawnSync(
  process.execPath,
  [join(repoRoot, 'scripts', 'supabase-cli.mjs'), 'test', 'db'],
  { cwd: repoRoot, stdio: 'inherit', env: process.env },
);

process.exit(result.status ?? 1);
