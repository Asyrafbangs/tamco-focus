'use client';

import { useRouter } from 'next/navigation';
import type { KeyboardEvent, MouseEvent } from 'react';

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
  filter,
  nowIso,
  periodParams,
}: {
  person: TeamAttentionRow;
  filter: 'everyone' | 'attention';
  nowIso: string;
  /**
   * The period the page is reporting over, carried into the drawer.
   *
   * The row built its own URL and dropped it, so widening to ninety days and
   * then opening somebody silently put the question back to thirty — and the
   * drawer said "Last 30 days" while the strip above it still said 90.
   */
  periodParams?: Record<string, string>;
}) {
  const router = useRouter();
  const personQuery = new URLSearchParams({ scope: 'team', ...periodParams });
  if (filter === 'attention') personQuery.set('filter', 'attention');
  personQuery.set('person', person.userId);
  const personHref = `/work?${personQuery.toString()}`;
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
  const summary =
    [
      person.overdueCount > 0 ? `${person.overdueCount} overdue` : null,
      person.activeCount > 0 ? `${person.activeCount} active` : null,
      person.availableCount > 0 ? `${person.availableCount} waiting` : null,
    ]
      .filter(Boolean)
      .join(' · ') || 'Nothing active';

  function openPerson() {
    router.push(personHref);
  }

  function handleRowKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    openPerson();
  }

  function handleAction(event: MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    if (managerAction) router.push(managerAction.href);
  }

  return (
    <div
      className={styles.row}
      data-testid="my-team-person-row"
      role="button"
      tabIndex={0}
      aria-label={`Open team member detail for ${person.fullName}`}
      onClick={openPerson}
      onKeyDown={handleRowKeyDown}
    >
      <div className={styles.person} data-cell="person">
        <strong>{person.fullName}</strong>
        <span className={person.overdueCount > 0 ? styles.summaryAlert : undefined}>{summary}</span>
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
  );
}
