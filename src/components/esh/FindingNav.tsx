'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * Finding Management's own navigation (§4, §33.1). Closed is a Register
 * filter, not a menu item; Overview and Verification join this list in the
 * stages that build them, never as empty pages first.
 */
export function FindingNav() {
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
      </ul>
      <Link href="/esh" className="esh-sidenav-home">
        ← ESH Home
      </Link>
    </nav>
  );
}
