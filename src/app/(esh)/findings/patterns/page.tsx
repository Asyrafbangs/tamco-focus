import Link from 'next/link';

import { requireEshAccess } from '@/server/esh/access';
import {
  getHazardDistribution,
  listReviewedConnections,
  type HazardDistributionRow,
  type ReviewedConnection,
} from '@/server/esh/queries';

/**
 * Patterns, from links somebody reviewed (S4).
 *
 * This page said for two stages that recurring issues would appear "after ESH
 * has reviewed categories and links". The links exist now - v209's duplicate
 * outcome, v267's effectiveness follow-up and v279's related link - and every
 * one of them is a decision a coordinator recorded, so reporting them together
 * infers nothing.
 *
 * v287 adds the hazard distribution, which is the other half of the same rule:
 * every category on it was assigned by a coordinator during review, nothing is
 * inferred from a title or a location, and the findings nobody has classified
 * are counted rather than left out.
 *
 * What is deliberately absent: any score, any ranking by likelihood, and any
 * cause read off a title, a location or a handful of observations.
 */

/**
 * The distribution (v287, §4).
 *
 * Counts, not a chart: a table of nine rows is read faster than a chart of
 * nine rows, works at phone width, and cannot imply a trend from three
 * findings. Every active category is a row even at zero, because a category
 * nobody has used is itself worth seeing.
 */
function HazardTable({
  rows,
  uncategorised,
  failed,
}: {
  rows: HazardDistributionRow[];
  uncategorised: number;
  failed: boolean;
}) {
  const classified = rows.reduce((total, row) => total + row.findings, 0);
  return (
    <section className="esh-form-card" aria-labelledby="pattern-categories">
      <div className="esh-section-head">
        <h2 id="pattern-categories">By hazard category</h2>
        <p>
          What kind of hazard the findings you cover turned out to be, as ESH classified them during
          review.
        </p>
      </div>
      {failed ? (
        <p className="notice warn" role="status">
          The distribution could not be read. Try again.
        </p>
      ) : classified === 0 ? (
        <p className="form-hint">
          No finding has been classified yet. The category is set on a finding&rsquo;s own page.
        </p>
      ) : (
        <div
          className="table-scroll"
          role="region"
          aria-label="Findings by hazard category"
          tabIndex={0}
        >
          <table className="esh-overview-table esh-hazard-table">
            <thead>
              <tr>
                <th scope="col">Category</th>
                <th scope="col">Findings</th>
                <th scope="col">Open</th>
                <th scope="col">Significant</th>
                <th scope="col">Recurring</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.code}>
                  <th scope="row">{row.label}</th>
                  <td>{row.findings}</td>
                  <td>{row.openFindings}</td>
                  <td>{row.significantFindings}</td>
                  <td>{row.recurringFindings}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {uncategorised > 0 && (
        <p className="form-hint">
          {uncategorised} open {uncategorised === 1 ? 'finding is' : 'findings are'} not categorised
          yet, so {uncategorised === 1 ? 'it is' : 'they are'} in none of the rows above.
        </p>
      )}
    </section>
  );
}

/** One direction of each pair, so a symmetric link is listed once. */
function onePerPair(connections: ReviewedConnection[], kind: ReviewedConnection['kind']) {
  const seen = new Set<string>();
  return connections.filter((connection) => {
    if (connection.kind !== kind) return false;
    const key = [connection.finding.id, connection.other.id].sort().join(':');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function Group({
  title,
  explanation,
  rows,
  lead,
  follow,
}: {
  title: string;
  explanation: string;
  rows: ReviewedConnection[];
  lead: string;
  follow: string;
}) {
  return (
    <section className="esh-form-card" aria-labelledby={`pattern-${lead}`}>
      <div className="esh-section-head">
        <h2 id={`pattern-${lead}`}>{title}</h2>
        <p>{explanation}</p>
      </div>
      {rows.length === 0 ? (
        <p className="form-hint">None recorded.</p>
      ) : (
        <ul className="esh-link-list">
          {rows.map((row) => (
            <li key={`${row.finding.id}:${row.other.id}`}>
              <div className="esh-link-row">
                <Link href={`/findings/${row.finding.id}`}>
                  {row.finding.reference} - {row.finding.title}
                </Link>
              </div>
              <p className="esh-link-note">
                {follow} <Link href={`/findings/${row.other.id}`}>{row.other.reference}</Link>
                {row.note ? ` - ${row.note}` : ''}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default async function PatternsPage() {
  await requireEshAccess();
  // Read together: two independent reads behind one page should not be two
  // round trips in sequence.
  const [connections, distribution] = await Promise.all([
    listReviewedConnections(),
    getHazardDistribution(),
  ]);

  const cameBack = connections.filter((connection) => connection.kind === 'recurred_as');
  const reportedAgain = connections.filter((connection) => connection.kind === 'reported_again_as');
  const related = onePerPair(connections, 'related');

  return (
    <>
      <div className="pagehead">
        <div>
          <p className="eyebrow">Finding Management</p>
          <h1>Patterns</h1>
          <p>
            Built only from what an ESH coordinator recorded: the hazard categories they assigned
            during review, and the links they made between findings.
          </p>
        </div>
      </div>

      <HazardTable
        rows={distribution.rows}
        uncategorised={distribution.uncategorised}
        failed={distribution.failed}
      />

      <Group
        title="Came back after a correction"
        explanation="The fix was accepted, an effectiveness check later found it had not held, and a new finding was raised. The original stays closed, because its closure was true when it was made."
        rows={cameBack}
        lead="recurred"
        follow="Raised again as"
      />

      <Group
        title="Reported more than once"
        explanation="Recorded again by somebody who did not know it was already open, and closed as a duplicate of the one that was kept."
        rows={reportedAgain}
        lead="duplicate"
        follow="Reported again as"
      />

      <Group
        title="Related by a coordinator"
        explanation="Connected deliberately because they inform each other, with neither replacing the other."
        rows={related}
        lead="related"
        follow="Related to"
      />

      <section className="esh-form-card esh-pattern-empty" aria-labelledby="patterns-held-title">
        <h2 id="patterns-held-title">What is not here</h2>
        <p>
          Historical findings are not classified after the fact, so the distribution above covers
          what ESH has reviewed since categories existed and says how many open findings are still
          uncategorised. There is no predictive score, no ranking by likelihood, and no second place
          where work is tracked.
        </p>
        <Link className="btn" href="/findings/patterns/insights">
          Open historical insights
        </Link>
      </section>
    </>
  );
}
