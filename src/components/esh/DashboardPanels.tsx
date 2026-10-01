import {
  ageBars,
  backlogTrend,
  onTimeRate,
  riskBars,
  type ClosureFacts,
  type DashboardData,
  type MonthPoint,
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
