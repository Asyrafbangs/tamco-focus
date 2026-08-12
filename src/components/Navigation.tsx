'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import type { AppRole } from '@/domain/types';

/**
 * Permanent navigation (section 4.1, 4.2).
 *
 * The destinations are Today, Work, Plan, Team (manager and administrator
 * only), and More. Desktop uses a compact rail whose labels stay reachable by
 * keyboard and assistive technology; mobile uses a labelled bottom bar with
 * touch-sized targets.
 */

interface Destination {
  href: string;
  label: string;
  icon: string;
  managerOnly?: boolean;
}

const DESTINATIONS: Destination[] = [
  { href: '/today', label: 'Today', icon: '◷' },
  { href: '/work', label: 'Work', icon: '◎' },
  { href: '/goals', label: 'Goals', icon: '◇' },
  { href: '/plan', label: 'Plan', icon: '▦' },
  // v43 section 3 — no separate Team destination. Team Focus lives inside Work
  // as the My Team scope, so a manager has one Work workspace rather than two
  // places that both list the same tasks. v53 section 22 retired the old
  // `/team` page itself; the route now redirects here so existing links and
  // bookmarks still land on the screen that answers them.
  { href: '/more', label: 'More', icon: '•••' },
];

function visibleTo(role: AppRole): Destination[] {
  return DESTINATIONS.filter(
    (destination) => !destination.managerOnly || role === 'manager' || role === 'administrator',
  );
}

function useIsActive() {
  const pathname = usePathname();
  return (href: string) => pathname === href || pathname.startsWith(`${href}/`);
}

interface NavigationProps {
  role: AppRole;
  initials?: string;
  /**
   * Count of notifications that genuinely require action. Section 23.4 permits
   * a red indicator only in that case, and every one carries written text.
   */
  actionRequiredCount?: number;
}

export function NavigationRail({ role, actionRequiredCount = 0, initials }: NavigationProps) {
  const isActive = useIsActive();

  return (
    <nav className="rail" aria-label="Main">
      <div className="brand">
        <div className="brandmark" aria-hidden="true">
          T
        </div>
        <span className="visually-hidden">TAMCO Focus</span>
      </div>

      <div className="railnav">
        {visibleTo(role).map((destination) => {
          const active = isActive(destination.href);
          const showBadge = destination.href === '/today' && actionRequiredCount > 0;

          return (
            <Link
              key={destination.href}
              href={destination.href}
              className={`railbtn${active ? ' active' : ''}`}
              aria-current={active ? 'page' : undefined}
              // Every rail destination sits in the viewport on every page, so
              // the default prefetch speculatively renders all of them each
              // time. Measured on My Work: it turned 42 SQL statements into
              // 107 and added 292ms to the load, to save 52ms on a client
              // navigation that was already 69ms. These are dynamic,
              // per-person pages — there is no static shell to fetch cheaply,
              // so prefetching one runs its whole query set for a page nobody
              // has asked for yet.
              prefetch={false}
            >
              <span aria-hidden="true">{destination.icon}</span>
              <span className="label" aria-hidden="true">
                {destination.label}
              </span>
              <span className="visually-hidden">{destination.label}</span>

              {showBadge && (
                <>
                  <span className="navbadge" aria-hidden="true">
                    {actionRequiredCount > 9 ? '9+' : actionRequiredCount}
                  </span>
                  <span className="visually-hidden">
                    {`${actionRequiredCount} item${actionRequiredCount === 1 ? '' : 's'} need action`}
                  </span>
                </>
              )}
            </Link>
          );
        })}
      </div>
      {initials && (
        <div className="railfoot" aria-hidden="true">
          <div className="avatar">{initials}</div>
        </div>
      )}
    </nav>
  );
}

export function MobileNavigation({ role, actionRequiredCount = 0 }: NavigationProps) {
  const isActive = useIsActive();
  const destinations = visibleTo(role);

  return (
    <nav
      className="mobile-nav"
      aria-label="Main"
      style={{ gridTemplateColumns: `repeat(${destinations.length}, minmax(0, 1fr))` }}
    >
      {destinations.map((destination) => {
        const active = isActive(destination.href);
        const showBadge = destination.href === '/today' && actionRequiredCount > 0;

        return (
          <Link
            key={destination.href}
            href={destination.href}
            className={active ? 'active' : undefined}
            aria-current={active ? 'page' : undefined}
            // Same reasoning as the rail; on a phone the whole bar is always
            // on screen, so the effect is if anything larger.
            prefetch={false}
          >
            <span aria-hidden="true">{destination.icon}</span>
            {destination.label}
            {showBadge && (
              <span className="visually-hidden">
                {`, ${actionRequiredCount} item${actionRequiredCount === 1 ? '' : 's'} need action`}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
