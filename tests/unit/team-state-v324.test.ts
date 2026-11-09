import { describe, expect, it } from 'vitest';

import {
  teamRowOrder,
  teamRowRank,
  teamRowState,
  type TeamOrderRow,
} from '@/domain/prioritisation';

/**
 * v324 — the four states a person can be in, and the order they are met in.
 *
 * A manager asked for two things by name: that a decision addressed to them is
 * told apart from work that is merely late, and that nothing overdue or
 * blocked can sort below somebody who is carrying nothing. Both are decided
 * here rather than in the card, so the roster, the sort and any later reader
 * cannot drift apart.
 */

const row = (over: Partial<TeamOrderRow> = {}): TeamOrderRow => ({
  fullName: 'A Person',
  attention: null,
  ...over,
});

const request = { reasonCode: 'support_requested', sourceType: 'barrier', kind: 'action_required' };
const goalRequest = {
  reasonCode: 'goal_support_requested',
  sourceType: 'goal',
  kind: 'action_required',
};
const lateTask = { reasonCode: 'overdue', sourceType: 'task', kind: 'exception' };
const stalled = { reasonCode: 'awareness', sourceType: 'task', kind: 'exception' };

describe('teamRowState', () => {
  it('tells a decision apart from work that is merely late', () => {
    /*
     * The distinction the roster exists to make. An overdue task is the
     * person's to catch up on; a barrier is somebody stopped, waiting for an
     * answer only their manager can give.
     */
    expect(teamRowState(row({ attention: request }))).toBe('manager_action');
    expect(teamRowState(row({ attention: goalRequest }))).toBe('manager_action');
    expect(teamRowState(row({ attention: lateTask }))).toBe('work_attention');
    expect(teamRowState(row({ attention: stalled }))).toBe('work_attention');
  });

  it('flags late work even where no attention item was raised', () => {
    /*
     * `getTeamAttention` drops a candidate that cannot say why it is there,
     * what to do and where. That gate is right, and it must not be able to
     * make overdue work disappear from the roster as a side effect.
     */
    expect(teamRowState(row({ overdueCount: 3 }))).toBe('work_attention');
    expect(teamRowState(row({ sharedStepOverdueCount: 1 }))).toBe('work_attention');
  });

  it('separates work due soon from work that is late', () => {
    expect(teamRowState(row({ dueSoonCount: 2 }))).toBe('due_soon');
    // Late outranks due soon: both are true, and only one of them is a problem.
    expect(teamRowState(row({ overdueCount: 1, dueSoonCount: 2 }))).toBe('work_attention');
  });

  it('says only that nothing is flagged, never that somebody is doing well', () => {
    /*
     * The state is a statement about what the product holds. "Steady" and "on
     * track" are judgements about a person, and no count on this screen can
     * support one: a quiet week and a week nobody recorded look identical from
     * here.
     */
    expect(teamRowState(row())).toBe('none');
    expect(teamRowState(row({ activeCount: 9, availableCount: 4 }))).toBe('none');
  });
});

describe('teamRowRank', () => {
  it('puts what the manager must answer above everything else', () => {
    expect(teamRowRank(row({ attention: request }))).toBe(1);
    expect(teamRowRank(row({ attention: goalRequest }))).toBe(1);
    /*
     * Keyed off the kind as well as the source type. The server defaults an
     * unmarked candidate to `action_required` so a forgetful branch
     * over-reports rather than hides a request; a rank that only knew about
     * barriers and goals would have sorted such a request below an overdue
     * task, which is the one thing this order must not do.
     */
    expect(teamRowRank(row({ attention: { ...request, sourceType: 'something_new' } }))).toBe(1);
  });

  it('ranks exceptions below requests and above everything quiet', () => {
    expect(teamRowRank(row({ attention: lateTask }))).toBe(2);
    expect(teamRowRank(row({ attention: stalled }))).toBe(3);
  });

  it('cannot let overdue or upcoming work fall behind a quiet row', () => {
    /*
     * The reported defect: a person with work due inside the attention window
     * raises no attention item — correctly, because nothing is wrong yet — and
     * so sorted at the bottom with people who had nothing at all.
     */
    expect(teamRowRank(row({ overdueCount: 2 }))).toBe(4);
    expect(teamRowRank(row({ dueSoonCount: 1 }))).toBe(5);
    expect(teamRowRank(row({ activeCount: 3 }))).toBe(9);
    // Nothing flagged and nothing assigned is the least urgent row there is.
    expect(teamRowRank(row())).toBe(10);
  });
});

describe('teamRowOrder', () => {
  it('meets the team worst first, against the alphabet', () => {
    /*
     * Alphabetically this is exactly the order given, so a check that happened
     * to agree with A-to-Z would prove nothing. By rank it is the reverse.
     */
    const ordered = teamRowOrder([
      row({ fullName: 'Aaron Nothing' }),
      row({ fullName: 'Bella Idle', activeCount: 0 }),
      row({ fullName: 'Cathy Busy', activeCount: 6 }),
      row({ fullName: 'Dana Soon', dueSoonCount: 1 }),
      row({ fullName: 'Eli Late', overdueCount: 4 }),
      row({ fullName: 'Fay Stalled', attention: stalled }),
      row({ fullName: 'Gita Overdue', attention: lateTask }),
      row({ fullName: 'Hana Blocked', attention: request }),
    ]);

    expect(ordered.map((person) => person.fullName)).toEqual([
      'Hana Blocked',
      'Gita Overdue',
      'Fay Stalled',
      'Eli Late',
      'Dana Soon',
      'Cathy Busy',
      'Aaron Nothing',
      'Bella Idle',
    ]);
  });
});
