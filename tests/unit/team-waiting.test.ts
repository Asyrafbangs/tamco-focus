import { describe, expect, it } from 'vitest';

import {
  ASSIGNED_UNTOUCHED_DAYS,
  WAITING_TOO_LONG_DAYS,
  classify,
  dueWords,
  groupWaiting,
  waitingSummary,
  type WaitingItem,
} from '@/domain/team-waiting';

const ZONE = 'Asia/Kuala_Lumpur';
const NOW = new Date('2026-10-01T04:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;

function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * DAY).toISOString();
}
function inDays(days: number): string {
  return new Date(NOW.getTime() + days * DAY).toISOString();
}

function item(overrides: Partial<WaitingItem> = {}): WaitingItem {
  return {
    id: 't1',
    title: 'Pallet slip CAPA',
    ownerId: 'amer',
    ownerName: 'Amer',
    dueAt: null,
    dueIsDateOnly: true,
    urgency: 'normal',
    createdAt: daysAgo(2),
    assignedByName: null,
    progressPercent: 0,
    ...overrides,
  };
}

describe('what needs a manager', () => {
  it('raises overdue work', () => {
    const entry = classify(item({ dueAt: daysAgo(1) }), NOW, ZONE);
    expect(entry.bucket).toBe('attention');
    expect(entry.overdue).toBe(true);
    expect(entry.reasons[0]).toBe('Due yesterday');
  });

  it('raises work that has sat too long, even with no due date', () => {
    const entry = classify(item({ createdAt: daysAgo(WAITING_TOO_LONG_DAYS) }), NOW, ZONE);
    expect(entry.bucket).toBe('attention');
    expect(entry.reasons).toContain(`waiting ${WAITING_TOO_LONG_DAYS} days`);
    expect(entry.reasons).toContain('no due date');
  });

  it('raises an assignment nobody has touched', () => {
    const entry = classify(
      item({ assignedByName: 'Izzul', createdAt: daysAgo(ASSIGNED_UNTOUCHED_DAYS) }),
      NOW,
      ZONE,
    );
    expect(entry.bucket).toBe('attention');
    expect(entry.reasons).toContain('assigned by Izzul, not started');
  });

  it('does not raise an assignment made this morning', () => {
    // Without a delay the exception list is worthless by lunchtime.
    const entry = classify(item({ assignedByName: 'Izzul', createdAt: daysAgo(1) }), NOW, ZONE);
    expect(entry.bucket).toBe('later');
  });

  it('does not raise an assignment somebody has started', () => {
    const entry = classify(
      item({ assignedByName: 'Izzul', createdAt: daysAgo(20), progressPercent: 30 }),
      NOW,
      ZONE,
    );
    // Still old enough to raise on its own, but not for being untouched.
    expect(entry.reasons).not.toContain('assigned by Izzul, not started');
  });

  it('raises high urgency before it is late', () => {
    const entry = classify(item({ urgency: 'high', dueAt: inDays(20) }), NOW, ZONE);
    expect(entry.bucket).toBe('attention');
    expect(entry.reasons).toContain('high attention');
  });

  it('leaves ordinary queued work quiet', () => {
    const entry = classify(item({ dueAt: inDays(30), createdAt: daysAgo(3) }), NOW, ZONE);
    expect(entry.bucket).toBe('later');
  });

  it('puts work due this week in its own group', () => {
    expect(classify(item({ dueAt: inDays(3) }), NOW, ZONE).bucket).toBe('upcoming');
    expect(classify(item({ dueAt: inDays(9) }), NOW, ZONE).bucket).toBe('later');
  });
});

describe('the words under a title', () => {
  it('counts days rather than printing a date nobody can subtract', () => {
    expect(dueWords(daysAgo(3), NOW, ZONE)).toBe('Due 3 days ago');
    expect(dueWords(daysAgo(1), NOW, ZONE)).toBe('Due yesterday');
    expect(dueWords(NOW.toISOString(), NOW, ZONE)).toBe('Due today');
    expect(dueWords(inDays(1), NOW, ZONE)).toBe('Due tomorrow');
    expect(dueWords(inDays(4), NOW, ZONE)).toBe('Due in 4 days');
  });

  it('falls back to a date once counting days stops helping', () => {
    expect(dueWords(inDays(30), NOW, ZONE)).toMatch(/^Due \d+ \w+$/);
  });

  it('says nothing when there is no date', () => {
    expect(dueWords(null, NOW, ZONE)).toBeNull();
  });
});

describe('the three groups', () => {
  const view = groupWaiting(
    [
      item({ id: 'overdue', title: 'Overdue one', dueAt: daysAgo(1) }),
      item({ id: 'old', title: 'Long wait', createdAt: daysAgo(40) }),
      item({ id: 'soon', title: 'Due soon', dueAt: inDays(2) }),
      item({ id: 'later', title: 'Queued', dueAt: inDays(40), createdAt: daysAgo(1) }),
    ],
    NOW,
    ZONE,
  );

  it('sorts them into attention, upcoming and later', () => {
    expect(view.attention.map((one) => one.id)).toEqual(['overdue', 'old']);
    expect(view.upcoming.map((one) => one.id)).toEqual(['soon']);
    expect(view.later.map((one) => one.id)).toEqual(['later']);
    expect(view.total).toBe(4);
  });

  it('summarises without making every waiting item sound like a problem', () => {
    expect(waitingSummary(view)).toBe(
      '4 waiting · 2 need attention · 1 due within 7 days · 1 later',
    );
  });

  it('is plain when there is nothing', () => {
    expect(waitingSummary(groupWaiting([], NOW, ZONE))).toBe('Nothing is waiting to be started.');
  });

  it('omits a group that is empty rather than printing a zero', () => {
    const only = groupWaiting([item({ dueAt: daysAgo(1) })], NOW, ZONE);
    expect(waitingSummary(only)).toBe('1 waiting · 1 need attention');
  });
});
