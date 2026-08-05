import { redirect } from 'next/navigation';

import { MobileNavigation, NavigationRail } from '@/components/Navigation';
import { ThemeToggle } from '@/components/ThemeToggle';
import { getCurrentProfile } from '@/lib/supabase/server';
import { getActionRequiredCount } from '@/server/queries';
import type { AppRole } from '@/domain/types';

import { SignOutButton } from './SignOutButton';

/**
 * The authenticated shell.
 *
 * Section 4 — permanent destinations are Today, Work, Plan, Team (manager and
 * administrator only), and More, presented as a rail on desktop and a labelled
 * bottom bar on mobile.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const profile = await getCurrentProfile();

  // The middleware already redirects, but a deactivated account can hold a
  // valid token; this is the second gate, and RLS is the third.
  if (!profile) redirect('/sign-in');

  const role = profile.role as AppRole;
  const actionRequiredCount = await getActionRequiredCount(profile.id);

  const initials = profile.full_name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part: string) => part[0])
    .join('')
    .toUpperCase();

  return (
    <div className="app">
      <a className="skip-link" href="#main">
        Skip to main content
      </a>

      <NavigationRail role={role} actionRequiredCount={actionRequiredCount} />

      <div className="shell">
        <header className="topbar">
          <div className="top-left">
            <div className="product">
              <strong>TAMCO Focus</strong>
              <span>{profile.full_name}</span>
            </div>
          </div>

          <div className="top-right">
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
