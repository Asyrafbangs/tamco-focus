import type { WorkPurpose } from './purpose';

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

/**
 * What a completion requires as proof, decided when the work is set up.
 *
 * Three values, deliberately. `file_or_note` exists because the alternative is
 * worse: a rule that demands an upload for every completion gets one — a blank
 * document, a duplicate photograph, a screenshot of nothing. Requiring proof
 * while accepting a written result where a file genuinely cannot exist keeps
 * the evidence that does arrive worth reading.
 */
export type CompletionEvidenceRule = 'optional' | 'file_or_note' | 'file';

export const COMPLETION_EVIDENCE_LABELS: Record<CompletionEvidenceRule, string> = {
  optional: 'Optional',
  file_or_note: 'Required — file or note',
  file: 'Required — file',
};

/** What the person completing the work is told, when the setter said nothing. */
export const COMPLETION_EVIDENCE_DEFAULT_INSTRUCTION: Record<CompletionEvidenceRule, string> = {
  optional: 'Attach anything that would be useful to whoever reads this later.',
  file_or_note: 'Attach proof of completion, or describe the result in a note.',
  file: 'Attach a file or photograph as proof before completing this work.',
};

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
  /**
   * Why this work exists (§11), independent of what shape it is.
   *
   * Null means nobody has recorded one. Old rows are left that way on purpose:
   * the migration classified only what was unambiguous, and a guess shown as a
   * fact is worse than an honest gap.
   */
  workPurpose: WorkPurpose | null;
  origin: WorkOrigin;
  urgency: UrgencyLevel;
  isMandatory: boolean;

  progressPercent: number;

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
  /**
   * v155 — steps on this work assigned to somebody other than its owner and not
   * yet done. A step's date is its own, or the task's when it has none.
   */
  delegatedOpenCount: number;
  /** v155 — of those, how many are past their date. */
  delegatedOverdueCount: number;
  /** v155 — the earliest date among them, or null when there are none. */
  nextDelegatedDueAt: string | null;
  attachmentCount: number;
  /** What completing this work requires as proof. */
  completionEvidenceRule: CompletionEvidenceRule;
  /**
   * §14 — where a routine occurrence is recorded, and the earliest date it may
   * be signed off.
   *
   * Both snapshotted from the schedule when the occurrence was generated, so
   * editing the template later cannot rewrite what an occurrence required or
   * when it was allowed to happen. Null on everything that is not a routine
   * occurrence.
   */
  routineArea: string | null;
  routineCompletionOpensOn: string | null;
  /** What to attach, in the words of whoever set the rule. */
  completionEvidenceInstruction: string | null;
  /** Evidence already on the work, from a step or from the work itself. */
  evidenceCount: number;
  collaboratorCount: number;
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

/**
 * Bucket wording, for sentences.
 *
 * The long forms — "Major Project", "Operational Actions", "Self-Development
 * Plan" — went with the capacity strip in v144, which was the only place that
 * still needed a heading-length label for a bucket.
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
