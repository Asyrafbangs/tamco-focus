import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * v195 — one question to the auth server per request, not two.
 *
 * Every open, close and save asked the auth server who was signed in twice in
 * a row: in the proxy, which must, and again in the page. The page now takes
 * the proxy's answer — but only with the session's signed token naming the
 * same person, and never from a header a client could have written.
 */

const ME = 'f0c05000-0000-4000-a000-000000000004';
const SOMEBODY_ELSE = 'f0c05000-0000-4000-a000-000000000003';

const state = vi.hoisted(() => ({
  requestHeaders: new Headers(),
  claims: { data: null as { claims: { sub: string } } | null, error: null as Error | null },
  user: null as { id: string } | null,
  getUser: vi.fn(),
  getClaims: vi.fn(),
  profileFor: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/env', () => ({
  publicEnv: { NEXT_PUBLIC_SUPABASE_URL: 'http://db.test', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon' },
}));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
vi.mock('next/headers', () => ({
  cookies: async () => ({ getAll: () => [], set: () => {} }),
  headers: async () => state.requestHeaders,
}));
vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getUser: state.getUser, getClaims: state.getClaims },
    from: () => ({
      select: () => ({
        eq: (_column: string, id: string) => ({
          maybeSingle: async () => ({ data: state.profileFor(id), error: null }),
        }),
      }),
    }),
  }),
}));

import { SESSION_USER_HEADER, forwardedRequestHeaders } from '@/lib/supabase/session-header';
import { getCurrentProfile } from '@/lib/supabase/server';

beforeEach(() => {
  state.requestHeaders = new Headers();
  state.claims = { data: { claims: { sub: ME } }, error: null };
  state.user = { id: ME };
  state.getUser.mockReset().mockImplementation(async () => ({ data: { user: state.user } }));
  state.getClaims.mockReset().mockImplementation(async () => state.claims);
  state.profileFor.mockReset().mockImplementation((id: string) => ({ id, status: 'active' }));
});

describe('v195 — who is signed in', () => {
  it("takes the proxy's word when the signed token names the same person", async () => {
    state.requestHeaders.set(SESSION_USER_HEADER, ME);

    const profile = await getCurrentProfile();

    expect(profile?.id).toBe(ME);
    expect(state.getUser, 'no second trip to the auth server').not.toHaveBeenCalled();
  });

  it('asks the auth server when the token names somebody else', async () => {
    state.requestHeaders.set(SESSION_USER_HEADER, SOMEBODY_ELSE);

    const profile = await getCurrentProfile();

    expect(state.getUser).toHaveBeenCalledOnce();
    expect(profile?.id, 'never the person the header named').toBe(ME);
  });

  it('asks the auth server when the proxy vouched for nobody', async () => {
    // A server action on an ended session is let through without the header.
    const profile = await getCurrentProfile();

    expect(state.getUser).toHaveBeenCalledOnce();
    expect(profile?.id).toBe(ME);
  });

  it('asks the auth server when the token does not verify', async () => {
    state.requestHeaders.set(SESSION_USER_HEADER, ME);
    state.claims = { data: null, error: new Error('JWT expired') };
    state.user = null;

    expect(await getCurrentProfile()).toBeNull();
    expect(state.getUser).toHaveBeenCalledOnce();
  });

  it('still refuses a deactivated account', async () => {
    state.requestHeaders.set(SESSION_USER_HEADER, ME);
    state.profileFor.mockImplementation((id: string) => ({ id, status: 'inactive' }));

    expect(await getCurrentProfile()).toBeNull();
  });
});

describe('v195 — the header the proxy forwards', () => {
  it('drops a value the client sent, whoever it names', () => {
    const incoming = new Headers({ [SESSION_USER_HEADER]: SOMEBODY_ELSE, cookie: 'a=b' });

    const forwarded = forwardedRequestHeaders(incoming, null);

    expect(forwarded.has(SESSION_USER_HEADER)).toBe(false);
    expect(forwarded.get('cookie'), 'everything else passes through').toBe('a=b');
  });

  it("replaces it with the auth server's answer", () => {
    const incoming = new Headers({ [SESSION_USER_HEADER]: SOMEBODY_ELSE });

    expect(forwardedRequestHeaders(incoming, ME).get(SESSION_USER_HEADER)).toBe(ME);
    expect(incoming.get(SESSION_USER_HEADER), 'the request itself is left alone').toBe(
      SOMEBODY_ELSE,
    );
  });
});
