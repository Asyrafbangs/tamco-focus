'use client';

import { useRouter } from 'next/navigation';
import type { MouseEvent } from 'react';

import { resolveAttentionAction } from '@/domain/attention';
import { teamRowState, type TeamRowState } from '@/domain/prioritisation';
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

/** What each state is called, in the words a manager would use. */
const STATE_LABEL: Record<TeamRowState, string> = {
  manager_action: 'Action needed from you',
  work_attention: 'Work needs attention',
  due_soon: 'Due soon',
  none: 'No issues flagged',
};

/**
 * One person, as a card on the roster (v323, refined v324).
 *
 * The card answers four questions in the order a manager asks them: who, what
 * state are they in, why, and what am I being asked to do. Everything else —
 * what they are working on, what they agreed, the full list of their work — is
 * in the panel beside the roster, which is open the whole time.
 *
 * v323 drew the state as a chip reading "⚠4" with the words in a title
 * attribute, and the load as a bar scaled to the busiest person. Both were
 * wrong for the same reason: they made the reader infer. "⚠4" is a glyph and a
 * number; the bar implied that carrying more work is carrying worse work, on a
 * scale nothing on screen stated. The state is a sentence now, and the figures
 * are the figures the product already computes — no derived indicator, no
 * ranking of people against each other.
 *
 * The one thing that is not words is the rail down the left edge, which is
 * severity. It is there so a column of seven can be scanned without being
 * read, which is what an andon lamp is for on the floors this product serves.
 */
export function MyTeamPersonRow({
  person,
  nowIso,
  attentionWindowDays = 5,
  expanded,
  toggleHref,
  panelId,
}: {
  person: TeamAttentionRow;
  nowIso: string;
  /** v189 — the organisation's attention window, in days. */
  attentionWindowDays?: number;
  /** Whether this person's detail is open beside the roster (§6). */
  expanded: boolean;
  /**
   * Where clicking the header goes: the same URL with this person expanded, or
   * with them dropped. The page builds it because it is the page that knows
   * the period, the filter and who else is being compared.
   */
  toggleHref: string;
  panelId: string;
}) {
  const router = useRouter();
  const action = person.attention
    ? resolveAttentionAction(person.attention, { teamAttention: true })
    : null;
  /*
   * A button only where the manager is being asked to do something.
   *
   * This is the distinction the card now states outright: an overdue task is
   * the person's to catch up on, and a request addressed to the manager is
   * not. Work that is merely late gets a state and a reason; a decision gets a
   * state, a reason and the control that answers it.
   */
  const managerAction = person.attention?.kind === 'action_required' ? action : null;
  const now = new Date(nowIso);
  const state = teamRowState(person);

  /*
   * How much this person is carrying, in the figures the product states
   * elsewhere — not an index, a score or a share of anything.
   *
   * Waiting work is here because v136 fixed a reported bug by putting it here:
   * from Needs attention a manager could not see what somebody had queued
   * without leaving the table that held the person they were reading.
   */
  const volume = [
    person.activeCount > 0 ? `${person.activeCount} active` : null,
    // v157 — what they owe on other people's work, which their own list cannot
    // show because the work belongs to somebody else.
    person.sharedStepCount > 0
      ? `${person.sharedStepCount} shared ${person.sharedStepCount === 1 ? 'step' : 'steps'}`
      : null,
    person.availableCount > 0 ? `${person.availableCount} waiting` : null,
  ].filter((part): part is string => part !== null);

  /*
   * What is wrong, counted and named.
   *
   * Every one of these was a two-character chip until v324, with the words
   * only in a `title` and in the screen reader's text — so the thing the card
   * exists to communicate was the one thing a manager had to decode.
   */
  const exceptions = [
    person.overdueCount > 0
      ? {
          key: 'overdue',
          tone: 'alert' as const,
          text: `${person.overdueCount} overdue`,
          testId: undefined,
        }
      : null,
    // v157 — a late step is late for somebody else's work, so it is counted on
    // its own rather than folded into a count of this person's own work.
    person.sharedStepOverdueCount > 0
      ? {
          key: 'shared-overdue',
          tone: 'alert' as const,
          text: `${person.sharedStepOverdueCount} assigned ${person.sharedStepOverdueCount === 1 ? 'step' : 'steps'} overdue`,
          testId: 'assigned-step-overdue',
        }
      : null,
    // v189 — and what is about to be late, so the manager can step in first.
    person.dueSoonCount > 0
      ? {
          key: 'soon',
          tone: 'soon' as const,
          text: `${person.dueSoonCount} due within ${attentionWindowDays} day${attentionWindowDays === 1 ? '' : 's'}`,
          testId: undefined,
        }
      : null,
  ].filter((part): part is NonNullable<typeof part> => part !== null);

  /*
   * §6 A01 — name, whitespace and chevron all do the same thing, because they
   * are all the same control: the card is the accordion button, and the
   * chevron inside it is decoration rather than a second target.
   *
   * `scroll: false` because this selects a person, it does not navigate.
   * Without it, choosing the fourth person sends the page back to the top and
   * the manager has to find them again.
   */
  function togglePerson() {
    router.push(toggleHref, { scroll: false });
  }

  /*
   * The whole card opens the person for a pointer, but it is not announced as
   * one button (v181). As a `role="button"` with a label, a screen reader
   * heard "Expand team member detail for Amer" and nothing else, and the
   * manager's decision button sat inside another button where it could not be
   * reached as itself.
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
      <div
        className={styles.row}
        data-testid="my-team-person-row"
        data-selected={expanded ? 'true' : undefined}
        data-state={state}
        onClick={handleRowClick}
      >
        <div className={styles.person} data-cell="person">
          <span className={styles.nameLine}>
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
            {/*
              The state, said rather than drawn. It is the one line that
              answers "do I need to do something about this person", so it sits
              on the name line where the eye already is.
            */}
            <span className={styles.state} data-cell="state" data-tone={state}>
              {STATE_LABEL[state]}
            </span>
          </span>

          {exceptions.length > 0 && (
            <span className={styles.exceptions} data-cell="exceptions">
              {exceptions.map((part) => (
                <span
                  key={part.key}
                  className={part.tone === 'soon' ? styles.summarySoon : styles.summaryAlert}
                  data-testid={part.testId}
                >
                  {part.text}
                </span>
              ))}
            </span>
          )}

          {/*
            What they are carrying, and when they last said anything. Both are
            counts the product already keeps; neither is combined into a score.
          */}
          <span className={styles.volume} data-cell="load">
            {volume.length === 0 ? 'No open items' : volume.join(' · ')}
            {' · '}
            <span data-cell="latest">
              {person.latestUpdate
                ? `updated ${agoWords(person.latestUpdate.at, now)}`
                : 'no updates recorded'}
            </span>
          </span>
        </div>

        {person.attention && (
          <div className={styles.attention} data-cell="needs-you">
            {/*
              Why, in the product's own words, and the control that answers it
              where there is one. This is the half of the card a manager reads
              rather than scans, so it keeps its sentence.
            */}
            <span className={styles.reason} data-cell="attention-reason">
              <strong>{person.attention.headline}</strong> — {person.attention.reason}
            </span>
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
          </div>
        )}

        <div className={styles.action} data-cell="action">
          <span className={styles.chevron} aria-hidden="true">
            ›
          </span>
        </div>
      </div>
    </div>
  );
}
