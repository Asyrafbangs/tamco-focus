import 'server-only';

import { cache } from 'react';

import { createSupabaseServerClient } from '@/lib/supabase/server';
import { barrierHref } from '@/domain/barriers';
import { describeRecurrence, patternFromRow } from '@/domain/routines';
import {
  attentionPriority,
  resolveAttentionAction,
  type AttentionCtaType,
  type AttentionKind,
  type AttentionSourceType,
} from '@/domain/attention';
import { FOCUS_BUCKET_WORD } from '@/domain/types';
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

    assignedById: (row.assigned_by as string) ?? null,
    assignedByName: (row.assigned_by_name as string) ?? null,
    assignmentBatchId: (row.assignment_batch_id as string) ?? null,
    classificationRuleCode: (row.classification_rule_code as string) ?? null,
    classificationRuleText: (row.classification_rule_text as string) ?? null,

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

type TeamAttentionTask = Pick<
  TaskOverview,
  | 'id'
  | 'title'
  | 'status'
  | 'workClass'
  | 'focusBucket'
  | 'isMandatory'
  | 'primaryOwnerId'
  | 'lastMeaningfulUpdateAt'
  | 'isOverdue'
  | 'isStale'
>;

function toTeamAttentionTask(row: Record<string, unknown>): TeamAttentionTask {
  return {
    id: String(row.id),
    title: String(row.title),
    status: row.status as TaskOverview['status'],
    workClass: row.work_class as TaskOverview['workClass'],
    focusBucket: (row.focus_bucket as FocusBucket | null) ?? null,
    isMandatory: Boolean(row.is_mandatory),
    primaryOwnerId: String(row.primary_owner_id),
    lastMeaningfulUpdateAt: String(row.last_meaningful_update_at),
    isOverdue: Boolean(row.is_overdue),
    isStale: Boolean(row.is_stale),
  };
}

type TeamMemberTask = TeamAttentionTask &
  Pick<
    TaskOverview,
    | 'progressPercent'
    | 'dueAt'
    | 'dueIsDateOnly'
    | 'version'
    | 'occurrenceDate'
    | 'checklistTotal'
    | 'checklistCompleted'
  >;

function toTeamMemberTask(row: Record<string, unknown>): TeamMemberTask {
  return {
    ...toTeamAttentionTask(row),
    progressPercent: Number(row.progress_percent ?? 0),
    dueAt: row.due_at ? String(row.due_at) : null,
    dueIsDateOnly: Boolean(row.due_is_date_only),
    version: Number(row.version ?? 1),
    occurrenceDate: row.occurrence_date ? String(row.occurrence_date) : null,
    checklistTotal: Number(row.checklist_total ?? 0),
    checklistCompleted: Number(row.checklist_completed ?? 0),
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

/**
 * How much Available work is waiting across the team, without loading it.
 *
 * Counted on every load rather than only when the tab is open. The Bin badge
 * was built the other way and read 0 everywhere until you clicked it, which is
 * the failure mode a badge exists to prevent.
 */
export async function getTeamAvailableCount(viewerId: string): Promise<number> {
  const team = await getTeamLoad(viewerId);
  const ownerIds = team.map((person) => person.userId);
  if (ownerIds.length === 0) return 0;

  const supabase = await createSupabaseServerClient();
  const { count, error } = await supabase
    .from('task_overview')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'backlog')
    // Task RLS also permits individual collaborations. My Team is a people
    // scope, so an unrelated peer must not enter it merely because one of
    // their tasks was shared with the viewer.
    .in('primary_owner_id', ownerIds)
    .neq('work_class', 'routine_occurrence');

  if (error) {
    console.error(`[getTeamAvailableCount] ${error.message}`);
    return 0;
  }
  return count ?? 0;
}

/** One person's Available work, for the team view. */
export interface TeamAvailableGroup {
  ownerId: string;
  ownerName: string;
  tasks: Array<{
    id: string;
    title: string;
    workClass: TaskOverview['workClass'];
    dueAt: string | null;
    dueIsDateOnly: boolean;
  }>;
}

/**
 * Available work across everybody the caller may see, grouped by owner.
 *
 * A manager could see that a report had five Available items, but not what any
 * of them were — the number was on the My Team row and the list behind it was
 * `getMyTasks`, which is filtered to the caller. So the one question a manager
 * asks before assigning anything else ("what is already waiting on them?") had
 * no answer in the product.
 *
 * Bounded entirely by RLS: `task_overview` is `security_invoker`, so this
 * returns exactly the work the caller was already entitled to see and nothing
 * more. The caller's own Available work is excluded because My Work → Available
 * is where that lives; repeating it here would double-count the totals.
 */
export async function getTeamAvailableWork(
  viewerId: string,
): Promise<{ groups: TeamAvailableGroup[]; failed: boolean }> {
  const team = await getTeamLoad(viewerId);
  const ownerNames = new Map(team.map((person) => [person.userId, person.fullName]));
  const ownerIds = [...ownerNames.keys()];
  if (ownerIds.length === 0) return { groups: [], failed: false };

  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from('task_overview')
    // Team Available renders five fields. Selecting the full projection also
    // calculated checklist, evidence, attachment and collaborator aggregates
    // for every row, then discarded them.
    .select('id,title,work_class,primary_owner_id,due_at,due_is_date_only')
    .eq('status', 'backlog')
    .in('primary_owner_id', ownerIds)
    .order('due_at', { ascending: true, nullsFirst: false })
    .limit(500);

  if (error) {
    // Reported, never rendered as "nobody has anything waiting" — that is a
    // claim about the team, and a failed query does not support it.
    console.error(`[getTeamAvailableWork] ${error.message}`);
    return { groups: [], failed: true };
  }

  const rows = (data ?? []).filter((row) => row.work_class !== 'routine_occurrence');

  const byOwner = new Map<string, TeamAvailableGroup>();
  for (const row of rows) {
    const ownerId = String(row.primary_owner_id);
    let group = byOwner.get(ownerId);
    if (!group) {
      group = { ownerId, ownerName: ownerNames.get(ownerId) ?? 'Team member', tasks: [] };
      byOwner.set(ownerId, group);
    }
    group.tasks.push({
      id: String(row.id),
      title: String(row.title),
      workClass: row.work_class as TaskOverview['workClass'],
      dueAt: row.due_at ? String(row.due_at) : null,
      dueIsDateOnly: Boolean(row.due_is_date_only),
    });
  }

  // Busiest first: the person a manager most needs to think about before
  // handing out anything else.
  return {
    failed: false,
    groups: [...byOwner.values()].sort(
      (a, b) => b.tasks.length - a.tasks.length || a.ownerName.localeCompare(b.ownerName),
    ),
  };
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

export interface TaskDetailChecklistItem {
  id: string;
  action: string;
  assignedTo: string | null;
  assignedName: string | null;
  evidenceRule: 'not_required' | 'optional' | 'required';
  dueAt: string | null;
  dependsOnItemId: string | null;
  state: 'waiting' | 'ready' | 'completed';
  /**
   * Whether this viewer may tick or untick this particular step. Task-wide
   * contribute authority is not enough: a step is a claim about one named
   * person's work, so it belongs to them and to whoever assigned it. Mirrors
   * `focus.can_complete_checklist_item`, which is the authority.
   */
  canComplete: boolean;
  /** Why the step is parked, when it is. Two unrelated rules put it there. */
  waitingReason: string | null;
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
  /** v44 section 17 — shapes the manager's primary control, nothing more. */
  actionType: 'decision' | 'approval' | 'support' | 'escalation' | 'other';
  /** Who was asked. A barrier addressed to nobody reaches nobody. */
  actionRequiredFromName: string | null;
  /** Whether that person still owes an answer (v45 sections 37-38). */
  actionPending: boolean;
  /** Already on the meeting agenda, so the control says so (v46 section 46). */
  inMeetingQueue: boolean;
  /** When the discussion is booked, if it is (v47 sections 14, 35). */
  scheduledDiscussionAt: string | null;
  /** True when the signed-in viewer is the one being asked. */
  actionRequiredFromViewer: boolean;
  /** Replies. A reply is never a resolution (section 16). */
  responses: Array<{
    id: string;
    authorName: string;
    message: string;
    createdAt: string;
    kind: 'answer' | 'approved' | 'changes_requested';
  }>;
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
    /** Owner or their manager. Excludes contributors, who finish steps not results. */
    canComplete: boolean;
    /** The creator only. Deleting says the task should never have existed. */
    canDelete: boolean;
    /** v52 — a manager act, never the owner's own (section 3.4). */
    canReassign: boolean;
    canCancel: boolean;
  };
  checklist: TaskDetailChecklistItem[];
  updates: TaskDetailUpdate[];
  attachments: TaskDetailAttachment[];
  barriers: TaskDetailBarrier[];
  collaborators: Array<{ id: string; fullName: string; employeeId: string }>;
  participants: Array<{ id: string; fullName: string }>;
  relatedWork: Array<{ id: string; title: string; relation: string }>;
  /**
   * v52 — findings recorded on this routine occurrence.
   *
   * Read back so recording one is not write-only: an inspection that noted a
   * problem should show that it did, and link to the work it raised.
   */
  routineFindings: Array<{
    id: string;
    severity: 'minor' | 'significant' | 'immediate_risk';
    description: string;
    recordedByName: string;
    recordedAt: string;
    createdTaskId: string | null;
  }>;
  activity: TaskDetailActivity[];
}

/**
 * Complete task-detail read model. Each table is queried as the signed-in user,
 * so RLS remains the authority. The second-stage name lookup is presentation
 * only; missing profile visibility falls back to a neutral label.
 */
export async function getTaskDetail(taskId: string, viewerId: string): Promise<TaskDetail | null> {
  const supabase = await createSupabaseServerClient();
  const [
    taskResult,
    checklistResult,
    barriersResult,
    updatesResult,
    attachmentsResult,
    barrierResponsesResult,
    findingsResult,
    meetingQueueResult,
  ] = await Promise.all([
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
    // Fetched with the barriers rather than on demand: a manager about to
    // reply needs to see what has already been said.
    supabase
      .from('barrier_responses')
      .select('id, barrier_id, author_id, message, created_at, kind')
      .order('created_at', { ascending: true }),
    // Read with the barriers so the Add to Meeting Queue control knows its own
    // state on first paint, rather than offering an action already taken.
    supabase
      .from('routine_findings')
      .select('id, severity, description, recorded_by, recorded_at, created_task_id')
      .eq('occurrence_task_id', taskId)
      .order('recorded_at', { ascending: false }),
    supabase
      .from('meeting_queue_items')
      .select(
        'barrier_id, status, calendar_events!meeting_queue_items_scheduled_event_id_fkey(starts_at)',
      )
      .in('status', ['open', 'queued', 'scheduled']),
  ]);

  const queuedBarrierIds = new Set(
    (meetingQueueResult.data ?? [])
      .map((row) => (row.barrier_id ? String(row.barrier_id) : null))
      .filter((value): value is string => value !== null),
  );

  // A booked discussion changes what the banner should say, so it travels with
  // the barrier rather than being fetched again by whoever renders it.
  const scheduledDiscussionByBarrier = new Map<string, string>();
  for (const row of meetingQueueResult.data ?? []) {
    const event = row.calendar_events as { starts_at?: string } | null;
    if (row.barrier_id && event?.starts_at) {
      scheduledDiscussionByBarrier.set(String(row.barrier_id), String(event.starts_at));
    }
  }

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
      (row) =>
        [row.raised_by, row.resolved_by, row.action_required_from].filter(Boolean) as string[],
    ),
    ...(barrierResponsesResult.data ?? []).map((row) => row.author_id as string),
    ...updates.map((row) => row.author_id as string),
    ...(mentions ?? []).map((row) => row.user_id as string),
    ...(attachmentsResult.data ?? []).map((row) => row.uploaded_by as string),
    ...(activityResult.data ?? []).map((row) => row.actor_id as string).filter(Boolean),
  ]);
  const { data: people } = personIds.size
    ? await supabase
        .from('team_directory')
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
  const overview = toTaskOverview(taskResult.data as Record<string, unknown>);

  return {
    task: overview,
    capabilities: {
      canView: Boolean(rawCapabilities.can_view),
      canContribute: Boolean(rawCapabilities.can_contribute),
      canEdit: Boolean(rawCapabilities.can_edit),
      canReview: Boolean(rawCapabilities.can_review),
      canComplete: Boolean(rawCapabilities.can_complete),
      canDelete: Boolean(rawCapabilities.can_delete),
      canReassign: Boolean(rawCapabilities.can_reassign),
      canCancel: Boolean(rawCapabilities.can_cancel),
    },
    checklist: (checklistResult.data ?? []).map((row) => {
      const assignedTo = (row.assigned_to as string) ?? null;
      const state = row.state as TaskDetailChecklistItem['state'];
      /*
       * The branches are in the order `focus.recalculate_checklist_readiness`
       * applies them, so the sentence names the rule that actually parked the
       * step. A contributor told "an earlier step must finish first" when the
       * truth is "the owner has not started" goes looking for a prerequisite
       * that does not exist.
       */
      const waitingReason =
        state !== 'waiting'
          ? null
          : overview.status !== 'active' && assignedTo && assignedTo !== overview.primaryOwnerId
            ? `${personName(taskResult.data.primary_owner_id)} has not started this work yet. Your step opens when they activate it.`
            : row.depends_on_item_id
              ? 'An earlier step must be completed first.'
              : 'This step is not ready to be completed yet.';
      return {
        id: row.id as string,
        action: row.action as string,
        assignedTo,
        assignedName: assignedTo ? personName(assignedTo) : null,
        evidenceRule: row.evidence_rule as TaskDetailChecklistItem['evidenceRule'],
        dueAt: (row.due_at as string) ?? null,
        dependsOnItemId: (row.depends_on_item_id as string) ?? null,
        state,
        canComplete: assignedTo === viewerId || Boolean(rawCapabilities.can_edit),
        waitingReason,
        completedByName: row.completed_by ? personName(row.completed_by) : null,
        completedAt: (row.completed_at as string) ?? null,
        completionNote: (row.completion_note as string) ?? null,
      };
    }),
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
      actionType: (row.action_type as TaskDetailBarrier['actionType']) ?? 'support',
      actionRequiredFromName: row.action_required_from
        ? personName(row.action_required_from)
        : null,
      actionPending: Boolean(row.action_pending),
      inMeetingQueue: queuedBarrierIds.has(String(row.id)),
      scheduledDiscussionAt: scheduledDiscussionByBarrier.get(String(row.id)) ?? null,
      actionRequiredFromViewer: row.action_required_from === viewerId,
      responses: (barrierResponsesResult.data ?? [])
        .filter((response) => response.barrier_id === row.id)
        .map((response) => ({
          id: String(response.id),
          authorName: personName(response.author_id),
          message: String(response.message),
          createdAt: String(response.created_at),
          kind: (response.kind ?? 'answer') as TaskDetailBarrier['responses'][number]['kind'],
        })),
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
    routineFindings: (findingsResult.data ?? []).map((row) => ({
      id: String(row.id),
      severity: row.severity as TaskDetail['routineFindings'][number]['severity'],
      description: String(row.description),
      recordedByName: personName(row.recorded_by),
      recordedAt: String(row.recorded_at),
      createdTaskId: row.created_task_id ? String(row.created_task_id) : null,
    })),
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
  eventKind: 'due' | 'overdue' | 'routine' | 'review' | 'discussion';
  /** Set on a booked discussion, so the calendar can link to the request. */
  eventId: string | null;
  barrierId: string | null;
}

/**
 * Whose dated work the Monthly Plan shows.
 *
 * `mine` is one person's calendar. `team` asks for everything the caller is
 * authorised to see, which for a manager or an administrator is their own work
 * plus the reporting line their visibility settings cover. It is not a wider
 * grant: `plan_events` is a `security_invoker` view, so the same RLS that
 * governs `tasks` decides which rows come back. Dropping the owner filter asks
 * the database the question; it does not answer it.
 */
export type PlanScope = 'mine' | 'team';

/**
 * Task IDs where this person is a collaborator or holds an assigned checklist
 * step — work that is shared with them but owned by somebody else.
 *
 * Section 13 makes shared work a first-class case: a contributor is committed
 * to a date they did not set, so the date has to reach them. Both tables are
 * RLS-scoped to rows the caller may already read, and both queries filter on
 * the caller's own id, so this can only ever return work they are part of.
 */
export async function getSharedTaskIds(userId: string): Promise<string[]> {
  const supabase = await createSupabaseServerClient();

  const [collaborations, checklistSteps] = await Promise.all([
    supabase.from('task_collaborators').select('task_id').eq('user_id', userId).limit(400),
    supabase.from('task_checklist_items').select('task_id').eq('assigned_to', userId).limit(400),
  ]);

  if (collaborations.error) console.error(`[getSharedTaskIds] ${collaborations.error.message}`);
  if (checklistSteps.error) console.error(`[getSharedTaskIds] ${checklistSteps.error.message}`);

  const ids = new Set<string>();
  for (const row of collaborations.data ?? []) ids.add(String(row.task_id));
  for (const row of checklistSteps.data ?? []) ids.add(String(row.task_id));
  return [...ids];
}

/** Display names for a specific set of people, from the active directory. */
export async function getUserNames(userIds: readonly string[]): Promise<Map<string, string>> {
  if (userIds.length === 0) return new Map();

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('team_directory')
    .select('id, full_name')
    .in('id', [...userIds]);

  if (error) {
    console.error(`[getUserNames] ${error.message}`);
    return new Map();
  }

  return new Map((data ?? []).map((row) => [String(row.id), String(row.full_name)]));
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
  scope: PlanScope = 'mine',
): Promise<PlanEvent[]> {
  const supabase = await createSupabaseServerClient();

  let request = supabase.from('plan_events').select('*');
  if (scope === 'mine') {
    // "Mine" means work this person is committed to, which includes work
    // somebody else owns but shares with them. A contributor who cannot see the
    // date cannot plan around it.
    const shared = await getSharedTaskIds(userId);
    request =
      shared.length > 0
        ? request.or(`primary_owner_id.eq.${userId},task_id.in.(${shared.join(',')})`)
        : request.eq('primary_owner_id', userId);
  }

  const { data, error } = await request
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
    eventId: row.event_id ? String(row.event_id) : null,
    barrierId: row.barrier_id ? String(row.barrier_id) : null,
  }));
}

/** One person's row in Team Focus (section 18.3). */
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
 * Team Focus (section 18).
 *
 * Returns only the people the caller is authorised to see — RLS on the
 * underlying view does the filtering, so a manager sees their reporting line
 * and an administrator sees everyone, without this query knowing the rule.
 * The caller's own row is excluded: Team Focus is about other people's load.
 */
/**
 * How many active people report to this person.
 *
 * The My Team scope used to appear for anybody holding the manager role, which
 * meant a manager with nobody reporting to them was offered a workspace that
 * could only ever be empty. The role says what somebody is permitted to do;
 * this says whether there is anything to do it to, and the control is worth
 * showing only when both are true.
 */
export interface RoutineTemplateRow {
  id: string;
  title: string;
  description: string | null;
  ownerId: string;
  ownerName: string;
  frequency: 'daily' | 'weekly' | 'monthly' | 'yearly';
  intervalCount: number;
  weekday: number | null;
  weekdays: number[] | null;
  monthlyMode: string | null;
  dayOfMonth: number | null;
  nthWeekday: number | null;
  nthWeekdayDow: number | null;
  monthOfYear: number | null;
  startDate: string | null;
  endsMode: string | null;
  endsAfterCount: number | null;
  endsOnDate: string | null;
  dueTime: string;
  evidenceRequired: boolean;
  requiresCompletionReview: boolean;
  isActive: boolean;
  createdBy: string;
  occurrenceCount: number;
  /** The soonest occurrence that already exists as a task. */
  nextOccurrenceDate: string | null;
  /**
   * What the schedule says is next, whether or not a task exists for it.
   *
   * Generation only runs a fortnight ahead, so a routine due next month has
   * nothing generated and used to read "nothing scheduled yet" — which is what
   * a broken routine reads like too. The schedule always knows its next date;
   * this is it.
   */
  scheduledNextDate: string | null;
}

/**
 * The routines somebody can see, bounded by the existing SELECT policy: a
 * manager sees their team's, everybody sees their own.
 */
export async function getRoutineTemplates(): Promise<{
  templates: RoutineTemplateRow[];
  failed: boolean;
}> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from('routine_template_overview')
    .select('*')
    // Binned routines live in the Bin, not in the list they were removed from.
    .is('deleted_at', null)
    .order('is_active', { ascending: false })
    .order('title', { ascending: true })
    .limit(200);

  if (error) {
    // Reported rather than shown as "no routines", which would read as a fact
    // about the team's work instead of a failed query.
    console.error(`[getRoutineTemplates] ${error.message}`);
    return { templates: [], failed: true };
  }

  return {
    failed: false,
    templates: (data ?? []).map((row) => ({
      id: String(row.id),
      title: String(row.title),
      description: row.description ? String(row.description) : null,
      ownerId: String(row.default_owner_id),
      ownerName: String(row.owner_name ?? ''),
      frequency: row.frequency as RoutineTemplateRow['frequency'],
      intervalCount: Number(row.interval_count ?? 1),
      weekday: row.weekday === null ? null : Number(row.weekday),
      weekdays: Array.isArray(row.weekdays) ? row.weekdays.map(Number) : null,
      monthlyMode: row.monthly_mode ? String(row.monthly_mode) : null,
      dayOfMonth: row.day_of_month === null ? null : Number(row.day_of_month),
      nthWeekday: row.nth_weekday === null ? null : Number(row.nth_weekday),
      nthWeekdayDow: row.nth_weekday_dow === null ? null : Number(row.nth_weekday_dow),
      monthOfYear: row.month_of_year === null ? null : Number(row.month_of_year),
      startDate: row.start_date ? String(row.start_date) : null,
      endsMode: row.ends_mode ? String(row.ends_mode) : null,
      endsAfterCount: row.ends_after_count === null ? null : Number(row.ends_after_count),
      endsOnDate: row.ends_on_date ? String(row.ends_on_date) : null,
      dueTime: String(row.due_time ?? '17:00'),
      evidenceRequired: Boolean(row.evidence_required),
      requiresCompletionReview: Boolean(row.requires_completion_review),
      isActive: Boolean(row.is_active),
      createdBy: String(row.created_by ?? ''),
      occurrenceCount: Number(row.occurrence_count ?? 0),
      nextOccurrenceDate: row.next_occurrence_date ? String(row.next_occurrence_date) : null,
      scheduledNextDate: row.scheduled_next_date ? String(row.scheduled_next_date) : null,
    })),
  };
}

export interface BinnedRoutine {
  id: string;
  title: string;
  ownerName: string;
  recurrence: string;
  deletedAt: string;
}

/**
 * Routines in the Bin.
 *
 * A schedule and a task are deleted for the same reason — it should not exist —
 * so they come back the same way. Kept as its own query rather than folded into
 * `getBinnedTasks` because restoring one is a different procedure with a
 * different consequence: a routine returns paused, so nothing is generated
 * until somebody decides it should be.
 */
export async function getBinnedRoutines(viewerId: string): Promise<{
  routines: BinnedRoutine[];
  failed: boolean;
}> {
  const supabase = await createSupabaseServerClient();
  // Scoped to the deleter for the same reason as tasks, and more urgently:
  // `routine_templates_select` grants every manager sight of every routine in
  // the organisation, so an unscoped Bin would show one manager the schedules
  // another had just removed.
  const { data, error } = await supabase
    .from('routine_template_overview')
    .select('*')
    .eq('deleted_by', viewerId)
    .not('deleted_at', 'is', null)
    // Emptied out of the Bin: retained in the database, gone from the app.
    .is('purged_at', null)
    .order('deleted_at', { ascending: false })
    .limit(100);

  if (error) {
    console.error(`[getBinnedRoutines] ${error.message}`);
    return { routines: [], failed: true };
  }

  return {
    failed: false,
    routines: (data ?? []).map((row) => ({
      id: String(row.id),
      title: String(row.title),
      ownerName: String(row.owner_name ?? ''),
      recurrence: describeRecurrence(
        patternFromRow({
          frequency: String(row.frequency),
          intervalCount: Number(row.interval_count ?? 1),
          weekdays: Array.isArray(row.weekdays) ? row.weekdays.map(Number) : null,
          weekday: row.weekday === null ? null : Number(row.weekday),
          monthlyMode: row.monthly_mode ? String(row.monthly_mode) : null,
          dayOfMonth: row.day_of_month === null ? null : Number(row.day_of_month),
          nthWeekday: row.nth_weekday === null ? null : Number(row.nth_weekday),
          nthWeekdayDow: row.nth_weekday_dow === null ? null : Number(row.nth_weekday_dow),
          monthOfYear: row.month_of_year === null ? null : Number(row.month_of_year),
          startDate: row.start_date ? String(row.start_date) : null,
          endsMode: row.ends_mode ? String(row.ends_mode) : null,
          endsAfterCount: row.ends_after_count === null ? null : Number(row.ends_after_count),
          endsOnDate: row.ends_on_date ? String(row.ends_on_date) : null,
        }),
      ),
      deletedAt: String(row.deleted_at),
    })),
  };
}

export interface BinnedTask {
  id: string;
  title: string;
  status: string;
  ownerName: string;
  deletedAt: string;
  deletedByName: string | null;
}

/**
 * What is in the Bin, bounded by what the reader could already see.
 *
 * `binned_tasks` is `security_invoker`, so RLS decides the rows; this only
 * orders and shapes them.
 */
/**
 * How many items are in this person's Bin, without loading them.
 *
 * The tab badge read 0 everywhere except on the Bin itself, because the list
 * was only fetched when that tab was already open — so the one number whose
 * job is to tell you whether it is worth opening was wrong until you opened
 * it. A HEAD count keeps the badge honest without paying for rows nobody is
 * about to render.
 */
export async function getBinnedTaskCount(viewerId: string): Promise<number> {
  const supabase = await createSupabaseServerClient();
  const { count, error } = await supabase
    .from('binned_tasks')
    .select('id', { count: 'exact', head: true })
    .eq('deleted_by', viewerId);

  if (error) {
    console.error(`[getBinnedTaskCount] ${error.message}`);
    return 0;
  }
  return count ?? 0;
}

export async function getBinnedTasks(
  viewerId: string,
): Promise<{ tasks: BinnedTask[]; failed: boolean }> {
  const supabase = await createSupabaseServerClient();

  /*
   * Only what this person deleted.
   *
   * `binned_tasks` is bounded by `focus.can_view_task`, which for a manager
   * covers their entire reporting line — so without this the Bin became a
   * shared list of everybody's deleted work rather than a way back from your
   * own mistake. Deleting is already restricted to the creator, so the person
   * who put something here is the only one who needs it back.
   */
  const { data, error } = await supabase
    .from('binned_tasks')
    .select('id, title, status, owner_name, deleted_at, deleted_by_name')
    .eq('deleted_by', viewerId)
    .order('deleted_at', { ascending: false })
    .limit(200);

  if (error) {
    // Returning an empty list here would render as "The Bin is empty", which
    // states as fact something we do not know. The caller reports the failure
    // instead, because telling somebody their deleted work is gone when the
    // query merely broke is the worst possible answer.
    console.error(`[getBinnedTasks] ${error.message}`);
    return { tasks: [], failed: true };
  }

  return {
    failed: false,
    tasks: (data ?? []).map((row) => ({
      id: String(row.id),
      title: String(row.title),
      status: String(row.status),
      ownerName: String(row.owner_name ?? ''),
      deletedAt: String(row.deleted_at),
      deletedByName: row.deleted_by_name ? String(row.deleted_by_name) : null,
    })),
  };
}

/**
 * How many people this viewer may see, other than themselves.
 *
 * My Team used to be gated on the manager role plus a direct-report count, so
 * an explicit visibility grant bought the recipient nothing: an administrator
 * could tick "Amer may view Izzah and Ajmal", the rule would take effect in
 * every RLS check, and Amer would still have no screen on which to look at
 * them. Granting sight of somebody and giving nowhere to see them is not a
 * setting, it is a dead end.
 *
 * `user_profiles` SELECT is bounded by `focus.can_view_user`, so this count is
 * the visibility rule itself rather than a second opinion about it — reporting
 * line, administrator scope and explicit grants all included, by construction.
 */
export async function getVisiblePeopleCount(
  viewerId: string,
  reportingManagerId: string | null,
): Promise<number> {
  const supabase = await createSupabaseServerClient();

  /*
   * The viewer's own manager is excluded deliberately.
   *
   * `user_profiles_select` permits three things: your own row,
   * `focus.can_view_user(id)`, and your reporting manager's row — that last
   * one so the interface can name the person you report to. It is a licence to
   * read a name, not to see their work. Counting it as "somebody I can see"
   * gave every employee a My Team containing their own manager, which is both
   * wrong and unusable.
   */
  let request = supabase
    .from('user_profiles')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'active')
    .neq('id', viewerId);
  if (reportingManagerId) request = request.neq('id', reportingManagerId);

  const { count, error } = await request;

  if (error) {
    // Never hide a real team because a count failed.
    console.error(`[getVisiblePeopleCount] ${error.message}`);
    return 1;
  }
  return count ?? 0;
}

export async function getDirectReportCount(viewerId: string): Promise<number> {
  const supabase = await createSupabaseServerClient();

  const { count, error } = await supabase
    .from('user_profiles')
    .select('id', { count: 'exact', head: true })
    .eq('reporting_manager_id', viewerId)
    .eq('status', 'active');

  if (error) {
    // A failure here must not hide a real manager's team, so fall back to
    // showing the scope rather than silently removing their workspace.
    console.error(`[getDirectReportCount] ${error.message}`);
    return 1;
  }

  return count ?? 0;
}

async function getTeamLoadUncached(viewerId: string): Promise<TeamLoadRow[]> {
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

/**
 * The Work page and Team Member drawer share this roster during one server
 * render. React cache is request-scoped, so the duplicate callers share the
 * same RLS-bound result without data crossing users or requests.
 */
export const getTeamLoad = cache(getTeamLoadUncached);

export interface MeetingQueueRow {
  id: string;
  taskId: string | null;
  taskTitle: string | null;
  barrierId: string | null;
  summary: string;
  source: string;
  status: string;
  createdAt: string;
  addedByName: string | null;
  requestedByName: string | null;
  scheduledEventId: string | null;
  scheduledAt: string | null;
  /** The one link that opens the request behind this topic (v47 §41). */
  href: string | null;
}

/**
 * Meeting Queue (section 19).
 *
 * Only what needs a decision, support, escalation, reprioritisation, or
 * clarification reaches a meeting. RLS decides whose items are returned, so
 * this query carries no visibility rule of its own.
 */
/**
 * The Meeting Queue, as the Plan drawer needs it (v47 sections 16-17).
 *
 * Enough per topic to decide what to schedule next: what is to be discussed,
 * which work it came from, who is waiting on the answer, who queued it, and
 * whether a time has already been agreed. Anything less and the drawer becomes
 * a list of sentences with no way to act on them.
 */
/**
 * Active colleagues, by name (v47 section 23).
 *
 * The same three-column projection the assignment picker reads. Anywhere the
 * application asks "who could I involve", it asks here, so the answer cannot
 * differ by screen.
 */
export async function getTeamDirectory(): Promise<Array<{ id: string; name: string }>> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from('team_directory')
    .select('id, full_name')
    .order('full_name')
    .limit(200);

  if (error) {
    console.error(`[getTeamDirectory] ${error.message}`);
    return [];
  }

  return (data ?? []).map((row) => ({ id: String(row.id), name: String(row.full_name) }));
}

export async function getMeetingQueue(): Promise<MeetingQueueRow[]> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from('meeting_queue_items')
    // One literal string: the client derives the row type from it, and a
    // concatenated expression is just `string`, which erases every column.
    .select(
      'id, task_id, barrier_id, summary, source, status, created_at, added_by, requested_by, calendar_events!meeting_queue_items_scheduled_event_id_fkey(id, starts_at)',
    )
    // RLS already limits this to work the caller may see; the status filter is
    // about relevance, not authority.
    .in('status', ['open', 'queued', 'scheduled'])
    .order('created_at', { ascending: true })
    .limit(100);

  if (error) {
    console.error(`[getMeetingQueue] ${error.message}`);
    return [];
  }

  const rows = data ?? [];
  const personIds = new Set<string>();
  for (const row of rows) {
    if (row.added_by) personIds.add(String(row.added_by));
    if (row.requested_by) personIds.add(String(row.requested_by));
  }

  const taskIds = [...new Set(rows.map((row) => row.task_id).filter(Boolean))] as string[];

  const [peopleResult, tasksResult] = await Promise.all([
    personIds.size
      ? supabase
          .from('team_directory')
          .select('id, full_name')
          .in('id', [...personIds])
      : Promise.resolve({ data: [] as Array<{ id: string; full_name: string }> }),
    taskIds.length
      ? supabase.from('tasks').select('id, title').in('id', taskIds)
      : Promise.resolve({ data: [] as Array<{ id: string; title: string }> }),
  ]);

  const names = new Map(
    (peopleResult.data ?? []).map((row) => [String(row.id), String(row.full_name)]),
  );
  const titles = new Map(
    (tasksResult.data ?? []).map((row) => [String(row.id), String(row.title)]),
  );

  return rows.map((row) => {
    const event = row.calendar_events as { id?: string; starts_at?: string } | null;
    return {
      id: String(row.id),
      taskId: row.task_id ? String(row.task_id) : null,
      taskTitle: row.task_id ? (titles.get(String(row.task_id)) ?? null) : null,
      barrierId: row.barrier_id ? String(row.barrier_id) : null,
      summary: String(row.summary),
      source: String(row.source),
      status: String(row.status),
      createdAt: String(row.created_at),
      addedByName: row.added_by ? (names.get(String(row.added_by)) ?? 'Team member') : null,
      requestedByName: row.requested_by
        ? (names.get(String(row.requested_by)) ?? 'Team member')
        : null,
      scheduledEventId: event?.id ? String(event.id) : null,
      scheduledAt: event?.starts_at ? String(event.starts_at) : null,
      href:
        row.task_id && row.barrier_id
          ? barrierHref(String(row.task_id), String(row.barrier_id))
          : null,
    };
  });
}

/** Focus counts against targets for everyone the caller may see. */
async function getTeamFocusSummaryUncached(): Promise<FocusSummary[]> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase.from('focus_summary').select('*').limit(600);

  if (error) {
    console.error(`[getTeamFocusSummary] ${error.message}`);
    throw new Error('TEAM_FOCUS_UNAVAILABLE');
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

export const getTeamFocusSummary = cache(getTeamFocusSummaryUncached);

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
    supabase.from('team_directory').select('id,full_name').in('id', userIds),
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
      ? supabase.from('team_directory').select('id,full_name').in('id', actorIds)
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
  /**
   * False when nobody has chosen this mode and it is the default for their
   * role. The distinction matters to the editor: a default has to be shown as
   * a default, because saving the form is what turns it into a decision.
   */
  configured: boolean;
  selectedSubjectIds: string[];
  effective: Array<{ userId: string; fullName: string; employeeId: string; source: string }>;
}

/**
 * What one person can see, as the database understands it.
 *
 * Read through `get_visibility_state` rather than off the policy table. The
 * table only records a decision somebody made; it says nothing about the
 * people nobody has configured, and reading it directly meant treating "no
 * row" as `specific_only` — which stopped being true for managers at v68 and
 * left this screen quietly describing the wrong rule. The procedure answers
 * with the mode actually in force and says whether it was stored or defaulted.
 */
export async function getVisibilityData(viewerId: string): Promise<VisibilityData> {
  const supabase = await createSupabaseServerClient();
  const [stateResult, previewResult] = await Promise.all([
    supabase.rpc('get_visibility_state', { p_viewer_id: viewerId }),
    supabase.rpc('preview_effective_visibility', { p_viewer_id: viewerId }),
  ]);
  if (previewResult.error) {
    console.error(`[preview_effective_visibility] ${previewResult.error.message}`);
    throw new Error('VISIBILITY_UNAVAILABLE');
  }
  const state = stateResult.data as {
    ok?: boolean;
    mode?: VisibilityData['mode'];
    configured?: boolean;
    subject_ids?: string[];
  } | null;
  if (stateResult.error || !state?.ok) {
    console.error(`[get_visibility_state] ${stateResult.error?.message ?? 'refused'}`);
    throw new Error('VISIBILITY_UNAVAILABLE');
  }
  return {
    mode: state.mode ?? 'specific_only',
    configured: state.configured === true,
    selectedSubjectIds: (state.subject_ids ?? []).map(String),
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

/**
 * One person's contribution to somebody else's result (v41 sections 9, 10, 23).
 *
 * This is the ORIGINAL checklist item, not a copy. Shared is a view over
 * `task_checklist_items`, so completing a contribution updates the one record
 * the primary owner is also looking at, and the two can never disagree.
 */
export interface SharedContribution {
  checklistItemId: string;
  taskId: string;
  title: string;
  evidenceRule: string;
  itemDueAt: string | null;
  state: 'waiting' | 'ready' | 'completed';
  completedAt: string | null;
  parentTitle: string;
  parentStatus: string;
  parentWorkClass: string;
  parentDueAt: string | null;
  parentDueIsDateOnly: boolean;
  primaryOwnerId: string;
  primaryOwnerName: string;
  prerequisiteTitle: string | null;
  /** Why this is or is not startable. Derived in SQL so it is worded once. */
  readiness:
    | 'completed'
    | 'waiting_for_owner'
    | 'waiting_parent_paused'
    | 'waiting_prerequisite'
    | 'ready'
    | 'waiting';
}

export async function getSharedContributions(userId: string): Promise<SharedContribution[]> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from('shared_contributions')
    .select('*')
    .eq('assignee_id', userId)
    .order('state', { ascending: true })
    .order('position', { ascending: true })
    .limit(200);

  if (error) {
    console.error(`[getSharedContributions] ${error.message}`);
    return [];
  }

  return (data ?? []).map((row) => ({
    checklistItemId: String(row.checklist_item_id),
    taskId: String(row.task_id),
    title: String(row.title),
    evidenceRule: String(row.evidence_rule),
    itemDueAt: (row.item_due_at as string) ?? null,
    state: row.state as SharedContribution['state'],
    completedAt: (row.completed_at as string) ?? null,
    parentTitle: String(row.parent_title),
    parentStatus: String(row.parent_status),
    parentWorkClass: String(row.parent_work_class),
    parentDueAt: (row.parent_due_at as string) ?? null,
    parentDueIsDateOnly: Boolean(row.parent_due_is_date_only),
    primaryOwnerId: String(row.primary_owner_id),
    primaryOwnerName: String(row.primary_owner_name),
    prerequisiteTitle: (row.prerequisite_title as string) ?? null,
    readiness: row.readiness as SharedContribution['readiness'],
  }));
}

/**
 * People a checklist step may be assigned to (v45 §1-2).
 *
 * Any active member of the team, and deliberately not a manager hierarchy.
 *
 * This previously returned the primary owner plus whoever the viewer could
 * "see" through reporting-line visibility, which for an ordinary employee is
 * roughly their manager and themselves. Collaboration was therefore impossible
 * between peers: Izzah could not ask Fadli to do a step, which is most of what
 * a checklist is for. Visibility rules answer "whose work may I read"; that is
 * a different question from "who may I work with".
 *
 * Authority still lives on the server. RLS on `user_profiles` bounds the
 * directory, and the checklist insert/update policies independently verify the
 * caller may manage this task — the picker cannot grant anything.
 */
export async function getAssignablePeople(
  taskId: string,
): Promise<Array<{ id: string; name: string; isPrimaryOwner: boolean }>> {
  const supabase = await createSupabaseServerClient();

  const [taskResult, peopleResult] = await Promise.all([
    supabase
      .from('task_overview')
      .select('primary_owner_id, owner_name')
      .eq('id', taskId)
      .maybeSingle(),
    // `team_directory` is the names-only projection: it answers "who is here"
    // without widening who may read anybody's work (v45 sections 1-2).
    supabase.from('team_directory').select('id, full_name').order('full_name').limit(200),
  ]);

  if (!taskResult.data) return [];

  const ownerId = String(taskResult.data.primary_owner_id);
  const ordered: Array<{ id: string; name: string; isPrimaryOwner: boolean }> = [];

  // The owner leads and stays labelled — a step is theirs unless somebody
  // deliberately says otherwise — but is no longer the only choice.
  ordered.push({
    id: ownerId,
    name: String(taskResult.data.owner_name),
    isPrimaryOwner: true,
  });

  for (const row of peopleResult.data ?? []) {
    const id = String(row.id);
    if (id === ownerId) continue;
    ordered.push({ id, name: String(row.full_name), isPrimaryOwner: false });
  }

  return ordered;
}

/** One entry in the notification bell (v42 sections M, N, P). */
export interface NotificationEntry {
  id: string;
  kind: string;
  title: string;
  body: string;
  requiresAction: boolean;
  readAt: string | null;
  createdAt: string;
  /** Where clicking goes. Resolved from the entity pair, RLS-checked on open. */
  href: string;
}

function notificationHref(row: Record<string, unknown>): string {
  const entityType = row.entity_type as string | null;
  const entityId = row.entity_id as string | null;
  const taskId = row.task_id as string | null;
  const goalId = row.goal_id as string | null;

  // A checklist item is reached through the task that owns it — Shared is a
  // projection, so there is no separate page to land on. The item id rides
  // along so the drawer can open the checklist and highlight the exact step,
  // rather than dropping somebody on a list to find their own work (v44 §7).
  if (entityType === 'checklist_item' && taskId && entityId) {
    return `/work?tab=shared&task=${taskId}&item=${entityId}`;
  }
  // Same for a barrier: open the task with its barrier section focused, never
  // the team homepage (v44 §22).
  if (entityType === 'barrier' && taskId && entityId) {
    return barrierHref(taskId, entityId);
  }
  // v46 §45 — a legacy notification that recorded only the task still has to
  // land somewhere useful. The drawer resolves the recipient's own open
  // barrier when there is exactly one, and otherwise opens the task normally.
  if (entityType === 'barrier' && taskId) return `/work?task=${taskId}&attention=barrier`;
  // v53 §21 — a request raised against a Goal is still a barrier notification,
  // but it has no task to open. Without this it fell through to My Day: the
  // bell said somebody needed you on a Goal and then took you nowhere near it.
  if (entityType === 'barrier' && goalId) return `/goals?goal=${goalId}`;
  if (entityType === 'goal' && entityId) return `/goals?goal=${entityId}`;
  if (taskId) return `/work?task=${taskId}`;
  if (goalId) return `/goals?goal=${goalId}`;
  return '/today';
}

/**
 * Notifications for the bell.
 *
 * Returns unread actionable items first, then recent read ones for context.
 * The count shown on the bell is deliberately narrower than this list — see
 * `getActionRequiredCount`, which counts only unread AND actionable, so the
 * badge means "things waiting on me" rather than "things that happened".
 */
export async function getNotifications(userId: string): Promise<NotificationEntry[]> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from('notifications')
    .select(
      'id, kind, title, body, requires_action, read_at, created_at, task_id, goal_id, entity_type, entity_id',
    )
    .eq('recipient_id', userId)
    .order('read_at', { ascending: true, nullsFirst: true })
    .order('created_at', { ascending: false })
    .limit(20);

  if (error) {
    console.error(`[getNotifications] ${error.message}`);
    return [];
  }

  return (data ?? []).map((row) => ({
    id: String(row.id),
    kind: String(row.kind),
    title: String(row.title),
    body: String(row.body),
    requiresAction: Boolean(row.requires_action),
    readAt: (row.read_at as string) ?? null,
    createdAt: String(row.created_at),
    href: notificationHref(row as Record<string, unknown>),
  }));
}

/**
 * One person's row in My Team (v44 sections 19, 20, 30, 33, 34).
 *
 * Every field answers one of the three questions a manager actually has: what
 * is this person working on, where do they need me, and what changed.
 *
 * `attention` is null when nothing genuinely needs the manager. That is the
 * point of the exception model — a row that says "nothing needs you" is more
 * useful than an invented reason, and section 19 is explicit that anything
 * appearing as actionable must be able to say why, what to do, and where.
 */
export interface TeamAttentionRow {
  userId: string;
  fullName: string;
  activeCount: number;
  routineDueCount: number;
  /** What they are carrying right now. */
  workingOn: { taskId: string; title: string } | null;
  attention: {
    /**
     * The state, in three words: "Decision needed", "Overdue routine".
     * v46 §23 — a generic "Needs you" makes every row look the same, so a
     * manager has to read all of them to find the one that is theirs.
     */
    headline: string;
    sourceType: AttentionSourceType;
    sourceId: string;
    ctaType: AttentionCtaType;
    reasonCode: string;
    taskId: string | null;
    actionType: string | null;
    /** v49 §55-57 — "Needs you" versus "worth knowing". */
    kind: AttentionKind;
    /** Why this is here, in words a manager can act on. */
    reason: string;
    /** What the manager is being asked to do. */
    requiredAction: string;
    /** Where to do it — the exact record, never a landing page. */
    href: string;
    severity: 'critical' | 'attention';
  } | null;
  latestUpdate: { summary: string; at: string } | null;
}

/**
 * Ranking from section 32. Lower sorts first.
 *
 * Deliberately reuses the conditions the product already treats as
 * exceptional rather than inventing a second severity system.
 */
/**
 * v46 sections 12-17, 22-25 — one derivation of "somebody needs me to act".
 *
 * Notifications, My Day and My Team all ask the same question and must answer
 * it identically, so it is answered once. Three copies of this predicate would
 * become three different definitions of "still waiting on you" — and the one a
 * person trusts is whichever they happened to look at.
 *
 * Deliberately derived, never stored (section 8). A `needs_attention` table
 * would be a second record of a fact the barrier already holds, and the two
 * would disagree the first time a write half-succeeded.
 */
/**
 * v48 §20 — semantic fields, never a pre-joined display string.
 *
 * This used to carry `reason: "Decision — <the entire request>"`, which the
 * card then used as its heading. A barrier request is free prose, so the
 * heading was however long somebody's sentence happened to be, and the layout
 * was only ever as good as the shortest test fixture. Sending the parts
 * separately lets the card decide what is a label, what is a heading and what
 * is a preview — and lets the detail view show the whole thing.
 */
export interface AttentionRequest {
  sourceType: AttentionSourceType;
  sourceId: string;
  ctaType: AttentionCtaType;
  kind: AttentionKind;
  /** Why this exists, in a code the ranking and the wording both read. */
  reasonCode: string;
  /** Null when the request was raised against a Goal rather than a Task (v53 §21). */
  taskId: string | null;
  /** The Goal a Goal request belongs to; null for Task requests. */
  goalId: string | null;
  /** The stable heading. Predictable in a way a free-text request never is. */
  taskTitle: string;
  requestedActionType: string;
  /** The full original text. The card previews it; nothing truncates it here. */
  requestedAction: string;
  requestedByName: string;
  headline: string;
  requiredAction: string;
  href: string;
  createdAt: string;
  /** Booked for discussion, if it is (v47 sections 30-31). */
  scheduledAt: string | null;
  isOverdue: boolean;
}
/**
 * Everything currently waiting on this person (sections 9, 19).
 *
 * The condition is exactly "the barrier is open, this person was asked, and
 * they have not answered yet". Reading the notification is not answering it
 * (section 18), so `read_at` is deliberately absent from this query.
 */
export async function getMyAttention(userId: string): Promise<AttentionRequest[]> {
  const supabase = await createSupabaseServerClient();

  /*
   * v53 §21 — one request engine, read through one projection.
   *
   * A request now hangs off a Task *or* a Goal, and this used to read the table
   * directly and then look the titles up by `task_id`. A Goal request has none,
   * so a single one of them put the literal string "null" into the `in(...)`
   * list, Postgres rejected the whole lookup as an invalid uuid, and every card
   * on the screen — Task requests included — silently fell back to the heading
   * "Work". The same null then produced a CTA pointing at `/work?task=null`.
   *
   * The view resolves the subject and the requester in one read, so there is no
   * second query to poison and no id to stringify.
   */
  const { data, error } = await supabase
    .from('action_requests_overview')
    .select(
      'id, source_type, task_id, goal_id, source_title, support_needed, action_type, raised_at, raised_by_name',
    )
    .eq('status', 'open')
    // v47 §30 — a booked discussion does NOT remove the row. The answer is
    // still owed; only its urgency changes. Filtering on a scheduled meeting
    // here would let a date in the diary quietly discharge an obligation.
    .eq('action_pending', true)
    // v53 §2, §5 — a cancelled parent stops asking. The record is kept; only
    // its claim on somebody's attention ends.
    .eq('source_active', true)
    .eq('action_required_from', userId)
    .order('raised_at', { ascending: false })
    .limit(50);

  if (error) {
    console.error(`[getMyAttention] ${error.message}`);
    return [];
  }

  const rows = data ?? [];
  if (rows.length === 0) return [];

  const scheduledResult = await supabase
    .from('meeting_queue_items')
    .select('barrier_id, calendar_events!meeting_queue_items_scheduled_event_id_fkey(starts_at)')
    .eq('status', 'scheduled')
    .in('barrier_id', [...new Set(rows.map((row) => String(row.id)))]);

  const scheduledByBarrier = new Map<string, string>();
  for (const row of scheduledResult.data ?? []) {
    const event = row.calendar_events as { starts_at?: string } | null;
    if (row.barrier_id && event?.starts_at) {
      scheduledByBarrier.set(String(row.barrier_id), String(event.starts_at));
    }
  }

  const items: AttentionRequest[] = rows.flatMap((row) => {
    const actionType = String(row.action_type ?? 'support');
    const scheduledAt = scheduledByBarrier.get(String(row.id)) ?? null;
    const isGoalRequest = row.source_type === 'goal' && Boolean(row.goal_id);

    /*
     * A Goal request keeps its own identity — two can be open on one Goal — and
     * names the Goal it opens separately. Its reason is what the Goal side of
     * the product calls it, so My Day, My Team and the Goal drawer agree.
     */
    const target = isGoalRequest
      ? {
          sourceType: 'goal' as const,
          sourceId: String(row.id),
          ctaType: 'review_goal' as const,
          reasonCode: 'goal_support_requested',
          taskId: null,
          goalId: String(row.goal_id),
          actionType,
        }
      : {
          sourceType: 'barrier' as const,
          sourceId: String(row.id),
          ctaType: 'barrier_action' as const,
          // The barrier's own request type is the reason; nothing is inferred.
          reasonCode:
            actionType === 'decision'
              ? 'decision_required'
              : actionType === 'approval'
                ? 'approval_required'
                : actionType === 'escalation'
                  ? 'escalation_required'
                  : 'support_required',
          taskId: row.task_id ? String(row.task_id) : null,
          goalId: null,
          actionType,
        };

    // A request whose subject the viewer cannot resolve has no honest
    // destination, so it is not drawn as a control that leads nowhere.
    if (!target.taskId && !target.goalId) return [];

    const action = resolveAttentionAction(target);
    if (!action) return [];

    return [
      {
        ...target,
        kind: 'action_required' as const,
        taskTitle: String(row.source_title ?? 'Work request'),
        requestedActionType: actionType,
        requestedAction: String(row.support_needed),
        requestedByName: String(row.raised_by_name ?? 'Team member'),
        headline: action.badge,
        requiredAction: action.label,
        href: action.href,
        createdAt: String(row.raised_at),
        scheduledAt,
        isOverdue: false,
      },
    ];
  });

  // §7-8 — ordered once, here. A surface that re-sorted would be a second
  // definition of "most important", and the two would disagree.
  const now = new Date();
  return items.sort((left, right) => attentionPriority(left, now) - attentionPriority(right, now));
}

const ATTENTION_RANK = {
  urgent: 0,
  barrier: 1,
  goal: 2,
  overdue: 3,
  routine: 4,
  over_target: 5,
  stale: 6,
} as const;

/**
 * One team member, as their manager needs to see them (v48 sections 37-44).
 *
 * Answers three questions in order — does this person need me, what are they
 * doing, what has actually changed — and then gets out of the way. It is
 * assembled entirely from records that already exist; there is no employee
 * dashboard behind it and no second source of truth about anybody's work.
 */
export interface TeamMemberDetail {
  person: { id: string; fullName: string };
  focus: FocusSummary[];
  attention: TeamAttentionRow['attention'][];
  activeWork: Array<{
    id: string;
    title: string;
    bucket: FocusBucket | null;
    progressPercent: number;
    dueAt: string | null;
    dueIsDateOnly: boolean;
    isOverdue: boolean;
    isMandatory: boolean;
    /** Needed by any operation on this task; optimistic concurrency is not optional. */
    version: number;
  }>;
  recentUpdates: Array<{ id: string; at: string; taskTitle: string; summary: string }>;
  /**
   * What this person finished recently, for a manager reviewing the month.
   *
   * Deliberately bounded to a month rather than paginated: the question is
   * "what did they get done", not "everything they have ever done", and an
   * unbounded history turns a review into a scroll.
   */
  completedRecently: Array<{
    id: string;
    title: string;
    workClass: TaskOverview['workClass'];
    completedAt: string | null;
  }>;
  otherWorkload: {
    available: Array<{
      id: string;
      title: string;
      workClass: TaskOverview['workClass'];
      dueAt: string | null;
      dueIsDateOnly: boolean;
      isOverdue: boolean;
    }>;
    routines: Array<{
      id: string;
      title: string;
      status: TaskOverview['status'];
      occurrenceDate: string | null;
      dueAt: string | null;
      dueIsDateOnly: boolean;
      isOverdue: boolean;
      progressPercent: number;
      checklistTotal: number;
      checklistCompleted: number;
    }>;
    goals: Array<{
      id: string;
      title: string;
      status: 'draft' | 'pending_discussion' | 'active';
      health:
        'on_track' | 'at_risk' | 'off_track' | 'need_attention' | 'support_requested' | 'completed';
      targetDate: string;
      weightPercent: number;
      successMeasureCount: number;
      currentMilestoneTitle: string | null;
    }>;
  };
}

export async function getTeamMemberDetail(
  viewerId: string,
  personId: string,
): Promise<TeamMemberDetail | null> {
  const supabase = await createSupabaseServerClient();

  /*
   * §60-61 — the manager's scope is decided by the database, not by which rows
   * the page happened to render. Reaching this function with somebody else's id
   * returns nothing, because `team_load_summary` and `task_overview` are both
   * filtered by the same visibility rules the list uses.
   */
  const team = await getTeamLoad(viewerId);
  const person = team.find((row) => row.userId === personId);
  if (!person) return null;

  // A month of finished work, counted back from today so the list is never
  // nearly empty just because the calendar month has only just started.
  const completedSince = new Date(Date.now() - 31 * 86_400_000).toISOString();

  const [attentionRows, focusRows, tasksResult, goalsResult, completedResult] = await Promise.all([
    getTeamAttention(viewerId),
    getTeamFocusSummary(),
    supabase
      .from('task_overview')
      .select(
        'id,title,next_action,status,work_class,focus_bucket,is_mandatory,primary_owner_id,last_meaningful_update_at,due_at,due_is_date_only,progress_percent,version,is_overdue,is_stale,occurrence_date,checklist_total,checklist_completed',
      )
      .eq('primary_owner_id', personId)
      .in('status', ['backlog', 'active', 'paused'])
      .order('last_meaningful_update_at', { ascending: false })
      .limit(200),
    supabase
      .from('goal_overview')
      .select(
        'id,title,status,health,target_date,weight_percent,success_measure_count,current_milestone_title',
      )
      .eq('owner_id', personId)
      .in('status', ['draft', 'pending_discussion', 'active'])
      .order('target_date', { ascending: true })
      .limit(100),
    supabase
      .from('task_overview')
      .select('id,title,work_class,completed_at')
      .eq('primary_owner_id', personId)
      .eq('status', 'completed')
      .gte('completed_at', completedSince)
      .order('completed_at', { ascending: false })
      .limit(100),
  ]);

  if (tasksResult.error) {
    console.error(`[getTeamMemberDetail:tasks] ${tasksResult.error.message}`);
    throw new Error('TEAM_MEMBER_UNAVAILABLE');
  }
  if (goalsResult.error) {
    console.error(`[getTeamMemberDetail:goals] ${goalsResult.error.message}`);
    throw new Error('TEAM_MEMBER_UNAVAILABLE');
  }
  if (completedResult.error) {
    console.error(`[getTeamMemberDetail:completed] ${completedResult.error.message}`);
    throw new Error('TEAM_MEMBER_UNAVAILABLE');
  }

  const tasks = (tasksResult.data ?? []).map((row) =>
    toTeamMemberTask(row as Record<string, unknown>),
  );
  const active = tasks.filter(
    (task) => task.status === 'active' && task.workClass !== 'routine_occurrence',
  );
  const available = tasks.filter(
    (task) => task.status === 'backlog' && task.workClass !== 'routine_occurrence',
  );
  const routines = tasks
    // This number has always meant overdue occurrences in the Team summary.
    // Name and list the exact records instead of making zero read as "this
    // person has no routines" or mixing future work into an overdue count.
    .filter((task) => task.workClass === 'routine_occurrence' && task.isOverdue)
    .sort((left, right) =>
      (left.occurrenceDate ?? left.dueAt ?? '').localeCompare(
        right.occurrenceDate ?? right.dueAt ?? '',
      ),
    );

  // §43 — meaningful changes, from the records people actually wrote. Opening
  // a tab is not a change.
  const updatesResult =
    tasks.length > 0
      ? await supabase
          .from('task_updates')
          .select('id, task_id, body, created_at')
          .in(
            'task_id',
            tasks.map((task) => task.id),
          )
          .order('created_at', { ascending: false })
          .limit(5)
      : { data: [], error: null };

  if (updatesResult.error) {
    console.error(`[getTeamMemberDetail:updates] ${updatesResult.error.message}`);
    throw new Error('TEAM_MEMBER_UNAVAILABLE');
  }
  const updates = updatesResult.data ?? [];

  const titles = new Map(tasks.map((task) => [task.id, task.title]));
  const row = attentionRows.find((candidate) => candidate.userId === personId);

  return {
    person: { id: person.userId, fullName: person.fullName },
    focus: focusRows.filter((bucket) => bucket.userId === personId),
    // The list shows a person's single most costly exception; the drawer has
    // room for it in full. Both come from the same derivation.
    attention: row?.attention ? [row.attention] : [],
    activeWork: active.map((task) => ({
      id: task.id,
      title: task.title,
      bucket: task.focusBucket,
      progressPercent: task.progressPercent,
      dueAt: task.dueAt,
      dueIsDateOnly: task.dueIsDateOnly,
      isOverdue: task.isOverdue,
      isMandatory: task.isMandatory,
      version: task.version,
    })),
    recentUpdates: updates.map((update) => ({
      id: String(update.id),
      at: String(update.created_at),
      taskTitle: titles.get(String(update.task_id)) ?? 'Work',
      summary: String(update.body),
    })),
    completedRecently: (completedResult.data ?? []).map((row) => ({
      id: String(row.id),
      title: String(row.title),
      workClass: row.work_class as TaskOverview['workClass'],
      completedAt: row.completed_at ? String(row.completed_at) : null,
    })),
    otherWorkload: {
      available: available.map((task) => ({
        id: task.id,
        title: task.title,
        workClass: task.workClass,
        dueAt: task.dueAt,
        dueIsDateOnly: task.dueIsDateOnly,
        isOverdue: task.isOverdue,
      })),
      routines: routines.map((task) => ({
        id: task.id,
        title: task.title,
        status: task.status,
        occurrenceDate: task.occurrenceDate,
        dueAt: task.dueAt,
        dueIsDateOnly: task.dueIsDateOnly,
        isOverdue: task.isOverdue,
        progressPercent: task.progressPercent,
        checklistTotal: task.checklistTotal,
        checklistCompleted: task.checklistCompleted,
      })),
      goals: (goalsResult.data ?? []).map((goal) => ({
        id: String(goal.id),
        title: String(goal.title),
        status: goal.status as TeamMemberDetail['otherWorkload']['goals'][number]['status'],
        health: goal.health as TeamMemberDetail['otherWorkload']['goals'][number]['health'],
        targetDate: String(goal.target_date),
        weightPercent: Number(goal.weight_percent ?? 0),
        successMeasureCount: Number(goal.success_measure_count ?? 0),
        currentMilestoneTitle: goal.current_milestone_title
          ? String(goal.current_milestone_title)
          : null,
      })),
    },
  };
}

/**
 * My Team's read model keeps semantic target identity beside each exception.
 * Exact task and barrier actions retain the team/filter return context without
 * adding the person layer, so clicking an action never opens Team Member Detail
 * before the requested record.
 */
async function getTeamAttentionUncached(viewerId: string): Promise<TeamAttentionRow[]> {
  const supabase = await createSupabaseServerClient();

  const [team, focus, tasksResult, barriersResult, goalsResult, goalSupportResult] =
    await Promise.all([
      getTeamLoad(viewerId),
      getTeamFocusSummary(),
      supabase
        .from('task_overview')
        // Attention uses identity, state, owner and ageing only. The full view
        // also computes checklist/evidence/attachment aggregates for every
        // task, which made a 500-row Team read spend seconds on data it never
        // rendered.
        .select(
          'id,title,next_action,status,work_class,focus_bucket,is_mandatory,primary_owner_id,last_meaningful_update_at,is_overdue,is_stale',
        )
        .neq('primary_owner_id', viewerId)
        .in('status', ['backlog', 'active', 'paused'])
        .order('last_meaningful_update_at', { ascending: false })
        .limit(500),
      // Barriers addressed to this manager. This is the authoritative record —
      // My Team aggregates it, it does not copy it (section 18).
      // v45 §37 — Needs Attention is derived from `action_pending`, not `status`.
      // A manager who has already given their decision must drop off this list
      // even though the barrier stays open until the blocker is actually gone.
      supabase
        .from('barriers')
        .select('id, task_id, description, support_needed, action_type, raised_at')
        .eq('action_pending', true)
        .eq('action_required_from', viewerId)
        .order('raised_at', { ascending: false })
        .limit(100),
      supabase
        .from('goal_overview')
        .select(
          'id, owner_id, title, health, quarterly_requires_manager_action, manager_attention_reason',
        )
        .eq('status', 'active')
        .eq('manager_id', viewerId)
        .eq('manager_needs_attention', true)
        .limit(100),
      supabase
        .from('goal_support_requests')
        .select('goal_id, details, created_at')
        .eq('manager_id', viewerId)
        .eq('status', 'open')
        .order('created_at', { ascending: false })
        .limit(100),
    ]);

  const failed = [
    ['tasks', tasksResult.error],
    ['barriers', barriersResult.error],
    ['goals', goalsResult.error],
    ['goal support', goalSupportResult.error],
  ].find((entry) => entry[1]);
  if (failed) {
    const error = failed[1] as { message: string };
    console.error(`[getTeamAttention:${failed[0]}] ${error.message}`);
    throw new Error('TEAM_ATTENTION_UNAVAILABLE');
  }

  const tasks = (tasksResult.data ?? []).map((row) =>
    toTeamAttentionTask(row as Record<string, unknown>),
  );
  const barriers = barriersResult.data ?? [];
  const goals = goalsResult.data ?? [];

  // The old derivation scanned every task, focus bucket, barrier and Goal for
  // every person. Index once by owner so Team remains linear as either side
  // grows, and preserve source ordering inside each bucket.
  const tasksByOwner = new Map<string, TeamAttentionTask[]>();
  const taskOwner = new Map<string, string>();
  for (const task of tasks) {
    taskOwner.set(task.id, task.primaryOwnerId);
    const bucket = tasksByOwner.get(task.primaryOwnerId);
    if (bucket) bucket.push(task);
    else tasksByOwner.set(task.primaryOwnerId, [task]);
  }

  const focusByUser = new Map<string, FocusSummary[]>();
  for (const bucket of focus) {
    const existing = focusByUser.get(bucket.userId);
    if (existing) existing.push(bucket);
    else focusByUser.set(bucket.userId, [bucket]);
  }

  const barrierByOwner = new Map<string, (typeof barriers)[number]>();
  for (const barrier of barriers) {
    const ownerId = taskOwner.get(String(barrier.task_id));
    if (ownerId && !barrierByOwner.has(ownerId)) barrierByOwner.set(ownerId, barrier);
  }

  const goalsByOwner = new Map<string, typeof goals>();
  for (const goal of goals) {
    const ownerId = String(goal.owner_id);
    const existing = goalsByOwner.get(ownerId);
    if (existing) existing.push(goal);
    else goalsByOwner.set(ownerId, [goal]);
  }

  const goalSupportByGoal = new Map<string, string>();
  for (const request of goalSupportResult.data ?? []) {
    const goalId = String(request.goal_id);
    // The query is newest-first. Keep its first row so an older unresolved
    // request cannot silently replace the current reason in My Team.
    if (!goalSupportByGoal.has(goalId)) {
      goalSupportByGoal.set(goalId, String(request.details));
    }
  }

  return team.map((person) => {
    const theirs = tasksByOwner.get(person.userId) ?? [];
    const active = theirs.filter((task) => task.status === 'active');
    const buckets = focusByUser.get(person.userId) ?? [];
    const overTarget = buckets.find((bucket) => bucket.isOverTarget);

    const theirBarrier = barrierByOwner.get(person.userId);
    const theirGoal = (goalsByOwner.get(person.userId) ?? []).sort((left, right) => {
      const rank = (goal: (typeof goals)[number]) => {
        if (goalSupportByGoal.has(String(goal.id)) || goal.health === 'support_requested') {
          return 0;
        }
        if (goal.quarterly_requires_manager_action) return 1;
        if (goal.health === 'off_track') return 2;
        return 3;
      };
      return rank(left) - rank(right);
    })[0];

    // Ordered by what costs most to ignore (section 32), and each branch
    // carries all three of reason / action / destination together — so a row
    // can never appear without being able to explain itself.
    const candidates: Array<{
      rank: number;
      /** v49 §55 — does the manager owe something, or merely need to know? */
      kind?: AttentionKind;
      sourceType: AttentionSourceType;
      sourceId: string;
      ctaType: AttentionCtaType;
      reasonCode: string;
      taskId?: string | null;
      actionType?: string | null;
      reason: string;
      severity: 'critical' | 'attention';
    }> = [];

    /*
     * v48 §9-13, §28 — mandatory work is not, by itself, manager attention.
     *
     * The old rule was `isMandatory → Needs Attention`, with the CTA "Review
     * controlled action". That failed the invariant in §52 on every count: it
     * could not say why the manager was being shown it, what they should do, or
     * where they would do it. Clicking through landed on an ordinary task with
     * no manager control on it, so the honest answer to "what now?" was
     * "nothing" — and a queue that cries wolf stops being read.
     *
     * Mandatory means the work could not wait for normal prioritisation. It has
     * already been decided; there is nothing to approve. It becomes the
     * manager's problem only when something else is true as well, and each of
     * those cases is handled below on its own terms: an over-target workload, a
     * barrier addressed to them, or work that is genuinely overdue.
     *
     * Mandatory work running normally stays visible under Everyone, where it is
     * information rather than an unanswered question.
     */
    const mandatoryOverTarget =
      overTarget &&
      theirs.find(
        (task) =>
          task.isMandatory && task.status === 'active' && task.focusBucket === overTarget.bucket,
      );

    if (mandatoryOverTarget && overTarget) {
      candidates.push({
        rank: ATTENTION_RANK.urgent,
        sourceType: 'focus_exception',
        sourceId: person.userId,
        ctaType: 'review_workload',
        reasonCode: 'workload_review',
        // §54 — the reason states the condition, in the numbers the manager
        // recognises from the capacity strip.
        reason:
          `Mandatory work put ${person.fullName.split(' ')[0]} at ` +
          `${overTarget.activeCount}/${overTarget.recommendedTarget} ${FOCUS_BUCKET_WORD[overTarget.bucket] ?? ''}`.trim(),
        severity: 'critical',
      });
    }

    if (theirBarrier) {
      // v46 §11, §24, §58 — the same wording and the same destination as My Day
      // and the notification, because they are the same request. A manager who
      // sees "Decision — Appoint alternative contractor" in one place and
      // "1 barrier" in another has to work out that they are one thing.
      const actionType = String(theirBarrier.action_type);
      candidates.push({
        rank: ATTENTION_RANK.barrier,
        sourceType: 'barrier',
        sourceId: String(theirBarrier.id),
        ctaType: 'barrier_action',
        reasonCode:
          actionType === 'decision'
            ? 'decision_required'
            : actionType === 'approval'
              ? 'approval_required'
              : actionType === 'escalation'
                ? 'escalation_required'
                : 'support_required',
        taskId: String(theirBarrier.task_id),
        actionType,
        reason: String(theirBarrier.support_needed),
        severity: 'critical',
      });
    }

    if (theirGoal) {
      const goalId = String(theirGoal.id);
      const supportDetails = goalSupportByGoal.get(goalId);
      const reasonCode =
        supportDetails || theirGoal.health === 'support_requested'
          ? 'goal_support_requested'
          : theirGoal.quarterly_requires_manager_action
            ? 'goal_quarterly_discussion'
            : theirGoal.health === 'off_track'
              ? 'goal_off_track'
              : 'goal_at_risk';
      const title = String(theirGoal.title);
      const reason = supportDetails
        ? String(supportDetails)
        : reasonCode === 'goal_quarterly_discussion'
          ? `${title} is ready for the quarterly discussion.`
          : reasonCode === 'goal_off_track'
            ? `${title} was reported Off track.`
            : `${title} was reported At risk.`;

      candidates.push({
        rank: ATTENTION_RANK.goal,
        sourceType: 'goal',
        sourceId: goalId,
        ctaType: 'review_goal',
        reasonCode,
        reason,
        severity: reasonCode === 'goal_off_track' ? 'critical' : 'attention',
      });
    }

    /*
     * v49 §13-16 — "Proposal to review" is gone.
     *
     * It counted rows in `work_proposals`, sent the manager to `/more/records`
     * and offered "Review proposal". There is no proposal review workflow: no
     * procedure decides one, no screen shows what is being proposed, and no
     * control approves or rejects it. So the manager arrived at a records page
     * and had to ask what they were reviewing — the exact failure §51 forbids.
     *
     * The honest fix is to stop showing it, not to invent the workflow. When a
     * real proposal object gains a real decision surface, it comes back with
     * its own source type and its own destination.
     */

    const overdue = theirs.find(
      (task) => task.isOverdue && task.workClass !== 'routine_occurrence',
    );
    if (overdue) {
      candidates.push({
        rank: ATTENTION_RANK.overdue,
        kind: 'exception',
        sourceType: 'task',
        sourceId: overdue.id,
        ctaType: 'open_task',
        reasonCode: 'overdue',
        taskId: overdue.id,
        reason: overdue.title,
        // §6-7, §23 — "Review with them" could mean open it, message them,
        // change the date, or arrange a meeting. Nobody could predict which,
        // so it named none of them. This opens the work.
        severity: 'critical',
      });
    }

    const overdueRoutine = theirs.find(
      (task) => task.isOverdue && task.workClass === 'routine_occurrence',
    );
    if (overdueRoutine) {
      candidates.push({
        rank: ATTENTION_RANK.routine,
        // §8, §11 — an overdue routine is abnormal, and it is the person's own
        // work to catch up on. Calling it "Needs you" would claim the manager
        // owes a response they do not.
        kind: 'exception',
        sourceType: 'routine_occurrence',
        sourceId: overdueRoutine.id,
        ctaType: 'open_routine',
        reasonCode: 'overdue',
        taskId: overdueRoutine.id,
        reason: overdueRoutine.title,
        severity: 'attention',
      });
    }

    if (overTarget) {
      candidates.push({
        rank: ATTENTION_RANK.over_target,
        sourceType: 'focus_exception',
        sourceId: person.userId,
        ctaType: 'review_workload',
        reasonCode: 'workload_review',
        reason:
          `${overTarget.activeCount}/${overTarget.recommendedTarget} ${FOCUS_BUCKET_WORD[overTarget.bucket] ?? ''} — over the recommended target`.trim(),
        severity: 'attention',
      });
    }

    const stale = theirs.find((task) => task.isStale && task.workClass !== 'routine_occurrence');
    if (stale) {
      candidates.push({
        rank: ATTENTION_RANK.stale,
        kind: 'exception',
        sourceType: 'task',
        sourceId: stale.id,
        ctaType: 'open_task',
        reasonCode: 'awareness',
        taskId: stale.id,
        reason: stale.title,
        // §23 — "Ask for an update" describes a conversation the product does
        // not have. Opening the work is what the button actually does.
        severity: 'attention',
      });
    }

    /*
     * v48 §52, §57 — the validity gate.
     *
     * An item may only reach Needs Attention if it can say why it is there,
     * what the manager should do, and where they would do it. Anything that
     * cannot answer all three is not an exception, it is noise wearing an
     * exception's clothes — and one useless card teaches people to skim the
     * whole list.
     *
     * Enforced here rather than trusted at each call site, because every branch
     * above was written believing it complied, and the one that did not was the
     * one that shipped.
     */
    const valid = candidates.flatMap((candidate) => {
      const action = resolveAttentionAction(candidate, { teamAttention: true });
      if (!candidate.reason.trim() || !action) {
        console.error(
          `[getTeamAttention] dropped an incomplete attention item for ${person.userId}: ` +
            JSON.stringify(candidate),
        );
        return [];
      }
      return [{ ...candidate, action }];
    });

    valid.sort((left, right) => left.rank - right.rank);
    const top = valid[0];

    const mostRecent = theirs[0];

    return {
      userId: person.userId,
      fullName: person.fullName,
      activeCount: active.length,
      routineDueCount: person.routinesOverdue,
      workingOn: active[0] ? { taskId: active[0].id, title: active[0].title } : null,
      attention: top
        ? {
            // Anything that does not say otherwise is something owed: a branch
            // that forgets should over-report rather than hide a request.
            kind: top.kind ?? 'action_required',
            sourceType: top.sourceType,
            sourceId: top.sourceId,
            ctaType: top.ctaType,
            reasonCode: top.reasonCode,
            taskId: top.taskId ?? null,
            actionType: top.actionType ?? null,
            headline: top.action.badge,
            reason: top.reason,
            requiredAction: top.action.label,
            href: top.action.href,
            severity: top.severity,
          }
        : null,
      latestUpdate: mostRecent
        ? { summary: mostRecent.title, at: mostRecent.lastMeaningfulUpdateAt }
        : null,
    };
  });
}

export const getTeamAttention = cache(getTeamAttentionUncached);

export type WorkProposalStatus =
  'pending' | 'changes_requested' | 'approved' | 'declined' | 'rejected';

export interface MajorProjectProposal {
  id: string;
  title: string;
  rationale: string | null;
  proposedById: string;
  proposedByName: string;
  status: WorkProposalStatus;
  decisionNote: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  createdTaskId: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
  lastSubmittedAt: string;
  version: number;
}

export interface MajorProjectProposalDetail extends MajorProjectProposal {
  capabilities: {
    canView: boolean;
    canDecide: boolean;
    canResubmit: boolean;
  };
}

function proposalFromRow(
  row: Record<string, unknown>,
  names: ReadonlyMap<string, string>,
): MajorProjectProposal {
  const proposedById = String(row.proposed_by);
  const decidedBy = row.decided_by ? String(row.decided_by) : null;
  return {
    id: String(row.id),
    title: String(row.title),
    rationale: row.rationale ? String(row.rationale) : null,
    proposedById,
    proposedByName: names.get(proposedById) ?? 'Team member',
    status: String(row.status) as WorkProposalStatus,
    decisionNote: row.decision_note ? String(row.decision_note) : null,
    decidedByName: decidedBy ? (names.get(decidedBy) ?? 'Manager') : null,
    decidedAt: row.decided_at ? String(row.decided_at) : null,
    createdTaskId: row.created_task_id ? String(row.created_task_id) : null,
    payload: (row.payload as Record<string, unknown>) ?? {},
    createdAt: String(row.created_at),
    lastSubmittedAt: String(row.last_submitted_at ?? row.created_at),
    version: Number(row.version ?? 1),
  };
}

/**
 * Visible Major Project proposals. RLS limits this to the proposer, their
 * authorised manager, or an administrator; the list does not reimplement that
 * relationship in application code.
 */
export async function getMajorProjectProposals(): Promise<MajorProjectProposal[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('work_proposals')
    .select('*')
    .eq('kind', 'major_project')
    .order('last_submitted_at', { ascending: false })
    .limit(100);
  if (error) {
    console.error(`[getMajorProjectProposals] ${error.message}`);
    return [];
  }
  const personIds = Array.from(
    new Set(
      (data ?? []).flatMap((row) =>
        [row.proposed_by, row.decided_by].filter((id): id is string => Boolean(id)),
      ),
    ),
  );
  const { data: people } = personIds.length
    ? await supabase.from('team_directory').select('id,full_name').in('id', personIds)
    : { data: [] };
  const names = new Map((people ?? []).map((person) => [person.id, person.full_name]));
  return (data ?? []).map((row) => proposalFromRow(row as Record<string, unknown>, names));
}

export async function getMajorProjectProposalDetail(
  proposalId: string,
): Promise<MajorProjectProposalDetail | null> {
  const supabase = await createSupabaseServerClient();
  const [proposalResult, capabilityResult] = await Promise.all([
    supabase.from('work_proposals').select('*').eq('id', proposalId).maybeSingle(),
    supabase.rpc('get_work_proposal_capabilities', { p_proposal_id: proposalId }),
  ]);
  if (proposalResult.error || !proposalResult.data) return null;
  const row = proposalResult.data;
  const personIds = [row.proposed_by, row.decided_by].filter((id): id is string => Boolean(id));
  const { data: people } = personIds.length
    ? await supabase.from('team_directory').select('id,full_name').in('id', personIds)
    : { data: [] };
  const names = new Map((people ?? []).map((person) => [person.id, person.full_name]));
  const capabilities = (capabilityResult.data ?? {}) as Record<string, unknown>;
  return {
    ...proposalFromRow(row as Record<string, unknown>, names),
    capabilities: {
      canView: Boolean(capabilities.can_view),
      canDecide: Boolean(capabilities.can_decide),
      canResubmit: Boolean(capabilities.can_resubmit),
    },
  };
}
