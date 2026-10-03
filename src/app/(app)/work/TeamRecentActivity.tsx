import Link from 'next/link';
import type { ReactNode } from 'react';

import { RowPrimaryLink } from '@/components/ui/ParityPrimitives';
import {
  ACTIVITY_FILTERS,
  activitySummary,
  cardChanges,
  groupByDay,
  matchesFilter,
  mergeActivity,
  perPerson,
  type ActivityEvent,
  type ActivityFilter,
} from '@/domain/team-activity';

/**
 * What the team actually did, for a weekly review (v232, §20).
 *
 * Not an audit log and not a workload dashboard: a manager-readable history of
 * meaningful work. Every raw event stays in the audit trail; this merges one
 * person's events on one task on one day into a single card, and says what
 * changed rather than that something changed.
 *
 * Nothing about overdue work, capacity or attention appears here. Those are
 * real questions with their own screens, and letting them in is how this
 * becomes a second dashboard instead of an answer to "what happened?".
 */
export function TeamRecentActivity({
  period,
  events,
  team,
  failed,
  timeZone,
  phrase,
  filter,
  person,
  hrefFor,
}: {
  /** The window control, rendered beside the figure it changes. */
  period: ReactNode;
  events: ActivityEvent[];
  team: Array<{ userId: string; fullName: string }>;
  failed: boolean;
  timeZone: string;
  phrase: string;
  filter: ActivityFilter;
  person: string | null;
  hrefFor: (next: { who?: string | null; kind?: ActivityFilter; task?: string }) => string;
}) {
  if (failed) {
    return (
      <div className="notice error" role="alert">
        <strong>Recent activity could not be loaded</strong>
        <p>
          Refresh the page, and tell an administrator if it persists. This is not a statement that
          your team has done nothing.
        </p>
      </div>
    );
  }

  const all = mergeActivity(events, timeZone);
  const counts = perPerson(all, team);
  const shown = all
    .filter((card) => (person ? card.personId === person : true))
    .filter((card) => matchesFilter(card, filter));
  const days = groupByDay(shown, timeZone);

  const dayName = new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
    timeZone,
  });
  const clock = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone });
  const today = new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date());

  return (
    <div className="focus-panel team-activity">
      {/* One understated line, not a row of dashboard cards. */}
      <div className="team-list-head">
        <p className="focus-tab-meaning">{activitySummary(shown, phrase)}</p>
        {period}
      </div>

      {/*
        v248 — one line of controls, not two strips of chips stacked.

        Six kinds over five people filled the top of the screen with filters
        before any of the activity they filter, which is the wrong way round on
        a tab whose whole job is to be read quickly. One line, and a person who
        did nothing says so with a dash rather than the words "No updates",
        which were longer than most of the names.
      */}
      <div className="team-activity-controls">
        <nav className="team-activity-filters" aria-label="Activity kind">
          {ACTIVITY_FILTERS.map((option) => (
            <Link
              key={option.key}
              href={hrefFor({ kind: option.key })}
              aria-current={option.key === filter ? 'page' : undefined}
            >
              {option.label}
            </Link>
          ))}
        </nav>

        {/*
          Everybody, including the people with nothing: a name quietly missing
          from a list is not noticeable, and absence is the thing most worth
          noticing — stated neutrally, because a fortnight on one hard task is
          honest work that generates no events.
        */}
        <nav className="team-activity-people" aria-label="Filter by person">
          {counts.map((row) => (
            <Link
              key={row.personId}
              href={hrefFor({ who: person === row.personId ? null : row.personId })}
              aria-current={person === row.personId ? 'page' : undefined}
              data-quiet={row.count === 0 || undefined}
            >
              <span>{row.personName}</span>
              <strong>{row.count === 0 ? '—' : row.count}</strong>
            </Link>
          ))}
        </nav>
      </div>

      {days.length === 0 ? (
        <div className="empty-state">
          <h3>Nothing recorded in this window</h3>
          <p>
            Try a wider range before reading anything into it — a team deep in one Major Project can
            go a week without an event worth reporting.
          </p>
        </div>
      ) : (
        days.map((day) => (
          <section key={day.day} className="team-activity-day">
            <h3>
              {day.day === today ? 'Today' : dayName.format(new Date(`${day.day}T12:00:00Z`))}
            </h3>
            <ul className="team-activity-list">
              {day.cards.map((card) => {
                const changes = cardChanges(card);
                return (
                  /*
                   * v248 — a row, with the same anatomy as Waiting and
                   * Completed: what happened, whose it is, and when.
                   *
                   * As a card it was three or four lines each, so a fortnight
                   * of a team's work was a page of scrolling. The question
                   * this tab answers — what moved this week — should be
                   * answerable in the time it takes to run an eye down a
                   * list, and the changes are the part worth reading, so they
                   * sit beside the title rather than under it.
                   */
                  <li
                    key={card.key}
                    className="team-activity-row"
                    data-done={card.completed || undefined}
                  >
                    <span className="team-activity-main">
                      <RowPrimaryLink href={hrefFor({ task: card.taskId })}>
                        {card.taskTitle}
                      </RowPrimaryLink>
                      {card.note ? <small>{card.note}</small> : null}
                      {card.findings.map((finding) => (
                        <small key={finding} className="team-activity-finding">
                          {finding}
                        </small>
                      ))}
                    </span>
                    <span className="team-activity-changes">
                      {changes.map((change) => (
                        <span key={change}>{change}</span>
                      ))}
                    </span>
                    <span className="team-activity-person">{card.personName}</span>
                    <span className="team-activity-time">{clock.format(new Date(card.at))}</span>
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
