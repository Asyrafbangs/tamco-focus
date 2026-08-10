import 'server-only';

import {
  goalMeasureProgress,
  type GoalCheckinStatus,
  type GoalCheckinType,
  type GoalHealth,
  type GoalMeasureState,
  type GoalMeasureType,
  type GoalOverview,
  type GoalTeamSummary,
  type GoalVersionStatus,
} from '@/domain/goals';
import { createSupabaseServerClient } from '@/lib/supabase/server';

type Raw = Record<string, unknown>;

function mapGoal(row: Raw): GoalOverview {
  return {
    id: String(row.id),
    ownerId: String(row.owner_id),
    ownerName: String(row.owner_name ?? 'Team member'),
    ownerEmployeeId: String(row.owner_employee_id ?? ''),
    managerId: row.manager_id ? String(row.manager_id) : null,
    managerName: row.manager_name ? String(row.manager_name) : null,
    title: String(row.title ?? 'Untitled goal'),
    category: (row.category ?? 'performance') as GoalOverview['category'],
    status: (row.status ?? 'draft') as GoalOverview['status'],
    health: (row.health ?? 'on_track') as GoalOverview['health'],
    reportedProgress: Number(row.reported_progress ?? 0),
    derivedProgress: Number(row.derived_progress ?? 0),
    targetDate: String(row.target_date),
    weightPercent: Number(row.weight_percent ?? 0),
    version: Number(row.version ?? 1),
    activeVersionId: row.active_version_id ? String(row.active_version_id) : null,
    pendingVersionId: row.pending_version_id ? String(row.pending_version_id) : null,
    activeVersionNumber:
      row.active_version_number == null ? null : Number(row.active_version_number),
    expectedResult: row.expected_result ? String(row.expected_result) : null,
    successMeasure: row.success_measure ? String(row.success_measure) : null,
    employeeApproach: row.employee_approach ? String(row.employee_approach) : null,
    supportAgreed: row.support_agreed ? String(row.support_agreed) : null,
    dependencies: row.dependencies ? String(row.dependencies) : null,
    baseline: row.baseline ? String(row.baseline) : null,
    purpose: row.purpose ? String(row.purpose) : null,
    currentMilestoneId: row.current_milestone_id ? String(row.current_milestone_id) : null,
    currentMilestoneTitle: row.current_milestone_title ? String(row.current_milestone_title) : null,
    currentMilestoneProgress:
      row.current_milestone_progress == null ? null : Number(row.current_milestone_progress),
    nextMilestoneTitle: row.next_milestone_title ? String(row.next_milestone_title) : null,
    openSupportCount: Number(row.open_support_count ?? 0),
    needsAttention: Boolean(row.needs_attention),
    attentionReason: row.attention_reason ? String(row.attention_reason) : null,
    isCheckinDue: Boolean(row.is_checkin_due),
    isUpdateRequested: Boolean(row.is_update_requested),
    isTargetApproaching: Boolean(row.is_target_approaching),
    hasRecentMilestoneCompletion: Boolean(row.has_recent_milestone_completion),
    lastMeaningfulUpdateAt: String(row.last_meaningful_update_at),
    checkinDueAt: row.checkin_due_at ? String(row.checkin_due_at) : null,
    updateRequestedAt: row.update_requested_at ? String(row.update_requested_at) : null,
    agreedAt: row.agreed_at ? String(row.agreed_at) : null,
    completedAt: row.completed_at ? String(row.completed_at) : null,
    closedAt: row.closed_at ? String(row.closed_at) : null,
    createdAt: String(row.created_at),
    successMeasureCount: Number(row.success_measure_count ?? 0),
    measureProgress: Number(row.measure_progress ?? 0),
    nextMonthlyCheckinDate: String(row.next_monthly_checkin_date ?? row.target_date),
    isMonthlyCheckinDue: Boolean(row.is_monthly_checkin_due),
    lastMonthlyCheckinAt: row.last_monthly_checkin_at ? String(row.last_monthly_checkin_at) : null,
    lastMonthlyCheckinStatus: row.last_monthly_checkin_status
      ? (String(row.last_monthly_checkin_status) as GoalHealth)
      : null,
    nextQuarterlyCheckinDate: String(row.next_quarterly_checkin_date ?? row.target_date),
    isQuarterlyCheckinDue: Boolean(row.is_quarterly_checkin_due),
    quarterlyRequiresManagerAction: Boolean(row.quarterly_requires_manager_action),
    managerNeedsAttention: Boolean(row.manager_needs_attention),
    managerAttentionReason: row.manager_attention_reason
      ? String(row.manager_attention_reason)
      : null,
    currentQuarterlyCheckinId: row.current_quarterly_checkin_id
      ? String(row.current_quarterly_checkin_id)
      : null,
    currentQuarterlyStatus: row.current_quarterly_status
      ? (String(row.current_quarterly_status) as GoalCheckinStatus)
      : null,
    latestYearEndResult: row.latest_year_end_result ? String(row.latest_year_end_result) : null,
    latestYearEndStatus: row.latest_year_end_status
      ? (String(row.latest_year_end_status) as GoalCheckinStatus)
      : null,
  };
}

export async function getMyGoals(ownerId: string): Promise<GoalOverview[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('goal_overview')
    .select('*')
    .eq('owner_id', ownerId)
    .neq('status', 'cancelled')
    .order('target_date', { ascending: true })
    .limit(100);
  if (error) {
    console.error(`[getMyGoals] ${error.message}`);
    throw new Error('GOALS_UNAVAILABLE');
  }
  return (data ?? []).map((row) => mapGoal(row as Raw));
}

export async function getGoalsForOwner(ownerId: string): Promise<GoalOverview[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('goal_overview')
    .select('*')
    .eq('owner_id', ownerId)
    .neq('status', 'cancelled')
    .order('target_date', { ascending: true })
    .limit(100);
  if (error) {
    console.error(`[getGoalsForOwner] ${error.message}`);
    return [];
  }
  return (data ?? []).map((row) => mapGoal(row as Raw));
}

export async function getGoalExceptions(userId: string): Promise<GoalOverview[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('goal_overview')
    .select('*')
    .eq('status', 'active')
    .or(`owner_id.eq.${userId},manager_id.eq.${userId}`)
    .order('target_date', { ascending: true })
    .limit(20);
  if (error) {
    console.error(`[getGoalExceptions] ${error.message}`);
    return [];
  }
  return (data ?? [])
    .map((row) => mapGoal(row as Raw))
    .filter((goal) => {
      const ownerAction =
        goal.ownerId === userId && (goal.isMonthlyCheckinDue || goal.isUpdateRequested);
      const managerAction = goal.managerId === userId && goal.managerNeedsAttention;
      return ownerAction || managerAction;
    });
}

export async function getTeamGoalSummary(viewerId: string): Promise<GoalTeamSummary[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('goal_team_summary')
    .select('*')
    .neq('user_id', viewerId)
    .order('full_name')
    .limit(200);
  if (error) {
    console.error(`[getTeamGoalSummary] ${error.message}`);
    throw new Error('TEAM_GOALS_UNAVAILABLE');
  }
  return (data ?? []).map((row) => ({
    userId: String(row.user_id),
    fullName: String(row.full_name ?? 'Team member'),
    employeeId: String(row.employee_id ?? ''),
    activeGoalCount: Number(row.active_goal_count ?? 0),
    attentionCount: Number(row.attention_count ?? 0),
    supportRequestCount: Number(row.support_request_count ?? 0),
    checkinDueCount: Number(row.checkin_due_count ?? 0),
    weightedProgress: Number(row.weighted_progress ?? 0),
    lastGoalUpdateAt: row.last_goal_update_at ? String(row.last_goal_update_at) : null,
    quarterlyActionCount: Number(row.quarterly_action_count ?? 0),
    quarterlyDueCount: Number(row.quarterly_due_count ?? 0),
  }));
}

export interface GoalMilestone {
  id: string;
  goalVersionId: string;
  sourceMilestoneId: string | null;
  position: number;
  title: string;
  completionDefinition: string;
  weightPercent: number;
  progressPercent: number;
  completedByName: string | null;
  completedAt: string | null;
  lastUpdateAt: string;
}

export interface GoalVersionDetail {
  id: string;
  versionNumber: number;
  status: GoalVersionStatus;
  title: string;
  expectedResult: string;
  successMeasure: string;
  employeeApproach: string | null;
  supportAgreed: string | null;
  dependencies: string | null;
  baseline: string | null;
  purpose: string | null;
  targetDate: string;
  weightPercent: number;
  proposedByName: string;
  proposedAt: string;
  activatedAt: string | null;
  milestones: GoalMilestone[];
  successMeasures: GoalSuccessMeasureDetail[];
}

export interface GoalSuccessMeasureDetail {
  id: string;
  goalVersionId: string;
  sourceMeasureId: string | null;
  position: number;
  description: string;
  optionalTargetDate: string | null;
  label: string;
  measureType: GoalMeasureType;
  targetNumeric: number | null;
  currentNumeric: number | null;
  unit: string | null;
  period: string | null;
  targetText: string | null;
  currentState: GoalMeasureState | null;
  actualResult: string | null;
  actualRecordedBy: string | null;
  actualRecordedAt: string | null;
  progress: number;
}

export interface GoalSuccessMeasureUpdateDetail {
  id: string;
  measureId: string;
  measureLabel: string;
  checkInId: string | null;
  authorName: string;
  previousNumeric: number | null;
  newNumeric: number | null;
  previousState: GoalMeasureState | null;
  newState: GoalMeasureState | null;
  note: string | null;
  createdAt: string;
}

export interface GoalCheckinDetail {
  id: string;
  checkinType: GoalCheckinType;
  status: GoalCheckinStatus;
  periodStart: string;
  periodEnd: string;
  periodYear: number;
  periodMonth: number | null;
  periodQuarter: number | null;
  progressStatus: GoalHealth | null;
  noMaterialChange: boolean;
  employeeSummary: string | null;
  managerDiscussion: string | null;
  agreedActions: string | null;
  supportRequested: boolean;
  supportDetails: string | null;
  resultStatement: string | null;
  sourceSnapshot: Record<string, unknown>;
  submittedByName: string | null;
  submittedAt: string | null;
  managerCompletedByName: string | null;
  managerCompletedAt: string | null;
  finalizedByName: string | null;
  finalizedAt: string | null;
}

export interface GoalUpdateDetail {
  id: string;
  authorName: string;
  previousProgress: number;
  newProgress: number;
  whatChanged: string;
  nextStep: string | null;
  supportRequested: boolean;
  supportDetails: string | null;
  createdAt: string;
}

export interface GoalMilestoneUpdateDetail {
  id: string;
  milestoneId: string;
  milestoneTitle: string;
  authorName: string;
  previousProgress: number;
  newProgress: number;
  comment: string | null;
  markedComplete: boolean;
  createdAt: string;
}

export interface GoalAttachmentDetail {
  id: string;
  goalUpdateId: string | null;
  milestoneUpdateId: string | null;
  fileName: string;
  mimeType: string;
  byteSize: number;
  virusScanState: string;
  uploadedByName: string;
  createdAt: string;
  relatedLabel: string;
}

export interface GoalSupportDetail {
  id: string;
  sourceKind: 'legacy_goal_support' | 'action_request';
  details: string;
  status: 'open' | 'acknowledged' | 'resolved';
  sourceActive: boolean;
  actionPending: boolean;
  actionRequiredFromName: string | null;
  requestedByName: string;
  createdAt: string;
  resolvedAt: string | null;
  resolutionNote: string | null;
}

export interface GoalWorkLinkDetail {
  id: string;
  taskId: string;
  taskTitle: string;
  taskStatus: string;
  milestoneTitle: string | null;
  createdAt: string;
}

export interface GoalActivityDetail {
  id: string;
  eventType: string;
  actorName: string;
  occurredAt: string;
  detail: Record<string, unknown>;
}

export interface GoalDetail {
  goal: GoalOverview;
  capabilities: {
    canView: boolean;
    canUpdate: boolean;
    canEditStructure: boolean;
    canAgree: boolean;
    canSubmitMonthly: boolean;
    canPrepareQuarterly: boolean;
    canCompleteQuarterly: boolean;
    canSaveYearEnd: boolean;
    canCompleteGoal: boolean;
    canCancelGoal: boolean;
  };
  activeVersion: GoalVersionDetail | null;
  pendingVersion: GoalVersionDetail | null;
  updates: GoalUpdateDetail[];
  milestoneUpdates: GoalMilestoneUpdateDetail[];
  attachments: GoalAttachmentDetail[];
  supportRequests: GoalSupportDetail[];
  workLinks: GoalWorkLinkDetail[];
  activity: GoalActivityDetail[];
  checkIns: GoalCheckinDetail[];
  measureUpdates: GoalSuccessMeasureUpdateDetail[];
}

export async function getGoalDetail(goalId: string): Promise<GoalDetail | null> {
  const supabase = await createSupabaseServerClient();
  const [overviewResult, capabilitiesResult] = await Promise.all([
    supabase.from('goal_overview').select('*').eq('id', goalId).maybeSingle(),
    supabase.rpc('get_goal_capabilities', { p_goal_id: goalId }),
  ]);
  if (overviewResult.error || !overviewResult.data) return null;

  const goal = mapGoal(overviewResult.data as Raw);
  const versionIds = [goal.activeVersionId, goal.pendingVersionId].filter((id): id is string =>
    Boolean(id),
  );

  const [
    versionsResult,
    milestonesResult,
    measuresResult,
    updatesResult,
    milestoneUpdatesResult,
    measureUpdatesResult,
    checkInsResult,
    attachmentsResult,
    supportResult,
    actionRequestsResult,
    linksResult,
    activityResult,
  ] = await Promise.all([
    versionIds.length
      ? supabase.from('goal_versions').select('*').in('id', versionIds).order('version_number')
      : Promise.resolve({ data: [], error: null }),
    versionIds.length
      ? supabase
          .from('goal_milestones')
          .select('*')
          .in('goal_version_id', versionIds)
          .order('position')
      : Promise.resolve({ data: [], error: null }),
    versionIds.length
      ? supabase
          .from('goal_success_measures')
          .select('*')
          .in('goal_version_id', versionIds)
          .order('position')
      : Promise.resolve({ data: [], error: null }),
    supabase
      .from('goal_updates')
      .select('*')
      .eq('goal_id', goalId)
      .order('created_at', { ascending: false })
      .limit(300),
    supabase
      .from('goal_milestone_updates')
      .select('*')
      .eq('goal_id', goalId)
      .order('created_at', { ascending: false })
      .limit(500),
    supabase
      .from('goal_success_measure_updates')
      .select('*')
      .eq('goal_id', goalId)
      .order('created_at', { ascending: false })
      .limit(500),
    supabase
      .from('goal_check_ins')
      .select('*')
      .eq('goal_id', goalId)
      .order('period_end', { ascending: false })
      .limit(100),
    supabase
      .from('goal_attachments')
      .select('*')
      .eq('goal_id', goalId)
      .order('created_at', { ascending: false })
      .limit(500),
    supabase
      .from('goal_support_requests')
      .select('*')
      .eq('goal_id', goalId)
      .order('created_at', { ascending: false })
      .limit(100),
    supabase
      .from('action_requests_overview')
      .select('*')
      .eq('goal_id', goalId)
      .order('raised_at', { ascending: false })
      .limit(100),
    supabase
      .from('goal_work_links')
      .select('*')
      .eq('goal_id', goalId)
      .order('created_at', { ascending: false })
      .limit(200),
    supabase
      .from('goal_lifecycle_history')
      .select('id,event_kind,actor_id,actor_name,occurred_at,title,detail')
      .eq('goal_id', goalId)
      .order('occurred_at', { ascending: false })
      .limit(500),
  ]);

  const versions = versionsResult.data ?? [];
  const milestones = milestonesResult.data ?? [];
  const measures = measuresResult.data ?? [];
  const updates = updatesResult.data ?? [];
  const milestoneUpdates = milestoneUpdatesResult.data ?? [];
  const measureUpdates = measureUpdatesResult.data ?? [];
  const checkIns = checkInsResult.data ?? [];
  const attachments = attachmentsResult.data ?? [];
  const supportRequests = supportResult.data ?? [];
  const actionRequests = actionRequestsResult.data ?? [];
  const workLinks = linksResult.data ?? [];
  const activity = activityResult.data ?? [];

  const taskIds = workLinks.map((row) => row.task_id);
  const personIds = new Set<string>([
    goal.ownerId,
    ...(goal.managerId ? [goal.managerId] : []),
    ...versions.map((row) => row.proposed_by),
    ...milestones.map((row) => row.completed_by).filter((id): id is string => Boolean(id)),
    ...updates.map((row) => row.author_id),
    ...milestoneUpdates.map((row) => row.author_id),
    ...measureUpdates.map((row) => row.author_id),
    ...checkIns
      .flatMap((row) => [row.submitted_by, row.manager_completed_by, row.finalized_by])
      .filter((id): id is string => Boolean(id)),
    ...attachments.map((row) => row.uploaded_by),
    ...supportRequests.map((row) => row.requested_by),
    ...activity.map((row) => row.actor_id).filter((id): id is string => Boolean(id)),
  ]);
  const [{ data: people }, { data: linkedTasks }] = await Promise.all([
    personIds.size
      ? supabase.from('user_profiles').select('id,full_name').in('id', Array.from(personIds))
      : Promise.resolve({ data: [] }),
    taskIds.length
      ? supabase.from('task_overview').select('id,title,status').in('id', taskIds)
      : Promise.resolve({ data: [] }),
  ]);
  const peopleById = new Map((people ?? []).map((row) => [row.id, row.full_name]));
  const personName = (id: string | null) =>
    (id ? peopleById.get(id) : null) ?? (id === null ? null : 'Team member');
  const tasksById = new Map((linkedTasks ?? []).map((row) => [row.id, row]));
  const milestoneById = new Map(milestones.map((row) => [row.id, row]));
  const measureById = new Map(measures.map((row) => [row.id, row]));
  const updateById = new Map(updates.map((row) => [row.id, row]));
  const milestoneUpdateById = new Map(milestoneUpdates.map((row) => [row.id, row]));

  const mapMilestone = (row: (typeof milestones)[number]): GoalMilestone => ({
    id: row.id,
    goalVersionId: row.goal_version_id,
    sourceMilestoneId: row.source_milestone_id,
    position: row.position,
    title: row.title,
    completionDefinition: row.completion_definition,
    weightPercent: row.weight_percent,
    progressPercent: row.progress_percent,
    completedByName: personName(row.completed_by),
    completedAt: row.completed_at,
    lastUpdateAt: row.last_update_at,
  });
  const mappedVersions: GoalVersionDetail[] = versions.map((row) => ({
    id: row.id,
    versionNumber: row.version_number,
    status: row.status,
    title: row.title,
    expectedResult: row.expected_result,
    successMeasure: row.success_measure,
    employeeApproach: row.employee_approach,
    supportAgreed: row.support_agreed,
    dependencies: row.dependencies,
    baseline: row.baseline,
    purpose: row.purpose,
    targetDate: row.target_date,
    weightPercent: row.weight_percent,
    proposedByName: personName(row.proposed_by) ?? 'Team member',
    proposedAt: row.proposed_at,
    activatedAt: row.activated_at,
    milestones: milestones.filter((item) => item.goal_version_id === row.id).map(mapMilestone),
    successMeasures: measures
      .filter((item) => item.goal_version_id === row.id)
      .map((item) => {
        const measure = {
          measureType: item.measure_type,
          targetNumeric: item.target_numeric == null ? null : Number(item.target_numeric),
          currentNumeric: item.current_numeric == null ? null : Number(item.current_numeric),
          currentState: item.current_state,
        };
        return {
          id: item.id,
          goalVersionId: item.goal_version_id,
          sourceMeasureId: item.source_measure_id,
          position: item.position,
          description: item.description ?? item.label,
          optionalTargetDate: item.optional_target_date,
          label: item.label,
          measureType: item.measure_type,
          targetNumeric: measure.targetNumeric,
          currentNumeric: measure.currentNumeric,
          unit: item.unit,
          period: item.period,
          targetText: item.target_text,
          currentState: item.current_state,
          actualResult: item.actual_result,
          actualRecordedBy: item.actual_recorded_by,
          actualRecordedAt: item.actual_recorded_at,
          progress: goalMeasureProgress(measure),
        };
      }),
  }));

  const rawCapabilities = (capabilitiesResult.data ?? {}) as Raw;
  return {
    goal,
    capabilities: {
      canView: Boolean(rawCapabilities.can_view),
      canUpdate: Boolean(rawCapabilities.can_update),
      canEditStructure: Boolean(rawCapabilities.can_edit_structure),
      canAgree: Boolean(rawCapabilities.can_agree),
      canSubmitMonthly: Boolean(rawCapabilities.can_submit_monthly),
      canPrepareQuarterly: Boolean(rawCapabilities.can_prepare_quarterly),
      canCompleteQuarterly: Boolean(rawCapabilities.can_complete_quarterly),
      canSaveYearEnd: Boolean(rawCapabilities.can_save_year_end),
      canCompleteGoal: Boolean(rawCapabilities.can_complete_goal),
      canCancelGoal: Boolean(rawCapabilities.can_cancel_goal),
    },
    activeVersion: mappedVersions.find((version) => version.id === goal.activeVersionId) ?? null,
    pendingVersion: mappedVersions.find((version) => version.id === goal.pendingVersionId) ?? null,
    updates: updates.map((row) => ({
      id: row.id,
      authorName: personName(row.author_id) ?? 'Team member',
      previousProgress: row.previous_reported_progress,
      newProgress: row.new_reported_progress,
      whatChanged: row.what_changed,
      nextStep: row.next_step,
      supportRequested: row.support_requested,
      supportDetails: row.support_details,
      createdAt: row.created_at,
    })),
    milestoneUpdates: milestoneUpdates.map((row) => ({
      id: row.id,
      milestoneId: row.milestone_id,
      milestoneTitle: milestoneById.get(row.milestone_id)?.title ?? 'Milestone',
      authorName: personName(row.author_id) ?? 'Team member',
      previousProgress: row.previous_progress,
      newProgress: row.new_progress,
      comment: row.comment,
      markedComplete: row.marked_complete,
      createdAt: row.created_at,
    })),
    attachments: attachments.map((row) => {
      const overall = row.goal_update_id ? updateById.get(row.goal_update_id) : null;
      const milestoneUpdate = row.milestone_update_id
        ? milestoneUpdateById.get(row.milestone_update_id)
        : null;
      return {
        id: row.id,
        goalUpdateId: row.goal_update_id,
        milestoneUpdateId: row.milestone_update_id,
        fileName: row.file_name,
        mimeType: row.mime_type,
        byteSize: row.byte_size,
        virusScanState: row.virus_scan_state,
        uploadedByName: personName(row.uploaded_by) ?? 'Team member',
        createdAt: row.created_at,
        relatedLabel: overall
          ? `Overall update to ${overall.new_reported_progress}%`
          : milestoneUpdate
            ? (milestoneById.get(milestoneUpdate.milestone_id)?.title ?? 'Milestone update')
            : 'Goal update',
      };
    }),
    supportRequests: [
      ...actionRequests.map((row): GoalSupportDetail => ({
        id: row.id,
        sourceKind: 'action_request',
        details: row.support_needed,
        status: row.status,
        sourceActive: row.source_active,
        actionPending: row.action_pending,
        actionRequiredFromName: row.action_required_from_name,
        requestedByName: row.raised_by_name ?? 'Team member',
        createdAt: row.raised_at,
        resolvedAt: row.resolved_at,
        resolutionNote: null,
      })),
      ...supportRequests.map((row): GoalSupportDetail => ({
        id: row.id,
        sourceKind: 'legacy_goal_support',
        details: row.details,
        status: row.status as GoalSupportDetail['status'],
        sourceActive: true,
        actionPending: row.status !== 'resolved',
        actionRequiredFromName: null,
        requestedByName: personName(row.requested_by) ?? 'Team member',
        createdAt: row.created_at,
        resolvedAt: row.resolved_at,
        resolutionNote: row.resolution_note,
      })),
    ].sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
    workLinks: workLinks.flatMap((row) => {
      const task = tasksById.get(row.task_id);
      if (!task) return [];
      return [
        {
          id: row.id,
          taskId: row.task_id,
          taskTitle: task.title ?? 'Untitled work',
          taskStatus: task.status ?? 'unknown',
          milestoneTitle: row.milestone_id
            ? (milestoneById.get(row.milestone_id)?.title ?? null)
            : null,
          createdAt: row.created_at,
        },
      ];
    }),
    activity: activity.map((row) => ({
      id: row.id,
      eventType: row.event_kind ?? 'goal_activity',
      actorName:
        row.actor_name ?? (row.actor_id ? (personName(row.actor_id) ?? 'Team member') : 'System'),
      occurredAt: row.occurred_at,
      detail: {
        ...((row.detail as Record<string, unknown>) ?? {}),
        title: row.title ?? 'Goal activity',
      },
    })),
    checkIns: checkIns.map((row) => ({
      id: row.id,
      checkinType: row.checkin_type,
      status: row.status,
      periodStart: row.period_start,
      periodEnd: row.period_end,
      periodYear: row.period_year,
      periodMonth: row.period_month,
      periodQuarter: row.period_quarter,
      progressStatus: row.progress_status,
      noMaterialChange: row.no_material_change,
      employeeSummary: row.employee_summary,
      managerDiscussion: row.manager_discussion,
      agreedActions: row.agreed_actions,
      supportRequested: row.support_requested,
      supportDetails: row.support_details,
      resultStatement: row.result_statement,
      sourceSnapshot: (row.source_snapshot as Record<string, unknown>) ?? {},
      submittedByName: personName(row.submitted_by),
      submittedAt: row.submitted_at,
      managerCompletedByName: personName(row.manager_completed_by),
      managerCompletedAt: row.manager_completed_at,
      finalizedByName: personName(row.finalized_by),
      finalizedAt: row.finalized_at,
    })),
    measureUpdates: measureUpdates.map((row) => ({
      id: row.id,
      measureId: row.measure_id,
      measureLabel: measureById.get(row.measure_id)?.label ?? 'Success measure',
      checkInId: row.check_in_id,
      authorName: personName(row.author_id) ?? 'Team member',
      previousNumeric: row.previous_numeric == null ? null : Number(row.previous_numeric),
      newNumeric: row.new_numeric == null ? null : Number(row.new_numeric),
      previousState: row.previous_state,
      newState: row.new_state,
      note: row.note,
      createdAt: row.created_at,
    })),
  };
}

export async function getGoalEmployeeOptions(viewerId: string) {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('user_profiles')
    .select('id,full_name,employee_id,role')
    .eq('status', 'active')
    .neq('id', viewerId)
    .order('full_name')
    .limit(200);
  if (error) {
    console.error(`[getGoalEmployeeOptions] ${error.message}`);
    return [];
  }
  return (data ?? []).map((row) => ({
    id: row.id,
    fullName: row.full_name,
    employeeId: row.employee_id,
    role: row.role,
  }));
}

export async function getGoalActiveWeights(): Promise<Record<string, number>> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('goals')
    .select('owner_id,weight_percent')
    .in('status', ['active', 'completed'])
    .limit(1000);
  if (error) {
    console.error(`[getGoalActiveWeights] ${error.message}`);
    return {};
  }
  return (data ?? []).reduce<Record<string, number>>((totals, row) => {
    totals[row.owner_id] = (totals[row.owner_id] ?? 0) + Number(row.weight_percent ?? 0);
    return totals;
  }, {});
}

export interface GoalPlanOverview {
  id: string;
  employeeId: string;
  employeeName: string;
  performancePeriodId: string;
  performancePeriodName: string;
  startsOn: string;
  endsOn: string;
  status: 'draft' | 'finalized' | 'reallocation_required';
  finalizedAt: string | null;
  version: number;
  activeGoalCount: number;
  formalWeight: number;
  reallocationRequired: number;
  canFinalize: boolean;
}

export interface GoalSessionOverview {
  id: string;
  employeeId: string;
  employeeName: string;
  performancePeriodId: string;
  performancePeriodName: string;
  sessionKind: 'monthly' | 'quarterly';
  status: 'draft' | 'submitted' | 'completed';
  periodYear: number;
  periodMonth: number | null;
  periodQuarter: number | null;
  submittedByName: string | null;
  submittedAt: string | null;
  reviewedByName: string | null;
  reviewedAt: string | null;
  summary: string | null;
  version: number;
  goalCount: number;
  atRiskCount: number;
  offTrackCount: number;
  supportRequestCount: number;
}

export async function getCurrentGoalPlan(ownerId: string): Promise<GoalPlanOverview | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('goal_plan_overview')
    .select('*')
    .eq('employee_id', ownerId)
    .order('ends_on', { ascending: false })
    .limit(10);
  if (error) {
    console.error(`[getCurrentGoalPlan] ${error.message}`);
    return null;
  }
  const today = new Date().toISOString().slice(0, 10);
  const current = (data ?? []).find((row) => row.starts_on <= today && row.ends_on >= today);
  const selected = current ?? data?.[0];
  if (!selected) return null;
  return {
    id: selected.id,
    employeeId: selected.employee_id,
    employeeName: selected.employee_name,
    performancePeriodId: selected.performance_period_id,
    performancePeriodName: selected.performance_period_name,
    startsOn: selected.starts_on,
    endsOn: selected.ends_on,
    status: selected.status,
    finalizedAt: selected.finalized_at,
    version: selected.version,
    activeGoalCount: selected.active_goal_count,
    formalWeight: selected.formal_weight,
    reallocationRequired: selected.reallocation_required,
    canFinalize: selected.can_finalize,
  };
}

export async function getGoalSessions(
  ownerId: string,
  performancePeriodId: string | null,
): Promise<GoalSessionOverview[]> {
  if (!performancePeriodId) return [];
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('goal_session_overview')
    .select('*')
    .eq('employee_id', ownerId)
    .eq('performance_period_id', performancePeriodId)
    .order('period_year', { ascending: false })
    .order('submitted_at', { ascending: false })
    .limit(36);
  if (error) {
    console.error(`[getGoalSessions] ${error.message}`);
    return [];
  }
  return (data ?? []).map((row) => ({
    id: row.id,
    employeeId: row.employee_id,
    employeeName: row.employee_name,
    performancePeriodId: row.performance_period_id,
    performancePeriodName: row.performance_period_name,
    sessionKind: row.session_kind,
    status: row.status,
    periodYear: row.period_year,
    periodMonth: row.period_month,
    periodQuarter: row.period_quarter,
    submittedByName: row.submitted_by_name,
    submittedAt: row.submitted_at,
    reviewedByName: row.reviewed_by_name,
    reviewedAt: row.reviewed_at,
    summary: row.summary,
    version: row.version,
    goalCount: row.goal_count,
    atRiskCount: row.at_risk_count,
    offTrackCount: row.off_track_count,
    supportRequestCount: row.support_request_count,
  }));
}

export async function getGoalSupportPeople(viewerId: string) {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('team_directory')
    .select('id,full_name')
    .neq('id', viewerId)
    .order('full_name')
    .limit(200);
  if (error) {
    console.error(`[getGoalSupportPeople] ${error.message}`);
    return [];
  }
  return (data ?? []).map((row) => ({ id: row.id, name: row.full_name }));
}
