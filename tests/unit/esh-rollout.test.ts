import { describe, expect, it } from 'vitest';

import {
  releaseSummary,
  rolloutChangeWords,
  rolloutWords,
  type ReleaseOutcome,
  type RolloutStatus,
} from '@/domain/esh-rollout';

function status(overrides: Partial<RolloutStatus> = {}): RolloutStatus {
  return {
    mode: 'restricted',
    modeChangedAt: null,
    modeChangedBy: null,
    modeReason: null,
    authorizationVersion: 1,
    contactsTotal: 9,
    contactsEnabled: 2,
    contactsRevoked: 0,
    held: 0,
    heldReleasable: 0,
    ...overrides,
  };
}

function outcome(overrides: Partial<ReleaseOutcome> = {}): ReleaseOutcome {
  return { released: 0, covered: 0, skipped: 0, reasons: {}, stillHeld: 0, ...overrides };
}

describe('what the rollout mode means', () => {
  it('says how many of the contacts can be written to while it is restricted', () => {
    expect(rolloutWords(status())).toBe(
      '2 of 9 active contacts can be written to. The rest are recorded as owners but receive nothing.',
    );
  });

  it('does not claim everybody when somebody was switched off by name', () => {
    expect(rolloutWords(status({ mode: 'live', contactsRevoked: 1 }))).toBe(
      'Every active contact can be written to, apart from 1 contact an administrator switched off.',
    );
  });

  it('is plain when the rollout is open and nobody is switched off', () => {
    expect(rolloutWords(status({ mode: 'live' }))).toBe('Every active contact can be written to.');
  });

  it('warns that opening the rollout sends nothing by itself', () => {
    const words = rolloutChangeWords(status({ held: 40 }));
    expect(words).toContain('7 contacts would become reachable');
    expect(words).toContain('what is held stays held until it is released');
  });

  it('warns that closing it ends the sessions it opened', () => {
    expect(rolloutChangeWords(status({ mode: 'live' }))).toContain('ends the links and sessions');
  });
});

describe('what a bulk release did', () => {
  it('is honest when there was nothing to do', () => {
    expect(releaseSummary(outcome())).toBe('Nothing was held, so nothing was released.');
  });

  it('reports a clean release', () => {
    expect(releaseSummary(outcome({ released: 94 }))).toBe(
      '94 notifications released, going out on the next dispatch.',
    );
  });

  it('counts a covered reply as accounted for rather than refused', () => {
    const words = releaseSummary(outcome({ released: 12, covered: 3 }));
    expect(words).toContain('3 reply notices covered by an assignment email');
    expect(words).not.toContain('not released');
  });

  it('names the rule behind every letter that did not go', () => {
    expect(
      releaseSummary(
        outcome({
          released: 90,
          skipped: 4,
          reasons: { contact_access_off: 3, no_longer_the_owner: 1 },
          stillHeld: 4,
        }),
      ),
    ).toBe(
      '90 notifications released, going out on the next dispatch; 4 notifications not released — ' +
        '3 because the contact is not cleared to receive mail, 1 because the address no longer owns the action. ' +
        '4 notifications are still held.',
    );
  });

  it('does not repeat the count still held when nothing went out', () => {
    const words = releaseSummary(
      outcome({ skipped: 2, reasons: { contact_access_off: 2 }, stillHeld: 2 }),
    );
    expect(words).toBe(
      '2 notifications not released — 2 because the contact is not cleared to receive mail.',
    );
  });

  it('falls back to a plain clause for a code it has never seen', () => {
    expect(releaseSummary(outcome({ skipped: 1, reasons: { something_new: 1 } }))).toContain(
      '1 because of a refusal',
    );
  });
});
