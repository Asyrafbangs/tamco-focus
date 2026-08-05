import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

/**
 * Resets the database once before the integration suite.
 *
 * Per-test cleanup is impossible here, and correctly so: deleting a task
 * cascades into `audit_events`, where DELETE is revoked from every role and the
 * append-only trigger would refuse it anyway. Retained history is a product
 * requirement (MASTER_PRODUCT_SPEC.md section 21.3), not an obstacle to work
 * around — so the suite starts from a known seed instead of trying to tidy up
 * after itself.
 */
export async function setup() {
  const repoRoot = join(import.meta.dirname, '..', '..');

  console.log('Resetting the local database for the integration suite…');

  const result = spawnSync(
    process.execPath,
    [join(repoRoot, 'scripts', 'supabase-cli.mjs'), 'db', 'reset'],
    { cwd: repoRoot, stdio: 'pipe', encoding: 'utf8' },
  );

  if (result.status !== 0) {
    throw new Error(
      'Could not reset the database before the integration suite.\n' +
        'The local Supabase stack must be running (`npm run supabase:start`).\n' +
        (result.stderr ?? ''),
    );
  }
}
