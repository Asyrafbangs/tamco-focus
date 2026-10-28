import {
  ageBars,
  backlogTrend,
  onTimeRate,
  riskBars,
  type ClosureFacts,
  type DashboardData,
  type MonthPoint,
  type ProtectionFacts,
  type ResponsivenessFacts,
} from '@/domain/esh-dashboard';

/**
 * The panels both dashboards are built from (v230, §33).
 *
 * Server components with no interactivity: a dashboard is read, not operated,
 * and the same figures have to mean the same thing on the ESH page and on the
 * sign-in-free one. Charts are plain elements sized by percentage rather than
 * a charting library — they have to survive Night mode, a doubled text size
 * and a phone, and a bar is a div.
 */

export function TrendPanel({ monthly }: { monthly: MonthPoint[] }) {
  const trend = backlogTrend(monthly);
  const tallest = Math.max(1, ...monthly.map((point) => Math.max(point.opened, point.closed)));

  return (
    <section className="esh-dash-panel" aria-labelledby="dash-trend">
      <h2 id="dash-trend">Recorded against closed</h2>
      <p className="esh-dash-lead" data-direction={trend.direction}>
        {trend.words}
      </p>
      {/*
        A table, not a picture. It is the same numbers either way, and this way
        a screen reader and a printout both get them.
      */}
      <table className="esh-dash-chart">
        <caption className="visually-hidden">
          Findings recorded and closed in each of the last {monthly.length} months
        </caption>
        <thead>
          <tr>
            <th scope="col">Month</th>
            <th scope="col">Recorded</th>
            <th scope="col">Closed</th>
          </tr>
        </thead>
        <tbody>
          {monthly.map((point) => (
            <tr key={point.month}>
              <th scope="row">{monthLabel(point.month)}</th>
              <td>
                <span className="esh-dash-bar" data-kind="opened">
                  <span style={{ width: `${(point.opened / tallest) * 100}%` }} />
                </span>
                <span className="esh-dash-figure">{point.opened}</span>
              </td>
              <td>
                <span className="esh-dash-bar" data-kind="closed">
                  <span style={{ width: `${(point.closed / tallest) * 100}%` }} />
                </span>
                <span className="esh-dash-figure">{point.closed}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export function RiskPanel({ openByRisk }: { openByRisk: Record<string, number> }) {
  const bars = riskBars(openByRisk);
  if (bars.length === 0) return null;
  return (
    <section className="esh-dash-panel" aria-labelledby="dash-risk">
      <h2 id="dash-risk">Open work by risk</h2>
      <ul className="esh-dash-bars">
        {bars.map((bar) => (
          <li key={bar.key}>
            <span className="esh-dash-bar-label">{bar.label}</span>
            <span className="esh-dash-bar" data-risk={bar.key}>
              <span style={{ width: `${bar.share}%` }} />
            </span>
            <span className="esh-dash-figure">{bar.count}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function AgePanel({ openByAge }: { openByAge: DashboardData['openByAge'] }) {
  const bars = ageBars(openByAge);
  const total = bars.reduce((sum, bar) => sum + bar.count, 0);
  return (
    <section className="esh-dash-panel" aria-labelledby="dash-age">
      <h2 id="dash-age">How long it has been open</h2>
      <ul className="esh-dash-bars">
        {bars.map((bar) => (
          <li key={bar.label} data-exception={bar.exception || undefined}>
            <span className="esh-dash-bar-label">{bar.label}</span>
            <span className="esh-dash-bar" data-kind={bar.exception ? 'old' : 'age'}>
              <span style={{ width: `${total === 0 ? 0 : (bar.count / total) * 100}%` }} />
            </span>
            <span className="esh-dash-figure">{bar.count}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function ClosurePanel({ closure }: { closure: ClosureFacts }) {
  const rate = onTimeRate(closure);
  return (
    <section className="esh-dash-panel" aria-labelledby="dash-closure">
      <h2 id="dash-closure">Closed, and closed on time</h2>
      {closure.closed === 0 ? (
        <p className="esh-dash-lead">Nothing has closed in this period.</p>
      ) : (
        <>
          <p className="esh-dash-big">
            {rate}%<small>closed by the date first promised</small>
          </p>
          {/*
            Against `baseline_due_at`. A deadline extended three times and then
            met is not a finding closed on time, and a dashboard that says so
            flatters exactly the work that went worst.
          */}
          <dl className="esh-dash-facts">
            <div>
              <dt>Closed</dt>
              <dd>{closure.closed}</dd>
            </div>
            <div>
              <dt>On time</dt>
              <dd>{closure.onTime}</dd>
            </div>
            <div>
              <dt>Late</dt>
              <dd>{closure.late}</dd>
            </div>
            <div>
              <dt>Typical time to close</dt>
              <dd>
                {closure.medianDays} day{closure.medianDays === 1 ? '' : 's'}
              </dd>
            </div>
          </dl>
          <p className="form-hint">
            On time means the date the owner was first given, not a date it was later moved to.
          </p>
        </>
      )}
    </section>
  );
}

/**
 * v263 — whether anybody is protected, which closure percentage cannot say.
 *
 * Deliberately the first panel on the page. A backlog that is shrinking while
 * four critical findings have nothing holding them is not a safety programme
 * going well, and the figure that shows it should not be below the fold.
 */
export function ProtectionPanel({ protection }: { protection: ProtectionFacts }) {
  const { significant, unprotected, unverified, unassessed } = protection;
  return (
    <section className="esh-dash-panel" aria-labelledby="dash-protection">
      <h2 id="dash-protection">Protected while it is open</h2>
      {significant === 0 && unassessed === 0 ? (
        <p className="esh-dash-lead">No significant findings are open.</p>
      ) : (
        <>
          <p className="esh-dash-big" data-tone={unprotected > 0 ? 'red' : undefined}>
            {unprotected}
            <small>
              of {significant} significant finding{significant === 1 ? '' : 's'} with nothing
              recorded
            </small>
          </p>
          <dl className="esh-dash-facts">
            <div>
              <dt>Control written, nobody has checked</dt>
              <dd>{unverified}</dd>
            </div>
            <div>
              <dt>Not yet risk assessed</dt>
              <dd>{unassessed}</dd>
            </div>
          </dl>
          <p className="form-hint">
            Significant means High or Critical. A finding counts as protected once somebody has
            checked the interim control, or recorded that none is needed.
          </p>
        </>
      )}
    </section>
  );
}

/**
 * v264 — who is actually slow.
 *
 * Every figure carries what it was drawn from, because a percentage over three
 * closures is not a rate, and a dashboard that prints it as one invites a
 * decision nobody should be making on three events.
 */
export function ResponsivenessPanel({ facts }: { facts: ResponsivenessFacts }) {
  const { firstSubmission, acceptedSubmission, eshReview, afterChanges } = facts;
  const share = (part: number, whole: number) =>
    whole === 0 ? '—' : `${Math.round((part / whole) * 100)}%`;
  const hours = (value: number) =>
    value >= 48 ? `${Math.round(value / 24)} days` : `${Math.round(value)} hours`;

  return (
    <section className="esh-dash-panel" aria-labelledby="dash-responsive">
      <h2 id="dash-responsive">Owners, and us</h2>
      {firstSubmission.counted === 0 && eshReview.counted === 0 ? (
        <p className="esh-dash-lead">Nothing has been submitted or reviewed in this period.</p>
      ) : (
        <>
          <dl className="esh-dash-facts">
            <div>
              <dt>Something in by the deadline</dt>
              <dd>
                {share(firstSubmission.onTime ?? 0, firstSubmission.counted)}
                <small> of {firstSubmission.counted}</small>
              </dd>
            </div>
            <div>
              <dt>What was accepted, by the deadline</dt>
              <dd>
                {share(acceptedSubmission.onTime ?? 0, acceptedSubmission.counted)}
                <small> of {acceptedSubmission.counted}</small>
              </dd>
            </div>
            <div>
              <dt>Our time to review a submission</dt>
              <dd>
                {hours(eshReview.medianHours ?? 0)}
                <small> of {eshReview.counted}</small>
              </dd>
            </div>
            <div>
              <dt>Owner&rsquo;s time to answer a rejection</dt>
              <dd>
                {hours(afterChanges.medianHours ?? 0)}
                <small> of {afterChanges.counted}</small>
              </dd>
            </div>
          </dl>
          {(afterChanges.waiting ?? 0) > 0 && (
            <p className="form-hint">
              {afterChanges.waiting} rejection{afterChanges.waiting === 1 ? ' has' : 's have'} not
              been answered yet, and {afterChanges.waiting === 1 ? 'is' : 'are'} left out of that
              figure rather than counted as quick.
            </p>
          )}
          <p className="form-hint">
            The two deadline figures differ when what arrived first was not what was accepted. The
            gap between them is a review problem or a quality problem, not an owner being late.
          </p>
        </>
      )}
    </section>
  );
}

function monthLabel(month: string): string {
  const [year, rest] = month.split('-');
  const index = Number(rest) - 1;
  const names = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  return `${names[index] ?? month} ${String(year ?? '').slice(2)}`;
}
