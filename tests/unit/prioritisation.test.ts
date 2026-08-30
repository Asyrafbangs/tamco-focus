import { describe, expect, it } from 'vitest';

import {
  activeOrder,
  comingUp,
  needsAttention,
  rankTasks,
  startHere,
  todayList,
} from '@/domain/prioritisation';
import { makeTask, NOW } from './fixtures';

const DAY = 86_400_000;
const viewerId = '00000000-0000-4000-b000-000000000001';
const context = { viewerId, now: NOW };

describe('Start Here ordering (section 9.4)', () => {
  it('puts mandatory safety work above everything else', () => {
    const mandatory = makeTask({ id: 'mandatory', isMandatory: true });
    const overdue = makeTask({
      id: 'overdue',
      isOverdue: true,
      dueAt: new Date(NOW.getTime() - 3 * DAY).toISOString(),
    });

    expect(startHere([overdue, mandatory], context)!.task.id).toBe('mandatory');
  });

  it('puts overdue work above work merely due today', () => {
    const overdue = makeTask({
      id: 'overdue',
      isOverdue: true,
      dueAt: new Date(NOW.getTime() - DAY).toISOString(),
    });
    const dueToday = makeTask({ id: 'today', dueAt: NOW.toISOString() });

    expect(startHere([dueToday, overdue], context)!.task.id).toBe('overdue');
  });

  it('treats an open barrier as needing attention alongside overdue work', () => {
    const blocked = makeTask({ id: 'blocked', openBarrierCount: 1 });
    const active = makeTask({ id: 'active' });

    expect(startHere([active, blocked], context)!.task.id).toBe('blocked');
  });

  /*
   * "Blocked and needing this person" — the second half is the operative one.
   *
   * A barrier ranks a task highly because a blockage is urgent, which holds
   * only while the viewer is the one who can clear it. Where somebody else
   * owes the answer, recommending they "start" it asks them to do the single
   * thing they cannot, and pushes work they could actually move below it.
   */
  it('does not recommend work that is waiting on somebody else', () => {
    const blockedOnOthers = makeTask({ id: 'theirs', openBarrierCount: 1 });
    const active = makeTask({ id: 'mine', status: 'active' });

    const recommendation = startHere([blockedOnOthers, active], {
      ...context,
      awaitingOthersTaskIds: new Set(['theirs']),
    });

    expect(recommendation!.task.id).toBe('mine');
  });

  it('still recommends blocked work when the viewer is the one who can clear it', () => {
    const blocked = makeTask({ id: 'blocked', openBarrierCount: 1 });
    const active = makeTask({ id: 'active', status: 'active' });

    expect(
      startHere([active, blocked], { ...context, awaitingOthersTaskIds: new Set() })!.task.id,
    ).toBe('blocked');
  });

  /*
   * Overdue is overdue whoever is holding it up, so it keeps its band — but it
   * is still not what to recommend starting. Having something to fall back to
   * matters more than the ranking here: a page with nothing recommended is
   * worse than one recommending the only thing there is.
   */
  it('falls back to waiting work when there is nothing else to do', () => {
    const onlyTask = makeTask({ id: 'only', openBarrierCount: 1 });

    const recommendation = startHere([onlyTask], {
      ...context,
      awaitingOthersTaskIds: new Set(['only']),
    });

    expect(recommendation!.task.id).toBe('only');
  });

  it('ranks a ready handoff above ordinary active work', () => {
    const handoff = makeTask({ id: 'handoff', status: 'backlog' });
    const active = makeTask({ id: 'active', status: 'active' });

    const ranked = rankTasks([active, handoff], {
      ...context,
      handoffReadyTaskIds: new Set(['handoff']),
    });

    expect(ranked[0]!.task.id).toBe('handoff');
  });

  it('excludes completed and cancelled work entirely', () => {
    const done = makeTask({ id: 'done', status: 'completed', completedAt: NOW.toISOString() });
    const cancelled = makeTask({
      id: 'cancelled',
      status: 'cancelled',
      cancelledAt: NOW.toISOString(),
    });

    expect(rankTasks([done, cancelled], context)).toHaveLength(0);
  });
});

describe('tie-breaking within a band (section 9.4)', () => {
  it('prefers the earliest exact due time', () => {
    const later = makeTask({
      id: 'later',
      dueAt: new Date(NOW.getTime() + 4 * 3_600_000).toISOString(),
    });
    const sooner = makeTask({
      id: 'sooner',
      dueAt: new Date(NOW.getTime() + 1 * 3_600_000).toISOString(),
    });

    const ranked = rankTasks([later, sooner], context);
    expect(ranked.map((entry) => entry.task.id)).toEqual(['sooner', 'later']);
  });

  it('prefers Critical over High over Normal at the same due time', () => {
    const due = new Date(NOW.getTime() + 3_600_000).toISOString();

    const ranked = rankTasks(
      [
        makeTask({ id: 'normal', urgency: 'normal', dueAt: due }),
        makeTask({ id: 'critical', urgency: 'critical', dueAt: due }),
        makeTask({ id: 'high', urgency: 'high', dueAt: due }),
      ],
      context,
    );

    expect(ranked.map((entry) => entry.task.id)).toEqual(['critical', 'high', 'normal']);
  });

  it('prefers work blocking the most other work', () => {
    const due = new Date(NOW.getTime() + 3_600_000).toISOString();

    const ranked = rankTasks(
      [makeTask({ id: 'blocks-one', dueAt: due }), makeTask({ id: 'blocks-three', dueAt: due })],
      {
        ...context,
        blockingCounts: new Map([
          ['blocks-one', 1],
          ['blocks-three', 3],
        ]),
      },
    );

    expect(ranked[0]!.task.id).toBe('blocks-three');
  });

  it('falls back to the least recently updated', () => {
    const due = new Date(NOW.getTime() + 3_600_000).toISOString();

    const ranked = rankTasks(
      [
        makeTask({
          id: 'fresh',
          dueAt: due,
          lastMeaningfulUpdateAt: new Date(NOW.getTime() - DAY).toISOString(),
        }),
        makeTask({
          id: 'neglected',
          dueAt: due,
          lastMeaningfulUpdateAt: new Date(NOW.getTime() - 12 * DAY).toISOString(),
        }),
      ],
      context,
    );

    expect(ranked[0]!.task.id).toBe('neglected');
  });

  it('produces a stable order for otherwise identical work', () => {
    const due = new Date(NOW.getTime() + 3_600_000).toISOString();
    const shared = { dueAt: due, lastMeaningfulUpdateAt: NOW.toISOString() };

    const tasks = [makeTask({ id: 'bbb', ...shared }), makeTask({ id: 'aaa', ...shared })];

    expect(rankTasks(tasks, context).map((entry) => entry.task.id)).toEqual(
      rankTasks([...tasks].reverse(), context).map((entry) => entry.task.id),
    );
  });
});

describe('Why this? (section 9.5)', () => {
  it('explains an overdue recommendation in days', () => {
    const task = makeTask({
      isOverdue: true,
      dueAt: new Date(NOW.getTime() - 3 * DAY).toISOString(),
    });

    expect(startHere([task], context)!.why).toBe('Selected because this is overdue by 3 days.');
  });

  it('explains a due-today recommendation', () => {
    const task = makeTask({ dueAt: new Date(NOW.getTime() + 3_600_000).toISOString() });

    expect(startHere([task], context)!.why).toContain('due today');
  });

  // v83 retired Next Action. Active work is recommended on the strength of
  // being active; what remains inside it is the Steps list, not a sentence
  // maintained alongside it.
  it('explains a recommendation of work already active', () => {
    const task = makeTask({ status: 'active' });

    expect(startHere([task], context)!.why).toContain('already have active');
  });

  it('always gives a plain-language sentence', () => {
    const tasks = [
      makeTask({ id: '1', isMandatory: true }),
      makeTask({ id: '2', openBarrierCount: 1 }),
      makeTask({ id: '3', status: 'active' }),
    ];

    for (const entry of rankTasks(tasks, context)) {
      expect(entry.why.startsWith('Selected because')).toBe(true);
      expect(entry.why.endsWith('.')).toBe(true);
    }
  });
});

describe('Today list (section 9.6)', () => {
  it('caps the list at the configured maximum', () => {
    const tasks = Array.from({ length: 12 }, (_, index) =>
      makeTask({ id: `task-${index}`, status: 'active' }),
    );

    expect(todayList(tasks, context, 5)).toHaveLength(5);
    expect(todayList(tasks, context, 3)).toHaveLength(3);
  });
});

describe('Needs Attention (section 9.3)', () => {
  it('stays empty when nothing is genuinely exceptional', () => {
    const ordinary = [
      makeTask({ id: '1', status: 'active' }),
      makeTask({ id: '2', status: 'backlog' }),
    ];

    expect(needsAttention(ordinary, context)).toHaveLength(0);
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

describe('Coming Up (section 9.7)', () => {
  it('shows only the nearest few commitments inside the window', () => {
    const tasks = [
      makeTask({ id: 'in-2d', dueAt: new Date(NOW.getTime() + 2 * DAY).toISOString() }),
      makeTask({ id: 'in-1d', dueAt: new Date(NOW.getTime() + 1 * DAY).toISOString() }),
      makeTask({ id: 'in-3d', dueAt: new Date(NOW.getTime() + 3 * DAY).toISOString() }),
      makeTask({ id: 'in-30d', dueAt: new Date(NOW.getTime() + 30 * DAY).toISOString() }),
    ];

    const upcoming = comingUp(tasks, { ...context, upcomingWindowDays: 7 }, 3);

    expect(upcoming.map((task) => task.id)).toEqual(['in-1d', 'in-2d', 'in-3d']);
  });

  it('excludes work that is already overdue', () => {
    const overdue = makeTask({ dueAt: new Date(NOW.getTime() - DAY).toISOString() });

    expect(comingUp([overdue], context)).toHaveLength(0);
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
