/**
 * Domain vocabulary.
 *
 * These types mirror the database enumerations one-for-one. They are hand-
 * written rather than taken from the generated `database.types.ts` because the
 * domain layer is pure and must be unit-testable without a database, and
 * because `npm run db:types:check` verifies the two stay in agreement.
 *
 * Terms follow MASTER_PRODUCT_SPEC.md section 5 exactly.
 */

export type AppRole = 'team_member' | 'manager' | 'administrator';

export type AccountStatus = 'active' | 'deactivated';

export type VisibilityMode = 'specific_only' | 'direct_reports_plus' | 'none';

export type PersonalSummaryMode = 'off' | 'focused' | 'standard';
export type TeamSummaryMode = 'off' | 'leadership' | 'detailed';

/** Section 6.1. `cancelled` is a terminal archived outcome, not a working column. */
export type TaskStatus = 'backlog' | 'active' | 'paused' | 'completed' | 'cancelled';

/** Section 7.1 — the three buckets that carry a focus target. */
export type FocusBucket = 'major' | 'operational' | 'self_development';

export type WorkClass =
  | 'quick_action'
  | 'major_project'
  | 'operational_action'
  | 'self_development'
  | 'routine_occurrence'
  | 'collaborative_contribution';

export type WorkOrigin =
  | 'manager_assigned'
  | 'self_initiated'
  | 'routine_generated'
  | 'finding_generated'
  | 'collaborative'
  | 'meeting_generated'
  | 'system_generated';

export type UrgencyLevel = 'normal' | 'high' | 'critical';

export type EvidenceRule = 'not_required' | 'optional' | 'required';

/** Section 7.4 — the approved reason list, in the approved order. */
export type ActivationReason =
  | 'urgent_deadline'
  | 'workload_peak'
  | 'cannot_move_out'
  | 'external_request'
  | 'dependency'
  | 'other';

export type RelationType = 'before' | 'after' | 'related';

export type BarrierImpact =
  'may_delay' | 'cannot_continue' | 'safety_or_compliance_risk' | 'management_decision_required';

export type ReviewDecision = 'accepted' | 'changes_requested';
export type ReviewStatus = 'pending' | 'decided' | 'not_required';

export type ChecklistItemState = 'waiting' | 'ready' | 'completed';

export type CaptureDestination =
  | 'quick_action'
  | 'operational_available_work'
  | 'routine_template_request'
  | 'self_development_plan'
  | 'collaborative_contribution'
  | 'major_project_request'
  | 'mandatory_operational_action';

export type CaptureTiming = 'today' | 'this_week' | 'choose_date' | 'no_date';

/**
 * The shape the interface reads, mirroring the `task_overview` view.
 *
 * Timestamps arrive as ISO strings from PostgREST and are parsed at the edge of
 * the domain layer, never re-derived downstream.
 */
export interface TaskOverview {
  id: string;
  title: string;
  description: string | null;

  status: TaskStatus;
  workClass: WorkClass;
  focusBucket: FocusBucket | null;
  origin: WorkOrigin;
  urgency: UrgencyLevel;
  isMandatory: boolean;

  progressPercent: number;
  overFocusTarget: boolean;
  activationReasonCode: ActivationReason | null;
  activationReasonNote: string | null;

  reviewStatus: ReviewStatus;
  reviewerId: string | null;
  version: number;

  primaryOwnerId: string;
  ownerName: string;
  ownerEmployeeId: string;

  /**
   * v40 — who directed this work, when it was not self-initiated. Displayed as
   * "Assigned by Izzul". Deliberately never an ordering input: an overdue
   * safety action outranks an ordinary manager-assigned task (v40 section 4).
   */
  assignedById: string | null;
  assignedByName: string | null;
  /** Shared by the independent tasks created from one multi-person assignment. */
  assignmentBatchId: string | null;
  /** v40 section 12 — the deterministic rule that chose this work class. */
  classificationRuleCode: string | null;
  classificationRuleText: string | null;

  routineTemplateId: string | null;
  occurrenceDate: string | null;

  createdAt: string;
  stateEnteredAt: string;
  lastMeaningfulUpdateAt: string;
  dueAt: string | null;
  dueIsDateOnly: boolean;
  reviewAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;

  /** Computed in SQL so it can be indexed and filtered at scale. */
  isOverdue: boolean;
  isStale: boolean;

  openBarrierCount: number;
  checklistTotal: number;
  checklistCompleted: number;
  checklistReady: number;
  missingEvidenceCount: number;
  attachmentCount: number;
  collaboratorCount: number;
}

/** Section 7 — a bucket's count against its recommended target. */
export interface FocusSummary {
  userId: string;
  bucket: FocusBucket;
  activeCount: number;
  recommendedTarget: number;
  isOverTarget: boolean;
  overTargetSince: string | null;
}

/**
 * The uniform result shape every transactional procedure returns.
 *
 * Callers branch on `code`, never on `message` text, so wording can change
 * without breaking behaviour.
 */
export type OperationResult<T = unknown> =
  | ({ ok: true; code: string; message?: string } & Partial<T>)
  | {
      ok: false;
      code: OperationErrorCode;
      message: string;
      detail?: Record<string, unknown>;
    };

export type OperationErrorCode =
  | 'not_authorised'
  | 'not_found'
  | 'invalid_state'
  | 'invalid_owner'
  | 'version_conflict'
  | 'reason_required'
  | 'reason_note_required'
  | 'restart_information_required'
  | 'evidence_missing'
  | 'validation_failed'
  | 'waiting_on_prerequisite'
  | 'undo_window_expired'
  | 'already_reversed'
  | 'not_reversible'
  | 'confirmation_mismatch'
  | 'retained_history_exists'
  | 'open_work_requires_reassignment'
  | 'employee_id_taken'
  | 'email_taken'
  | 'duplicate_identity'
  | 'invalid_target'
  | 'unexpected_error';

/** Human-readable labels for the approved activation reasons (section 7.4). */
export const ACTIVATION_REASON_LABELS: Record<ActivationReason, string> = {
  urgent_deadline: 'Urgent deadline or commitment',
  workload_peak: 'Temporary workload peak',
  cannot_move_out: 'Current work cannot reasonably be moved out',
  external_request: 'Manager, customer, or regulatory request',
  dependency: 'Dependency requires both tasks to remain active',
  other: 'Other',
};

/** Section 5 — approved bucket wording. Never "limit" or "quota". */
export const FOCUS_BUCKET_LABELS: Record<FocusBucket, string> = {
  major: 'Major Project',
  operational: 'Operational Actions',
  self_development: 'Self-Development Plan',
};

/**
 * The short form, for sentences (v48 §15).
 *
 * "Amer is at 6/5 Operational" reads; "6/5 Operational Actions" does not. The
 * full labels above remain the ones used for headings and pickers.
 */
export const FOCUS_BUCKET_WORD: Record<FocusBucket, string> = {
  major: 'Major',
  operational: 'Operational',
  self_development: 'Development',
};

export const WORK_CLASS_LABELS: Record<WorkClass, string> = {
  quick_action: 'Quick Action',
  major_project: 'Major Project',
  operational_action: 'Operational Action',
  self_development: 'Self-Development Plan',
  routine_occurrence: 'Routine occurrence',
  collaborative_contribution: 'Collaborative Contribution',
};

/**
 * The same classes, in one word.
 *
 * A row in a work list is read at a glance, and "Operational Action" spends
 * two words saying what "Operational" says in one. Next to a title, in a list
 * where every item is already work, "Action", "Project" and "Plan" carry no
 * information — they just repeat on every row. The long labels stay wherever
 * the class is being chosen or explained rather than recognised.
 */
export const WORK_CLASS_SHORT_LABELS: Record<WorkClass, string> = {
  quick_action: 'Quick',
  major_project: 'Major',
  operational_action: 'Operational',
  self_development: 'Development',
  routine_occurrence: 'Routine',
  collaborative_contribution: 'Contribution',
};

/** Section 5 — `backlog` is presented to users as Available Work. */
export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  // v41 section 17 — `backlog` is persisted; "Available" is what people read.
  // The label matches the Focus tab exactly so the same state is never called
  // two different things on two screens.
  backlog: 'Available',
  active: 'Active',
  paused: 'Paused',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

export const BARRIER_IMPACT_LABELS: Record<BarrierImpact, string> = {
  may_delay: 'Task may be delayed',
  cannot_continue: 'Work cannot continue',
  safety_or_compliance_risk: 'Safety or compliance risk',
  management_decision_required: 'Management decision required',
};
