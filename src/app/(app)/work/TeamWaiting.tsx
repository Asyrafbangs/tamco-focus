import { RowPrimaryLink } from '@/components/ui/ParityPrimitives';
import {
  UPCOMING_DAYS,
  groupWaiting,
  waitingSummary,
  type WaitingEntry,
  type WaitingItem,
} from '@/domain/team-waiting';

/**
 * Work that has not started, ordered by whether it needs a manager (v233, §20).
 *
 * It was every person's backlog under their name: nineteen rows with nothing to
 * say which of them mattered, which is a list to scroll rather than a thing to
 * act on. The exceptions are raised, the rest is quiet, and most of it is quiet
 * — waiting work is not a problem by default, and treating it as one teaches
 * people to ignore the screen.
 *
 * No date filter. This is the state of things now; "what was waiting last
 * month" is not a question anybody asks.
 */
export function TeamWaiting({
  items,
  failed,
  now,
  timeZone,
  hrefFor,
}: {
  items: WaitingItem[];
  failed: boolean;
  now: Date;
  timeZone: string;
  hrefFor: (taskId: string) => string;
}) {
  if (failed) {
    return (
      <div className="notice error" role="alert">
        <strong>Waiting work could not be loaded</strong>
        <p>
          Refresh the page, and tell an administrator if it persists. This is not a statement that
          nobody has anything waiting.
        </p>
      </div>
    );
  }

  const view = groupWaiting(items, now, timeZone);

  return (
    <div className="focus-panel team-waiting">
      <p className="focus-tab-meaning">
        Work that has not started yet. Exceptions first, because most waiting work is properly
        queued and only some of it needs you.
      </p>
      <p className="team-waiting-summary">{waitingSummary(view)}</p>

      {view.total === 0 ? (
        <div className="empty-state">
          <h3>Nothing is waiting</h3>
          <p>Everything your team owns has been started, finished or is not yet theirs.</p>
        </div>
      ) : (
        <>
          <WaitingGroup
            title="Needs attention"
            note="Late, waiting unusually long, or assigned and untouched."
            entries={view.attention}
            hrefFor={hrefFor}
            exception
          />
          <WaitingGroup
            title="Upcoming"
            note={`Due within ${UPCOMING_DAYS} days, but not yet late.`}
            entries={view.upcoming}
            hrefFor={hrefFor}
          />
          {/*
            Folded, because it is the bulk of the list and none of it is a
            question. It stays reachable: a manager looking for one particular
            thing should not have to go somewhere else for it.
          */}
          {view.later.length > 0 && (
            <details className="team-waiting-later">
              <summary>
                Later · {view.later.length} other waiting item
                {view.later.length === 1 ? '' : 's'}
              </summary>
              <WaitingList entries={view.later} hrefFor={hrefFor} />
            </details>
          )}
        </>
      )}
    </div>
  );
}

function WaitingGroup({
  title,
  note,
  entries,
  hrefFor,
  exception,
}: {
  title: string;
  note: string;
  entries: WaitingEntry[];
  hrefFor: (taskId: string) => string;
  exception?: boolean;
}) {
  if (entries.length === 0) return null;
  return (
    <section className="team-waiting-group" data-exception={exception || undefined}>
      <header>
        <h3>{title}</h3>
        <p>{note}</p>
      </header>
      <WaitingList entries={entries} hrefFor={hrefFor} />
    </section>
  );
}

function WaitingList({
  entries,
  hrefFor,
}: {
  entries: WaitingEntry[];
  hrefFor: (taskId: string) => string;
}) {
  return (
    <ul className="team-waiting-list">
      {entries.map((entry) => (
        /*
         * Columns, not a title with everything stacked under it.
         *
         * Stacked, a row on a wide screen was a short title on the left and
         * "Open →" against the far edge with a thousand pixels of nothing
         * between them: the eye had to cross the screen to join a task to its
         * action, and twenty-one of them read as a wall. Whose it is and why it
         * is here now line up down the list, which is what makes a list of
         * twenty-one scannable at all.
         */
        <li
          key={entry.id}
          className="team-waiting-row"
          /*
           * Two levels, not one. Red is for work that is actually late; amber
           * for the rest of what wants a manager — waiting unusually long,
           * assigned and never touched, high attention. Everything in this
           * group used to be red, so eleven rows shouted equally.
           */
          data-severity={
            entry.overdue ? 'overdue' : entry.bucket === 'attention' ? 'watch' : undefined
          }
        >
          <span className="team-waiting-main">
            <RowPrimaryLink href={hrefFor(entry.id)}>{entry.title}</RowPrimaryLink>
          </span>
          <span className="team-waiting-owner">{entry.ownerName}</span>
          <span className="team-waiting-why">{entry.reasons.join(' · ')}</span>
          <span className="team-waiting-open" aria-hidden="true">
            ›
          </span>
        </li>
      ))}
    </ul>
  );
}
