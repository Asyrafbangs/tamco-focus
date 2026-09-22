import 'server-only';

import { cookies } from 'next/headers';

import type { ActionPriority, ActionState } from '@/domain/esh-findings';
import type { GuestReport, GuestReportRow } from '@/domain/esh-reports';
import {
  MY_ACTIONS_PAGE_SIZE,
  type ConversationEntry,
  type EvidenceFile,
  type MyActionRow,
  type MyActionsFilter,
  type SubmissionMark,
} from '@/domain/esh-guest';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/server';

/**
 * The Action Owner's side of Finding Management (v198, §10, §11, §18, §20).
 *
 * A guest is not a signed-in person and never becomes one: their session is
 * a separate cookie, scoped to `/respond`, holding a random secret. Every
 * read and write here goes through an `esh_guest_*` procedure that takes that
 * secret and re-derives, on each call, who it belongs to, whether their
 * access is on and whether they still own the action. The service-role
 * client is used only to reach those procedures, which are granted to
 * nothing else; no table is read directly.
 */

export const GUEST_COOKIE = 'tamco_esh_guest';

export async function guestSecret(): Promise<string | null> {
  const jar = await cookies();
  const value = jar.get(GUEST_COOKIE)?.value ?? null;
  return value && value.length >= 40 ? value : null;
}

export function guestClient() {
  return createSupabaseServiceRoleClient();
}

export type GuestReportResult =
  | { kind: 'report'; data: GuestReport }
  | { kind: 'no_session' }
  | { kind: 'not_available' }
  | { kind: 'failed' };

/** One immutable report snapshot, or the explicitly requested live view. */
export async function loadGuestReport(runId: string, live: boolean): Promise<GuestReportResult> {
  const secret = await guestSecret();
  if (!secret) return { kind: 'no_session' };
  const { data, error } = await guestClient().rpc('esh_guest_report', {
    p_session: secret,
    p_run_id: runId,
    p_live: live,
  });
  if (error) {
    console.error(`[esh_guest_report] ${error.code ?? 'unknown'}: ${error.message}`);
    return { kind: 'failed' };
  }
  const result = (data ?? {}) as Record<string, unknown> & { ok?: boolean; code?: string };
  if (!result.ok) {
    return result.code === 'no_session' ? { kind: 'no_session' } : { kind: 'not_available' };
  }
  const rows = ((result.rows ?? []) as Array<Record<string, unknown>>).map(
    (row): GuestReportRow => ({
      signal: row.signal as GuestReportRow['signal'],
      departmentName: (row.department_name as string | null) ?? null,
      reference: String(row.reference),
      findingTitle: String(row.finding_title),
      location: (row.location as string | null) ?? null,
      ownerEmail: (row.owner_email as string | null) ?? null,
      actionTitle: (row.action_title as string | null) ?? null,
      actionState: (row.action_state as string | null) ?? null,
      dueAt: (row.due_at as string | null) ?? null,
      dueIsDateOnly: (row.due_is_date_only as boolean | null) ?? null,
      lastUpdateAt: (row.last_update_at as string | null) ?? null,
      closedAt: (row.closed_at as string | null) ?? null,
    }),
  );
  const count = (signal: GuestReportRow['signal']) =>
    rows.filter((row) => row.signal === signal).length;
  return {
    kind: 'report',
    data: {
      mode: result.mode === 'live' ? 'live' : 'snapshot',
      name: String(result.report_name ?? 'Weekly report'),
      capturedAt: String(result.captured_at),
      timezone: String(result.timezone ?? 'Asia/Kuala_Lumpur'),
      closedWindowStart: String(result.closed_window_start),
      closedWindowEnd: String(result.closed_window_end),
      counts: {
        open: Number(result.open_count ?? count('open')),
        overdue: Number(result.overdue_count ?? count('overdue')),
        awaiting: Number(result.awaiting_count ?? count('awaiting_verification')),
        closed: Number(result.closed_count ?? count('closed')),
      },
      rows,
    },
  };
}

export type MyActionsResult =
  | {
      kind: 'list';
      email: string;
      filter: MyActionsFilter;
      counts: Record<MyActionsFilter, number>;
      total: number;
      rows: MyActionRow[];
    }
  | {
      kind: 'action_only';
      email: string;
      actions: Array<{ id: string; reference: string; title: string }>;
    }
  | { kind: 'no_session' }
  | { kind: 'failed' };

export async function loadMyActions(
  filter: MyActionsFilter,
  search: string,
  page: number,
): Promise<MyActionsResult> {
  const secret = await guestSecret();
  if (!secret) return { kind: 'no_session' };
  const { data, error } = await guestClient().rpc('esh_guest_my_actions', {
    p_session: secret,
    p_filter: filter,
    p_search: search,
    p_offset: Math.max(0, page - 1) * MY_ACTIONS_PAGE_SIZE,
    p_limit: MY_ACTIONS_PAGE_SIZE,
  });
  // A failed read is said to be one, never shown as an empty list (§10).
  if (error) {
    console.error(`[esh_guest_my_actions] ${error.code ?? 'unknown'}: ${error.message}`);
    return { kind: 'failed' };
  }
  const result = (data ?? {}) as {
    ok?: boolean;
    code?: string;
    email?: string;
    filter?: MyActionsFilter;
    counts?: { needs?: number; review?: number };
    total?: number;
    rows?: Array<Record<string, unknown>>;
    actions?: Array<{ id: string; reference: string; title: string }>;
  };
  if (!result.ok) {
    if (result.code === 'no_inbox_scope') {
      return { kind: 'action_only', email: result.email ?? '', actions: result.actions ?? [] };
    }
    return result.code === 'no_session' ? { kind: 'no_session' } : { kind: 'failed' };
  }
  return {
    kind: 'list',
    email: result.email ?? '',
    filter: result.filter ?? filter,
    counts: {
      needs: Number(result.counts?.needs ?? 0),
      review: Number(result.counts?.review ?? 0),
    },
    total: Number(result.total ?? 0),
    rows: (result.rows ?? []).map((row) => ({
      id: String(row.id),
      reference: String(row.reference),
      title: String(row.title),
      findingTitle: String(row.finding_title),
      location: (row.location as string | null) ?? null,
      department: (row.department as string | null) ?? null,
      priority: (row.priority as ActionPriority | null) ?? null,
      state: row.state as ActionState,
      dueAt: (row.due_at as string | null) ?? null,
      dueIsDateOnly: Boolean(row.due_is_date_only),
      lastUpdateAt: (row.last_update_at as string | null) ?? null,
    })),
  };
}

export interface GuestAction {
  email: string;
  displayName: string | null;
  principalId: string;
  inboxScope: boolean;
  readOnly: boolean;
  mode: 'owner' | 'escalation';
  escalationLevel: number | null;
  ownerEmail: string | null;
  action: {
    id: string;
    title: string;
    state: ActionState;
    priority: ActionPriority | null;
    requiredOutcome: string | null;
    evidenceInstruction: string | null;
    evidenceRule: 'file_required' | 'no_file_exception';
    dueAt: string | null;
    dueIsDateOnly: boolean;
    assignedAt: string | null;
  };
  finding: {
    reference: string;
    title: string;
    description: string | null;
    location: string | null;
    department: string | null;
    reportedOn: string | null;
  };
  eshContact: { name: string | null; email: string | null };
  messages: ConversationEntry[];
  hasMore: boolean;
  /** v199 - the finding's own evidence, the owner's unsent files, and what was submitted. */
  originalEvidence: EvidenceFile[];
  drafts: EvidenceFile[];
  submissions: SubmissionMark[];
}

function evidenceFiles(value: unknown): EvidenceFile[] {
  return ((Array.isArray(value) ? value : []) as Array<Record<string, unknown>>).map((file) => ({
    id: String(file.id),
    name: String(file.name),
    type: String(file.type ?? ''),
    size: Number(file.size ?? 0),
  }));
}

export type GuestActionResult =
  | { kind: 'action'; data: GuestAction }
  | { kind: 'no_session' }
  | { kind: 'not_available'; inboxScope: boolean }
  | { kind: 'failed' };

export async function loadGuestAction(
  actionId: string,
  before: string | null,
): Promise<GuestActionResult> {
  const secret = await guestSecret();
  if (!secret) return { kind: 'no_session' };
  const { data, error } = await guestClient().rpc('esh_guest_action', {
    p_session: secret,
    p_action_id: actionId,
    p_before: before as string,
  });
  if (error) {
    console.error(`[esh_guest_action] ${error.code ?? 'unknown'}: ${error.message}`);
    return { kind: 'failed' };
  }
  const result = (data ?? {}) as Record<string, unknown> & { ok?: boolean; code?: string };
  if (!result.ok) {
    if (result.code === 'no_session') return { kind: 'no_session' };
    return { kind: 'not_available', inboxScope: Boolean(result.inbox_scope) };
  }
  const action = result.action as Record<string, unknown>;
  const finding = result.finding as Record<string, unknown>;
  const contact = (result.esh_contact ?? {}) as Record<string, unknown>;
  return {
    kind: 'action',
    data: {
      email: String(result.email ?? ''),
      displayName: (result.display_name as string | null) ?? null,
      principalId: String(result.principal_id ?? ''),
      inboxScope: Boolean(result.inbox_scope),
      readOnly: Boolean(result.read_only),
      mode: result.mode === 'escalation' ? 'escalation' : 'owner',
      escalationLevel: typeof result.escalation_level === 'number' ? result.escalation_level : null,
      ownerEmail: (result.owner_email as string | null) ?? null,
      action: {
        id: String(action.id),
        title: String(action.title),
        state: action.state as ActionState,
        priority: (action.priority as ActionPriority | null) ?? null,
        requiredOutcome: (action.required_outcome as string | null) ?? null,
        evidenceInstruction: (action.evidence_instruction as string | null) ?? null,
        evidenceRule:
          action.evidence_rule === 'no_file_exception' ? 'no_file_exception' : 'file_required',
        dueAt: (action.due_at as string | null) ?? null,
        dueIsDateOnly: Boolean(action.due_is_date_only),
        assignedAt: (action.assigned_at as string | null) ?? null,
      },
      finding: {
        reference: String(finding.reference),
        title: String(finding.title),
        description: (finding.description as string | null) ?? null,
        location: (finding.location as string | null) ?? null,
        department: (finding.department as string | null) ?? null,
        reportedOn: (finding.reported_on as string | null) ?? null,
      },
      eshContact: {
        name: (contact.name as string | null) ?? null,
        email: (contact.email as string | null) ?? null,
      },
      messages: ((result.messages ?? []) as Array<Record<string, unknown>>).map((message) => ({
        id: String(message.id),
        authorKind: message.author_kind as ConversationEntry['authorKind'],
        authorName: (message.author_name as string | null) ?? null,
        authorEmail: (message.author_email as string | null) ?? null,
        authorPrincipalId: (message.author_principal_id as string | null) ?? null,
        body: String(message.body),
        sentAt: String(message.sent_at),
        submittable: Boolean(message.submittable),
        files: evidenceFiles(
          (result.files as Record<string, unknown> | null)?.[String(message.id)],
        ),
      })),
      hasMore: Boolean(result.has_more),
      originalEvidence: evidenceFiles(result.original_evidence),
      drafts: evidenceFiles(result.drafts),
      submissions: ((result.submissions ?? []) as Array<Record<string, unknown>>).map((mark) => ({
        messageId: String(mark.message_id),
        version: Number(mark.version),
        state: mark.state as SubmissionMark['state'],
      })),
    },
  };
}
