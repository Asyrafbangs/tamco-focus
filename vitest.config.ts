import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { BaseSequencer, type TestSpecification } from 'vitest/node';

const srcRoot = fileURLToPath(new URL('./src', import.meta.url));
const testsRoot = fileURLToPath(new URL('./tests', import.meta.url));

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
    alias: { '@': srcRoot, '@tests': testsRoot },
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
        resolve: { alias: { '@': srcRoot, '@tests': testsRoot } },
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        // Exercises the running local Supabase stack. Requires `supabase start`.
        resolve: { alias: { '@': srcRoot, '@tests': testsRoot } },
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
