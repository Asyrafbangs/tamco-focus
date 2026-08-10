export type GoalStatus =
  'draft' | 'pending_discussion' | 'active' | 'completed' | 'closed' | 'cancelled';

export type GoalHealth =
  'on_track' | 'at_risk' | 'off_track' | 'need_attention' | 'support_requested' | 'completed';
export type GoalVersionStatus = 'pending' | 'active' | 'superseded' | 'rejected';
export type GoalCategory = 'performance' | 'improvement' | 'development';
export type GoalMeasureType = 'number' | 'percentage' | 'qualitative';
export type GoalMeasureState = 'not_started' | 'progressing' | 'achieved' | 'exceeded';
export type GoalCheckinType = 'monthly' | 'quarterly' | 'year_end';
export type GoalCheckinStatus = 'draft' | 'submitted' | 'agreed' | 'finalized';

export interface GoalMilestoneProgress {
  weightPercent: number;
  progressPercent: number;
}

export interface GoalOverview {
  id: string;
  ownerId: string;
  ownerName: string;
  ownerEmployeeId: string;
  managerId: string | null;
  managerName: string | null;
  title: string;
  category: GoalCategory;
  status: GoalStatus;
  health: GoalHealth;
  reportedProgress: number;
  derivedProgress: number;
  targetDate: string;
  weightPercent: number;
  version: number;
  activeVersionId: string | null;
  pendingVersionId: string | null;
  activeVersionNumber: number | null;
  expectedResult: string | null;
  successMeasure: string | null;
  employeeApproach: string | null;
  supportAgreed: string | null;
  dependencies: string | null;
  baseline: string | null;
  purpose: string | null;
  currentMilestoneId: string | null;
  currentMilestoneTitle: string | null;
  currentMilestoneProgress: number | null;
  nextMilestoneTitle: string | null;
  openSupportCount: number;
  needsAttention: boolean;
  attentionReason: string | null;
  isCheckinDue: boolean;
  isUpdateRequested: boolean;
  isTargetApproaching: boolean;
  hasRecentMilestoneCompletion: boolean;
  lastMeaningfulUpdateAt: string;
  checkinDueAt: string | null;
  updateRequestedAt: string | null;
  agreedAt: string | null;
  completedAt: string | null;
  closedAt: string | null;
  createdAt: string;
  successMeasureCount: number;
  measureProgress: number;
  nextMonthlyCheckinDate: string;
  isMonthlyCheckinDue: boolean;
  lastMonthlyCheckinAt: string | null;
  lastMonthlyCheckinStatus: GoalHealth | null;
  nextQuarterlyCheckinDate: string;
  isQuarterlyCheckinDue: boolean;
  quarterlyRequiresManagerAction: boolean;
  managerNeedsAttention: boolean;
  managerAttentionReason: string | null;
  currentQuarterlyCheckinId: string | null;
  currentQuarterlyStatus: GoalCheckinStatus | null;
  latestYearEndResult: string | null;
  latestYearEndStatus: GoalCheckinStatus | null;
}

export interface GoalTeamSummary {
  userId: string;
  fullName: string;
  employeeId: string;
  activeGoalCount: number;
  attentionCount: number;
  supportRequestCount: number;
  checkinDueCount: number;
  weightedProgress: number;
  lastGoalUpdateAt: string | null;
  quarterlyActionCount: number;
  quarterlyDueCount: number;
}

export const GOAL_STATUS_LABELS: Record<GoalStatus, string> = {
  draft: 'Draft',
  pending_discussion: 'For discussion',
  active: 'Active',
  completed: 'Completed',
  closed: 'Closed',
  cancelled: 'Cancelled',
};

export const GOAL_HEALTH_LABELS: Record<GoalHealth, string> = {
  on_track: 'On track',
  at_risk: 'At risk',
  off_track: 'Off track',
  need_attention: 'Needs attention',
  support_requested: 'Support requested',
  completed: 'Completed',
};

export const GOAL_LIFECYCLE_VIEWS = ['active', 'draft', 'completed'] as const;
export type GoalLifecycleView = (typeof GOAL_LIFECYCLE_VIEWS)[number];

export const GOAL_LIFECYCLE_LABELS: Record<GoalLifecycleView, string> = {
  active: 'Active',
  draft: 'Draft',
  completed: 'Completed',
};

export function matchesGoalLifecycle(status: GoalStatus, view: GoalLifecycleView): boolean {
  if (view === 'active') return status === 'active';
  if (view === 'draft') return status === 'draft' || status === 'pending_discussion';
  return status === 'completed' || status === 'closed';
}

export interface FormalGoalWeightSummary {
  allocated: number;
  remaining: number;
  over: number;
  state: 'complete' | 'under' | 'over';
}

export function formalGoalWeightSummary(
  goals: readonly Pick<GoalOverview, 'status' | 'weightPercent'>[],
): FormalGoalWeightSummary {
  const allocated = goals
    .filter((goal) => goal.status === 'active')
    .reduce((total, goal) => total + goal.weightPercent, 0);
  return {
    allocated,
    remaining: Math.max(0, 100 - allocated),
    over: Math.max(0, allocated - 100),
    state: allocated === 100 ? 'complete' : allocated > 100 ? 'over' : 'under',
  };
}

export function canActivateGoalWeight(
  currentActiveWeight: number,
  proposedWeight: number,
): boolean {
  return currentActiveWeight + proposedWeight <= 100;
}

export function goalDisplayHealth(
  goal: GoalOverview,
): 'On track' | 'At risk' | 'Off track' | 'Needs attention' | 'Update due' | 'Completed' {
  if (goal.status === 'completed' || goal.status === 'closed' || goal.health === 'completed') {
    return 'Completed';
  }
  if (goal.openSupportCount > 0 || goal.health === 'support_requested') {
    return 'Needs attention';
  }
  if (goal.health === 'off_track') return 'Off track';
  if (goal.health === 'at_risk') return 'At risk';
  if (goal.health === 'need_attention') return 'Needs attention';
  if (goal.isCheckinDue || goal.isUpdateRequested) return 'Update due';
  return 'On track';
}

export function isFivePercentStep(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 100 && value % 5 === 0;
}

/**
 * Milestone-derived progress: the plain average of milestone completion.
 *
 * Weighting belongs to the GOAL, not to its milestones — a milestone records
 * how complete it is, a goal records how much it counts towards the formal set.
 * This value stays separate from the employee's reported overall progress, so
 * the two can be compared rather than one silently overwriting the other.
 */
export function milestoneDerivedProgress(milestones: readonly GoalMilestoneProgress[]): number {
  if (milestones.length === 0) return 0;
  const total = milestones.reduce((sum, milestone) => sum + milestone.progressPercent, 0);
  return Math.round(total / milestones.length);
}

export interface GoalMilestoneDraft {
  title: string;
  completionDefinition: string;
  weightPercent?: number | null;
  progressPercent?: number;
}

export function validateGoalMilestones(milestones: readonly GoalMilestoneDraft[]): string | null {
  if (milestones.length > 5) {
    return 'Add no more than five optional milestones.';
  }
  if (
    milestones.some(
      (milestone) =>
        milestone.title.trim().length === 0 || milestone.completionDefinition.trim().length === 0,
    )
  ) {
    return 'Every milestone needs a result and a definition of done.';
  }
  if (milestones.some((milestone) => !isFivePercentStep(milestone.progressPercent ?? 0))) {
    return 'Milestone progress must use five-percent increments.';
  }
  const supplied = milestones.filter((milestone) => milestone.weightPercent != null);
  if (supplied.length !== 0 && supplied.length !== milestones.length) {
    return 'Provide every milestone weight or leave every weight blank.';
  }
  if (
    supplied.length > 0 &&
    supplied.length === milestones.length &&
    supplied.reduce((total, milestone) => total + Number(milestone.weightPercent), 0) !== 100
  ) {
    return 'Milestone weights must total 100%.';
  }
  return null;
}

export function goalProgressDifference(reported: number, derived: number): number {
  return Math.abs(reported - derived);
}

/** My Day shows a Goal only when the person can make a useful decision now. */
export function isMeaningfulGoalException(goal: GoalOverview): boolean {
  return (
    goal.status === 'active' &&
    (goal.isMonthlyCheckinDue || goal.isUpdateRequested || goal.managerNeedsAttention)
  );
}

export function goalExceptionMessage(goal: GoalOverview): string {
  if (goal.openSupportCount > 0) return 'Support is requested';
  if (goal.isUpdateRequested) return 'Your manager requested an update';
  if (goal.quarterlyRequiresManagerAction) return 'Quarterly discussion is ready';
  if (goal.isMonthlyCheckinDue) return 'Monthly check-in is due';
  return goal.managerAttentionReason ?? goal.attentionReason ?? 'Needs attention';
}

export interface StructuredGoalSuccessMeasureDraft {
  label: string;
  measureType: GoalMeasureType;
  targetNumeric?: number | null;
  currentNumeric?: number | null;
  unit?: string | null;
  period?: string | null;
  targetText?: string | null;
}

export interface LeanGoalSuccessMeasureDraft {
  description: string;
  optionalTargetDate?: string | null;
}

export type GoalSuccessMeasureDraft =
  StructuredGoalSuccessMeasureDraft | LeanGoalSuccessMeasureDraft;

export function validateGoalSuccessMeasures(
  measures: readonly GoalSuccessMeasureDraft[],
): string | null {
  if (measures.length < 1 || measures.length > 10) {
    return 'Add between one and ten success measures.';
  }
  for (const measure of measures) {
    if ('description' in measure) {
      if (!measure.description.trim()) return 'Every success measure needs a clear result.';
      if (
        measure.optionalTargetDate != null &&
        !/^\d{4}-\d{2}-\d{2}$/.test(measure.optionalTargetDate)
      ) {
        return 'A different success-measure due date must be a valid date.';
      }
      continue;
    }
    if (!measure.label.trim()) return 'Every success measure needs a clear result.';
    if (measure.measureType === 'qualitative') {
      if (!(measure.targetText?.trim() || measure.label.trim())) {
        return 'Qualitative measures need a clear target state.';
      }
      continue;
    }
    if (measure.targetNumeric == null || measure.targetNumeric <= 0) {
      return 'Numeric measures need a target greater than zero.';
    }
    if (
      measure.measureType === 'percentage' &&
      (measure.targetNumeric > 100 ||
        (measure.currentNumeric != null &&
          (measure.currentNumeric < 0 || measure.currentNumeric > 100)))
    ) {
      return 'Percentage measures must stay between zero and 100.';
    }
  }
  return null;
}

export function goalMeasureProgress(measure: {
  measureType: GoalMeasureType;
  targetNumeric: number | null;
  currentNumeric: number | null;
  currentState: GoalMeasureState | null;
}): number {
  if (measure.measureType === 'qualitative') {
    if (measure.currentState === 'achieved' || measure.currentState === 'exceeded') return 100;
    return measure.currentState === 'progressing' ? 50 : 0;
  }
  if (measure.measureType === 'percentage') {
    return Math.round(Math.min(100, Math.max(0, measure.currentNumeric ?? 0)));
  }
  if (!measure.targetNumeric || measure.targetNumeric <= 0) return 0;
  return Math.round(
    Math.min(100, Math.max(0, ((measure.currentNumeric ?? 0) / measure.targetNumeric) * 100)),
  );
}

export function goalOverallMeasureProgress(
  measures: readonly Parameters<typeof goalMeasureProgress>[0][],
): number {
  if (!measures.length) return 0;
  return Math.round(
    measures.reduce((total, measure) => total + goalMeasureProgress(measure), 0) / measures.length,
  );
}

export function goalMonthEnd(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth() + 1, 0);
}

export function goalQuarterEnd(value: Date): Date {
  const quarterEndMonth = Math.floor(value.getMonth() / 3) * 3 + 3;
  return new Date(value.getFullYear(), quarterEndMonth, 0);
}
