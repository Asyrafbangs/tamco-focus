/**
 * ESH Finding Management — what an Action Owner's email link opens (v198).
 *
 * Owners have no account (§8). A link in their email carries a random secret;
 * pressing the button on the page it opens exchanges that secret, once, for a
 * short session on this device (§18, §19). Everything that decides whether
 * they may see or do something lives in the database procedures; this module
 * is the vocabulary the guest screens and emails share. Pure, so it can be
 * tested without a server.
 */

import { daysOverdue, type ActionPriority, type ActionState } from '@/domain/esh-findings';

/** The two kinds of link an owner receives (§9). */
export type AccessPurpose = 'owner_action' | 'owner_inbox';

/**
 * A link secret: 32 random bytes, base64url, 43 characters. Anything else in
 * the address is not one of ours and is not sent anywhere.
 */
export const ACCESS_SECRET_SHAPE = /^[A-Za-z0-9_-]{43}$/;

/**
 * The secret rides in the fragment, never the query: a fragment is not sent
 * to the server, so it cannot land in a request log or a proxy's history, and
 * a mail scanner fetching the address learns nothing it could spend (§18).
 */
export function accessLinkUrl(origin: string, purpose: AccessPurpose, secret: string): string {
  const target = purpose === 'owner_inbox' ? 'actions' : 'action';
  return `${origin.replace(/\/+$/, '')}/respond/access?for=${target}#${secret}`;
}

/** The secret in a fragment, or null when there is none worth trying. */
export function secretFromFragment(hash: string): string | null {
  const value = hash.startsWith('#') ? hash.slice(1) : hash;
  return ACCESS_SECRET_SHAPE.test(value) ? value : null;
}

/**
 * Where an emailed link may point (§18): an approved origin, never whatever
 * Host a request arrived with. The request's own origin is used when it is
 * one of the approved ones, so a preview deployment links to itself;
 * otherwise the production address, then the configured base.
 */
export function approvedLinkOrigin(options: {
  requestOrigin?: string | null;
  appBaseUrl?: string | null;
  productionHost?: string | null;
}): string {
  const approved = [
    options.appBaseUrl?.replace(/\/+$/, ''),
    options.productionHost ? `https://${options.productionHost.replace(/^https?:\/\//, '')}` : null,
  ].filter((origin): origin is string => Boolean(origin));
  const asked = options.requestOrigin?.replace(/\/+$/, '');
  if (asked && approved.includes(asked)) return asked;
  const production = options.productionHost
    ? `https://${options.productionHost.replace(/^https?:\/\//, '')}`
    : null;
  return production ?? approved[0] ?? 'http://localhost:3000';
}

/** Why an exchange did not open anything, as the procedure says it. */
export type ExchangeProblem =
  'invalid' | 'expired' | 'used' | 'revoked' | 'unavailable' | 'needs_tap';

/**
 * A link we recognise can ask for a fresh one without the owner typing
 * anything (§19); one we cannot find asks for their email instead.
 */
export function recoveryFor(problem: ExchangeProblem): 'send_fresh' | 'ask_email' {
  return problem === 'invalid' ? 'ask_email' : 'send_fresh';
}

export type MyActionsFilter = 'needs' | 'review';

export const MY_ACTIONS_FILTERS: Array<{ key: MyActionsFilter; label: string }> = [
  { key: 'needs', label: 'Needs my action' },
  { key: 'review', label: 'Awaiting ESH review' },
];

export function myActionsFilterFrom(value: string | undefined): MyActionsFilter {
  return value === 'review' ? 'review' : 'needs';
}

export const MY_ACTIONS_PAGE_SIZE = 20;

/** The longest message either side may send (the database checks it too). */
export const MESSAGE_MAX_LENGTH = 4000;

export interface MyActionRow {
  id: string;
  reference: string;
  title: string;
  findingTitle: string;
  location: string | null;
  department: string | null;
  priority: ActionPriority | null;
  state: ActionState;
  dueAt: string | null;
  dueIsDateOnly: boolean;
  lastUpdateAt: string | null;
}

/**
 * The due line on a row (§10): an explicit age once late, otherwise the date.
 * Overdue is counted in whole days on the organisation's calendar.
 */
export function dueLine(
  row: Pick<MyActionRow, 'dueAt' | 'dueIsDateOnly' | 'state'>,
  now: Date,
  timeZone: string,
): { text: string; overdue: boolean } {
  if (!row.dueAt) return { text: 'No due date', overdue: false };
  if (row.state === 'awaiting_verification') {
    return { text: 'Submitted — ESH is reviewing', overdue: false };
  }
  const due = new Date(row.dueAt);
  if (due.getTime() < now.getTime()) {
    const days = daysOverdue(row.dueAt, now, timeZone);
    return {
      text: days === 0 ? 'Overdue today' : `Overdue ${days} day${days === 1 ? '' : 's'}`,
      overdue: true,
    };
  }
  const date = new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone,
  }).format(due);
  const time = row.dueIsDateOnly
    ? ''
    : ` ${new Intl.DateTimeFormat('en-GB', {
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
        timeZone,
      }).format(due)}`;
  return { text: `Due ${date}${time}`, overdue: false };
}

/** What a guest is told when a message could not be sent. */
export const OWNER_MESSAGE_PROBLEMS: Record<string, string> = {
  no_session:
    'Your access on this device has ended. Your message is still here — get a new link to send it.',
  not_available: 'This action is no longer open to you, so the message was not sent.',
  body_required: 'Write a message first.',
  body_too_long: `Keep a message under ${MESSAGE_MAX_LENGTH.toLocaleString('en-GB')} characters.`,
  slow_down: 'That is a lot of messages in a few minutes. Wait a little, then send again.',
  invalid: 'Something went wrong and the message was not sent. Try again.',
};

const TRY_AGAIN = 'Something went wrong and nothing was saved. Try again.';

/** The words for a code, from one of the maps below, never undefined. */
function wordsFor(map: Record<string, string>, code: string | undefined, fallback: string) {
  return (code ? map[code] : undefined) ?? fallback;
}

export function ownerMessageProblem(code: string | undefined): string {
  return wordsFor(OWNER_MESSAGE_PROBLEMS, code, OWNER_MESSAGE_PROBLEMS.invalid ?? TRY_AGAIN);
}

/** What ESH staff are told when a message or release could not be saved. */
export const STAFF_MESSAGE_PROBLEMS: Record<string, string> = {
  not_permitted: 'Only a Coordinator or Verifier can write to the owner.',
  action_not_found: 'This action could not be found.',
  action_closed: 'This action is closed, so the conversation is read-only.',
  body_required: 'Write a message first.',
  body_too_long: `Keep a message under ${MESSAGE_MAX_LENGTH.toLocaleString('en-GB')} characters.`,
  invalid: 'Something went wrong and the message was not sent. Try again.',
};

export const RELEASE_PROBLEMS: Record<string, string> = {
  not_permitted: 'Only a Coordinator or Verifier can release a notification.',
  notification_not_found: 'This notification could not be found.',
  not_held: 'This notification is no longer held.',
  contact_access_off:
    'The owner’s access is still off. An administrator enables it in Identity and access → Email contacts.',
  no_longer_the_owner: 'This address no longer owns the action, so nothing was sent.',
  assignment_first: 'Release the assignment email first: it opens the same conversation.',
};

export const CONTACT_ACCESS_PROBLEMS: Record<string, string> = {
  not_permitted: 'Only an administrator can change a contact’s access.',
  contact_not_found: 'That contact no longer exists.',
  rollout_not_configured:
    'Finding Management has not been set up on this database, so access cannot be granted.',
  contact_disabled: 'A disabled contact cannot be given access.',
};

/** A conversation entry as both sides render it. */
export interface ConversationEntry {
  id: string;
  authorKind: 'owner' | 'staff' | 'system';
  authorName: string | null;
  authorEmail: string | null;
  body: string;
  sentAt: string;
}

/**
 * The day heading above a run of messages: Today, Yesterday, or the date, in
 * the reader's zone.
 */
export function conversationDay(instant: string, now: Date, timeZone: string): string {
  const day = (value: Date) => new Intl.DateTimeFormat('en-CA', { timeZone }).format(value);
  const that = day(new Date(instant));
  if (that === day(now)) return 'Today';
  if (that === day(new Date(now.getTime() - 86_400_000))) return 'Yesterday';
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone,
  }).format(new Date(instant));
}

export function firstName(fullName: string | null | undefined): string {
  const trimmed = (fullName ?? '').trim();
  return trimmed.split(/\s+/)[0] || trimmed || 'ESH';
}

export function staffMessageProblem(code: string | undefined): string {
  return wordsFor(
    STAFF_MESSAGE_PROBLEMS,
    code,
    'Something went wrong and the message was not sent. Try again.',
  );
}

export function releaseProblem(code: string | undefined): string {
  return wordsFor(
    RELEASE_PROBLEMS,
    code,
    'Something went wrong and nothing was released. Try again.',
  );
}

export function contactAccessProblem(code: string | undefined): string {
  return wordsFor(
    CONTACT_ACCESS_PROBLEMS,
    code,
    'Something went wrong and nothing was changed. Try again.',
  );
}
