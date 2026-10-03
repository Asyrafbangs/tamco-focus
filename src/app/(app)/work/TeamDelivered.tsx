import Link from 'next/link';
import type { ReactNode } from 'react';

import { RowPrimaryLink } from '@/components/ui/ParityPrimitives';
import { DELIVERY_KIND_WORD } from '@/domain/delivery';
import {
  completedDay,
  completedTime,
  dayHeading,
  deliveredByPerson,
  deliveredDays,
  deliveredSummary,
  deliveredTally,
  type DeliveredRecord,
  type DeliveredView,
} from '@/domain/team-delivered';

/**
 * What the team finished, read as a week first and as people second (v234, §20).
 *
 * Grouping by person was the only view, so "what did we actually finish this
 * week?" — the question a manager writes their own weekly update from — had to
 * be answered by reading six lists, each in its own time order, and merging
 * them by eye. Time is now the axis the tab opens on; the person grouping is
 * one link away, because checking one person's output is also a real question.
 *
 * Both views are rendered from one list of records, so they cannot disagree
 * about what closed. That is not hypothetical: the headline figure and the list
 * beneath it were separate reads once, and they drifted.
 */

const NAME_LIST = new Intl.ListFormat('en-GB', { style: 'long', type: 'conjunction' });

export function TeamDelivered({
  period,
  records,
  team,
  failed,
  view,
  person,
  now,
  timeZone,
  phrase,
  hrefFor,
  taskHref,
}: {
  /** The window control, rendered beside the figure it changes. */
  period: ReactNode;
  records: DeliveredRecord[];
  team: Array<{ userId: string; fullName: string }>;
  failed: boolean;
  view: DeliveredView;
  /** The one person being read, or null for everybody. */
  person: string | null;
  now: Date;
  timeZone: string;
  /** "in the last 7 days", from the period control above. */
  phrase: string;
  hrefFor: (next: { view?: DeliveredView; who?: string | null }) => string;
  taskHref: (taskId: string) => string;
}) {
  if (failed) {
    return (
      <div className="notice error" role="alert">
        <strong>Team delivery could not be loaded</strong>
        <p>
          Refresh the page, and tell an administrator if it persists. This is not a statement that
          your team has delivered nothing.
        </p>
      </div>
    );
  }

  const tally = deliveredTally(records, team);
  const shown = person ? records.filter((record) => record.personId === person) : records;

  return (
    <div className="focus-panel team-delivered">
      {/*
        What counts, said once. The three kinds are the reason this tab is not
        a ranking: a routine occurrence closes every week and a Major Project
        once a quarter. The window is not repeated here — the figure below
        names it, and the control above sets it.
      */}
      <p className="focus-tab-meaning">
        What your team closed: owned work, contributions to somebody else&rsquo;s task, and routine
        occurrences.
      </p>
      <div className="team-list-head">
        <p className="team-delivered-summary">{deliveredSummary(shown, phrase)}</p>
        {period}
      </div>

      {/*
        Two readings of one list, named by what they answer rather than by how
        they are sorted. Timeline is first because it is the question the tab
        opens on; By person is the follow-up.
      */}
      <nav className="team-delivered-views" aria-label="Completed view">
        <Link
          href={hrefFor({ view: 'timeline' })}
          aria-current={view === 'timeline' ? 'page' : undefined}
        >
          Timeline
        </Link>
        <Link
          href={hrefFor({ view: 'person' })}
          aria-current={view === 'person' ? 'page' : undefined}
        >
          By person
        </Link>
      </nav>

      {/*
        Who closed what, including who closed nothing. An empty window is as
        often a fact about the window — a fortnight of leave, one long Major
        Project still running — as about the person, and a name quietly missing
        from the list shows neither.
      */}
      <nav className="team-delivered-people" aria-label="Filter by person">
        {tally.map((row) => (
          <Link
            key={row.personId}
            href={hrefFor({ who: person === row.personId ? null : row.personId })}
            aria-current={person === row.personId ? 'page' : undefined}
            data-quiet={row.count === 0 || undefined}
          >
            <span>{row.personName}</span>
            <strong>{row.count === 0 ? 'Nothing closed' : row.count}</strong>
          </Link>
        ))}
      </nav>

      {shown.length === 0 ? (
        <div className="empty-state">
          <h3>Nothing closed in this window</h3>
          <p>
            Try a wider window before reading anything into it — a team working on Major Projects
            can go a month without closing one.
          </p>
        </div>
      ) : view === 'person' ? (
        <PersonView
          records={shown}
          team={team}
          phrase={phrase}
          timeZone={timeZone}
          taskHref={taskHref}
        />
      ) : (
        <Timeline records={shown} now={now} timeZone={timeZone} taskHref={taskHref} />
      )}
    </div>
  );
}

function Timeline({
  records,
  now,
  timeZone,
  taskHref,
}: {
  records: DeliveredRecord[];
  now: Date;
  timeZone: string;
  taskHref: (taskId: string) => string;
}) {
  return (
    <>
      {deliveredDays(records, timeZone).map((day) => (
        <section key={day.day || 'undated'} className="team-delivered-day">
          <h3>{dayHeading(day.day, now, timeZone)}</h3>
          <ul className="team-delivered-list">
            {day.records.map((record) => (
              <Record
                key={`${record.kind}-${record.id}`}
                record={record}
                /* The clock, not the date: the date is the heading above. */
                when={completedTime(record.at, timeZone)}
                taskHref={taskHref}
                withPerson
              />
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}

function PersonView({
  records,
  team,
  phrase,
  timeZone,
  taskHref,
}: {
  records: DeliveredRecord[];
  team: Array<{ userId: string; fullName: string }>;
  phrase: string;
  timeZone: string;
  taskHref: (taskId: string) => string;
}) {
  const groups = deliveredByPerson(records, team);
  const withWork = groups.filter((group) => group.records.length > 0);
  const withNone = groups.filter((group) => group.records.length === 0);

  return (
    <>
      {withWork.map((group) => (
        <section key={group.personId} className="team-delivered-group">
          <header>
            <strong>{group.personName}</strong>
            <span className="muted">{group.records.length} completed</span>
            <Link href={`/work?scope=team&person=${group.personId}`}>Open person</Link>
          </header>
          <ul className="team-delivered-list">
            {group.records.map((record) => (
              <Record
                key={`${record.kind}-${record.id}`}
                record={record}
                /* The day, because this list is not in day order. */
                when={completedDay(record.at, timeZone)}
                taskHref={taskHref}
              />
            ))}
          </ul>
        </section>
      ))}

      {/*
        A footnote, not a card each: giving every empty name its own card makes
        the absence the loudest thing on a page about what was delivered.
      */}
      {withNone.length > 0 && withWork.length > 0 && (
        <p className="team-group-none" data-testid="team-delivered-none">
          Nothing closed {phrase} by {NAME_LIST.format(withNone.map((group) => group.personName))}.
        </p>
      )}
    </>
  );
}

function Record({
  record,
  when,
  taskHref,
  withPerson,
}: {
  record: DeliveredRecord;
  when: string | null;
  taskHref: (taskId: string) => string;
  /** The timeline names who closed it; a person's own list does not repeat it. */
  withPerson?: boolean;
}) {
  return (
    <li className="team-delivered-row">
      {/*
        A tick, because every row here is something that finished. It carries
        no meaning the text does not, so it is hidden from a screen reader
        rather than read out on every row.
      */}
      <span className="team-delivered-tick" aria-hidden="true">
        ✓
      </span>
      {/*
        Columns, so a day of closures reads down the list.

        With the person and the kind stacked under the title, a wide screen gave
        each row a short title on the left and nothing at all on the right —
        sixty-seven of them, and no way to run an eye down "who" or "what kind".
      */}
      <span className="team-delivered-main">
        <RowPrimaryLink href={taskHref(record.taskId)}>{record.title}</RowPrimaryLink>
        {record.parentTitle ? <small>on {record.parentTitle}</small> : null}
      </span>
      <span className="team-delivered-person">{withPerson ? record.personName : ''}</span>
      <span className="team-delivered-kind">{DELIVERY_KIND_WORD[record.kind]}</span>
      <span className="team-delivered-when">{when ?? ''}</span>
    </li>
  );
}
