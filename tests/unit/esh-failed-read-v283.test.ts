import { describe, expect, it } from 'vitest';

import { requireAnswer } from '@/domain/esh-findings';

/**
 * v283 — "nothing" and "no answer" are different facts.
 *
 * `getFindingDetail` returned null both when a finding was genuinely absent and
 * when the read failed, and the detail page turns null into `notFound()`. A
 * gateway 502 therefore told the reader that a finding did not exist — on the
 * one screen in the module where that statement does the most damage, and in
 * exactly the way v282's access read did before it.
 */
describe('v283 a failed read is not an absent row', () => {
  it('throws when the read failed, naming what could not be read', () => {
    expect(() => requireAnswer({ message: 'upstream 502' }, 'The finding')).toThrow(
      /The finding could not be read: unknown upstream 502/,
    );
  });

  it('carries the code through, so the cause survives into the error', () => {
    expect(() =>
      requireAnswer({ code: 'PGRST301', message: 'JWT expired' }, 'The register'),
    ).toThrow(/PGRST301 JWT expired/);
  });

  it('says nothing at all when the read succeeded', () => {
    expect(() => requireAnswer(null, 'The finding')).not.toThrow();
  });
});
