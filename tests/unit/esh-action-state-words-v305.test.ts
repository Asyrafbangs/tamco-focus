import { describe, expect, it } from 'vitest';

import {
  ACTION_STATE_LABELS,
  actionStateWords,
  isOwnWork,
  type ActionState,
} from '@/domain/esh-findings';
import { lastSubmissionWasSentBack, type SubmissionMark } from '@/domain/esh-guest';

/**
 * v305 — one state, two situations, one label.
 *
 * Read from the live procedure definitions: `esh_guest_send_message` moves an
 * action from `assigned` to `in_progress` the first time the owner writes, so
 * "In progress" is honest for work that has genuinely started. But
 * `esh_verify_submission` puts a REJECTED submission's action back into the
 * same state, and so do `esh_guest_withdraw` and `esh_reopen_finding`.
 *
 * A correction ESH sent back therefore read exactly like one being worked on.
 * Only the rejection is reworded here, because only the rejection is a
 * decision somebody made that the label was hiding; a withdrawal or a reopen
 * does leave the work with the owner, which is what "In progress" says.
 */

describe('v305 what an action state says', () => {
  it('leaves every state but one exactly as it was', () => {
    /*
     * The other five are honest, and this change must not quietly reword the
     * vocabulary people already navigate by.
     */
    const untouched: ActionState[] = [
      'draft',
      'assigned',
      'awaiting_verification',
      'accepted',
      'cancelled',
    ];
    for (const state of untouched) {
      expect(actionStateWords(state)).toBe(ACTION_STATE_LABELS[state]);
      expect(actionStateWords(state, { changesRequested: true })).toBe(ACTION_STATE_LABELS[state]);
      expect(actionStateWords(state, { audience: 'owner' })).toBe(ACTION_STATE_LABELS[state]);
    }
  });

  it('never calls rejected work "In progress" again', () => {
    expect(actionStateWords('in_progress', { changesRequested: true })).not.toBe(
      ACTION_STATE_LABELS.in_progress,
    );
    expect(actionStateWords('in_progress', { changesRequested: true })).toBe('Sent back for more');
  });

  it('says it plainly to the person who has to act on it', () => {
    /*
     * The owner has no register, no queue and no ESH vocabulary. "Sent back"
     * told to the person who must now do something reads as a verdict; what
     * they need is the request.
     */
    expect(actionStateWords('in_progress', { changesRequested: true, audience: 'owner' })).toBe(
      'More needed from you',
    );
  });

  it('leaves genuinely started work alone', () => {
    /*
     * `esh_guest_send_message` moves `assigned` to `in_progress` when the
     * owner first writes, so most actions in this state really are underway.
     * Rewording those would have replaced one wrong reading with another, and
     * saying "sent back" where ESH decided nothing would invent a decision.
     */
    expect(actionStateWords('in_progress')).toBe(ACTION_STATE_LABELS.in_progress);
    expect(actionStateWords('in_progress', { changesRequested: false })).toBe(
      ACTION_STATE_LABELS.in_progress,
    );
    expect(actionStateWords('in_progress', { audience: 'owner' })).toBe(
      ACTION_STATE_LABELS.in_progress,
    );
  });

  it('distinguishes the two readings of the same state', () => {
    // The whole point: one state, two situations, and they must not read alike.
    expect(actionStateWords('in_progress', { changesRequested: true })).not.toBe(
      actionStateWords('in_progress', { changesRequested: false }),
    );
  });
});

describe('v305 whether this is the viewer’s own work', () => {
  const viewer = { viewerEmail: 'izzul@tamco.local', viewerUserId: 'user-izzul' };

  it('matches on the address, however it was typed', () => {
    expect(isOwnWork({ ownerEmail: 'IZZUL@Tamco.Local', ownerStaffUserId: null, ...viewer })).toBe(
      true,
    );
  });

  it('matches on the staff account when the addresses differ', () => {
    /*
     * The arm the page was missing. `focus.esh_is_own_work` returns true on
     * `staff_user_id = actor` whatever the address says, so a page testing the
     * email alone would render the Verify panel and let the procedure refuse
     * the click with `self_verification` - a message about "your own address"
     * shown to somebody whose address plainly differs.
     */
    expect(
      isOwnWork({
        ownerEmail: 'izzul.ahmad@tamco.com.my',
        ownerStaffUserId: 'user-izzul',
        ...viewer,
      }),
    ).toBe(true);
  });

  it('is false for somebody else, by either arm', () => {
    expect(
      isOwnWork({ ownerEmail: 'fadli@tamco.com.my', ownerStaffUserId: 'user-fadli', ...viewer }),
    ).toBe(false);
  });

  it('does not treat two unlinked principals as the same person', () => {
    /*
     * Both ids absent must not match. An owner with no staff account and a
     * viewer with none would otherwise compare null to null and refuse every
     * verification in the organisation.
     */
    expect(
      isOwnWork({ ownerEmail: 'someone@example.com', ownerStaffUserId: null, ...viewer }),
    ).toBe(false);
    expect(
      isOwnWork({ ownerEmail: null, ownerStaffUserId: null, viewerEmail: '', viewerUserId: '' }),
    ).toBe(false);
  });

  it('is false when there is no owner at all', () => {
    expect(isOwnWork({ ownerEmail: null, ownerStaffUserId: null, ...viewer })).toBe(false);
  });
});

describe('v305 which submission speaks for the action now', () => {
  const mark = (version: number, state: SubmissionMark['state']): SubmissionMark => ({
    messageId: `m-${version}`,
    version,
    state,
  });

  it('asks the newest version, not the first row the query returned', () => {
    /*
     * Row order is the query's business, not a fact about the work. An
     * accepted version two rounds ago says nothing about where this sits now.
     */
    expect(lastSubmissionWasSentBack([mark(2, 'changes_requested'), mark(1, 'accepted')])).toBe(
      true,
    );
    expect(lastSubmissionWasSentBack([mark(1, 'changes_requested'), mark(2, 'pending')])).toBe(
      false,
    );
  });

  it('is false when the owner withdrew it rather than ESH returning it', () => {
    // Both land the action in `in_progress`; only one is a decision ESH made.
    expect(lastSubmissionWasSentBack([mark(1, 'withdrawn')])).toBe(false);
  });

  it('is false when nothing has been submitted', () => {
    expect(lastSubmissionWasSentBack([])).toBe(false);
  });
});
