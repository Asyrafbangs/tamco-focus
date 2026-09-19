import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getCurrentProfile } from '@/lib/supabase/server';
import { getEshAccess } from '@/server/esh/access';

/**
 * ESH Home (§4, FM01): one card per module the person may open, and nothing
 * for modules they may not — no disabled teaser for work they cannot see
 * (§43.3).
 */
export default async function EshHomePage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect('/sign-in');
  const access = await getEshAccess();
  const focusHref = `/${profile.default_landing_page ?? 'today'}`;

  return (
    <main id="esh-main" className="esh-home">
      <p className="eyebrow">Environment, safety &amp; health</p>
      <h1>Your ESH workspace</h1>
      <p className="esh-home-lead">Choose where you want to work.</p>
      <ul className="esh-module-cards">
        <li>
          <Link className="esh-module-card" href={focusHref}>
            <span className="esh-module-tag" aria-hidden="true">
              Focus
            </span>
            <strong>TAMCO Focus</strong>
            <span className="esh-module-summary">Tasks, routines and team priorities.</span>
            <span className="esh-module-open" aria-hidden="true">
              Open module →
            </span>
          </Link>
        </li>
        {access.enabled && (
          <li>
            <Link className="esh-module-card" href="/findings">
              <span className="esh-module-tag" aria-hidden="true">
                Findings
              </span>
              <strong>Finding Management</strong>
              <span className="esh-module-summary">
                Corrective actions, follow-up and verified closure.
              </span>
              <span className="esh-module-open" aria-hidden="true">
                Open module →
              </span>
            </Link>
          </li>
        )}
      </ul>
      <p className="esh-home-foot">One platform. Separate workspaces.</p>
    </main>
  );
}
