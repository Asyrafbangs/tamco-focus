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
  /**
   * Shown only when the server says this person may use the assistant.
   *
   * v301 — a role is no longer enough to decide this, because the rule can
   * now name individual accounts, and the named list is server configuration
   * that has no business being shipped to a browser so a `filter` can read
   * it. The layout asks `canUseAssistant` once and passes the answer.
   */
  assistant?: boolean;
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
  // v295 — the assistant sits with the work it reads, not in a settings
  // corner. It is a destination because somebody asks it a question in the
  // middle of doing something, not at the end of a configuration journey.
  // v299 — manager and administrator, like Team Focus before it. The
  // destination appeared for everyone in v295 by omission rather than by
  // decision. This flag only hides the link; the authorisation is
  // `canUseAssistant` in `@/domain/ai`, which the page and the route each
  // call for themselves. The two must agree, and an e2e case holds them to it.
  // v301 — the same rule, asked once on the server, because it can now name
  // accounts as well as roles.
  { href: '/ai', label: 'TAMCO AI', icon: '✦', assistant: true },
  { href: '/more', label: 'More', icon: '•••' },
];

function visibleTo(role: AppRole, assistant: boolean): Destination[] {
  return DESTINATIONS.filter((destination) => {
    if (destination.assistant) return assistant;
    return !destination.managerOnly || role === 'manager' || role === 'administrator';
  });
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
  /**
   * Whether to offer the assistant. Decided on the server by
   * `canUseAssistant`, never re-derived here.
   *
   * Defaults to `false`, which is the safe direction for a presentation
   * concern: a caller that forgets it hides a link somebody is entitled to,
   * which is a visible annoyance, rather than offering one they are not,
   * which is the defect v299 existed to fix. Hiding the link authorises
   * nothing either way — the page and the route check for themselves.
   */
  canUseAssistant?: boolean;
}

export function NavigationRail({
  role,
  actionRequiredCount = 0,
  initials,
  canUseAssistant = false,
}: NavigationProps) {
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
        {visibleTo(role, canUseAssistant).map((destination) => {
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

export function MobileNavigation({
  role,
  actionRequiredCount = 0,
  canUseAssistant = false,
}: NavigationProps) {
  const isActive = useIsActive();
  const destinations = visibleTo(role, canUseAssistant);

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
