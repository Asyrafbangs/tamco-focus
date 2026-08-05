import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const srcRoot = fileURLToPath(new URL('./src', import.meta.url));
const testsRoot = fileURLToPath(new URL('./tests', import.meta.url));

export default defineConfig({
  resolve: {
    alias: { '@': srcRoot, '@tests': testsRoot },
  },
  test: {
    // Integration specs contend on the same seeded rows, so failures stay
    // attributable to logic rather than to test ordering.
    fileParallelism: false,
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
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
