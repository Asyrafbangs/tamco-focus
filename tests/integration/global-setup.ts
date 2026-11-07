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

  /*
   * A reset returns while containers are still restarting, and this probe has
   * to watch the one that does.
   *
   * It used to ask `/rest/v1/`, which is the service that stays up: `rest`
   * keeps its container across a `db reset` while `auth` is recreated. So the
   * probe answered 200 immediately and returned, every time, including when
   * GoTrue was not accepting sign-ins yet — it could not detect the single
   * condition it exists to detect. Every test here signs in, so auth
   * readiness is the readiness that matters, and `scripts/run-e2e.mjs` has
   * always probed it this way for the same reason.
   *
   * The opt-in reuse path needs the same probe, because it is used by
   * constrained local verification environments that deliberately preserve
   * developer data.
   */
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await fetch(`${supabaseUrl}/auth/v1/settings`, {
        headers: { apikey: anonKey },
      });
      if (response.ok) return;
    } catch {
      // The auth service is still restarting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error('Supabase Auth did not become ready within 60 seconds after the database reset.');
}
