import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FlatCompat } from '@eslint/eslintrc';

const compat = new FlatCompat({
  baseDirectory: dirname(fileURLToPath(import.meta.url)),
});

export default [
  {
    ignores: [
      'node_modules/**',
      '.next/**',
      'playwright-report/**',
      'test-results/**',
      'coverage/**',
      'src/lib/database.types.ts',
      'desktop/**',
      'mobile/**',
    ],
  },
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      'no-console': ['error', { allow: ['warn', 'error', 'info'] }],
      // `x == null` is the idiomatic way to test null and undefined together,
      // which matters for nullable answers that are meaningfully tri-state
      // ("not asked yet" vs "answered no"). Every other comparison is strict.
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'prefer-const': 'error',
    },
  },
  {
    // Node-side scripts and tests may log freely.
    files: ['scripts/**/*.mjs', 'tests/**/*.ts', '*.config.ts', '*.config.mjs'],
    rules: { 'no-console': 'off' },
  },
];
