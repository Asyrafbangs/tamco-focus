import 'server-only';

import type { GoalOverview, GoalTeamSummary, GoalVersionStatus } from '@/domain/goals';
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
    .filter(
      (goal) =>
        goal.needsAttention || goal.isTargetApproaching || goal.hasRecentMilestoneCompletion,
    );
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
  details: string;
  status: 'open' | 'acknowledged' | 'resolved';
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
  };
  activeVersion: GoalVersionDetail | null;
  pendingVersion: GoalVersionDetail | null;
  updates: GoalUpdateDetail[];
  milestoneUpdates: GoalMilestoneUpdateDetail[];
  attachments: GoalAttachmentDetail[];
  supportRequests: GoalSupportDetail[];
  workLinks: GoalWorkLinkDetail[];
  activity: GoalActivityDetail[];
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
    updatesResult,
    milestoneUpdatesResult,
    attachmentsResult,
    supportResult,
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
      .from('goal_work_links')
      .select('*')
      .eq('goal_id', goalId)
      .order('created_at', { ascending: false })
      .limit(200),
    supabase
      .from('audit_events')
      .select('id,event_type,actor_id,occurred_at,detail')
      .eq('goal_id', goalId)
      .order('occurred_at', { ascending: false })
      .limit(500),
  ]);

  const versions = versionsResult.data ?? [];
  const milestones = milestonesResult.data ?? [];
  const updates = updatesResult.data ?? [];
  const milestoneUpdates = milestoneUpdatesResult.data ?? [];
  const attachments = attachmentsResult.data ?? [];
  const supportRequests = supportResult.data ?? [];
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
  }));

  const rawCapabilities = (capabilitiesResult.data ?? {}) as Raw;
  return {
    goal,
    capabilities: {
      canView: Boolean(rawCapabilities.can_view),
      canUpdate: Boolean(rawCapabilities.can_update),
      canEditStructure: Boolean(rawCapabilities.can_edit_structure),
      canAgree: Boolean(rawCapabilities.can_agree),
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
    supportRequests: supportRequests.map((row) => ({
      id: row.id,
      details: row.details,
      status: row.status as GoalSupportDetail['status'],
      requestedByName: personName(row.requested_by) ?? 'Team member',
      createdAt: row.created_at,
      resolvedAt: row.resolved_at,
      resolutionNote: row.resolution_note,
    })),
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
      eventType: row.event_type,
      actorName: row.actor_id ? (personName(row.actor_id) ?? 'Team member') : 'System',
      occurredAt: row.occurred_at,
      detail: (row.detail as Record<string, unknown>) ?? {},
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
    .eq('status', 'active')
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
