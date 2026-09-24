import type { ActionState, FindingStatus } from '@/domain/esh-findings';

/**
 * Who has to act next, said plainly (§24, §33).
 *
 * The database knows this. Until now it made the reader work it out from a
 * state chip, a due date, a held-notification badge and a conversation, which
 * is four things to hold in your head before you learn the one thing you came
 * for. Every list and every header asks this module instead, so the answer is
 * the same wherever it is read.
 *
 * Order matters: a bounced assignment outranks an overdue deadline, because
 * work nobody was told about is not late — it is undelivered.
 */

export type NextActorKind =
  | 'unassigned'
  | 'delivery_problem'
  | 'not_told'
  | 'owner'
  | 'owner_overdue'
  | 'esh_verification'
  | 'settled';

export interface NextActorInput {
  status: FindingStatus;
  actionState: ActionState | null;
  ownerEmail: string | null;
  dueAt: string | null;
  dueIsDateOnly: boolean;
  isOverdue: boolean;
  notificationHeld: boolean;
  notificationFailed: boolean;
  lastUpdateAt: string;
}

export interface NextActor {
  kind: NextActorKind;
  /** The headline, in capitals wherever it is shown as a label. */
  headline: string;
  /** One line under it: who, and by when. */
  detail: string;
  /** Whether this is somebody's turn, or something that has gone wrong. */
  tone: 'owner' | 'esh' | 'problem' | 'settled';
}

/** "Today · 5:00 PM", "26 Sept", "2 days overdue" — in the reader's zone. */
export function dueWords(
  dueAt: string | null,
  dateOnly: boolean,
  now: Date,
  timeZone: string,
): string {
  if (!dueAt) return 'no date set';
  const due = new Date(dueAt);
  const day = (value: Date) =>
    new Intl.DateTimeFormat('en-GB', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .format(value)
      .split('/')
      .reverse()
      .join('-');
  const today = day(now);
  const dueDay = day(due);
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(due);
  const date = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    day: 'numeric',
    month: 'short',
  }).format(due);

  if (dueDay === today) return dateOnly ? 'today' : `today · ${time}`;
  if (due.getTime() < now.getTime()) {
    const days = Math.max(1, Math.round((now.getTime() - due.getTime()) / 86_400_000));
    return days === 1 ? '1 day overdue' : `${days} days overdue`;
  }
  return dateOnly ? date : `${date} · ${time}`;
}

/** "42 min", "3 hr", "2 days" — how long ago, for a column that scans. */
export function agoWords(since: string, now: Date): string {
  const minutes = Math.floor((now.getTime() - new Date(since).getTime()) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'}`;
}

/** How long something has been waiting, for a queue that should not grow. */
export function waitingWords(since: string, now: Date): string {
  const hours = Math.floor((now.getTime() - new Date(since).getTime()) / 3_600_000);
  if (hours < 1) return 'just now';
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'}`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'}`;
}

export function nextActor(row: NextActorInput, now: Date, timeZone: string): NextActor {
  const owner = row.ownerEmail ?? 'the owner';

  if (row.status === 'closed') {
    return { kind: 'settled', headline: 'Closed', detail: 'Verified by ESH.', tone: 'settled' };
  }
  if (row.status === 'cancelled' || row.status === 'duplicate' || row.status === 'withdrawn') {
    return {
      kind: 'settled',
      headline: 'No longer open',
      detail: `Recorded as ${row.status}.`,
      tone: 'settled',
    };
  }
  if (row.status === 'draft' || !row.actionState || row.actionState === 'draft') {
    return {
      kind: 'unassigned',
      headline: 'Needs an owner',
      detail: 'ESH assigns somebody accountable.',
      tone: 'esh',
    };
  }

  // Undelivered beats late: nobody can be late for work they never received.
  if (row.notificationFailed) {
    return {
      kind: 'delivery_problem',
      headline: 'Delivery problem',
      detail: `The assignment email to ${owner} could not be delivered.`,
      tone: 'problem',
    };
  }
  if (row.notificationHeld) {
    return {
      kind: 'not_told',
      headline: 'Owner not told yet',
      detail: `${owner} is not cleared to receive email, so the assignment is held.`,
      tone: 'problem',
    };
  }

  if (row.actionState === 'awaiting_verification') {
    return {
      kind: 'esh_verification',
      headline: 'ESH verification required',
      detail: `${owner} submitted ${waitingWords(row.lastUpdateAt, now)} ago.`,
      tone: 'esh',
    };
  }
  if (row.actionState === 'accepted' || row.actionState === 'cancelled') {
    return {
      kind: 'settled',
      headline: 'Nothing outstanding',
      detail: 'No action is waiting on anybody.',
      tone: 'settled',
    };
  }

  const words = dueWords(row.dueAt, row.dueIsDateOnly, now, timeZone);
  return {
    kind: row.isOverdue ? 'owner_overdue' : 'owner',
    headline: 'Owner action required',
    detail: row.isOverdue
      ? `${owner} is ${words}.`
      : `${owner} needs to complete this by ${words}.`,
    tone: 'owner',
  };
}
