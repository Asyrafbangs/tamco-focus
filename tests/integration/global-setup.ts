import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { config } from 'dotenv';

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
  config({ path: join(repoRoot, '.env.local'), quiet: true });

  const reuseExistingDatabase = process.env.TAMCO_INTEGRATION_REUSE_LOCAL_DB === '1';
  if (reuseExistingDatabase) {
    console.log('Using the existing local database for this explicitly non-destructive run…');
  } else {
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

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) throw new Error('Local Supabase environment values are missing.');

  // A reset returns while containers are still restarting. The opt-in reuse
  // path needs the same readiness probe because it is used by constrained
  // local verification environments that deliberately preserve developer data.
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`${supabaseUrl}/rest/v1/`, {
        headers: { apikey: anonKey },
      });
      if (response.status < 500) return;
    } catch {
      // The service is still restarting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error('Supabase did not become ready within 20 seconds after the database reset.');
}
