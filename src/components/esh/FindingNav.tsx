'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/** Three destinations for daily work, records and historical insight. */
export function FindingNav({ canManageSettings }: { canManageSettings: boolean }) {
  const pathname = usePathname();
  const onPatterns = pathname.startsWith('/findings/patterns');
  const onFindings =
    pathname.startsWith('/findings/register') ||
    pathname === '/findings/new' ||
    pathname === '/findings/closed' ||
    /^\/findings\/[0-9a-f-]{36}$/.test(pathname);
  const onToday = pathname === '/findings' || pathname === '/findings/verification';
  const current = onPatterns ? 'patterns' : onFindings ? 'findings' : onToday ? 'today' : null;

  return (
    <nav className="esh-sidenav" aria-label="Finding Management">
      <p className="esh-sidenav-title">Finding Management</p>
      <ul>
        <li>
          <Link href="/findings" aria-current={current === 'today' ? 'page' : undefined}>
            Today
          </Link>
        </li>
        <li>
          <Link
            href="/findings/register?filter=open"
            aria-current={current === 'findings' ? 'page' : undefined}
          >
            Findings
          </Link>
        </li>
        <li>
          <Link
            href="/findings/patterns"
            aria-current={current === 'patterns' ? 'page' : undefined}
          >
            Patterns
          </Link>
        </li>
      </ul>
      {canManageSettings && (
        <Link
          className="esh-sidenav-settings"
          href="/findings/settings"
          aria-current={pathname.startsWith('/findings/settings') ? 'page' : undefined}
        >
          Configuration
        </Link>
      )}
      <Link href="/esh" className="esh-sidenav-home">
        ← ESH Home
      </Link>
    </nav>
  );
}
