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

  /*
   * v152 — the same helper now guards `/sign-in?next=`, which had its own
   * weaker check (`next.startsWith('/')`) and let a signed-in person be handed
   * straight to another origin. These are the cases a literal reading of the
   * string misses: browsers strip control characters out of a URL and navigate
   * to what is left, so each of these leaves the site while looking local.
   * Only tab, line feed and carriage return: a space is percent-encoded
   * rather than discarded, and `/%20/evil.example` stays on this site.
   */
  it.each(['/\u0009/evil.example', '/\u000a/evil.example', '/\u000d/evil.example'])(
    'rejects a path made external by characters browsers discard: %s',
    (from) => {
      expect(safeReturnPath(from, fallback)).toBe(fallback);
    },
  );

  it('sends an empty or nonsense value to the fallback rather than nowhere', () => {
    expect(safeReturnPath('', fallback)).toBe(fallback);
    expect(safeReturnPath('today', fallback)).toBe(fallback);
  });

  it('uses the fallback when no return path is provided', () => {
    expect(safeReturnPath(undefined, fallback)).toBe(fallback);
  });
});
