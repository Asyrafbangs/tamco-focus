import Link from 'next/link';

import type { TeamAttentionRow, TeamMemberDetail } from '@/server/queries';

import { teamStatCells } from './team-stats';

/**
 * Two or three people, read across rather than down (v324).
 *
 * Compare used to open a second full panel beside the first, which is not a
 * comparison — it is two registers, and the manager does the comparing from
 * memory while scrolling between them. The figures are the comparison, so they
 * are laid out as one: the same six measures, in the same order, on the same
 * rows, with the names across the top.
 *
 * Nothing here marks a winner. "More overdue" is worse and "more done" is
 * better and "more active" is neither, so a rule that highlighted the larger
 * figure would be stating three different things with one mark. The only
 * colour is the colour the rest of the product already uses for late work and
 * for work due inside the window, and only where the count is not zero.
 *
 * The full detail is one press away per person rather than rendered
 * underneath: a comparison that ends in two thousand pixels of task list is
 * the thing this replaced.
 */
export function MyTeamComparison({
  people,
  windowDays,
  openHref,
  stopHref,
}: {
  people: { person: TeamAttentionRow; detail: TeamMemberDetail }[];
  /** v189 — the organisation's attention window, in days. */
  windowDays: number;
  /** This page with one person open and the comparison dropped. */
  openHref: (personId: string) => string;
  /** This page with the comparison dropped entirely. */
  stopHref: string;
}) {
  const columns = people.map(({ person, detail }) => ({
    person,
    cells: teamStatCells(detail, person, windowDays),
    /*
     * §6 — a decision, not a status. An `exception` is something true about
     * the work; what belongs in a row headed "Needs you" is what the manager
     * is actually being asked to answer.
     */
    decision: detail.attention.find((item) => item?.kind === 'action_required') ?? null,
  }));
  const measures = columns[0]?.cells ?? [];

  return (
    <section className="team-compare" aria-label="Comparing team members">
      <header className="team-compare-head">
        <h3>Comparing {people.length} people</h3>
        <Link href={stopHref} scroll={false} className="btn small">
          Stop comparing
        </Link>
      </header>

      <table className="team-compare-table">
        <thead>
          <tr>
            <th scope="col">
              <span className="visually-hidden">Measure</span>
            </th>
            {columns.map(({ person }) => (
              <th key={person.userId} scope="col">
                {person.fullName}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {measures.map((measure, index) => (
            <tr key={measure.key}>
              <th scope="row">{measure.label}</th>
              {columns.map(({ person, cells }) => {
                const cell = cells[index]!;
                return (
                  <td key={person.userId} data-tone={cell.tone ?? undefined}>
                    {cell.value}
                  </td>
                );
              })}
            </tr>
          ))}
          <tr className="team-compare-decision">
            <th scope="row">Needs you</th>
            {columns.map(({ person, decision }) => (
              <td key={person.userId}>
                {decision ? (
                  <>
                    <strong>{decision.headline}</strong>
                    <Link href={decision.href} scroll={false} className="btn small primary">
                      {decision.requiredAction}
                    </Link>
                  </>
                ) : (
                  /* Factual: nothing has been addressed to the manager. It is
                     not a statement that the person is doing well. */
                  <span className="muted">Nothing</span>
                )}
              </td>
            ))}
          </tr>
          <tr className="team-compare-open">
            <th scope="row">
              <span className="visually-hidden">Full detail</span>
            </th>
            {columns.map(({ person }) => (
              <td key={person.userId}>
                <Link href={openHref(person.userId)} scroll={false}>
                  Open {person.fullName.split(' ')[0]}
                </Link>
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </section>
  );
}
