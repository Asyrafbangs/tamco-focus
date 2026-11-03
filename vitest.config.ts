import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { BaseSequencer, type TestSpecification } from 'vitest/node';

const srcRoot = fileURLToPath(new URL('./src', import.meta.url));
const testsRoot = fileURLToPath(new URL('./tests', import.meta.url));

/**
 * `server-only` resolves to a no-op here, and only here.
 *
 * The real package exists to fail: its default entry point throws on import,
 * and Next.js only avoids it by resolving the `react-server` export condition
 * on the server. Vitest resolves the throwing entry, so every module beginning
 * `import 'server-only'` — `src/server/esh/access.ts` and
 * `src/server/esh/queries.ts` among them — was unimportable from a test, and
 * their behaviour could only be tested at one remove, through the pure helpers
 * they call. That is how the v282/v283 hardening came to have no test proving
 * the call sites still call it.
 *
 * Aliasing it costs nothing in production: this config is vitest's alone, the
 * Next.js build still resolves the real package, and the guarantee it enforces
 * — that these modules cannot be bundled for a browser — is not a guarantee
 * about a test runner. Each project repeats the alias because a project's
 * `resolve` replaces the root one rather than merging with it.
 */
const alias = {
  '@': srcRoot,
  '@tests': testsRoot,
  'server-only': fileURLToPath(new URL('./tests/support/server-only.ts', import.meta.url)),
};

/**
 * One order, every run.
 *
 * Vitest sorts files by how long they took last time, slowest first. That is
 * the right default for a parallel suite of pure functions and the wrong one
 * here: the integration specs share a seeded database, so the order decides
 * the result. `goals` and `execution-goal-v53` both take about a second, and
 * the two swapped places between two runs of the same commit — one green, one
 * with two failures in files nothing had touched. Sorting by path makes a
 * failure mean what it says.
 */
class PathSequencer extends BaseSequencer {
  override async sort(files: TestSpecification[]) {
    return [...files].sort((left, right) => left.moduleId.localeCompare(right.moduleId));
  }
}

export default defineConfig({
  resolve: {
    alias,
  },
  test: {
    // Integration specs contend on the same seeded rows, so failures stay
    // attributable to logic rather than to test ordering. Running one file at
    // a time was half of that; the other half is running them in the same
    // order every time.
    fileParallelism: false,
    sequence: { sequencer: PathSequencer },
    projects: [
      {
        // Pure domain logic. No database, no network, fully deterministic.
        resolve: { alias },
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        // Exercises the running local Supabase stack. Requires `supabase start`.
        resolve: { alias },
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          environment: 'node',
          setupFiles: ['tests/integration/setup.ts'],
          // Resets the database once before the suite; see the file for why
          // per-test cleanup is neither possible nor desirable here.
          globalSetup: ['tests/integration/global-setup.ts'],
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
