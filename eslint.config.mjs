import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTypeScript from 'eslint-config-next/typescript';

export default defineConfig([
  ...nextVitals,
  ...nextTypeScript,
  globalIgnores([
    'node_modules/**',
    '.next/**',
    '.next-e2e/**',
    '.next-verify/**',
    'playwright-report/**',
    'test-results/**',
    'coverage/**',
    'src/lib/database.types.ts',
    'desktop/**',
    'mobile/**',
    // Vendored agent skills installed with `npx skills add`. Third-party code,
    // linted upstream and not ours to change — same reasoning as the
    // prototypes above.
    '.claude/skills/**',
  ]),
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      'no-console': ['error', { allow: ['warn', 'error', 'info'] }],
      // `x == null` is the idiomatic way to test null and undefined together,
      // which matters for nullable answers that are meaningfully tri-state.
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'prefer-const': 'error',
    },
  },
  {
    // Node-side scripts and tests may log freely.
    files: ['scripts/**/*.mjs', 'tests/**/*.ts', '*.config.ts', '*.config.mjs'],
    rules: { 'no-console': 'off' },
  },
]);
