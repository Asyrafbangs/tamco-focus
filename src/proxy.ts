import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

import { publicEnv } from '@/lib/env';

/** Paths reachable without a session. Everything else requires one. */
const PUBLIC_PATHS = ['/sign-in', '/auth/callback', '/forgot-password'];

/**
 * Endpoints that carry their own authentication and must not be redirected.
 *
 * `/api/cron` is called by the platform scheduler, which presents a bearer
 * secret and holds no session cookie. Sending it to `/sign-in` does not fail
 * loudly — it returns a 307 the scheduler treats as a response, so routine
 * generation and the weekly summary would silently never run. That is the exact
 * failure section 38 is about, and it survived until the first live smoke test.
 *
 * This is not a hole. The route refuses anything without
 * `Authorization: Bearer $CRON_SECRET`, and returns 503 rather than running
 * unprotected when the secret is unset. Session redirect and secret check are
 * two different mechanisms; this endpoint uses the second.
 */
const SELF_AUTHENTICATING_PATHS = ['/api/cron'];

/**
 * Refreshes the Supabase session on every request and gates the application
 * behind authentication.
 *
 * This is a convenience redirect, not the security boundary. The boundary is
 * RLS: even a request that slipped past this proxy would read nothing it
 * is not entitled to.
 */
export async function proxy(request: NextRequest) {
  // Before any Supabase round trip: a scheduler request has no session to
  // refresh, and asking the auth server about a user that cannot exist only
  // adds latency to a job that must not be redirected anyway.
  if (SELF_AUTHENTICATING_PATHS.some((path) => request.nextUrl.pathname.startsWith(path))) {
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // Refreshes an expiring token as a side effect. Must be `getUser`, not
  // `getSession`: only `getUser` revalidates the token with the auth server.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some((path) => pathname.startsWith(path));

  /*
   * An emailed token arriving anywhere goes to the callback that can spend it.
   *
   * Supabase ignores a `redirect_to` that is not on the project's allow-list
   * and falls back to the Site URL, so a recovery link built with the wrong
   * origin lands on `/` carrying a valid `token_hash`. The holder has no
   * session yet — that is the entire point of a recovery link — so this proxy
   * redirected them to sign-in and dropped the token on the way. Forwarding it
   * has to happen here rather than in the page, because the page never ran.
   *
   * Nothing is trusted by doing this: `/auth/callback` still verifies the
   * token, and an expired, spent or forged one is refused there exactly as
   * before.
   */
  const emailedToken = request.nextUrl.searchParams.get('token_hash');
  const emailedType = request.nextUrl.searchParams.get('type');
  if (!user && emailedToken && emailedType && !pathname.startsWith('/auth/callback')) {
    const callback = request.nextUrl.clone();
    callback.pathname = '/auth/callback';
    callback.search = '';
    callback.searchParams.set('token_hash', emailedToken);
    callback.searchParams.set('type', emailedType);
    return NextResponse.redirect(callback);
  }

  if (!user && !isPublic) {
    const signIn = request.nextUrl.clone();
    signIn.pathname = '/sign-in';
    // Preserve where they were heading so sign-in can return them there.
    signIn.searchParams.set('next', pathname);
    return NextResponse.redirect(signIn);
  }

  if (user && pathname === '/sign-in') {
    const home = request.nextUrl.clone();
    home.pathname = '/today';
    home.search = '';
    return NextResponse.redirect(home);
  }

  return response;
}

export const config = {
  matcher: [
    // Everything except static assets and image files.
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
