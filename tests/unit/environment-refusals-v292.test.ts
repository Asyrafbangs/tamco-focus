import { describe, expect, it } from 'vitest';

// @ts-expect-error - a plain .mjs script module with no type declarations.
import { resolveEnvironment } from '../../scripts/lib/environment.mjs';

/**
 * v292 — the refusal has to be followable.
 *
 * `resolveEnvironment` is what stops a destructive command running against a
 * database nobody declared, and it had no tests at all. The gap that showed
 * was smaller and more annoying than a wrong target: its documented usage is
 * bash's `VAR=value command` prefix, which is a parse error in PowerShell —
 * the shell this repository is driven from on Windows. So the one command that
 * provides the production evidence refused, correctly, with no way past it.
 *
 * These hold the two things the refusals have to do: name the problem, and
 * name a way to fix it on the shell in front of you.
 */
describe('v292 the environment refusals say what to do next', () => {
  it('refuses with no URL, and names both shells', () => {
    let message = '';
    try {
      resolveEnvironment({ url: '', declared: '' });
    } catch (cause) {
      message = String((cause as Error).message);
    }
    expect(message).toContain('cannot be identified');
    expect(message).toContain('$env:NEXT_PUBLIC_SUPABASE_URL');
    expect(message).toContain('TAMCO_ENV=production');
  });

  it('still refuses a declaration that contradicts the URL', () => {
    expect(() =>
      resolveEnvironment({ url: 'https://abcdefgh.supabase.co', declared: 'local' }),
    ).toThrow(/says "local" but the Supabase URL is remote/);
  });

  it('still refuses a hosted URL that nobody declared', () => {
    expect(() =>
      resolveEnvironment({ url: 'https://abcdefgh.supabase.co', declared: '' }),
    ).toThrow();
  });

  it('reads loopback as local, which is what every destructive command relies on', () => {
    const resolved = resolveEnvironment({ url: 'http://127.0.0.1:54321', declared: 'local' });
    expect(resolved.environment).toBe('local');
  });
});
