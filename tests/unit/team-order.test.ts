import { describe, expect, it } from 'vitest';

import { teamRowOrder, teamRowRank, type TeamOrderRow } from '@/domain/prioritisation';

/**
 * The order a manager meets their team in.
 *
 * Tested here rather than end to end, deliberately. In the seed every person
 * who needs something also sorts early alphabetically, so exception-first and
 * A-to-Z produce an identical list — a browser check would have passed whether
 * the rule existed or not. These rows are built so the two orders disagree.
 */

const row = (fullName: string, attention: TeamOrderRow['attention'] = null): TeamOrderRow => ({
  fullName,
  attention,
});

const workloadReview = { reasonCode: 'workload_review', sourceType: 'focus_exception' };
const overdue = { reasonCode: 'overdue', sourceType: 'task' };
const overdueRoutine = { reasonCode: 'overdue', sourceType: 'routine_occurrence' };
const barrier = { reasonCode: 'support_requested', sourceType: 'barrier' };
const goal = { reasonCode: 'goal_support_requested', sourceType: 'goal' };
const awareness = { reasonCode: 'awareness', sourceType: 'task' };

describe('teamRowRank', () => {
  it('ranks by what the row asks of the reader', () => {
    expect(teamRowRank(row('a', workloadReview))).toBe(0);
    expect(teamRowRank(row('a', overdue))).toBe(1);
    expect(teamRowRank(row('a', overdueRoutine))).toBe(1);
    expect(teamRowRank(row('a', barrier))).toBe(2);
    expect(teamRowRank(row('a', goal))).toBe(2);
    // Worth knowing, but nothing is being asked.
    expect(teamRowRank(row('a', awareness))).toBe(3);
    expect(teamRowRank(row('a'))).toBe(9);
  });
});

describe('teamRowOrder', () => {
  it('puts exceptions above people who are fine, against the alphabet', () => {
    /*
     * Alphabetically this is exactly the order given. By rank it is the
     * reverse, which is the whole point: nobody should have to filter, or
     * scroll past four healthy people, to discover a problem.
     */
    const ordered = teamRowOrder([
      row('Aaron Healthy'),
      row('Bella Awareness', awareness),
      row('Cathy Barrier', barrier),
      row('Dan Overdue', overdue),
      row('Erin Workload', workloadReview),
    ]);

    expect(ordered.map((person) => person.fullName)).toEqual([
      'Erin Workload',
      'Dan Overdue',
      'Cathy Barrier',
      'Bella Awareness',
      'Aaron Healthy',
    ]);
  });

  it('is alphabetical within a rank, so the list does not shuffle between visits', () => {
    const ordered = teamRowOrder([
      row('Zara Overdue', overdue),
      row('Adam Overdue', overdueRoutine),
      row('Mia Overdue', overdue),
    ]);

    expect(ordered.map((person) => person.fullName)).toEqual([
      'Adam Overdue',
      'Mia Overdue',
      'Zara Overdue',
    ]);
  });

  it('does not modify the array it was given', () => {
    const rows = [row('Zoe Healthy'), row('Amy Overdue', overdue)];
    const ordered = teamRowOrder(rows);
    expect(rows.map((person) => person.fullName)).toEqual(['Zoe Healthy', 'Amy Overdue']);
    expect(ordered[0]!.fullName).toBe('Amy Overdue');
  });
});
