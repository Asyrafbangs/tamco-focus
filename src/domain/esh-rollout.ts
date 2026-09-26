/**
 * The rollout gate, in words (v224, §43).
 *
 * Two settings and one bulk act, and all three are easy to describe wrongly.
 * "Live" must not read as "everybody, including the people you switched off".
 * A release that let ninety letters go and refused four must say which four
 * and why, in one sentence, without making the ninety sound like a failure.
 * Both are decided here so a test can argue with the wording.
 */

export type RolloutMode = 'restricted' | 'live';

export interface RolloutStatus {
  mode: RolloutMode;
  modeChangedAt: string | null;
  modeChangedBy: string | null;
  modeReason: string | null;
  authorizationVersion: number;
  contactsTotal: number;
  contactsEnabled: number;
  contactsRevoked: number;
  held: number;
  heldReleasable: number;
}

export interface ReleaseOutcome {
  released: number;
  covered: number;
  skipped: number;
  reasons: Record<string, number>;
  stillHeld: number;
}

export const ROLLOUT_MODE_PROBLEMS: Record<string, string> = {
  not_permitted: 'Only an administrator can change the rollout.',
  mode_invalid: 'The rollout is either restricted or live.',
  reason_required: 'Say why the rollout is changing, in a sentence somebody can read later.',
  rollout_not_configured:
    'Finding Management has not been set up on this database, so the rollout cannot be changed.',
};

/** Why one held notification would not go, as a clause in a longer sentence. */
export const RELEASE_SKIP_WORDS: Record<string, string> = {
  contact_access_off: 'the contact is not cleared to receive mail',
  no_longer_the_owner: 'the address no longer owns the action',
  assignment_first: 'the assignment email has not gone out yet',
  not_held: 'it was no longer held',
  notification_not_found: 'the finding is outside your departments',
  not_permitted: 'you cannot release notifications',
};

export function rolloutModeProblem(code: string | undefined): string {
  return ROLLOUT_MODE_PROBLEMS[code ?? ''] ?? 'Something went wrong and nothing was changed.';
}

function count(value: number, one: string, many: string): string {
  return `${value} ${value === 1 ? one : many}`;
}

/** What the current mode means for real people, not what its value is. */
export function rolloutWords(status: RolloutStatus): string {
  if (status.mode === 'live') {
    const except =
      status.contactsRevoked > 0
        ? `, apart from ${count(status.contactsRevoked, 'contact', 'contacts')} an administrator switched off`
        : '';
    return `Every active contact can be written to${except}.`;
  }
  return `${status.contactsEnabled} of ${count(status.contactsTotal, 'active contact', 'active contacts')} can be written to. The rest are recorded as owners but receive nothing.`;
}

/**
 * What going the other way would do, said before it is done.
 *
 * Restricted to live is the wider act and the one worth a warning; live to
 * restricted is the safe direction, but it is not free either — it ends the
 * sessions of everybody who was reachable only because the rollout was open.
 */
export function rolloutChangeWords(status: RolloutStatus): string {
  if (status.mode === 'live') {
    return 'Closing the rollout ends the links and sessions of everyone who was reachable only because it was open. Contacts cleared by name keep their access, and no work changes.';
  }
  const waiting =
    status.contactsTotal - status.contactsEnabled > 0
      ? ` ${count(status.contactsTotal - status.contactsEnabled, 'contact', 'contacts')} would become reachable.`
      : '';
  return `Opening the rollout lets every active contact receive email, apart from anyone switched off by name.${waiting} Nothing is sent by opening it: what is held stays held until it is released.`;
}

/**
 * One sentence for what a bulk release actually did.
 *
 * "Covered" is not a refusal and must never read as one: releasing an
 * assignment email settles that owner's held replies because the assignment
 * opens the same conversation, so those letters are accounted for, not lost.
 */
export function releaseSummary(outcome: ReleaseOutcome): string {
  if (outcome.released === 0 && outcome.covered === 0 && outcome.skipped === 0) {
    return 'Nothing was held, so nothing was released.';
  }

  const parts: string[] = [];
  if (outcome.released > 0) {
    parts.push(
      `${count(outcome.released, 'notification', 'notifications')} released, going out on the next dispatch`,
    );
  }
  if (outcome.covered > 0) {
    parts.push(
      `${count(outcome.covered, 'reply notice', 'reply notices')} covered by an assignment email to the same person`,
    );
  }
  if (outcome.skipped > 0) {
    const because = Object.entries(outcome.reasons)
      .sort(([, a], [, b]) => b - a)
      .map(([code, howMany]) => `${howMany} because ${RELEASE_SKIP_WORDS[code] ?? 'of a refusal'}`)
      .join(', ');
    parts.push(
      `${count(outcome.skipped, 'notification', 'notifications')} not released — ${because}`,
    );
  }

  const sentence = parts.join('; ');
  const more =
    outcome.stillHeld > 0 && outcome.released > 0
      ? ` ${count(outcome.stillHeld, 'notification is', 'notifications are')} still held.`
      : '';
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.${more}`;
}
