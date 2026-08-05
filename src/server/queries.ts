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
