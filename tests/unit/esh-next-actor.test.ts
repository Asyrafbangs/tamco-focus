import { describe, expect, it } from 'vitest';

import {
  agoWords,
  dueWords,
  nextActor,
  rowOverlays,
  type NextActorInput,
} from '@/domain/esh-next-actor';

const NOW = new Date('2026-09-24T09:00:00Z'); // 17:00 in Kuala Lumpur
const ZONE = 'Asia/Kuala_Lumpur';

const ASSIGNED: NextActorInput = {
  status: 'open',
  actionState: 'assigned',
  ownerEmail: 'owner@example.com',
  dueAt: '2026-09-26T09:00:00Z',
  dueIsDateOnly: false,
  isOverdue: false,
  changesRequested: false,
  lastUpdateAt: '2026-09-24T07:00:00Z',
};

describe('v214/v223 who has to act next (§24, §33)', () => {
  it('names the owner and the deadline, rather than a state', () => {
    const next = nextActor(ASSIGNED, NOW, ZONE);
    expect(next.headline).toBe('Owner action');
    expect(next.detail).toContain('owner@example.com');
    expect(next.detail).toContain('26 Sept');
    expect(next.tone).toBe('owner');
  });

  it('says how late, once it is late', () => {
    const next = nextActor(
      { ...ASSIGNED, isOverdue: true, dueAt: '2026-09-21T09:00:00Z' },
      NOW,
      ZONE,
    );
    expect(next.kind).toBe('owner_overdue');
    expect(next.detail).toContain('3 days overdue');
  });

  it('says changes were requested when ESH sent the correction back', () => {
    const next = nextActor({ ...ASSIGNED, changesRequested: true }, NOW, ZONE);
    expect(next.kind).toBe('changes_requested');
    expect(next.headline).toBe('Changes requested');
    expect(next.tone).toBe('owner');
  });

  it('keeps delivery out of the state: a failed email is an overlay, worst first', () => {
    const overlays = rowOverlays(
      {
        dueAt: '2026-09-21T09:00:00Z',
        isOverdue: true,
        notificationFailed: true,
        escalationLevel: 1,
      },
      NOW,
    ).map((overlay) => overlay.label);
    expect(overlays).toEqual(['Email failed', 'Overdue 3 days', 'Escalated L1']);
  });

  it('adds no overlay to a row that is on time and delivered', () => {
    expect(
      rowOverlays(
        {
          dueAt: ASSIGNED.dueAt,
          isOverdue: false,
          notificationFailed: false,
          escalationLevel: null,
        },
        NOW,
      ),
    ).toEqual([]);
  });

  it('turns the queue over to ESH once work is submitted, and says for how long', () => {
    const next = nextActor(
      {
        ...ASSIGNED,
        actionState: 'awaiting_verification',
        lastUpdateAt: '2026-09-22T09:00:00Z',
      },
      NOW,
      ZONE,
    );
    expect(next.headline).toBe('ESH verification');
    expect(next.detail).toContain('2 days ago');
    expect(next.tone).toBe('esh');
  });

  it('asks ESH for an owner when there is not one yet', () => {
    expect(nextActor({ ...ASSIGNED, status: 'new', actionState: null }, NOW, ZONE).kind).toBe(
      'unassigned',
    );
  });

  it('says nothing is waiting once it is closed or set aside', () => {
    expect(nextActor({ ...ASSIGNED, status: 'closed' }, NOW, ZONE).tone).toBe('settled');
    expect(nextActor({ ...ASSIGNED, status: 'duplicate' }, NOW, ZONE).headline).toBe(
      'No longer open',
    );
  });

  it('words a deadline the way somebody would say it', () => {
    expect(dueWords('2026-09-24T09:00:00Z', false, NOW, ZONE)).toBe('today · 5:00 pm');
    expect(dueWords('2026-09-24T09:00:00Z', true, NOW, ZONE)).toBe('today');
    expect(dueWords('2026-09-23T09:00:00Z', true, NOW, ZONE)).toBe('1 day overdue');
    expect(dueWords(null, true, NOW, ZONE)).toBe('no date set');
  });

  it('keeps the updated column short', () => {
    expect(agoWords('2026-09-24T08:18:00Z', NOW)).toBe('42 min');
    expect(agoWords('2026-09-24T06:00:00Z', NOW)).toBe('3 hr');
    expect(agoWords('2026-09-22T09:00:00Z', NOW)).toBe('2 days');
  });
});
