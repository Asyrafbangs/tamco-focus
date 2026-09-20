import 'server-only';

import type {
  ActionPriority,
  ActionState,
  EshAccess,
  EshPreset,
  FindingSource,
  FindingStatus,
  RegisterFilter,
  RiskLevel,
} from '@/domain/esh-findings';
import type { ConversationEntry, EvidenceFile, SubmissionMark } from '@/domain/esh-guest';
import type { Database } from '@/lib/database.types';
import { createSupabaseServerClient } from '@/lib/supabase/server';

/**
 * Finding Management reads (v197).
 *
 * Everything here runs as the signed-in person, so RLS decides what comes back:
 * a department outside their scope, or the whole module while their access is
 * off, simply returns nothing. Filters and counts go to the database through
 * `esh_register_rows`, one definition for every list and number (§24).
 */

export const REGISTER_PAGE_SIZE = 50;

export interface RegisterListRow {
  findingId: string;
  reference: string;
  title: string;
  location: string | null;
  departmentName: string | null;
  status: FindingStatus;
  isRestricted: boolean;
  riskLevel: RiskLevel;
  actionState: ActionState | null;
  priority: ActionPriority | null;
  dueAt: string | null;
  dueIsDateOnly: boolean;
  actionCount: number;
  ownerEmail: string | null;
  notificationHeld: boolean;
  isOverdue: boolean;
  needsAttention: boolean;
  lastUpdateAt: string;
  lastUpdateType: string;
  closedAt: string | null;
}

/**
 * Characters PostgREST's `or` syntax gives meaning to. A search box is text,
 * not a filter expression, so they are removed before it is used as one.
 */
function searchTerm(value: string): string {
  return value
    .replace(/[,()*%\\:"']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

export async function listRegister(options: {
  filter: RegisterFilter;
  search: string;
  departmentId: string | null;
  closedWithinDays: number;
  page: number;
}): Promise<{ rows: RegisterListRow[]; total: number; failed: boolean }> {
  const supabase = await createSupabaseServerClient();
  let query = supabase.from('esh_register_rows').select('*', { count: 'exact' });

  switch (options.filter) {
    case 'attention':
      query = query.eq('needs_attention', true);
      break;
    case 'open':
      query = query.in('status', ['draft', 'new', 'open']);
      break;
    case 'overdue':
      query = query.eq('status', 'open').eq('is_overdue', true);
      break;
    case 'closed': {
      const since = new Date(Date.now() - options.closedWithinDays * 86_400_000).toISOString();
      query = query.eq('status', 'closed').gte('closed_at', since);
      break;
    }
  }

  if (options.departmentId) {
    query = query.eq('accountable_department_id', options.departmentId);
  }

  const term = searchTerm(options.search);
  if (term) {
    query = query.or(
      ['reference', 'title', 'owner_email', 'location', 'department_name']
        .map((column) => `${column}.ilike.*${term}*`)
        .join(','),
    );
  }

  query =
    options.filter === 'closed'
      ? query.order('closed_at', { ascending: false }).order('reference')
      : query.order('due_at', { ascending: true, nullsFirst: false }).order('reference');

  const from = Math.max(0, options.page) * REGISTER_PAGE_SIZE;
  const { data, count, error } = await query.range(from, from + REGISTER_PAGE_SIZE - 1);

  if (error) {
    console.error(`[listRegister] ${error.code ?? 'unknown'}: ${error.message}`);
    // A failed read is not an empty register (§33.2).
    return { rows: [], total: 0, failed: true };
  }

  return {
    total: count ?? 0,
    failed: false,
    rows: (data ?? []).map((row) => ({
      findingId: String(row.finding_id),
      reference: String(row.reference),
      title: String(row.title),
      location: row.location ?? null,
      departmentName: row.department_name ?? null,
      status: row.status as FindingStatus,
      isRestricted: Boolean(row.is_restricted),
      riskLevel: (row.risk_level ?? 'not_assessed') as RiskLevel,
      actionState: (row.action_state ?? null) as ActionState | null,
      priority: (row.priority ?? null) as ActionPriority | null,
      dueAt: row.due_at ?? null,
      dueIsDateOnly: Boolean(row.due_is_date_only),
      actionCount: Number(row.action_count ?? 0),
      ownerEmail: row.owner_email ?? null,
      notificationHeld: Boolean(row.notification_held),
      isOverdue: Boolean(row.is_overdue),
      needsAttention: Boolean(row.needs_attention),
      lastUpdateAt: String(row.last_update_at),
      lastUpdateType: String(row.last_update_type),
      closedAt: row.closed_at ?? null,
    })),
  };
}

export interface DepartmentOption {
  id: string;
  name: string;
}

/** Active departments the person may file findings against or filter by. */
export async function getDepartmentsInScope(access: EshAccess): Promise<DepartmentOption[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('departments')
    .select('id, name')
    .eq('status', 'active')
    .order('name');
  if (error) {
    console.error(`[getDepartmentsInScope] ${error.message}`);
    return [];
  }
  const allowed = new Set(access.departmentIds);
  return (data ?? [])
    .filter((department) => access.scopeAll || allowed.has(String(department.id)))
    .map((department) => ({ id: String(department.id), name: String(department.name) }));
}

export interface VerifierOption {
  userId: string;
  fullName: string;
  email: string;
}

export async function getVerifiers(): Promise<VerifierOption[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('esh_list_verifiers');
  if (error) {
    console.error(`[getVerifiers] ${error.message}`);
    return [];
  }
  const rows = (data ?? []) as Array<{ user_id: string; full_name: string; email: string }>;
  return rows.map((row) => ({
    userId: String(row.user_id),
    fullName: String(row.full_name),
    email: String(row.email),
  }));
}

export interface EscalationRecipient {
  level: number;
  email: string;
}

export interface FindingDetail {
  id: string;
  reference: string;
  title: string;
  description: string | null;
  source: FindingSource;
  sourceReference: string | null;
  reportedOn: string | null;
  location: string | null;
  departmentId: string | null;
  departmentName: string | null;
  riskLevel: RiskLevel;
  isRestricted: boolean;
  status: FindingStatus;
  createdAt: string;
  createdByName: string;
  action: {
    id: string;
    title: string;
    requiredOutcome: string | null;
    evidenceInstruction: string | null;
    priority: ActionPriority | null;
    state: ActionState;
    ownerEmail: string | null;
    draftOwnerEmail: string | null;
    dueAt: string | null;
    baselineDueAt: string | null;
    dueIsDateOnly: boolean;
    reviewerUserId: string | null;
    reviewerName: string | null;
    noFurtherEscalationReason: string | null;
    escalation: EscalationRecipient[];
    assignedAt: string | null;
    ownerAccessEnabled: boolean;
  } | null;
  notifications: Array<{
    id: string;
    eventType: string;
    state: string;
    stateReason: string | null;
    stoppedRetrying: boolean;
    createdAt: string;
    recipient: string | null;
    recipientEnabled: boolean;
  }>;
  /** v198 - the owner conversation of the first action, oldest first. */
  conversation: ConversationEntry[];
  /** v200 - actions on this finding that are still open. */
  openActionCount: number;
  /** v200 - how it was closed, and whether it was reopened. */
  closure: {
    closedAt: string | null;
    closedByName: string | null;
    closureNote: string | null;
    reopenedAt: string | null;
    reopenedByName: string | null;
    reopenReason: string | null;
  };
  /** v200 - every decision on this action, and every due-date change. */
  decisions: Array<{
    version: number;
    decision: 'accepted' | 'changes_requested';
    method: string | null;
    note: string | null;
    verifierName: string;
    verifiedAt: string;
  }>;
  dueChanges: Array<{
    oldDueAt: string | null;
    newDueAt: string;
    reason: string;
    cause: string;
    changedByName: string;
    changedAt: string;
  }>;
  /** v199 - the finding's own evidence, and what the owner submitted. */
  originalEvidence: EvidenceFile[];
  submissions: SubmissionMark[];
  pendingSubmission: {
    id: string;
    version: number;
    submittedAt: string;
    ownerEmail: string;
    resultText: string;
    files: EvidenceFile[];
  } | null;
  history: Array<{
    eventType: string;
    occurredAt: string;
    actorName: string;
    detail: Record<string, unknown>;
  }>;
}

/** One finding as ESH reads it, or null when it is not theirs to see. */
export async function getFindingDetail(findingId: string): Promise<FindingDetail | null> {
  const supabase = await createSupabaseServerClient();
  const { data: finding, error } = await supabase
    .from('esh_findings')
    .select('*')
    .eq('id', findingId)
    .maybeSingle();
  if (error) {
    console.error(`[getFindingDetail] ${error.message}`);
    return null;
  }
  if (!finding) return null;

  const [actionResult, outboxResult, auditResult, departmentResult] = await Promise.all([
    supabase
      .from('esh_finding_actions')
      .select('*')
      .eq('finding_id', findingId)
      .order('sequence')
      .limit(1)
      .maybeSingle(),
    supabase
      .from('esh_notification_outbox')
      .select(
        'id, event_type, state, state_reason, next_attempt_at, created_at, recipient_principal_id, recipient_user_id',
      )
      .eq('finding_id', findingId)
      .order('created_at'),
    supabase
      .from('esh_audit_events')
      .select('event_type, occurred_at, actor_kind, actor_user_id, detail')
      .eq('finding_id', findingId)
      .order('occurred_at'),
    finding.accountable_department_id
      ? supabase
          .from('departments')
          .select('name')
          .eq('id', finding.accountable_department_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const action = actionResult.data;
  const [
    escalationResult,
    peopleResult,
    messagesResult,
    evidenceResult,
    decisionsResult,
    dueChangesResult,
    submissionsResult,
  ] = await Promise.all([
    action
      ? supabase
          .from('esh_action_escalation_recipients')
          .select('level, principal_id')
          .eq('action_id', action.id)
          .is('removed_at', null)
          .order('level')
      : Promise.resolve({ data: [] as Array<{ level: number; principal_id: string }> }),
    supabase
      .from('user_profiles')
      .select('id, full_name')
      .in(
        'id',
        [
          finding.created_by,
          action?.reviewer_user_id,
          ...(auditResult.data ?? []).map((row) => row.actor_user_id),
          ...(outboxResult.data ?? []).map((row) => row.recipient_user_id),
          finding.closed_by,
          finding.reopened_by,
        ].filter((id): id is string => Boolean(id)),
      ),
    action
      ? supabase
          .from('esh_action_messages')
          .select('id, author_kind, author_name, author_email, body, sent_at')
          .eq('action_id', action.id)
          .order('sent_at')
          .limit(500)
      : Promise.resolve({
          data: [] as Array<{
            id: string;
            author_kind: string;
            author_name: string | null;
            author_email: string;
            body: string;
            sent_at: string;
          }>,
        }),
    supabase
      .from('esh_evidence_assets')
      .select('id, original_name, content_type, size_bytes, purpose, message_id, created_at')
      .eq('finding_id', findingId)
      .eq('state', 'ready')
      .order('created_at'),
    action
      ? supabase
          .from('esh_verification_events')
          .select('submission_id, decision, method, note, verifier_user_id, verified_at')
          .eq('action_id', action.id)
          .order('verified_at')
      : Promise.resolve({
          data: [] as Array<{
            submission_id: string;
            decision: string;
            method: string | null;
            note: string | null;
            verifier_user_id: string;
            verified_at: string;
          }>,
        }),
    action
      ? supabase
          .from('esh_due_date_changes')
          .select('old_due_at, new_due_at, reason, cause, changed_by, changed_at')
          .eq('action_id', action.id)
          .order('changed_at')
      : Promise.resolve({
          data: [] as Array<{
            old_due_at: string | null;
            new_due_at: string;
            reason: string;
            cause: string;
            changed_by: string;
            changed_at: string;
          }>,
        }),
    action
      ? supabase
          .from('esh_action_submissions')
          .select(
            'id, version, state, message_id, submitted_at, owner_email, result_text, evidence_asset_ids',
          )
          .eq('action_id', action.id)
          .order('version')
      : Promise.resolve({
          data: [] as Array<{
            id: string;
            version: number;
            state: string;
            message_id: string;
            submitted_at: string;
            owner_email: string;
            result_text: string;
            evidence_asset_ids: string[];
          }>,
        }),
  ]);
  const evidence = (evidenceResult.data ?? []).map((row) => ({
    id: String(row.id),
    name: String(row.original_name),
    type: String(row.content_type ?? ''),
    size: Number(row.size_bytes ?? 0),
    purpose: String(row.purpose),
    messageId: row.message_id ? String(row.message_id) : null,
  }));
  const fileOf = new Map(evidence.map((file) => [file.id, file]));
  const toFile = ({ id, name, type, size }: (typeof evidence)[number]): EvidenceFile => ({
    id,
    name,
    type,
    size,
  });
  const pending = (submissionsResult.data ?? []).find((row) => row.state === 'pending') ?? null;
  const pendingId = pending ? String(pending.id) : null;
  // v200 - accepting the last open action closes the finding, so the button
  // has to say which it is.
  const { count: openActions } = await supabase
    .from('esh_finding_actions')
    .select('id', { count: 'exact', head: true })
    .eq('finding_id', findingId)
    .not('state', 'in', '("accepted","cancelled")');

  const principalIds = [
    action?.owner_principal_id,
    ...(escalationResult.data ?? []).map((row) => row.principal_id),
    ...(outboxResult.data ?? []).map((row) => row.recipient_principal_id),
  ].filter((id): id is string => Boolean(id));
  const { data: principals } = principalIds.length
    ? await supabase
        .from('esh_email_principals')
        .select('id, display_email, access_enabled, status')
        .in('id', principalIds)
    : {
        data: [] as Array<{
          id: string;
          display_email: string;
          access_enabled: boolean;
          status: string;
        }>,
      };
  const emailOf = new Map((principals ?? []).map((row) => [row.id, row.display_email]));
  const reachable = new Set(
    (principals ?? [])
      .filter((row) => row.access_enabled && row.status === 'active')
      .map((row) => row.id),
  );
  const nameOf = new Map(
    (peopleResult.data ?? []).map((row) => [String(row.id), String(row.full_name)]),
  );

  const draftEscalation = Array.isArray(action?.draft_escalation)
    ? (action.draft_escalation as Array<{ level?: number; email?: string }>)
        .filter((entry) => typeof entry?.email === 'string' && typeof entry?.level === 'number')
        .map((entry) => ({ level: entry.level as number, email: entry.email as string }))
    : [];

  return {
    id: String(finding.id),
    reference: String(finding.reference),
    title: String(finding.title),
    description: finding.description ?? null,
    source: finding.source as FindingSource,
    sourceReference: finding.source_reference ?? null,
    reportedOn: finding.reported_on ?? null,
    location: finding.location ?? null,
    departmentId: finding.accountable_department_id ?? null,
    departmentName: (departmentResult.data as { name?: string } | null)?.name ?? null,
    riskLevel: finding.risk_level as RiskLevel,
    isRestricted: Boolean(finding.is_restricted),
    status: finding.status as FindingStatus,
    createdAt: String(finding.created_at),
    createdByName: nameOf.get(String(finding.created_by)) ?? 'ESH',
    action: action
      ? {
          id: String(action.id),
          title: String(action.title),
          requiredOutcome: action.required_outcome ?? null,
          evidenceInstruction: action.evidence_instruction ?? null,
          priority: (action.priority ?? null) as ActionPriority | null,
          state: action.state as ActionState,
          ownerEmail: action.owner_principal_id
            ? (emailOf.get(action.owner_principal_id) ?? null)
            : null,
          draftOwnerEmail: action.draft_owner_email ?? null,
          dueAt: action.due_at ?? null,
          baselineDueAt: action.baseline_due_at ?? null,
          dueIsDateOnly: Boolean(action.due_is_date_only),
          reviewerUserId: action.reviewer_user_id ?? null,
          reviewerName: action.reviewer_user_id
            ? (nameOf.get(String(action.reviewer_user_id)) ?? null)
            : null,
          noFurtherEscalationReason: action.no_further_escalation_reason ?? null,
          escalation:
            action.state === 'draft'
              ? draftEscalation
              : (escalationResult.data ?? []).map((row) => ({
                  level: Number(row.level),
                  email: emailOf.get(row.principal_id) ?? '',
                })),
          assignedAt: action.assigned_at ?? null,
          ownerAccessEnabled: Boolean(
            action.owner_principal_id && reachable.has(action.owner_principal_id),
          ),
        }
      : null,
    notifications: (outboxResult.data ?? []).map((row) => ({
      id: String(row.id),
      eventType: String(row.event_type),
      state: String(row.state),
      stateReason: row.state_reason ?? null,
      stoppedRetrying: row.state === 'failed' && !row.next_attempt_at,
      createdAt: String(row.created_at),
      // v199 - a review request goes to a member of ESH, not to a contact.
      recipient: row.recipient_principal_id
        ? (emailOf.get(row.recipient_principal_id) ?? null)
        : row.recipient_user_id
          ? (nameOf.get(String(row.recipient_user_id)) ?? null)
          : null,
      recipientEnabled: Boolean(
        row.recipient_principal_id && reachable.has(row.recipient_principal_id),
      ),
    })),
    openActionCount: openActions ?? 0,
    closure: {
      closedAt: finding.closed_at ?? null,
      closedByName: finding.closed_by ? (nameOf.get(String(finding.closed_by)) ?? 'ESH') : null,
      closureNote: finding.closure_note ?? null,
      reopenedAt: finding.reopened_at ?? null,
      reopenedByName: finding.reopened_by
        ? (nameOf.get(String(finding.reopened_by)) ?? 'ESH')
        : null,
      reopenReason: finding.reopen_reason ?? null,
    },
    decisions: (decisionsResult.data ?? []).map((row) => ({
      version:
        (submissionsResult.data ?? []).find(
          (submission) => String(submission.id ?? '') === String(row.submission_id),
        )?.version ?? 0,
      decision: row.decision as 'accepted' | 'changes_requested',
      method: row.method ?? null,
      note: row.note ?? null,
      verifierName: nameOf.get(String(row.verifier_user_id)) ?? 'ESH',
      verifiedAt: String(row.verified_at),
    })),
    dueChanges: (dueChangesResult.data ?? []).map((row) => ({
      oldDueAt: row.old_due_at ?? null,
      newDueAt: String(row.new_due_at),
      reason: String(row.reason),
      cause: String(row.cause),
      changedByName: nameOf.get(String(row.changed_by)) ?? 'ESH',
      changedAt: String(row.changed_at),
    })),
    conversation: (messagesResult.data ?? []).map((row) => ({
      id: String(row.id),
      authorKind: row.author_kind === 'owner' ? 'owner' : 'staff',
      authorName: row.author_name ?? null,
      authorEmail: row.author_email ?? null,
      body: String(row.body),
      sentAt: String(row.sent_at),
      files: evidence.filter((file) => file.messageId === String(row.id)).map(toFile),
    })),
    originalEvidence: evidence.filter((file) => file.purpose === 'original').map(toFile),
    submissions: (submissionsResult.data ?? []).map((row) => ({
      messageId: String(row.message_id),
      version: Number(row.version),
      state: row.state as SubmissionMark['state'],
    })),
    pendingSubmission: pending
      ? {
          id: String(pendingId),
          version: Number(pending.version),
          submittedAt: String(pending.submitted_at),
          ownerEmail: String(pending.owner_email),
          resultText: String(pending.result_text),
          files: ((pending.evidence_asset_ids ?? []) as string[])
            .map((id) => fileOf.get(String(id)))
            .filter((file): file is (typeof evidence)[number] => Boolean(file))
            .map(toFile),
        }
      : null,
    history: (auditResult.data ?? []).map((row) => ({
      eventType: String(row.event_type),
      occurredAt: String(row.occurred_at),
      actorName: row.actor_user_id
        ? (nameOf.get(String(row.actor_user_id)) ?? 'ESH')
        : row.actor_kind === 'principal'
          ? 'Action Owner'
          : 'System',
      detail: (row.detail ?? {}) as Record<string, unknown>,
    })),
  };
}

export interface StaffEshAccess {
  enabled: boolean;
  preset: EshPreset;
  scopeAll: boolean;
  departmentIds: string[];
  includeDescendants: boolean;
  canManageReports: boolean;
  authorizationVersion: number;
  enabledAt: string | null;
  enabledByName: string | null;
  bootstrap: boolean;
}

/**
 * One person's Finding access, for the administrator's Identity & Access page.
 * Administrators read access rows; they read no findings by doing so.
 */
export async function getStaffEshAccessForAdmin(userId: string): Promise<{
  access: StaffEshAccess | null;
  rolloutConfigured: boolean;
}> {
  const supabase = await createSupabaseServerClient();
  const [accessResult, rolloutResult] = await Promise.all([
    supabase.from('esh_staff_access').select('*').eq('user_id', userId).maybeSingle(),
    supabase.from('esh_rollout_settings').select('organization_id').limit(1),
  ]);
  const rolloutConfigured = (rolloutResult.data ?? []).length > 0;
  const row = accessResult.data;
  if (!row) return { access: null, rolloutConfigured };

  const [departmentsResult, enablerResult] = await Promise.all([
    supabase
      .from('esh_staff_access_departments')
      .select('department_id, include_descendants')
      .eq('access_id', row.id),
    row.enabled_by
      ? supabase.from('user_profiles').select('full_name').eq('id', row.enabled_by).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  return {
    rolloutConfigured,
    access: {
      enabled: Boolean(row.enabled),
      preset: row.preset as EshPreset,
      scopeAll: Boolean(row.scope_all_departments),
      departmentIds: (departmentsResult.data ?? []).map((entry) => String(entry.department_id)),
      includeDescendants: (departmentsResult.data ?? []).some((entry) => entry.include_descendants),
      canManageReports: Boolean(row.can_manage_reports),
      authorizationVersion: Number(row.authorization_version),
      enabledAt: row.enabled_at ?? null,
      enabledByName: (enablerResult.data as { full_name?: string } | null)?.full_name ?? null,
      bootstrap: Boolean(row.enabled) && !row.enabled_by,
    },
  };
}

export interface EmailContact {
  id: string;
  email: string;
  displayName: string | null;
  status: string;
  accessEnabled: boolean;
  accessChangedAt: string | null;
  accessChangedBy: string | null;
  accessReason: string | null;
  openActions: number;
  escalationRoutes: number;
  heldNotifications: number;
  createdAt: string;
}

/**
 * Email contacts, for an administrator maintaining their access (v198,
 * §31.3). Counts only: administration is not a view of the findings (§43.1).
 */
export async function listEmailContacts(search: string): Promise<EmailContact[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('esh_admin_contacts', { p_search: search });
  if (error) {
    console.error(`[listEmailContacts] ${error.message}`);
    return [];
  }
  const rows = (data ?? []) as Database['public']['Functions']['esh_admin_contacts']['Returns'];
  return rows.map((row) => ({
    id: String(row.id),
    email: String(row.display_email),
    displayName: row.display_name ?? null,
    status: String(row.status),
    accessEnabled: Boolean(row.access_enabled),
    accessChangedAt: row.access_changed_at ?? null,
    accessChangedBy: row.access_changed_by ?? null,
    accessReason: row.access_reason ?? null,
    openActions: Number(row.open_actions ?? 0),
    escalationRoutes: Number(row.escalation_routes ?? 0),
    heldNotifications: Number(row.held_notifications ?? 0),
    createdAt: String(row.created_at),
  }));
}

export interface VerificationQueueRow {
  submissionId: string;
  findingId: string;
  actionId: string;
  reference: string;
  title: string;
  location: string | null;
  departmentName: string | null;
  priority: ActionPriority | null;
  ownerEmail: string;
  version: number;
  submittedAt: string;
  files: number;
}

/**
 * What is waiting for ESH (v200, §13). One row per pending submission,
 * oldest first; RLS decides which findings the reader may see at all.
 */
export async function listVerificationQueue(): Promise<VerificationQueueRow[]> {
  const supabase = await createSupabaseServerClient();
  const { data: submissions, error } = await supabase
    .from('esh_action_submissions')
    .select('id, action_id, version, submitted_at, owner_email, evidence_asset_ids')
    .eq('state', 'pending')
    .order('submitted_at')
    .limit(200);
  if (error) {
    console.error(`[listVerificationQueue] ${error.message}`);
    return [];
  }
  const actionIds = (submissions ?? []).map((row) => String(row.action_id));
  if (actionIds.length === 0) return [];
  const { data: rows } = await supabase
    .from('esh_register_rows')
    .select('finding_id, action_id, reference, title, location, department_name, priority')
    .in('action_id', actionIds);
  const findingOf = new Map((rows ?? []).map((row) => [String(row.action_id), row]));
  return (submissions ?? [])
    .map((submission) => {
      const row = findingOf.get(String(submission.action_id));
      if (!row) return null;
      return {
        submissionId: String(submission.id),
        findingId: String(row.finding_id),
        actionId: String(submission.action_id),
        reference: String(row.reference),
        title: String(row.title),
        location: row.location ?? null,
        departmentName: row.department_name ?? null,
        priority: (row.priority ?? null) as ActionPriority | null,
        ownerEmail: String(submission.owner_email),
        version: Number(submission.version),
        submittedAt: String(submission.submitted_at),
        files: (submission.evidence_asset_ids ?? []).length,
      };
    })
    .filter((row): row is VerificationQueueRow => row !== null);
}

/** The same rule as the queue, for the count beside the menu item. */
export async function countAwaitingVerification(): Promise<number> {
  const supabase = await createSupabaseServerClient();
  const { count, error } = await supabase
    .from('esh_action_submissions')
    .select('id', { count: 'exact', head: true })
    .eq('state', 'pending');
  if (error) {
    console.error(`[countAwaitingVerification] ${error.message}`);
    return 0;
  }
  return count ?? 0;
}
