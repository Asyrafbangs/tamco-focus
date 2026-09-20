'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * Finding Management's own navigation (§4, §33.1). Overview joins this list
 * in the stage that builds it, never as an empty page first.
 */
export function FindingNav({
  waitingToVerify,
  canManageSettings,
}: {
  waitingToVerify: number;
  canManageSettings: boolean;
}) {
  const pathname = usePathname();
  const inRegister =
    pathname.startsWith('/findings/register') ||
    pathname === '/findings/new' ||
    /^\/findings\/[0-9a-f-]{36}$/.test(pathname);

  return (
    <nav className="esh-sidenav" aria-label="Finding Management">
      <p className="esh-sidenav-title">Finding Management</p>
      <ul>
        <li>
          <Link href="/findings/register" aria-current={inRegister ? 'page' : undefined}>
            Finding Register
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
            href="/findings/closed"
            aria-current={pathname.startsWith('/findings/closed') ? 'page' : undefined}
          >
            Closed
          </Link>
        </li>
        {canManageSettings && (
          <li>
            <Link
              href="/findings/settings"
              aria-current={pathname.startsWith('/findings/settings') ? 'page' : undefined}
            >
              Follow-up settings
            </Link>
          </li>
        )}
      </ul>
      <Link href="/esh" className="esh-sidenav-home">
        ← ESH Home
      </Link>
    </nav>
  );
}
