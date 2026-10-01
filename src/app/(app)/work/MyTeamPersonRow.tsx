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

/**
 * Three columns, in the order a manager reads them (v235, §20).
 *
 * The row carried eight figures across five columns — overdue, due soon,
 * active, shared steps, overdue shared steps, current work, agreed priorities
 * and the latest update — so every person had to be decoded rather than read.
 * Worse, two of the columns were mostly absence: "No agreed priorities" and
 * "No action needed from you" repeated down the table were the loudest text on
 * the page, and both said nothing.
 *
 * Now: who they are and how much they are carrying; what they are on; and what
 * needs you, with when they were last heard from. Exceptions are in one place
 * instead of split between the first column and the fourth.
 */
export function MyTeamListHeader() {
  return (
    <div className={styles.listHeader} aria-hidden="true">
      <span>Person</span>
      {/* What the person said they are on, not what the data suggests. It was
          the most recently touched Active task until v140 §8 — a column that
          could never be empty, never be wrong, and never quite meant anything.
          It is now their own selection, and "Not set" is a real answer. */}
      <span>Currently working on</span>
      {/* One column, because they are one question: is this person in trouble,
          and when did they last say anything. Split across two, a manager read
          the exceptions in the middle of the row and the silence at the end. */}
      <span>Needs attention · Latest</span>
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
   * How much this person is carrying. Volume only — the exceptions moved to
   * the attention column, where the manager is already looking for them.
   *
   * Zeroes are left out entirely: a column of "0 overdue" is a column of
   * nothing happening, said loudly. Waiting work is included because load is
   * what is carried plus what is queued, and the queued half used to be
   * readable only in a view that replaces this table.
   */
  const volume = [
    person.activeCount > 0 ? `${person.activeCount} active` : null,
    // v157 — what they owe on other people's work, which their own list cannot
    // show because the work is somebody else's.
    person.sharedStepCount > 0
      ? `${person.sharedStepCount} shared ${person.sharedStepCount === 1 ? 'step' : 'steps'}`
      : null,
    person.availableCount > 0 ? `${person.availableCount} waiting` : null,
  ].filter((part): part is string => part !== null);

  /*
   * The figures that decide whether this row needs reading, in one place.
   *
   * They used to lead the person's summary line, where they sat beside volume
   * figures of the same shape and weight — so "15 overdue" and "3 active" read
   * as two facts of equal standing rather than a problem and a workload.
   */
  const exceptions = [
    person.overdueCount > 0
      ? { text: `⚠ ${person.overdueCount} overdue`, tone: 'alert' as const, testId: undefined }
      : null,
    // v189 — and what is about to be: the manager can step in before it is late.
    person.dueSoonCount > 0
      ? {
          text: `! ${person.dueSoonCount} due within ${attentionWindowDays} day${attentionWindowDays === 1 ? '' : 's'}`,
          tone: 'soon' as const,
          testId: undefined,
        }
      : null,
    // v157 — a late step is late for somebody else's work, so it is said on its
    // own line rather than folded into a count of this person's own work.
    person.sharedStepOverdueCount > 0
      ? {
          text: `⚠ ${person.sharedStepOverdueCount} assigned ${person.sharedStepOverdueCount === 1 ? 'step' : 'steps'} overdue`,
          tone: 'alert' as const,
          testId: 'assigned-step-overdue',
        }
      : null,
  ].filter((part): part is NonNullable<typeof part> => part !== null);

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
          <span>{volume.length === 0 ? 'Nothing active' : volume.join(' · ')}</span>
        </div>

        <div className={styles.working} data-cell="working-on">
          {person.workingOn ? (
            <>
              <strong>{person.workingOn.title}</strong>
              {/*
                When it was said, not how long ago something was touched.
                §8: this communicates a main focus, not presence — so a
                selection made on Tuesday says Tuesday rather than implying
                somebody is at it right now.
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

          {/*
            The agreed result, only when there is one.

            It had a column of its own, which meant most rows carried "No
            agreed priorities" — the same absence restated on every line, in a
            column a manager cannot act on. Said here it is a fact about what
            this person is working towards, beside what they are working on.
          */}
          {person.nextAgreedResult && (
            <span className={styles.agreed} data-cell="next-result">
              <em>Agreed:</em> {person.nextAgreedResult.expectedResult}
              {person.nextAgreedResult.outcome === 'missed' && (
                <span className={styles.summaryAlert}> · Missed</span>
              )}
            </span>
          )}
        </div>

        <div className={styles.attention} data-cell="needs-you">
          {/*
            What is wrong and when they last spoke, on one line.

            They are the two halves of the same glance — is this person in
            trouble, and have they said anything about it — and stacked they
            cost the cell a line it has not got: `team-context-v48` caps the
            row, and this cell can already carry a flag, a button and a reason.
          */}
          <span className={styles.state}>
            {exceptions.length > 0 && (
              <span className={styles.exceptions}>
                {exceptions.map((part) => (
                  <span
                    key={part.text}
                    className={part.tone === 'soon' ? styles.summarySoon : styles.summaryAlert}
                    data-testid={part.testId}
                  >
                    {part.text}
                  </span>
                ))}
              </span>
            )}
            <span className={styles.latest} data-cell="latest">
              {person.latestUpdate
                ? `Updated ${agoWords(person.latestUpdate.at, now)}`
                : 'No recent activity'}
              {/*
                Said for a screen reader only. Sighted readers take the absence
                of a flag as the answer, which is why "No action needed from
                you" was removed from every healthy row; a screen reader has no
                absence to take, so it is given the words.
              */}
              {!person.attention && (
                <span className="visually-hidden"> Nothing needed from you</span>
              )}
            </span>
          </span>

          {person.attention && (
            <>
              {/*
                The state and the response on one line.

                The button used to sit under the reason, which cost the cell a
                third line. On a narrower screen the row already folds into two
                bands, so that line pushed the row past the height the layout
                test allows — and it separated "a decision is owed" from the
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
              <span className={styles.reason} data-cell="attention-reason">
                {person.attention.reason}
              </span>
            </>
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
