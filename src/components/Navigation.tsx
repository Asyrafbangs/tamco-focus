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
  { href: '/today', label: 'Today', icon: '◉' },
  { href: '/work', label: 'Work', icon: '▦' },
  { href: '/plan', label: 'Plan', icon: '▤' },
  { href: '/team', label: 'Team', icon: '◑', managerOnly: true },
  { href: '/more', label: 'More', icon: '⋯' },
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
  /**
   * Count of notifications that genuinely require action. Section 23.4 permits
   * a red indicator only in that case, and every one carries written text.
   */
  actionRequiredCount?: number;
}

export function NavigationRail({ role, actionRequiredCount = 0 }: NavigationProps) {
  const isActive = useIsActive();

  return (
    <nav className="rail" aria-label="Main">
      <div className="brand">
        <div className="brandmark" aria-hidden="true">
          TF
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
            >
              <span aria-hidden="true">{destination.icon}</span>
              <span className="label">{destination.label}</span>
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
    </nav>
  );
}

export function MobileNavigation({ role, actionRequiredCount = 0 }: NavigationProps) {
  const isActive = useIsActive();

  return (
    <nav className="mobile-nav" aria-label="Main">
      {visibleTo(role).map((destination) => {
        const active = isActive(destination.href);
        const showBadge = destination.href === '/today' && actionRequiredCount > 0;

        return (
          <Link
            key={destination.href}
            href={destination.href}
            className={active ? 'active' : undefined}
            aria-current={active ? 'page' : undefined}
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
