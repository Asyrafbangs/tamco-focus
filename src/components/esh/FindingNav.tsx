'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';

/**
 * Finding Management's own navigation (§4, §33.1).
 *
 * Register, Verification and Closed are the working destinations; settings
 * stays secondary. Closed was a chip inside the register while also being a
 * place people navigate to, which made two navigation systems compete on one
 * screen. It is a destination here and a view there — the same URL, reached
 * the way people actually think of it.
 */
export function FindingNav({
  waitingToVerify,
  canManageSettings,
}: {
  waitingToVerify: number;
  canManageSettings: boolean;
}) {
  const pathname = usePathname();
  const showingClosed = useSearchParams().get('filter') === 'closed';
  const inRegister =
    (pathname.startsWith('/findings/register') && !showingClosed) ||
    pathname === '/findings/new' ||
    /^\/findings\/[0-9a-f-]{36}$/.test(pathname);

  return (
    <nav className="esh-sidenav" aria-label="Finding Management">
      <p className="esh-sidenav-title">Finding Management</p>
      {/*
       * v223 - Register, Verification, Closed, Settings. The Overview is kept
       * at its address and reached from the Register's tools; it is not daily
       * work, so it does not stand first in the navigation.
       */}
      <ul>
        <li>
          <Link href="/findings/register" aria-current={inRegister ? 'page' : undefined}>
            Register
          </Link>
        </li>
        <li>
          <Link
            href="/findings/verification"
            aria-current={pathname.startsWith('/findings/verification') ? 'page' : undefined}
          >
            Verification
            {waitingToVerify > 0 && (
              <span className="esh-nav-count" aria-label={`${waitingToVerify} waiting`}>
                {waitingToVerify}
              </span>
            )}
          </Link>
        </li>
        <li>
          <Link
            href="/findings/register?filter=closed"
            aria-current={showingClosed ? 'page' : undefined}
          >
            Closed
          </Link>
        </li>
      </ul>
      {canManageSettings && (
        <Link
          className="esh-sidenav-settings"
          href="/findings/settings"
          aria-current={pathname.startsWith('/findings/settings') ? 'page' : undefined}
        >
          Settings
        </Link>
      )}
      <Link href="/esh" className="esh-sidenav-home">
        ← ESH Home
      </Link>
    </nav>
  );
}
