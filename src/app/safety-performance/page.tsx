import type { Metadata } from 'next';

import { AgePanel, ClosurePanel, RiskPanel, TrendPanel } from '@/components/esh/DashboardPanels';
import { headline } from '@/domain/esh-dashboard';
import { orgConfig } from '@/lib/env';
import { getPublicDashboard } from '@/server/esh/queries';

/**
 * The safety dashboard anyone can open (v230).
 *
 * Built at the Product Owner's explicit request (1 Oct 2026) to be readable
 * with no sign-in, so that an employee, a supervisor or a manager can see how
 * the site is doing without an account and without Finding access.
 *
 * Everything on it is a count over the whole organisation. There is no
 * department, no reference, no title, no owner, no location and no date of any
 * single finding, and a finding marked restricted is not counted at all — the
 * database function enforces that, not this page. Nobody can be identified
 * from anything here, which is the condition on which a page with no front
 * door is safe to serve.
 */

export const metadata: Metadata = {
  title: 'Safety performance',
  description: 'Open safety findings, how old they are, and how much closes on time.',
  // Readable by anyone who has the address, but not advertised to the world.
  // Remove this to have it indexed.
  robots: { index: false, follow: false },
};

/** Recomputed at most every five minutes: it is a public page on a free plan. */
export const revalidate = 300;

export default async function PublicSafetyPage() {
  const data = await getPublicDashboard();

  if (!data) {
    return (
      <main className="public-dash" id="main">
        <h1>Safety performance</h1>
        <p className="public-dash-lead">
          These figures are not available at the moment. Nothing is shown rather than numbers that
          may be wrong.
        </p>
      </main>
    );
  }

  const asOf = new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: orgConfig.timeZone,
  }).format(new Date(data.asOf));

  return (
    <main className="public-dash" id="main">
      <header className="public-dash-head">
        <p className="eyebrow">TAMCO · Environment, Safety &amp; Health</p>
        <h1>Safety performance</h1>
        <p className="public-dash-lead">{headline(data)}</p>
        <p className="public-dash-time">Figures at {asOf}</p>
      </header>

      <section className="esh-dash-headline" aria-label="Headline figures">
        <p className="public-dash-figure">
          <strong>{data.openFindings}</strong>
          <span>open finding{data.openFindings === 1 ? '' : 's'}</span>
        </p>
        <p className="public-dash-figure" data-exception={data.overdueActions > 0 || undefined}>
          <strong>{data.overdueActions}</strong>
          <span>past their due date</span>
        </p>
        <p className="public-dash-figure">
          <strong>{data.closure.closed}</strong>
          <span>closed in the last 6 months</span>
        </p>
      </section>

      <div className="esh-dash-grid">
        <TrendPanel monthly={data.monthly} />
        <ClosurePanel closure={data.closure} />
        <RiskPanel openByRisk={data.openByRisk} />
        <AgePanel openByAge={data.openByAge} />
      </div>

      <footer className="public-dash-foot">
        <p>
          Counts only. Individual findings, the people responsible for them and the places they
          concern are not shown here and are not public.
        </p>
        <p>
          If you have a safety concern, raise it with your supervisor or the ESH department — this
          page cannot receive one.
        </p>
      </footer>
    </main>
  );
}
