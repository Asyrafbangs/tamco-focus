import { describe, expect, it } from 'vitest';

import { accessFromAnswer } from '@/domain/esh-findings';

/**
 * v282 — a read that failed is not a read that said no.
 *
 * `getEshAccess` used to return `NO_ESH_ACCESS` whenever the access RPC
 * errored, and every Finding route turns that into `notFound()`. So a
 * coordinator holding every permission met "This page could not be found"
 * whenever the database could not be reached — a false statement, identical to
 * the one a disabled person sees, and invisible to anybody not reading server
 * logs.
 *
 * It is not hypothetical: one local gate run logged four
 * `An invalid response was received from the upstream server` failures, and the
 * last of them rendered a 404 inside the ESH shell that failed an unrelated
 * browser case and read exactly like a product bug.
 *
 * Both outcomes still deny access. The difference is only what the reader is
 * told, and these cases hold that line in both directions.
 */
describe('v282 Finding Management access answers', () => {
  it('refuses to call a failed read "no access"', () => {
    expect(() =>
      accessFromAnswer(null, { code: 'PGRST000', message: 'An invalid response was received' }),
    ).toThrow(/could not be read/);
  });

  it('names the failure, so the cause is not lost between the log and the page', () => {
    expect(() => accessFromAnswer(null, { message: 'upstream 502' })).toThrow(/upstream 502/);
  });

  // A failure plus a stale body is still a failure: the body cannot be trusted.
  it('throws even when the failed read carried a payload', () => {
    expect(() =>
      accessFromAnswer({ enabled: true, preset: 'verifier' }, { message: 'upstream 502' }),
    ).toThrow(/could not be read/);
  });

  it('still fails closed when the answer says the module is off', () => {
    expect(accessFromAnswer({ enabled: false }, null).enabled).toBe(false);
    expect(accessFromAnswer(null, null).enabled).toBe(false);
    // Enabled without a preset is not an answer either.
    expect(accessFromAnswer({ enabled: true }, null).enabled).toBe(false);
  });

  it('maps a real answer, and defaults the parts the database left out', () => {
    const access = accessFromAnswer(
      {
        enabled: true,
        preset: 'verifier',
        scope_all: false,
        department_ids: ['f0c05100-0000-4000-a000-000000000001'],
        can_coordinate: true,
        can_verify: true,
      },
      null,
    );
    expect(access).toEqual({
      enabled: true,
      preset: 'verifier',
      scopeAll: false,
      departmentIds: ['f0c05100-0000-4000-a000-000000000001'],
      canCoordinate: true,
      canVerify: true,
      canManageReports: false,
      authorizationVersion: null,
    });
  });
});
