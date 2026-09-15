import { describe, expect, it } from 'vitest';

import { activeOrder, needsAttention } from '@/domain/prioritisation';
import { makeTask, NOW } from './fixtures';

const DAY = 86_400_000;
const viewerId = '00000000-0000-4000-b000-000000000001';
const context = { viewerId, now: NOW };

describe('Needs Attention (section 9.3)', () => {
  it('stays empty when nothing is genuinely exceptional', () => {
    const ordinary = [
      makeTask({ id: '1', status: 'active' }),
      makeTask({ id: '2', status: 'backlog' }),
    ];

    expect(needsAttention(ordinary, context)).toHaveLength(0);
  });

  it('v155 surfaces work whose delegated step is late, though the work itself is not', () => {
    const task = makeTask({ delegatedOpenCount: 2, delegatedOverdueCount: 1 });
    const item = needsAttention([task], context).find(
      (entry) => entry.kind === 'waiting_on_others',
    );
    expect(item, 'a late delegated step went unmentioned').toBeDefined();
    expect(item!.message).toBe('1 delegated step is past due.');
  });

  it('v155 stays quiet about delegation that is on time', () => {
    const task = makeTask({ delegatedOpenCount: 2, delegatedOverdueCount: 0 });
    expect(needsAttention([task], context).map((entry) => entry.kind)).not.toContain(
      'waiting_on_others',
    );
  });

  it('reports overdue work with a written explanation', () => {
    const task = makeTask({
      isOverdue: true,
      dueAt: new Date(NOW.getTime() - 2 * DAY).toISOString(),
    });

    const items = needsAttention([task], context);
    expect(items).toHaveLength(1);
    expect(items[0]!.kind).toBe('overdue');
    expect(items[0]!.message).toBe('Overdue by 2 days.');
  });

  it('distinguishes an overdue routine from other overdue work', () => {
    const routine = makeTask({
      workClass: 'routine_occurrence',
      focusBucket: null,
      isOverdue: true,
      dueAt: new Date(NOW.getTime() - DAY).toISOString(),
    });

    expect(needsAttention([routine], context)[0]!.kind).toBe('overdue_routine');
  });

  it('reports a paused task whose review date has passed', () => {
    const task = makeTask({
      status: 'paused',
      reviewAt: new Date(NOW.getTime() - DAY).toISOString(),
    });

    expect(needsAttention([task], context).map((item) => item.kind)).toContain(
      'paused_review_passed',
    );
  });

  it('gives every item a written message, never colour alone', () => {
    const task = makeTask({ isMandatory: true, isOverdue: true, openBarrierCount: 1 });

    for (const item of needsAttention([task], context)) {
      expect(item.message.length).toBeGreaterThan(10);
    }
  });
});

/**
 * Active had no order of its own, so it arrived however the query returned it
 * and the late work could be anywhere in the list. Automatic rather than a
 * sort control: nobody should have to configure a list to find what slipped.
 */
describe('Active ordering', () => {
  it('puts overdue first, then due today, then nearest, then undated', () => {
    const undated = makeTask({ id: 'undated', dueAt: null });
    const later = makeTask({ id: 'later', dueAt: new Date(NOW.getTime() + 9 * DAY).toISOString() });
    const soon = makeTask({ id: 'soon', dueAt: new Date(NOW.getTime() + 2 * DAY).toISOString() });
    const today = makeTask({ id: 'today', dueAt: NOW.toISOString() });
    const overdue = makeTask({
      id: 'overdue',
      isOverdue: true,
      dueAt: new Date(NOW.getTime() - DAY).toISOString(),
    });

    const ordered = activeOrder([undated, later, soon, today, overdue], NOW, 'UTC');

    expect(ordered.map((task) => task.id)).toEqual([
      'overdue',
      'today',
      'soon',
      'later',
      'undated',
    ]);
  });

  it('leaves the caller array untouched', () => {
    const first = makeTask({ id: 'first', dueAt: null });
    const second = makeTask({ id: 'second', isOverdue: true });
    const input = [first, second];

    activeOrder(input, NOW, 'UTC');

    expect(input.map((task) => task.id)).toEqual(['first', 'second']);
  });
});

describe('v160 — a late step of the owner’s own', () => {
  const at = (days: number) => new Date(NOW.getTime() + days * DAY).toISOString();

  it('surfaces a late step of the owner’s own, on work not late itself', () => {
    const task = makeTask({ ownStepOverdueCount: 1 });
    const item = needsAttention([task], context).find((entry) => entry.kind === 'step_overdue');
    expect(item?.message).toBe('A step of yours is past its date.');
  });

  it('leaves a late step to the work when the work itself is overdue', () => {
    const task = makeTask({ ownStepOverdueCount: 1, isOverdue: true, dueAt: at(-1) });
    expect(needsAttention([task], context).map((entry) => entry.kind)).not.toContain(
      'step_overdue',
    );
  });
});
