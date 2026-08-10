import { describe, expect, it } from 'vitest';

import {
  goalMeasureProgress,
  goalMonthEnd,
  goalOverallMeasureProgress,
  goalQuarterEnd,
  goalDisplayHealth,
  type GoalOverview,
  validateGoalMilestones,
  validateGoalSuccessMeasures,
} from '@/domain/goals';

describe('Goal lifecycle v50 deterministic domain rules', () => {
  it('calculates progress from success measures rather than milestone weights', () => {
    const measures = [
      {
        measureType: 'number' as const,
        targetNumeric: 20,
        currentNumeric: 10,
        currentState: null,
      },
      {
        measureType: 'percentage' as const,
        targetNumeric: 100,
        currentNumeric: 75,
        currentState: null,
      },
      {
        measureType: 'qualitative' as const,
        targetNumeric: null,
        currentNumeric: null,
        currentState: 'achieved' as const,
      },
    ];

    expect(measures.map(goalMeasureProgress)).toEqual([50, 75, 100]);
    expect(goalOverallMeasureProgress(measures)).toBe(75);
  });

  it('derives month-end and quarter-end dates without hard-coded employee dates', () => {
    expect(goalMonthEnd(new Date(2026, 1, 5))).toEqual(new Date(2026, 1, 28));
    expect(goalMonthEnd(new Date(2028, 1, 5))).toEqual(new Date(2028, 1, 29));
    expect(goalQuarterEnd(new Date(2026, 0, 2))).toEqual(new Date(2026, 2, 31));
    expect(goalQuarterEnd(new Date(2026, 10, 2))).toEqual(new Date(2026, 11, 31));
  });

  it('accepts natural-language measures and optional milestones', () => {
    expect(validateGoalSuccessMeasures([])).toMatch(/between one and ten/i);
    expect(
      validateGoalSuccessMeasures([
        {
          label: 'Audit score',
          measureType: 'number',
          targetNumeric: 0,
        },
      ]),
    ).toMatch(/greater than zero/i);
    expect(
      validateGoalSuccessMeasures([
        {
          label: 'Controls approved',
          measureType: 'qualitative',
          targetText: 'Controls are approved and operating',
        },
      ]),
    ).toBeNull();

    expect(
      validateGoalSuccessMeasures([
        {
          description: 'Complete at least four ESH inspections each month.',
          optionalTargetDate: null,
        },
      ]),
    ).toBeNull();

    expect(validateGoalMilestones([])).toBeNull();
    expect(
      validateGoalMilestones(
        Array.from({ length: 6 }, (_, index) => ({
          title: `Milestone ${index + 1}`,
          completionDefinition: 'A clear checkpoint exists',
          progressPercent: 0,
        })),
      ),
    ).toMatch(/no more than five/i);
  });

  it('keeps unresolved support visible even after a later On track check-in', () => {
    expect(
      goalDisplayHealth({
        status: 'active',
        health: 'on_track',
        openSupportCount: 1,
        isCheckinDue: false,
        isUpdateRequested: false,
      } as GoalOverview),
    ).toBe('Needs attention');
  });
});
