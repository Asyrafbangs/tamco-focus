'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const links = [
  { href: '/more', label: 'Overview' },
  { href: '/more/records', label: 'Completion Reviews' },
  { href: '/more/attachments', label: 'Attachments' },
  { href: '/more/audit', label: 'Audit History' },
  { href: '/more/archive', label: 'Archive' },
  { href: '/more/settings', label: 'Settings' },
];

export function MoreNavigation({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();
  const items = isAdmin
    ? [
        ...links,
        { href: '/more/admin/users', label: 'Users' },
        { href: '/more/admin/visibility', label: 'Visibility Rules' },
      ]
    : links;
  return (
    <nav className="more-nav" aria-label="Records and settings">
      {items.map((item) => {
        const active =
          item.href === '/more' ? pathname === item.href : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={active ? 'active' : undefined}
            aria-current={active ? 'page' : undefined}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
