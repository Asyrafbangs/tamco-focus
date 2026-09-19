import Link from 'next/link';
import { redirect } from 'next/navigation';

import { ModuleSwitcher } from '@/components/esh/ModuleSwitcher';
import { ESH_PRESET_LABELS } from '@/domain/esh-findings';
import { getCurrentProfile } from '@/lib/supabase/server';
import { sanitiseTheme, themeStyleSheet } from '@/lib/theme';
import { getEshAccess } from '@/server/esh/access';

import { SignOutButton } from '../(app)/SignOutButton';
import { ThemeAttribute } from '../(app)/ThemeAttribute';

/**
 * The ESH platform chrome (v197, spec §4): ESH Home, the module switcher and
 * who is signed in — and no module's menu. TAMCO Focus keeps its own shell;
 * Finding Management adds its navigation inside this one.
 */
export default async function EshLayout({ children }: { children: React.ReactNode }) {
  const profile = await getCurrentProfile();
  if (!profile) redirect('/sign-in');

  const access = await getEshAccess();
  const focusHref = `/${profile.default_landing_page ?? 'today'}`;
  const themeCss = themeStyleSheet(sanitiseTheme(profile.theme_colors));
  const firstName = profile.full_name.split(' ')[0] ?? profile.full_name;

  return (
    <div className="esh-app">
      {themeCss && <style id="tamco-theme-saved">{themeCss}</style>}
      {themeCss && <ThemeAttribute />}
      <a className="skip-link" href="#esh-main">
        Skip to main content
      </a>
      <header className="esh-topbar">
        {access.enabled ? (
          <ModuleSwitcher focusHref={focusHref} />
        ) : (
          <Link href={focusHref} className="esh-home-link" aria-label="TAMCO Focus">
            <span className="esh-brand-mark" aria-hidden="true">
              E
            </span>
            <span>TAMCO Focus</span>
          </Link>
        )}
        <div className="esh-account">
          <span>
            {firstName}
            {access.enabled && access.preset ? ` · ESH ${ESH_PRESET_LABELS[access.preset]}` : ''}
          </span>
          <SignOutButton />
        </div>
      </header>
      {children}
    </div>
  );
}
