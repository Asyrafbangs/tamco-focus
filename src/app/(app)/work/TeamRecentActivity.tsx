import Link from 'next/link';

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
  events,
  team,
  failed,
  timeZone,
  phrase,
  filter,
  person,
  hrefFor,
}: {
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
      <p className="focus-tab-meaning">{activitySummary(shown, phrase)}</p>

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
        Who contributed, including who did not. A name quietly missing from a
        list is not noticeable, and absence is the thing most worth noticing —
        stated neutrally, because a fortnight on one hard task is honest work
        that generates no events.
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
            <strong>{row.count === 0 ? 'No updates' : row.count}</strong>
          </Link>
        ))}
      </nav>

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
                  <li
                    key={card.key}
                    className="team-activity-card"
                    data-done={card.completed || undefined}
                  >
                    <p className="team-activity-head">
                      <strong>{card.personName}</strong>
                      <span className="team-activity-time">{clock.format(new Date(card.at))}</span>
                    </p>
                    <p className="team-activity-task">
                      <RowPrimaryLink href={hrefFor({ task: card.taskId })}>
                        {card.taskTitle}
                      </RowPrimaryLink>
                    </p>
                    {changes.length > 0 && (
                      <p className="team-activity-changes">
                        {changes.map((change) => (
                          <span key={change}>{change}</span>
                        ))}
                      </p>
                    )}
                    {card.note && <p className="team-activity-note">{card.note}</p>}
                    {card.findings.map((finding) => (
                      <p key={finding} className="team-activity-finding">
                        {finding}
                      </p>
                    ))}
                    <p className="team-activity-foot">
                      {card.relationship === 'contribution'
                        ? `Contribution${card.parentTitle ? ` to ${card.parentTitle}` : ''}`
                        : card.relationship === 'routine'
                          ? 'Routine'
                          : 'Owned'}
                    </p>
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
