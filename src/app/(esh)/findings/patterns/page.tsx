import Link from 'next/link';

import { requireEshAccess } from '@/server/esh/access';
import { listReviewedConnections, type ReviewedConnection } from '@/server/esh/queries';

/**
 * Patterns, from links somebody reviewed (S4).
 *
 * This page said for two stages that recurring issues would appear "after ESH
 * has reviewed categories and links". The links exist now - v209's duplicate
 * outcome, v267's effectiveness follow-up and v279's related link - and every
 * one of them is a decision a coordinator recorded, so reporting them together
 * infers nothing. Categories do not exist, remain an open decision for ESH and
 * the plant, and nothing here groups by hazard type.
 *
 * What is deliberately absent: any score, any ranking by likelihood, and any
 * cause read off a title, a location or a handful of observations.
 */

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
  const connections = await listReviewedConnections();

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
            Built only from links an ESH coordinator reviewed. Hazard categories are not yet agreed,
            so nothing here is grouped by type.
          </p>
        </div>
      </div>

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
          Patterns by hazard category need the category list confirmed by ESH and plant
          representatives, and historical findings cannot be classified after the fact. There is no
          predictive score and no second place where work is tracked.
        </p>
        <Link className="btn" href="/findings/patterns/insights">
          Open historical insights
        </Link>
      </section>
    </>
  );
}
