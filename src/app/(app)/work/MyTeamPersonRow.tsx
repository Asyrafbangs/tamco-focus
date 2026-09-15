'use client';

import { useRouter } from 'next/navigation';
import type { MouseEvent, ReactNode } from 'react';

import { resolveAttentionAction } from '@/domain/attention';
import type { TeamAttentionRow } from '@/server/queries';

import styles from './MyTeamPersonRow.module.css';

function agoWords(iso: string, now: Date): string {
  const minutes = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

export function MyTeamListHeader() {
  return (
    <div className={styles.listHeader} aria-hidden="true">
      <span>Person</span>
      {/* What the person said they are on, not what the data suggests. It was
          the most recently touched Active task until v140 §8 — a column that
          could never be empty, never be wrong, and never quite meant anything.
          It is now their own selection, and "Not set" is a real answer. */}
      <span>Current focus</span>
      {/* What they agreed to finish, which is a different question from what
          they are on right now — §8 keeps the two independent. */}
      <span>Next agreed result</span>
      <span>Needs you</span>
      {/* "Latest" alone could mean the latest task, the latest change or the
          latest message. */}
      <span>Latest update</span>
      {/* The chevron's column. It needs no heading, and "Action" over a column
          of Open buttons described the buttons rather than the work. */}
      <span />
    </div>
  );
}

export function MyTeamPersonRow({
  person,
  nowIso,
  attentionWindowDays = 5,
  expanded,
  toggleHref,
  panelId,
  children,
}: {
  person: TeamAttentionRow;
  nowIso: string;
  /** v189 — the organisation's attention window, in days. */
  attentionWindowDays?: number;
  /** Whether this person's detail is open underneath (§6). */
  expanded: boolean;
  /**
   * Where clicking the header goes: the same URL with this person expanded, or
   * with them dropped. The page builds it because it is the page that knows
   * the period, the filter and who else is being kept open.
   */
  toggleHref: string;
  panelId: string;
  /** The expansion itself, rendered by the server and slotted in below. */
  children?: ReactNode;
}) {
  const router = useRouter();
  const action = person.attention
    ? resolveAttentionAction(person.attention, { teamAttention: true })
    : null;
  /*
   * A button only where the manager is being asked to do something.
   *
   * Every row used to end in one: Open, Open task, Open routine — three labels
   * for the one interaction the whole row already performs, sized and placed
   * like the most important thing in the row. Work that is merely overdue is
   * the person's to catch up on; the manager reads it and moves on. What
   * survives is the case where they owe a decision, and there the button says
   * which decision.
   */
  const managerAction = person.attention?.kind === 'action_required' ? action : null;
  const now = new Date(nowIso);

  /*
   * The exception before the volume.
   *
   * "4 active · 2 routines overdue" reads the wrong way round: the number that
   * decides whether this person needs reading is second, behind a number that
   * is the same shape on every row. Zeroes are left out entirely — a column of
   * "0 overdue" is a column of nothing happening, said loudly.
   *
   * Waiting work comes last and is the reason this line has three figures
   * rather than two. Load is what is carried plus what is queued, and the
   * queued half was readable only in a view that replaces this table — so
   * "who may be overloaded" could not be answered while looking at the people.
   * A person with nothing active but nine waiting now says so here, where the
   * line used to read "Nothing active" and mean the opposite of what it said.
   */
  const summary = [
    // Only this part is ever red: it is the figure that decides whether the row
    // needs reading, and a whole red line would shout down the step warning.
    person.overdueCount > 0
      ? { text: `⚠ ${person.overdueCount} overdue`, alert: true as const }
      : null,
    // v189 — and what is about to be: the manager can step in before it is late.
    person.dueSoonCount > 0
      ? {
          text: `! ${person.dueSoonCount} due within ${attentionWindowDays} day${attentionWindowDays === 1 ? '' : 's'}`,
          alert: 'soon' as const,
        }
      : null,
    person.activeCount > 0 ? { text: `${person.activeCount} active`, alert: false } : null,
    // v157 - what they owe on other people's work, which their own list
    // cannot show because the work is somebody else's.
    person.sharedStepCount > 0
      ? {
          text: `${person.sharedStepCount} shared ${person.sharedStepCount === 1 ? 'step' : 'steps'}`,
          alert: false,
        }
      : null,
    person.availableCount > 0 ? { text: `${person.availableCount} waiting`, alert: false } : null,
  ].filter((part): part is { text: string; alert: boolean | 'soon' } => part !== null);

  /*
   * §6 A01 — name, whitespace and chevron all do the same thing, because they
   * are all the same control: the header is the accordion button, and the
   * chevron inside it is decoration rather than a second target.
   *
   * `scroll: false` because this is an expansion, not a navigation. Without it
   * opening the fourth person in the list sends the page back to the top, and
   * the manager has to find them again to read what they just opened.
   */
  function togglePerson() {
    router.push(toggleHref, { scroll: false });
  }

  /*
   * The whole row still opens the person for a pointer, but it is no longer
   * announced as one button (v181). As a `role="button"` with a label, a screen
   * reader heard "Expand team member detail for Amer" and nothing else — what
   * they are working on, their agreed priorities and their latest update were
   * hidden inside the label — and the manager's decision button sat inside
   * another button, where it could not be reached as itself. The accordion
   * control is now the name, a real button; the rest of the row is read as
   * text; a click on the row's blank space is a pointer convenience only.
   */
  function handleRowClick(event: MouseEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest('button, a, input, select, textarea, summary')) {
      return;
    }
    togglePerson();
  }

  function handleAction(event: MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    if (managerAction) router.push(managerAction.href);
  }

  return (
    <div className={styles.block} data-expanded={expanded ? 'true' : undefined}>
      <div className={styles.row} data-testid="my-team-person-row" onClick={handleRowClick}>
        <div className={styles.person} data-cell="person">
          <button
            type="button"
            className={styles.toggle}
            aria-expanded={expanded}
            aria-controls={panelId}
            aria-label={`${expanded ? 'Collapse' : 'Expand'} team member detail for ${person.fullName}`}
            onClick={togglePerson}
          >
            <strong>{person.fullName}</strong>
          </button>
          <span>
            {summary.length === 0
              ? 'Nothing active'
              : summary.flatMap((part, index) => [
                  index > 0 ? ' · ' : '',
                  part.alert ? (
                    <span
                      key={part.text}
                      className={part.alert === 'soon' ? styles.summarySoon : styles.summaryAlert}
                    >
                      {part.text}
                    </span>
                  ) : (
                    part.text
                  ),
                ])}
          </span>
          {/* v157 - a late step is late for somebody else's work, so it is said
              on its own line rather than folded into the count above. */}
          {person.sharedStepOverdueCount > 0 && (
            <span className={styles.summaryAlert} data-testid="assigned-step-overdue">
              ⚠ {person.sharedStepOverdueCount} assigned{' '}
              {person.sharedStepOverdueCount === 1 ? 'step' : 'steps'} overdue
            </span>
          )}
        </div>

        <div className={styles.working} data-cell="working-on">
          {person.workingOn ? (
            <>
              <strong>{person.workingOn.title}</strong>
              {/*
              When it was said, not how long ago something was touched.
              §8: this communicates a main focus, not presence — so a selection
              made on Tuesday says Tuesday rather than implying somebody is at
              it right now.
            */}
              <span>
                Set {agoWords(person.workingOn.confirmedAt, now)}
                {person.otherActiveCount > 0 ? ` · +${person.otherActiveCount} other active` : ''}
              </span>
            </>
          ) : (
            /*
            "Not set" is a real answer, and a different one from "nothing
            active". The column used to name the most recently touched Active
            task, so it could never be empty and never be wrong — and never
            quite meant anything either.
          */
            <span className={styles.muted}>
              Not set
              {person.activeCount > 0 ? ` · ${person.activeCount} active` : ''}
            </span>
          )}
        </div>

        <div className={styles.nextResult} data-cell="next-result">
          {person.nextAgreedResult ? (
            <>
              <strong>{person.nextAgreedResult.expectedResult}</strong>
              {person.nextAgreedResult.outcome === 'missed' && (
                <span className={styles.summaryAlert}>Missed</span>
              )}
            </>
          ) : (
            // Not "nothing to do": nothing has been AGREED. Saying it this way
            // keeps a proposal from reading as a commitment.
            <span className={styles.muted}>No agreed priorities</span>
          )}
        </div>

        <div className={styles.attention} data-cell="needs-you">
          {person.attention ? (
            <>
              {/*
              The state and the response on one line.

              The button used to sit under the reason, which cost the cell a
              third line. On a narrower screen the row already folds into two
              bands, so that line pushed the row past the height the layout
              test allows - and it separated "a decision is owed" from the
              control that gives it by the width of the reason text.
            */}
              <span className={styles.attentionHead}>
                <span
                  className={styles.flag}
                  data-tone={
                    person.attention.kind === 'exception'
                      ? 'neutral'
                      : person.attention.severity === 'critical'
                        ? 'critical'
                        : 'attention'
                  }
                >
                  {/* Small, and only present on an exception. The words alone
                    were easy to miss because a row with a problem was
                    otherwise identical to a row without one. */}
                  <span className={styles.dot} aria-hidden="true" />
                  {person.attention.headline}
                </span>
                {/*
                Not in a column of its own at the end of the row: that gave a
                variable width to a column the header could not match, so the
                table lost its alignment on exactly the rows a manager most
                needs to read.
              */}
                {managerAction ? (
                  <button
                    type="button"
                    className="btn small primary"
                    onClick={handleAction}
                    aria-label={`${managerAction.label} for ${person.fullName}: ${person.attention.reason}`}
                  >
                    {managerAction.label}
                  </button>
                ) : null}
              </span>
              <span className={styles.reason}>{person.attention.reason}</span>
            </>
          ) : (
            /*
            A dash, not a sentence. "No action needed from you" repeated down
            every healthy row was the loudest text in the table, and it said
            the same thing each time: nothing.
          */
            <span className={styles.none}>
              <span aria-hidden="true">{'—'}</span>
              <span className="visually-hidden">Nothing needed from you</span>
            </span>
          )}
        </div>

        <div className={styles.latest} data-cell="latest">
          {person.latestUpdate ? (
            <>
              <strong>{agoWords(person.latestUpdate.at, now)}</strong>
              <span>{person.latestUpdate.summary}</span>
            </>
          ) : (
            <span className={styles.muted}>No recent activity</span>
          )}
        </div>

        <div className={styles.action} data-cell="action">
          <span className={styles.chevron} aria-hidden="true">
            ›
          </span>
        </div>
      </div>

      {children}
    </div>
  );
}
