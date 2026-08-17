import { describe, expect, it } from 'vitest';

import { safeReturnPath } from '@/domain/navigation';

describe('safeReturnPath', () => {
  const fallback = '/work';

  it('preserves a valid internal path, query and fragment', () => {
    expect(safeReturnPath('/work?scope=team&person=izzah#details', fallback)).toBe(
      '/work?scope=team&person=izzah#details',
    );
  });

  it.each([
    'https://evil.example/path',
    '//evil.example/path',
    '/\\evil.example/path',
    '\\evil.example/path',
  ])('rejects external and browser-normalised network paths: %s', (from) => {
    const result = safeReturnPath(from, fallback);
    expect(result).toBe(fallback);
    expect(new URL(result, 'https://tamco.example').origin).toBe('https://tamco.example');
  });

  it('uses the fallback when no return path is provided', () => {
    expect(safeReturnPath(undefined, fallback)).toBe(fallback);
  });
});
