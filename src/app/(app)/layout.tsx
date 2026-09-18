import { redirect } from 'next/navigation';
import { Suspense } from 'react';

import { sanitiseTheme, themeStyleSheet } from '@/lib/theme';

import { ThemeAttribute } from './ThemeAttribute';

import { MobileNavigation, NavigationRail } from '@/components/Navigation';
import { NotificationBell } from '@/components/NotificationBell';
import { PendingDrawer } from '@/components/ui/PendingDrawer';
import { ThemeToggle } from '@/components/ThemeToggle';
import { getCurrentProfile } from '@/lib/supabase/server';
import { getActionRequiredCount, getNotifications } from '@/server/queries';
import type { AppRole } from '@/domain/types';

import { SignOutButton } from './SignOutButton';

/**
 * The authenticated shell.
 *
 * v33 — permanent destinations are Today, Work, Goals, Plan, Team (manager and
 * administrator only), and More, presented as a rail on desktop and a labelled
 * bottom bar on mobile.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const profile = await getCurrentProfile();

  // The middleware already redirects, but a deactivated account can hold a
  // valid token; this is the second gate, and RLS is the third.
  if (!profile) redirect('/sign-in');

  const role = profile.role as AppRole;
  const [actionRequiredCount, notifications] = await Promise.all([
    getActionRequiredCount(profile.id),
    getNotifications(profile.id),
  ]);

  const initials = profile.full_name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part: string) => part[0])
    .join('')
    .toUpperCase();

  const themeColors = sanitiseTheme(profile.theme_colors);
  const themeCss = themeStyleSheet(themeColors);

  return (
    <div className="app">
      {/*
        The saved palette, rendered by the server.

        Two elements rather than one: this carries what is stored, and the
        settings page writes into the empty one below it while somebody is
        choosing, so the whole application previews live without this being
        rebuilt on every keystroke. The attribute is what the override selector
        keys on, so a person with no theme costs nothing at all.
      */}
      {themeCss && <style id="tamco-theme-saved">{themeCss}</style>}
      <style id="tamco-theme-live" />
      {themeCss && <ThemeAttribute />}

      <a className="skip-link" href="#main">
        Skip to main content
      </a>

      {/* v195 - the drawer a press has asked for, until its content arrives.
          Suspense because it reads the address, which a shell must not wait on. */}
      <Suspense fallback={null}>
        <PendingDrawer />
      </Suspense>

      <NavigationRail role={role} actionRequiredCount={actionRequiredCount} initials={initials} />

      <div className="shell">
        <header className="topbar">
          <div className="top-left">
            <div className="product">
              <strong>TAMCO Focus</strong>
              <span>Tasks, routines and support</span>
            </div>
            <form className="global-search" action="/more/records" role="search">
              <label className="visually-hidden" htmlFor="global-search">
                Search tasks, routines or people
              </label>
              <input id="global-search" name="q" placeholder="Search tasks, routines or people" />
              <button type="submit" aria-label="Search tasks, routines or people">
                ⌕
              </button>
            </form>
          </div>

          <div className="top-right">
            <span className="signed-in-name">{profile.full_name}</span>
            {/* v42 section M — one bell, in the existing top bar, counting only
                what is waiting on this person. */}
            <NotificationBell
              notifications={notifications}
              unreadActionable={actionRequiredCount}
            />
            <ThemeToggle />
            <div className="avatar" aria-hidden="true">
              {initials}
            </div>
            <span className="visually-hidden">
              Signed in as {profile.full_name}, {role.replace('_', ' ')}
            </span>
            <SignOutButton />
          </div>
        </header>

        <main id="main" className="main">
          {children}
        </main>
      </div>

      <MobileNavigation role={role} actionRequiredCount={actionRequiredCount} />
    </div>
  );
}
