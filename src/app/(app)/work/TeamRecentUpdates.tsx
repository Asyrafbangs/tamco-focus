import { RowPrimaryLink } from '@/components/ui/ParityPrimitives';
import {
  UPDATE_KIND_WORDS,
  groupByDay,
  updateDetail,
  updatesSummary,
  type TeamUpdate,
} from '@/domain/team-updates';

/**
 * What the team has done lately, in one list (v231, §20).
 *
 * A manager had to open each person and then each task to find out what moved.
 * This is the same information the other way round: newest first, across
 * everybody, grouped under the day it happened, with every row opening the
 * task it is about.
 *
 * Not grouped by person. The question this answers is "what changed", and a
 * list grouped by name is a tour of people again — which is the thing it is
 * meant to replace.
 */
export function TeamRecentUpdates({
  updates,
  failed,
  phrase,
  timeZone,
  period,
}: {
  updates: TeamUpdate[];
  failed: boolean;
  phrase: string;
  timeZone: string;
  /** Carried on each row's link, so closing the task comes back here. */
  period: Record<string, string>;
}) {
  if (failed) {
    return (
      <div className="notice error" role="alert">
        <strong>Recent updates could not be loaded</strong>
        <p>
          Refresh the page, and tell an administrator if it persists. This is not a statement that
          your team has done nothing.
        </p>
      </div>
    );
  }

  const days = groupByDay(updates, timeZone);
  const dayName = new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
    timeZone,
  });
  const clock = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  });

  return (
    <div className="focus-panel team-updates-panel">
      <p className="focus-tab-meaning">{updatesSummary(updates, phrase)}</p>

      {days.length === 0 ? (
        <div className="empty-state">
          <h3>Nothing recorded in this window</h3>
          <p>
            Try a wider range before reading anything into it — a team deep in one Major Project can
            go a fortnight without closing anything.
          </p>
        </div>
      ) : (
        days.map((day) => (
          <section key={day.day} className="team-updates-day">
            <h3>{dayName.format(new Date(`${day.day}T12:00:00Z`))}</h3>
            <ul className="team-updates-list">
              {day.updates.map((update) => {
                const detail = updateDetail(update);
                return (
                  <li key={update.id} className="team-updates-row" data-kind={update.kind}>
                    <span className="team-updates-time">{clock.format(new Date(update.at))}</span>
                    <span className="team-updates-main">
                      <span className="team-updates-what">
                        <strong>{update.personName}</strong> {UPDATE_KIND_WORDS[update.kind]}{' '}
                        {/*
                          The whole row is the link, so the task title is the
                          thing that reads as pressable rather than a separate
                          "Open" nobody needs.
                        */}
                        <RowPrimaryLink
                          href={`/work?scope=team&filter=updates&${new URLSearchParams(period).toString()}&task=${update.taskId}`}
                        >
                          {update.taskTitle}
                        </RowPrimaryLink>
                      </span>
                      {detail && <span className="team-updates-detail">{detail}</span>}
                    </span>
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
