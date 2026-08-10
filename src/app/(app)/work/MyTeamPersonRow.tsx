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
      <span>Working on</span>
      <span>Needs you</span>
      <span>Latest</span>
      <span>Action</span>
    </div>
  );
}

export function MyTeamPersonRow({
  person,
  filter,
  nowIso,
}: {
  person: TeamAttentionRow;
  filter: 'everyone' | 'attention';
  nowIso: string;
}) {
  const router = useRouter();
  const personHref = `/work?scope=team${filter === 'attention' ? '&filter=attention' : ''}&person=${person.userId}`;
  const action = person.attention
    ? resolveAttentionAction(person.attention, { teamAttention: true })
    : null;
  const actionHref = action?.href ?? (person.attention ? null : personHref);
  const actionLabel = action?.label ?? (person.attention ? null : 'Open');
  const now = new Date(nowIso);

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
    if (actionHref) router.push(actionHref);
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
        <span>
          {person.activeCount} active
          {person.routineDueCount > 0
            ? ` · ${person.routineDueCount} routine${person.routineDueCount === 1 ? '' : 's'} overdue`
            : ''}
        </span>
      </div>

      <div className={styles.working} data-cell="working-on">
        {person.workingOn ? (
          <>
            <strong>{person.workingOn.title}</strong>
            <span>
              {person.workingOn.nextAction
                ? `Next: ${person.workingOn.nextAction}`
                : 'No next action recorded'}
            </span>
          </>
        ) : (
          <span className={styles.muted}>No Active focus</span>
        )}
      </div>

      <div className={styles.attention} data-cell="needs-you">
        {person.attention ? (
          <>
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
              {person.attention.headline}
            </span>
            <span>{person.attention.reason}</span>
          </>
        ) : (
          <span className={styles.muted}>No action needed from you</span>
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
        {actionHref && actionLabel ? (
          <button
            type="button"
            className={`btn small${person.attention ? ' primary' : ''}`}
            onClick={handleAction}
            aria-label={
              person.attention
                ? `${actionLabel} for ${person.fullName}: ${person.attention.reason}`
                : `Open detail for ${person.fullName}`
            }
          >
            {actionLabel}
            <span aria-hidden="true">›</span>
          </button>
        ) : (
          <span className={styles.unavailable}>Action unavailable</span>
        )}
      </div>
    </div>
  );
}
