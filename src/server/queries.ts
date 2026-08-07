import 'server-only';

import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { FocusBucket, FocusSummary, TaskOverview } from '@/domain/types';

/**
 * Read helpers.
 *
 * Every query runs as the signed-in person through the request-scoped client,
 * so RLS decides what comes back. Nothing here filters by owner "for security" —
 * that would imply the database was not already doing it, and would drift.
 */

/** PostgREST returns snake_case; the domain layer speaks camelCase. Mapping
 * happens once, here, rather than in every component. */
function toTaskOverview(row: Record<string, unknown>): TaskOverview {
  return {
    id: row.id as string,
    title: row.title as string,
    description: (row.description as string) ?? null,
    nextAction: (row.next_action as string) ?? null,

    status: row.status as TaskOverview['status'],
    workClass: row.work_class as TaskOverview['workClass'],
    focusBucket: (row.focus_bucket as FocusBucket) ?? null,
    origin: row.origin as TaskOverview['origin'],
    urgency: row.urgency as TaskOverview['urgency'],
    isMandatory: Boolean(row.is_mandatory),

    progressPercent: Number(row.progress_percent ?? 0),
    overFocusTarget: Boolean(row.over_focus_target),
    activationReasonCode:
      (row.activation_reason_code as TaskOverview['activationReasonCode']) ?? null,
    activationReasonNote: (row.activation_reason_note as string) ?? null,

    reviewStatus: row.review_status as TaskOverview['reviewStatus'],
    reviewerId: (row.reviewer_id as string) ?? null,
    version: Number(row.version ?? 1),

    primaryOwnerId: row.primary_owner_id as string,
    ownerName: row.owner_name as string,
    ownerEmployeeId: row.owner_employee_id as string,

    routineTemplateId: (row.routine_template_id as string) ?? null,
    occurrenceDate: (row.occurrence_date as string) ?? null,

    createdAt: row.created_at as string,
    stateEnteredAt: row.state_entered_at as string,
    lastMeaningfulUpdateAt: row.last_meaningful_update_at as string,
    dueAt: (row.due_at as string) ?? null,
    dueIsDateOnly: Boolean(row.due_is_date_only),
    reviewAt: (row.review_at as string) ?? null,
    completedAt: (row.completed_at as string) ?? null,
    cancelledAt: (row.cancelled_at as string) ?? null,

    isOverdue: Boolean(row.is_overdue),
    isStale: Boolean(row.is_stale),

    openBarrierCount: Number(row.open_barrier_count ?? 0),
    checklistTotal: Number(row.checklist_total ?? 0),
    checklistCompleted: Number(row.checklist_completed ?? 0),
    checklistReady: Number(row.checklist_ready ?? 0),
    missingEvidenceCount: Number(row.missing_evidence_count ?? 0),
    attachmentCount: Number(row.attachment_count ?? 0),
    collaboratorCount: Number(row.collaborator_count ?? 0),
  };
}

/** Everything the caller may see that is still workable. */
export async function getWorkableTasks(): Promise<TaskOverview[]> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from('task_overview')
    .select('*')
    .in('status', ['backlog', 'active', 'paused'])
    .order('due_at', { ascending: true, nullsFirst: false })
    .limit(500);

  if (error) {
    console.error(`[getWorkableTasks] ${error.message}`);
    throw new Error('TASKS_UNAVAILABLE');
  }

  return (data ?? []).map(toTaskOverview);
}

/** The caller's own workable tasks, for My Day and the focus tabs. */
export async function getMyTasks(userId: string): Promise<TaskOverview[]> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from('task_overview')
    .select('*')
    .eq('primary_owner_id', userId)
    .in('status', ['backlog', 'active', 'paused'])
    .order('due_at', { ascending: true, nullsFirst: false })
    .limit(300);

  if (error) {
    console.error(`[getMyTasks] ${error.message}`);
    throw new Error('TASKS_UNAVAILABLE');
  }

  return (data ?? []).map(toTaskOverview);
}

/** Active work owned by someone else that a captured collaborative contribution
 * may be linked to. RLS remains the authority for which rows are visible. */
export async function getCollaborativeParentOptions(
  userId: string,
): Promise<Array<{ id: string; title: string; ownerName: string }>> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('task_overview')
    .select('id,title,owner_name')
    .neq('primary_owner_id', userId)
    .in('status', ['active', 'paused'])
    .order('title')
    .limit(100);

  if (error) {
    console.error(`[getCollaborativeParentOptions] ${error.message}`);
    return [];
  }

  return (data ?? []).map((row) => ({
    id: row.id as string,
    title: row.title as string,
    ownerName: row.owner_name as string,
  }));
}

export interface TaskDetailChecklistItem {
  id: string;
  action: string;
  assignedTo: string | null;
  assignedName: string | null;
  evidenceRule: 'not_required' | 'optional' | 'required';
  dueAt: string | null;
  dependsOnItemId: string | null;
  state: 'waiting' | 'ready' | 'completed';
  completedByName: string | null;
  completedAt: string | null;
  completionNote: string | null;
}

export interface TaskDetailAttachment {
  id: string;
  checklistItemId: string | null;
  updateId: string | null;
  fileName: string;
  mimeType: string;
  byteSize: number;
  isEvidence: boolean;
  virusScanState: string;
  uploadedByName: string;
  createdAt: string;
}

export interface TaskDetailUpdate {
  id: string;
  authorName: string;
  body: string | null;
  isEvidenceOnly: boolean;
  createdAt: string;
  mentionNames: string[];
}

export interface TaskDetailBarrier {
  id: string;
  description: string;
  supportNeeded: string;
  impact: string;
  addToMeetingQueue: boolean;
  status: 'open' | 'resolved';
  raisedByName: string;
  raisedAt: string;
  resolvedAt: string | null;
  resolutionNote: string | null;
}

export interface TaskDetailActivity {
  id: string;
  eventType: string;
  actorName: string;
  occurredAt: string;
  detail: Record<string, unknown>;
}

export interface TaskDetail {
  task: TaskOverview;
  capabilities: {
    canView: boolean;
    canContribute: boolean;
    canEdit: boolean;
    canReview: boolean;
  };
  checklist: TaskDetailChecklistItem[];
  updates: TaskDetailUpdate[];
  attachments: TaskDetailAttachment[];
  barriers: TaskDetailBarrier[];
  collaborators: Array<{ id: string; fullName: string; employeeId: string }>;
  participants: Array<{ id: string; fullName: string }>;
  relatedWork: Array<{ id: string; title: string; relation: string }>;
  activity: TaskDetailActivity[];
}

/**
 * Complete task-detail read model. Each table is queried as the signed-in user,
 * so RLS remains the authority. The second-stage name lookup is presentation
 * only; missing profile visibility falls back to a neutral label.
 */
export async function getTaskDetail(taskId: string): Promise<TaskDetail | null> {
  const supabase = await createSupabaseServerClient();
  const [taskResult, checklistResult, barriersResult, updatesResult, attachmentsResult] =
    await Promise.all([
      supabase.from('task_overview').select('*').eq('id', taskId).maybeSingle(),
      supabase.from('task_checklist_items').select('*').eq('task_id', taskId).order('position'),
      supabase.from('barriers').select('*').eq('task_id', taskId).order('raised_at', {
        ascending: false,
      }),
      supabase.from('task_updates').select('*').eq('task_id', taskId).order('created_at', {
        ascending: false,
      }),
      supabase.from('attachments').select('*').eq('task_id', taskId).order('created_at', {
        ascending: false,
      }),
    ]);

  if (taskResult.error || !taskResult.data) return null;

  const [collaboratorsResult, relationsResult, activityResult, capabilityResult] =
    await Promise.all([
      supabase.from('task_collaborators').select('user_id').eq('task_id', taskId),
      supabase
        .from('task_relations')
        .select('task_id,related_task_id,relation')
        .or(`task_id.eq.${taskId},related_task_id.eq.${taskId}`),
      supabase
        .from('audit_events')
        .select('id,event_type,actor_id,occurred_at,detail')
        .eq('task_id', taskId)
        .order('occurred_at', { ascending: false })
        .limit(500),
      supabase.rpc('get_task_capabilities', { p_task_id: taskId }),
    ]);

  const updates = updatesResult.data ?? [];
  const updateIds = updates.map((row) => row.id as string);
  const { data: mentions } = updateIds.length
    ? await supabase
        .from('task_update_mentions')
        .select('update_id,user_id')
        .in('update_id', updateIds)
    : { data: [] };

  const relatedIds = Array.from(
    new Set(
      (relationsResult.data ?? []).map((row) =>
        row.task_id === taskId ? (row.related_task_id as string) : (row.task_id as string),
      ),
    ),
  );
  const { data: relatedTasks } = relatedIds.length
    ? await supabase.from('task_overview').select('id,title').in('id', relatedIds)
    : { data: [] };
  const relatedById = new Map((relatedTasks ?? []).map((row) => [row.id as string, row]));

  const personIds = new Set<string>([
    taskResult.data.primary_owner_id as string,
    ...(collaboratorsResult.data ?? []).map((row) => row.user_id as string),
    ...(checklistResult.data ?? []).flatMap(
      (row) => [row.assigned_to, row.completed_by].filter(Boolean) as string[],
    ),
    ...(barriersResult.data ?? []).flatMap(
      (row) => [row.raised_by, row.resolved_by].filter(Boolean) as string[],
    ),
    ...updates.map((row) => row.author_id as string),
    ...(mentions ?? []).map((row) => row.user_id as string),
    ...(attachmentsResult.data ?? []).map((row) => row.uploaded_by as string),
    ...(activityResult.data ?? []).map((row) => row.actor_id as string).filter(Boolean),
  ]);
  const { data: people } = personIds.size
    ? await supabase
        .from('user_profiles')
        .select('id,full_name,employee_id')
        .in('id', Array.from(personIds))
    : { data: [] };
  const peopleById = new Map((people ?? []).map((row) => [row.id as string, row]));
  const personName = (id: unknown): string => {
    if (typeof id !== 'string') return 'Team member';
    const fullName = peopleById.get(id)?.full_name;
    return typeof fullName === 'string' && fullName ? fullName : 'Team member';
  };
  const mentionNames = new Map<string, string[]>();
  for (const mention of mentions ?? []) {
    const names = mentionNames.get(mention.update_id as string) ?? [];
    names.push(personName(mention.user_id));
    mentionNames.set(mention.update_id as string, names);
  }

  const collaboratorIds = (collaboratorsResult.data ?? []).map((row) => row.user_id as string);
  const participantIds = Array.from(
    new Set([
      taskResult.data.primary_owner_id as string,
      ...collaboratorIds,
      ...(checklistResult.data ?? [])
        .map((row) => row.assigned_to as string | null)
        .filter((id): id is string => Boolean(id)),
    ]),
  );
  const rawCapabilities = (capabilityResult.data ?? {}) as Record<string, unknown>;

  return {
    task: toTaskOverview(taskResult.data as Record<string, unknown>),
    capabilities: {
      canView: Boolean(rawCapabilities.can_view),
      canContribute: Boolean(rawCapabilities.can_contribute),
      canEdit: Boolean(rawCapabilities.can_edit),
      canReview: Boolean(rawCapabilities.can_review),
    },
    checklist: (checklistResult.data ?? []).map((row) => ({
      id: row.id as string,
      action: row.action as string,
      assignedTo: (row.assigned_to as string) ?? null,
      assignedName: row.assigned_to ? personName(row.assigned_to) : null,
      evidenceRule: row.evidence_rule as TaskDetailChecklistItem['evidenceRule'],
      dueAt: (row.due_at as string) ?? null,
      dependsOnItemId: (row.depends_on_item_id as string) ?? null,
      state: row.state as TaskDetailChecklistItem['state'],
      completedByName: row.completed_by ? personName(row.completed_by) : null,
      completedAt: (row.completed_at as string) ?? null,
      completionNote: (row.completion_note as string) ?? null,
    })),
    updates: updates.map((row) => ({
      id: row.id as string,
      authorName: personName(row.author_id),
      body: (row.body as string) ?? null,
      isEvidenceOnly: Boolean(row.is_evidence_only),
      createdAt: row.created_at as string,
      mentionNames: mentionNames.get(row.id as string) ?? [],
    })),
    attachments: (attachmentsResult.data ?? []).map((row) => ({
      id: row.id as string,
      checklistItemId: (row.checklist_item_id as string) ?? null,
      updateId: (row.update_id as string) ?? null,
      fileName: row.file_name as string,
      mimeType: row.mime_type as string,
      byteSize: Number(row.byte_size),
      isEvidence: Boolean(row.is_evidence),
      virusScanState: row.virus_scan_state as string,
      uploadedByName: personName(row.uploaded_by),
      createdAt: row.created_at as string,
    })),
    barriers: (barriersResult.data ?? []).map((row) => ({
      id: row.id as string,
      description: row.description as string,
      supportNeeded: row.support_needed as string,
      impact: row.impact as string,
      addToMeetingQueue: Boolean(row.add_to_meeting_queue),
      status: row.status as TaskDetailBarrier['status'],
      raisedByName: personName(row.raised_by),
      raisedAt: row.raised_at as string,
      resolvedAt: (row.resolved_at as string) ?? null,
      resolutionNote: (row.resolution_note as string) ?? null,
    })),
    collaborators: collaboratorIds.map((id) => ({
      id,
      fullName: personName(id),
      employeeId: (peopleById.get(id)?.employee_id as string) ?? '',
    })),
    participants: participantIds.map((id) => ({ id, fullName: personName(id) })),
    relatedWork: (relationsResult.data ?? []).flatMap((row) => {
      const relatedId = row.task_id === taskId ? row.related_task_id : row.task_id;
      const related = relatedById.get(relatedId as string);
      if (!related) return [];
      return [
        {
          id: relatedId as string,
          title: related.title as string,
          relation: row.relation as string,
        },
      ];
    }),
    activity: (activityResult.data ?? []).map((row) => ({
      id: row.id as string,
      eventType: row.event_type as string,
      actorName: row.actor_id ? personName(row.actor_id) : 'System',
      occurredAt: row.occurred_at as string,
      detail: (row.detail as Record<string, unknown>) ?? {},
    })),
  };
}

/**
 * Routine occurrences for the caller (section 16.3).
 *
 * Only current and near-term cycles, so future occurrences do not flood the
 * interface. Completed ones from the recent past are included so a person can
 * see what they have already done this week.
 */
export async function getRoutineOccurrences(
  userId: string,
  leadDays = 14,
): Promise<TaskOverview[]> {
  const supabase = await createSupabaseServerClient();

  const horizon = new Date(Date.now() + leadDays * 86_400_000).toISOString().slice(0, 10);
  const lookBack = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);

  const { data, error } = await supabase
    .from('task_overview')
    .select('*')
    .eq('work_class', 'routine_occurrence')
    .eq('primary_owner_id', userId)
    .gte('occurrence_date', lookBack)
    .lte('occurrence_date', horizon)
    .order('occurrence_date', { ascending: true })
    .limit(100);

  if (error) {
    console.error(`[getRoutineOccurrences] ${error.message}`);
    throw new Error('ROUTINES_UNAVAILABLE');
  }

  return (data ?? []).map(toTaskOverview);
}

/** Focus counts against targets, straight from committed state. */
export async function getFocusSummary(userId: string): Promise<FocusSummary[]> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase.from('focus_summary').select('*').eq('user_id', userId);

  if (error) {
    console.error(`[getFocusSummary] ${error.message}`);
    return [];
  }

  return (data ?? []).map((row) => ({
    userId: row.user_id as string,
    bucket: row.bucket as FocusBucket,
    activeCount: Number(row.active_count ?? 0),
    recommendedTarget: Number(row.recommended_target ?? 0),
    isOverTarget: Boolean(row.is_over_target),
    overTargetSince: (row.over_target_since as string) ?? null,
  }));
}

/**
 * Task IDs where a checklist step is assigned to this person and ready to start
 * (section 13.3). Supplied to the prioritiser, which cannot query for it itself.
 */
export async function getHandoffReadyTaskIds(userId: string): Promise<Set<string>> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from('task_checklist_items')
    .select('task_id')
    .eq('assigned_to', userId)
    .eq('state', 'ready');

  if (error) {
    console.error(`[getHandoffReadyTaskIds] ${error.message}`);
    return new Set();
  }

  return new Set((data ?? []).map((row) => row.task_id as string));
}

/** How many other tasks each task blocks, for My Day tie-breaking. */
export async function getBlockingCounts(): Promise<Map<string, number>> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from('task_relations')
    .select('task_id')
    .eq('relation', 'before');

  if (error) {
    console.error(`[getBlockingCounts] ${error.message}`);
    return new Map();
  }

  const counts = new Map<string, number>();
  for (const row of data ?? []) {
    const id = row.task_id as string;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }

  return counts;
}

/** Unread notifications that genuinely require action, for the red indicator. */
export async function getActionRequiredCount(userId: string): Promise<number> {
  const supabase = await createSupabaseServerClient();

  const { count, error } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('recipient_id', userId)
    .eq('requires_action', true)
    .is('read_at', null);

  if (error) {
    console.error(`[getActionRequiredCount] ${error.message}`);
    return 0;
  }

  return count ?? 0;
}

/** A dated commitment on the Monthly Plan (section 17.2). */
export interface PlanEvent {
  taskId: string;
  title: string;
  primaryOwnerId: string;
  status: string;
  workClass: string;
  occursAt: string;
  dueIsDateOnly: boolean;
  /** `due`, `overdue`, `routine`, or `review`. */
  eventKind: 'due' | 'overdue' | 'routine' | 'review';
}

/**
 * Dated commitments inside a calendar month (section 17.2).
 *
 * Covers due dates, overdue work, routine occurrences, and review or selection
 * deadlines. The view already labels each row with its kind so the calendar and
 * the mobile agenda render from one source.
 */
export async function getPlanEvents(
  userId: string,
  monthStart: Date,
  monthEnd: Date,
): Promise<PlanEvent[]> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from('plan_events')
    .select('*')
    .eq('primary_owner_id', userId)
    .gte('occurs_at', monthStart.toISOString())
    .lte('occurs_at', monthEnd.toISOString())
    .order('occurs_at', { ascending: true })
    .limit(400);

  if (error) {
    console.error(`[getPlanEvents] ${error.message}`);
    throw new Error('PLAN_UNAVAILABLE');
  }

  return (data ?? []).map((row) => ({
    taskId: row.task_id as string,
    title: row.title as string,
    primaryOwnerId: row.primary_owner_id as string,
    status: row.status as string,
    workClass: row.work_class as string,
    occursAt: row.occurs_at as string,
    dueIsDateOnly: Boolean(row.due_is_date_only),
    eventKind: row.event_kind as PlanEvent['eventKind'],
  }));
}

/** One person's row in Team Load (section 18.3). */
export interface TeamLoadRow {
  userId: string;
  fullName: string;
  employeeId: string;
  availableWorkCount: number;
  overdueCount: number;
  staleCount: number;
  openBarrierCount: number;
  routinesThisWeek: number;
  routinesCompletedThisWeek: number;
  routinesOverdue: number;
  quickActionsCreatedThisWeek: number;
  operationalCreatedThisWeek: number;
  decisionsPending: number;
}

/**
 * Team Load (section 18).
 *
 * Returns only the people the caller is authorised to see — RLS on the
 * underlying view does the filtering, so a manager sees their reporting line
 * and an administrator sees everyone, without this query knowing the rule.
 * The caller's own row is excluded: Team Load is about other people's load.
 */
export async function getTeamLoad(viewerId: string): Promise<TeamLoadRow[]> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from('team_load_summary')
    .select('*')
    .neq('user_id', viewerId)
    .order('full_name', { ascending: true })
    .limit(200);

  if (error) {
    console.error(`[getTeamLoad] ${error.message}`);
    throw new Error('TEAM_LOAD_UNAVAILABLE');
  }

  return (data ?? []).map((row) => ({
    userId: row.user_id as string,
    fullName: row.full_name as string,
    employeeId: row.employee_id as string,
    availableWorkCount: Number(row.available_work_count ?? 0),
    overdueCount: Number(row.overdue_count ?? 0),
    staleCount: Number(row.stale_count ?? 0),
    openBarrierCount: Number(row.open_barrier_count ?? 0),
    routinesThisWeek: Number(row.routines_this_week ?? 0),
    routinesCompletedThisWeek: Number(row.routines_completed_this_week ?? 0),
    routinesOverdue: Number(row.routines_overdue ?? 0),
    quickActionsCreatedThisWeek: Number(row.quick_actions_created_this_week ?? 0),
    operationalCreatedThisWeek: Number(row.operational_created_this_week ?? 0),
    decisionsPending: Number(row.decisions_pending ?? 0),
  }));
}

/** Focus counts against targets for everyone the caller may see. */
export async function getTeamFocusSummary(): Promise<FocusSummary[]> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase.from('focus_summary').select('*').limit(600);

  if (error) {
    console.error(`[getTeamFocusSummary] ${error.message}`);
    return [];
  }

  return (data ?? []).map((row) => ({
    userId: row.user_id as string,
    bucket: row.bucket as FocusBucket,
    activeCount: Number(row.active_count ?? 0),
    recommendedTarget: Number(row.recommended_target ?? 0),
    isOverTarget: Boolean(row.is_over_target),
    overTargetSince: (row.over_target_since as string) ?? null,
  }));
}

/** Active workload rows for people already authorised by task_overview RLS. */
export async function getVisibleTeamTasks(viewerId: string): Promise<TaskOverview[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('task_overview')
    .select('*')
    .neq('primary_owner_id', viewerId)
    .in('status', ['backlog', 'active', 'paused'])
    .order('due_at', { ascending: true, nullsFirst: false })
    .limit(500);

  if (error) {
    console.error(`[getVisibleTeamTasks] ${error.message}`);
    throw new Error('TEAM_TASKS_UNAVAILABLE');
  }
  return (data ?? []).map(toTaskOverview);
}

/** Manager-configurable values the interface needs in order to render. */
export async function getDisplaySettings(): Promise<{
  staleThresholdDays: number;
  upcomingWindowDays: number;
  todayListMaxItems: number;
}> {
  const supabase = await createSupabaseServerClient();

  const { data } = await supabase
    .from('org_settings')
    .select('key, value')
    .in('key', [
      'focus.stale_update_threshold_days',
      'day.upcoming_window_days',
      'day.today_list_max_items',
    ]);

  const byKey = new Map((data ?? []).map((row) => [row.key as string, row.value]));

  return {
    staleThresholdDays: Number(byKey.get('focus.stale_update_threshold_days') ?? 7),
    upcomingWindowDays: Number(byKey.get('day.upcoming_window_days') ?? 7),
    todayListMaxItems: Number(byKey.get('day.today_list_max_items') ?? 5),
  };
}

// ---------------------------------------------------------------------------
// Records and settings (sections 21, 22, and 31B)
// ---------------------------------------------------------------------------

export interface RecordFilters {
  query?: string;
  state?: 'all' | 'completed' | 'cancelled';
  review?: 'all' | 'pending' | 'accepted' | 'changes_requested' | 'not_required';
  ownerId?: string;
  workClass?: TaskOverview['workClass'] | 'all';
  attachment?: 'all' | 'with' | 'without';
  dateFrom?: string;
  dateTo?: string;
}

export interface CompletionRecord {
  task: TaskOverview;
  submittedAt: string | null;
  decidedAt: string | null;
  decision: 'accepted' | 'changes_requested' | null;
  decisionNote: string | null;
}

export async function getCompletionRecords(
  filters: RecordFilters = {},
): Promise<CompletionRecord[]> {
  const supabase = await createSupabaseServerClient();
  let taskQuery = supabase
    .from('task_overview')
    .select('*')
    .in('status', ['completed', 'cancelled'])
    .order('completed_at', { ascending: false, nullsFirst: false })
    .limit(500);

  if (filters.query?.trim()) taskQuery = taskQuery.ilike('title', `%${filters.query.trim()}%`);
  if (filters.state && filters.state !== 'all') taskQuery = taskQuery.eq('status', filters.state);
  if (filters.review && filters.review !== 'all')
    taskQuery = taskQuery.eq('review_status', filters.review);
  if (filters.ownerId) taskQuery = taskQuery.eq('primary_owner_id', filters.ownerId);
  if (filters.workClass && filters.workClass !== 'all')
    taskQuery = taskQuery.eq('work_class', filters.workClass);
  if (filters.attachment === 'with') taskQuery = taskQuery.gt('attachment_count', 0);
  if (filters.attachment === 'without') taskQuery = taskQuery.eq('attachment_count', 0);

  const { data: taskRows, error: taskError } = await taskQuery;
  if (taskError) {
    console.error(`[getCompletionRecords] ${taskError.message}`);
    throw new Error('RECORDS_UNAVAILABLE');
  }

  const from = filters.dateFrom ? new Date(`${filters.dateFrom}T00:00:00`).getTime() : null;
  const to = filters.dateTo ? new Date(`${filters.dateTo}T23:59:59.999`).getTime() : null;
  const tasks = (taskRows ?? []).map(toTaskOverview).filter((task) => {
    if (from === null && to === null) return true;
    const closedAt = task.completedAt ?? task.cancelledAt;
    if (!closedAt) return false;
    const instant = new Date(closedAt).getTime();
    return (from === null || instant >= from) && (to === null || instant <= to);
  });
  const ids = tasks.map((task) => task.id);
  if (ids.length === 0) return [];

  const { data: reviews, error: reviewError } = await supabase
    .from('completion_reviews')
    .select('task_id,submitted_at,decided_at,decision,decision_note')
    .in('task_id', ids)
    .order('submitted_at', { ascending: false });
  if (reviewError) console.error(`[getCompletionRecords:reviews] ${reviewError.message}`);

  const byTask = new Map((reviews ?? []).map((row) => [row.task_id as string, row]));
  return tasks.map((task) => {
    const review = byTask.get(task.id);
    return {
      task,
      submittedAt: (review?.submitted_at as string) ?? null,
      decidedAt: (review?.decided_at as string) ?? null,
      decision: (review?.decision as CompletionRecord['decision']) ?? null,
      decisionNote: (review?.decision_note as string) ?? null,
    };
  });
}

export interface AttachmentLibraryItem {
  id: string;
  taskId: string;
  taskTitle: string;
  fileName: string;
  mimeType: string;
  byteSize: number;
  isEvidence: boolean;
  uploadedByName: string;
  createdAt: string;
  viewCount: number;
}

export async function getAttachmentLibrary(query = ''): Promise<AttachmentLibraryItem[]> {
  const supabase = await createSupabaseServerClient();
  let attachmentQuery = supabase
    .from('attachments')
    .select('id,task_id,file_name,mime_type,byte_size,is_evidence,uploaded_by,created_at')
    .order('created_at', { ascending: false })
    .limit(500);
  if (query.trim()) attachmentQuery = attachmentQuery.ilike('file_name', `%${query.trim()}%`);

  const { data: attachments, error } = await attachmentQuery;
  if (error) {
    console.error(`[getAttachmentLibrary] ${error.message}`);
    throw new Error('ATTACHMENTS_UNAVAILABLE');
  }
  if (!attachments?.length) return [];

  const taskIds = [...new Set(attachments.map((row) => row.task_id as string))];
  const userIds = [...new Set(attachments.map((row) => row.uploaded_by as string))];
  const attachmentIds = attachments.map((row) => row.id as string);
  const [tasksResult, usersResult, viewsResult] = await Promise.all([
    supabase.from('task_overview').select('id,title').in('id', taskIds),
    supabase.from('user_profiles').select('id,full_name').in('id', userIds),
    supabase.from('attachment_views').select('attachment_id').in('attachment_id', attachmentIds),
  ]);

  const taskNames = new Map((tasksResult.data ?? []).map((row) => [row.id, row.title]));
  const userNames = new Map((usersResult.data ?? []).map((row) => [row.id, row.full_name]));
  const viewCounts = new Map<string, number>();
  for (const row of viewsResult.data ?? []) {
    const id = row.attachment_id as string;
    viewCounts.set(id, (viewCounts.get(id) ?? 0) + 1);
  }

  return attachments.map((row) => ({
    id: row.id as string,
    taskId: row.task_id as string,
    taskTitle: (taskNames.get(row.task_id as string) as string) ?? 'Authorised work item',
    fileName: row.file_name as string,
    mimeType: row.mime_type as string,
    byteSize: Number(row.byte_size),
    isEvidence: Boolean(row.is_evidence),
    uploadedByName: (userNames.get(row.uploaded_by as string) as string) ?? 'Team member',
    createdAt: row.created_at as string,
    viewCount: viewCounts.get(row.id as string) ?? 0,
  }));
}

export interface AuditHistoryItem {
  id: string;
  eventType: string;
  occurredAt: string;
  actorName: string;
  taskId: string | null;
  taskTitle: string | null;
  previousStatus: string | null;
  newStatus: string | null;
  detail: Record<string, unknown>;
  isReversal: boolean;
}

export async function getAuditHistory(query = ''): Promise<AuditHistoryItem[]> {
  const supabase = await createSupabaseServerClient();
  const { data: events, error } = await supabase
    .from('audit_events')
    .select(
      'id,event_type,occurred_at,actor_id,task_id,previous_status,new_status,detail,reversal_of_event_id',
    )
    .order('occurred_at', { ascending: false })
    .limit(500);
  if (error) {
    console.error(`[getAuditHistory] ${error.message}`);
    throw new Error('AUDIT_UNAVAILABLE');
  }

  const actorIds = [
    ...new Set((events ?? []).flatMap((row) => (row.actor_id ? [row.actor_id] : []))),
  ];
  const taskIds = [...new Set((events ?? []).flatMap((row) => (row.task_id ? [row.task_id] : [])))];
  const [usersResult, tasksResult] = await Promise.all([
    actorIds.length
      ? supabase.from('user_profiles').select('id,full_name').in('id', actorIds)
      : Promise.resolve({ data: [] }),
    taskIds.length
      ? supabase.from('task_overview').select('id,title').in('id', taskIds)
      : Promise.resolve({ data: [] }),
  ]);
  const names = new Map((usersResult.data ?? []).map((row) => [row.id, row.full_name]));
  const titles = new Map((tasksResult.data ?? []).map((row) => [row.id, row.title]));
  const needle = query.trim().toLowerCase();

  return (events ?? [])
    .map((row) => ({
      id: row.id as string,
      eventType: row.event_type as string,
      occurredAt: row.occurred_at as string,
      actorName: row.actor_id
        ? ((names.get(row.actor_id as string) as string) ?? 'Authorised user')
        : 'System',
      taskId: (row.task_id as string) ?? null,
      taskTitle: row.task_id ? ((titles.get(row.task_id as string) as string) ?? null) : null,
      previousStatus: (row.previous_status as string) ?? null,
      newStatus: (row.new_status as string) ?? null,
      detail: (row.detail as Record<string, unknown>) ?? {},
      isReversal: Boolean(row.reversal_of_event_id),
    }))
    .filter(
      (row) =>
        !needle ||
        row.eventType.toLowerCase().includes(needle) ||
        row.actorName.toLowerCase().includes(needle) ||
        row.taskTitle?.toLowerCase().includes(needle),
    );
}

export interface PersonalSettingsData {
  alerts: {
    barrierInvolvingMe: boolean;
    assignmentChanges: boolean;
    collaborationHandoff: boolean;
    dueTodayAndDeadlines: boolean;
    routineUpcoming: boolean;
  };
  organisation: Array<{
    key: string;
    value: unknown;
    description: string;
    managerEditable: boolean;
  }>;
  recentDeliveries: Array<{
    id: string;
    subject: string;
    status: string;
    queuedAt: string;
    sentAt: string | null;
    lastError: string | null;
  }>;
}

export async function getSettingsData(userId: string): Promise<PersonalSettingsData> {
  const supabase = await createSupabaseServerClient();
  const [alertsResult, orgResult, deliveriesResult] = await Promise.all([
    supabase.from('user_alert_preferences').select('*').eq('user_id', userId).maybeSingle(),
    supabase.from('org_settings').select('key,value,description,manager_editable').order('key'),
    supabase
      .from('email_deliveries')
      .select('id,subject,status,queued_at,sent_at,last_error')
      .eq('recipient_id', userId)
      .order('queued_at', { ascending: false })
      .limit(8),
  ]);
  const alerts = alertsResult.data;
  return {
    alerts: {
      barrierInvolvingMe: alerts?.barrier_involving_me ?? true,
      assignmentChanges: alerts?.assignment_changes ?? true,
      collaborationHandoff: alerts?.collaboration_handoff ?? true,
      dueTodayAndDeadlines: alerts?.due_today_and_deadlines ?? true,
      routineUpcoming: alerts?.routine_upcoming ?? true,
    },
    organisation: (orgResult.data ?? []).map((row) => ({
      key: row.key as string,
      value: row.value,
      description: row.description as string,
      managerEditable: Boolean(row.manager_editable),
    })),
    recentDeliveries: (deliveriesResult.data ?? []).map((row) => ({
      id: row.id as string,
      subject: row.subject as string,
      status: row.status as string,
      queuedAt: row.queued_at as string,
      sentAt: (row.sent_at as string) ?? null,
      lastError: (row.last_error as string) ?? null,
    })),
  };
}

export interface DirectoryUser {
  id: string;
  employeeId: string;
  email: string;
  fullName: string;
  departmentId: string | null;
  departmentName: string;
  role: 'team_member' | 'manager' | 'administrator';
  reportingManagerId: string | null;
  status: 'active' | 'deactivated';
  personalSummaryMode: 'off' | 'focused' | 'standard';
  teamSummaryMode: 'off' | 'leadership' | 'detailed';
  createdAt: string;
}

export interface DirectoryData {
  users: DirectoryUser[];
  departments: Array<{ id: string; code: string; name: string }>;
}

export async function getDirectoryData(): Promise<DirectoryData> {
  const supabase = await createSupabaseServerClient();
  const [usersResult, departmentsResult] = await Promise.all([
    supabase.from('user_profiles').select('*').order('full_name').limit(500),
    supabase.from('departments').select('id,code,name').order('name'),
  ]);
  if (usersResult.error) throw new Error('DIRECTORY_UNAVAILABLE');
  const departmentNames = new Map(
    (departmentsResult.data ?? []).map((row) => [row.id as string, row.name as string]),
  );
  return {
    users: (usersResult.data ?? []).map((row) => ({
      id: row.id as string,
      employeeId: row.employee_id as string,
      email: row.email as string,
      fullName: row.full_name as string,
      departmentId: (row.department_id as string) ?? null,
      departmentName: row.department_id
        ? (departmentNames.get(row.department_id as string) ?? 'Unknown department')
        : 'Unassigned',
      role: row.role as DirectoryUser['role'],
      reportingManagerId: (row.reporting_manager_id as string) ?? null,
      status: row.status as DirectoryUser['status'],
      personalSummaryMode: row.personal_summary_mode as DirectoryUser['personalSummaryMode'],
      teamSummaryMode: row.team_summary_mode as DirectoryUser['teamSummaryMode'],
      createdAt: row.created_at as string,
    })),
    departments: (departmentsResult.data ?? []).map((row) => ({
      id: row.id as string,
      code: row.code as string,
      name: row.name as string,
    })),
  };
}

export interface VisibilityData {
  mode: 'specific_only' | 'direct_reports_plus' | 'none';
  selectedSubjectIds: string[];
  effective: Array<{ userId: string; fullName: string; employeeId: string; source: string }>;
}

export async function getVisibilityData(viewerId: string): Promise<VisibilityData> {
  const supabase = await createSupabaseServerClient();
  const [policyResult, grantsResult, previewResult] = await Promise.all([
    supabase.from('visibility_policies').select('mode').eq('viewer_id', viewerId).maybeSingle(),
    supabase.from('visibility_grants').select('subject_id').eq('viewer_id', viewerId),
    supabase.rpc('preview_effective_visibility', { p_viewer_id: viewerId }),
  ]);
  if (previewResult.error) {
    console.error(`[preview_effective_visibility] ${previewResult.error.message}`);
    throw new Error('VISIBILITY_UNAVAILABLE');
  }
  return {
    mode: (policyResult.data?.mode as VisibilityData['mode'] | undefined) ?? 'specific_only',
    selectedSubjectIds: (grantsResult.data ?? []).map((row) => row.subject_id as string),
    effective: (previewResult.data ?? []).map(
      (row: { user_id: string; full_name: string; employee_id: string; source: string }) => ({
        userId: row.user_id as string,
        fullName: row.full_name as string,
        employeeId: row.employee_id as string,
        source: row.source as string,
      }),
    ),
  };
}
