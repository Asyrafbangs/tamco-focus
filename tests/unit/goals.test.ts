import { describe, expect, it } from 'vitest';

import {
  canActivateGoalWeight,
  formalGoalWeightSummary,
  goalProgressDifference,
  isFivePercentStep,
  matchesGoalLifecycle,
  validateGoalMilestones,
  milestoneDerivedProgress,
} from '@/domain/goals';

describe('Goal v34 lifecycle and formal weighting', () => {
  it('maps discussion and completed states into their approved views', () => {
    expect(matchesGoalLifecycle('active', 'active')).toBe(true);
    expect(matchesGoalLifecycle('draft', 'discussion')).toBe(true);
    expect(matchesGoalLifecycle('pending_discussion', 'discussion')).toBe(true);
    expect(matchesGoalLifecycle('completed', 'completed')).toBe(true);
    expect(matchesGoalLifecycle('closed', 'completed')).toBe(true);
    expect(matchesGoalLifecycle('cancelled', 'all')).toBe(false);
  });

  it('counts only active Goals in the formal allocation', () => {
    expect(
      formalGoalWeightSummary([
        { status: 'active', weightPercent: 55 },
        { status: 'active', weightPercent: 25 },
        { status: 'pending_discussion', weightPercent: 40 },
        { status: 'completed', weightPercent: 20 },
      ]),
    ).toEqual({ allocated: 80, remaining: 20, over: 0, state: 'under' });
  });

  it('blocks activation above one hundred but allows the exact formal total', () => {
    expect(canActivateGoalWeight(75, 25)).toBe(true);
    expect(canActivateGoalWeight(75, 30)).toBe(false);
  });
});

describe('Goal progress', () => {
  it('keeps the approved Safety Digitalisation reported and derived values independent', () => {
    const derived = milestoneDerivedProgress([
      { weightPercent: 20, progressPercent: 60 },
      { weightPercent: 20, progressPercent: 25 },
      { weightPercent: 20, progressPercent: 10 },
      { weightPercent: 20, progressPercent: 0 },
      { weightPercent: 20, progressPercent: 0 },
    ]);

    // Plain average of 60, 25, 10, 0, 0.
    expect(derived).toBe(19);
    expect(goalProgressDifference(20, derived)).toBe(1);
  });

  it('ignores milestone weight entirely — weighting belongs to the goal', () => {
    // Identical completion, wildly different weights: the result must not move.
    const even = milestoneDerivedProgress([
      { weightPercent: 50, progressPercent: 100 },
      { weightPercent: 50, progressPercent: 0 },
    ]);
    const lopsided = milestoneDerivedProgress([
      { weightPercent: 90, progressPercent: 100 },
      { weightPercent: 10, progressPercent: 0 },
    ]);

    expect(even).toBe(50);
    expect(lopsided).toBe(50);
  });

  it('returns zero when a goal has no milestones yet', () => {
    expect(milestoneDerivedProgress([])).toBe(0);
  });

  it('accepts only five-percent progress increments', () => {
    expect(isFivePercentStep(0)).toBe(true);
    expect(isFivePercentStep(65)).toBe(true);
    expect(isFivePercentStep(100)).toBe(true);
    expect(isFivePercentStep(63)).toBe(false);
    expect(isFivePercentStep(105)).toBe(false);
  });
});

describe('Goal milestone structure', () => {
  const milestone = {
    title: 'Test the solution with users',
    completionDefinition: 'Three users complete the workflow and feedback is recorded.',
    progressPercent: 0,
  };

  it('accepts even weighting when all weights are omitted', () => {
    expect(
      validateGoalMilestones([milestone, { ...milestone, title: 'Record lessons' }]),
    ).toBeNull();
  });

  it('requires complete weights that total one hundred', () => {
    expect(
      validateGoalMilestones([
        { ...milestone, weightPercent: 70 },
        { ...milestone, title: 'Record lessons' },
      ]),
    ).toMatch(/every milestone weight/i);
    expect(
      validateGoalMilestones([
        { ...milestone, weightPercent: 70 },
        { ...milestone, title: 'Record lessons', weightPercent: 20 },
      ]),
    ).toMatch(/total 100/i);
  });

  it('rejects blank definitions and non-step progress', () => {
    expect(validateGoalMilestones([{ ...milestone, completionDefinition: ' ' }])).toMatch(
      /definition of done/i,
    );
    expect(validateGoalMilestones([{ ...milestone, progressPercent: 12 }])).toMatch(
      /five-percent/i,
    );
  });
});
