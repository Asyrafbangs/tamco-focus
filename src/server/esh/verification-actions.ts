'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import {
  editProblem,
  verificationProblem,
  type FindingOutcomeKey,
} from '@/domain/esh-verification';
import { createSupabaseServerClient, requireProfile } from '@/lib/supabase/server';
import { scheduleEshDispatch } from '@/server/esh/schedule-dispatch';

/**
 * What ESH decides about an action (v200, §13, §14): accept it, ask for
 * more, reopen a closed finding, move the due date, or give the action to
 * somebody else. Each one is a single procedure that writes the decision,
 * the history, the event the owner reads and the email — or nothing at all.
 */

const uuid = z.string().uuid();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export type EshDecision = { ok: true; closed?: boolean } | { ok: false; message: string };

function refused(code: string | undefined, problems?: string[]): EshDecision {
  return { ok: false, message: verificationProblem(code, problems) };
}

function refresh(findingId: string) {
  if (uuid.safeParse(findingId).success) revalidatePath(`/findings/${findingId}`);
  revalidatePath('/findings/register');
  revalidatePath('/findings/verification');
}

export async function verifySubmission(input: {
  submissionId: string;
  findingId: string;
  decision: 'accepted' | 'changes_requested';
  method: string | null;
  note: string;
  keepDue: boolean | null;
  dueDate: string | null;
  dueTime: string | null;
}): Promise<EshDecision> {
  await requireProfile();
  const submissionId = uuid.safeParse(input.submissionId);
  if (!submissionId.success) return refused('not_found');
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('esh_verify_submission', {
    p_submission_id: submissionId.data,
    p_decision: input.decision === 'accepted' ? 'accepted' : 'changes_requested',
    p_method: (input.method || null) as string,
    p_note: (input.note?.trim() || null) as string,
    p_keep_due: input.keepDue as boolean,
    p_due_date: (day.safeParse(input.dueDate ?? '').success ? input.dueDate : null) as string,
    p_due_time: (input.dueTime || null) as string,
  });
  if (error) {
    console.error(`[esh_verify_submission] ${error.code ?? 'unknown'}: ${error.message}`);
    return refused(undefined);
  }
  const result = (data ?? {}) as {
    ok?: boolean;
    code?: string;
    problems?: string[];
    closed?: boolean;
  };
  if (!result.ok) return refused(result.code, result.problems);
  await scheduleEshDispatch();
  refresh(input.findingId);
  return { ok: true, closed: Boolean(result.closed) };
}

export async function reopenFinding(input: {
  findingId: string;
  reason: string;
  dueDate: string | null;
  dueTime: string | null;
}): Promise<EshDecision> {
  await requireProfile();
  const findingId = uuid.safeParse(input.findingId);
  if (!findingId.success) return refused('not_found');
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('esh_reopen_finding', {
    p_finding_id: findingId.data,
    p_reason: String(input.reason ?? ''),
    p_due_date: (day.safeParse(input.dueDate ?? '').success ? input.dueDate : null) as string,
    p_due_time: (input.dueTime || null) as string,
  });
  if (error) {
    console.error(`[esh_reopen_finding] ${error.code ?? 'unknown'}: ${error.message}`);
    return refused(undefined);
  }
  const result = (data ?? {}) as { ok?: boolean; code?: string; problems?: string[] };
  if (!result.ok) return refused(result.code, result.problems);
  await scheduleEshDispatch();
  refresh(input.findingId);
  return { ok: true };
}

export async function changeDueDate(input: {
  actionId: string;
  findingId: string;
  dueDate: string;
  dueTime: string | null;
  reason: string;
}): Promise<EshDecision> {
  await requireProfile();
  const actionId = uuid.safeParse(input.actionId);
  if (!actionId.success) return refused('not_found');
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('esh_change_due', {
    p_action_id: actionId.data,
    p_due_date: (day.safeParse(input.dueDate ?? '').success ? input.dueDate : null) as string,
    p_due_time: (input.dueTime || null) as string,
    p_reason: String(input.reason ?? ''),
  });
  if (error) {
    console.error(`[esh_change_due] ${error.code ?? 'unknown'}: ${error.message}`);
    return refused(undefined);
  }
  const result = (data ?? {}) as { ok?: boolean; code?: string; problems?: string[] };
  if (!result.ok) return refused(result.code, result.problems);
  await scheduleEshDispatch();
  refresh(input.findingId);
  return { ok: true };
}

/**
 * v208 - what the owner should do first, changed with a reason (§39).
 *
 * Deliberately narrow: it moves the priority and nothing else. The deadline,
 * the risk assessment and the follow-up schedule stay where they were, so
 * nobody's reminders quietly restart because a label changed.
 */
export async function changePriority(input: {
  actionId: string;
  findingId: string;
  priority: string;
  reason: string;
}): Promise<EshDecision> {
  await requireProfile();
  const actionId = uuid.safeParse(input.actionId);
  if (!actionId.success) return refused('not_found');
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('esh_set_priority', {
    p_action_id: actionId.data,
    p_priority: String(input.priority ?? ''),
    p_reason: String(input.reason ?? ''),
  });
  if (error) {
    console.error(`[esh_set_priority] ${error.code ?? 'unknown'}: ${error.message}`);
    return refused(undefined);
  }
  const result = (data ?? {}) as { ok?: boolean; code?: string };
  if (!result.ok) return refused(result.code);
  refresh(input.findingId);
  return { ok: true };
}

/**
 * v227 - an open finding's wording, place and department, corrected on the
 * record with the before and after. Nothing about the owner, the deadline or
 * the follow-up moves with it.
 */
export async function editFinding(input: {
  findingId: string;
  title: string;
  description: string;
  location: string;
  departmentId: string;
}): Promise<EshDecision> {
  await requireProfile();
  const findingId = uuid.safeParse(input.findingId);
  if (!findingId.success) return { ok: false, message: editProblem('not_found') };
  const departmentId = uuid.safeParse(input.departmentId);
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('esh_edit_finding', {
    p_finding_id: findingId.data,
    p_title: String(input.title ?? ''),
    p_description: String(input.description ?? ''),
    p_location: String(input.location ?? ''),
    p_department_id: (departmentId.success ? departmentId.data : null) as string,
  });
  if (error) {
    console.error(`[esh_edit_finding] ${error.code ?? 'unknown'}: ${error.message}`);
    return { ok: false, message: editProblem(undefined) };
  }
  const result = (data ?? {}) as { ok?: boolean; code?: string };
  if (!result.ok) return { ok: false, message: editProblem(result.code) };
  refresh(findingId.data);
  return { ok: true };
}

/** v227 - risk, reassessed with a reason. Follow-up already agreed stays as it is. */
export async function changeRisk(input: {
  findingId: string;
  risk: string;
  reason: string;
}): Promise<EshDecision> {
  await requireProfile();
  const findingId = uuid.safeParse(input.findingId);
  if (!findingId.success) return { ok: false, message: editProblem('not_found') };
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('esh_set_risk', {
    p_finding_id: findingId.data,
    p_risk: String(input.risk ?? ''),
    p_reason: String(input.reason ?? ''),
  });
  if (error) {
    console.error(`[esh_set_risk] ${error.code ?? 'unknown'}: ${error.message}`);
    return { ok: false, message: editProblem(undefined) };
  }
  const result = (data ?? {}) as { ok?: boolean; code?: string };
  if (!result.ok) return { ok: false, message: editProblem(result.code) };
  refresh(findingId.data);
  return { ok: true };
}

/**
 * v263 — what protects people until the permanent fix lands.
 *
 * The whole position at once, because the parts are not independent: deciding
 * none is needed has to remove any control already recorded, and recording a
 * control has to remove that decision. Splitting it into separate saves would
 * let the record sit, briefly, saying both.
 */
export async function setInterimControl(input: {
  findingId: string;
  containment?: string;
  control?: string;
  owner?: string;
  notRequiredReason?: string;
}): Promise<EshDecision> {
  await requireProfile();
  const findingId = uuid.safeParse(input.findingId);
  if (!findingId.success) return { ok: false, message: editProblem('not_found') };
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('esh_set_interim_control', {
    p_finding_id: findingId.data,
    p_payload: {
      immediate_containment: input.containment ?? '',
      interim_control: input.control ?? '',
      interim_owner: input.owner ?? '',
      not_required_reason: input.notRequiredReason ?? '',
    },
  });
  if (error) {
    console.error(`[esh_set_interim_control] ${error.code ?? 'unknown'}: ${error.message}`);
    return { ok: false, message: editProblem(undefined) };
  }
  const result = (data ?? {}) as { ok?: boolean; code?: string };
  if (!result.ok) return { ok: false, message: editProblem(result.code) };
  refresh(findingId.data);
  return { ok: true };
}

/**
 * v263 — somebody has been and checked the interim control is working.
 *
 * A separate decision from writing it down, because they are separate claims:
 * one says what should be protecting people, the other says somebody looked.
 */
export async function verifyInterimControl(input: { findingId: string }): Promise<EshDecision> {
  await requireProfile();
  const findingId = uuid.safeParse(input.findingId);
  if (!findingId.success) return { ok: false, message: editProblem('not_found') };
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('esh_verify_interim_control', {
    p_finding_id: findingId.data,
  });
  if (error) {
    console.error(`[esh_verify_interim_control] ${error.code ?? 'unknown'}: ${error.message}`);
    return { ok: false, message: editProblem(undefined) };
  }
  const result = (data ?? {}) as { ok?: boolean; code?: string };
  if (!result.ok) return { ok: false, message: editProblem(result.code) };
  refresh(findingId.data);
  return { ok: true };
}

/** v269 - ESH marks a blocker resolved once the help has been given. */
export async function clearBlocker(input: {
  blockerId: string;
  note?: string;
}): Promise<EshDecision> {
  await requireProfile();
  const blockerId = uuid.safeParse(input.blockerId);
  if (!blockerId.success) return { ok: false, message: editProblem('not_found') };
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('esh_clear_blocker', {
    p_blocker_id: blockerId.data,
    p_note: String(input.note ?? ''),
  });
  if (error) {
    console.error(`[esh_clear_blocker] ${error.message}`);
    return { ok: false, message: editProblem(undefined) };
  }
  const result = (data ?? {}) as { ok?: boolean; code?: string };
  if (!result.ok) return { ok: false, message: editProblem(result.code) };
  revalidatePath('/findings');
  return { ok: true };
}

/**
 * v269 - correct what will be accepted as proof, after assignment.
 *
 * The case this exists for: the owner sent a photograph and a photograph
 * cannot show that an interlock functions. Saying so in the conversation is
 * the unenforceable sentence v266 replaced.
 */
export async function changeEvidenceKind(input: {
  actionId: string;
  kind: string;
}): Promise<EshDecision> {
  await requireProfile();
  const actionId = uuid.safeParse(input.actionId);
  if (!actionId.success) return { ok: false, message: editProblem('not_found') };
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('esh_set_evidence_kind', {
    p_action_id: actionId.data,
    p_kind: String(input.kind ?? ''),
  });
  if (error) {
    console.error(`[esh_set_evidence_kind] ${error.message}`);
    return { ok: false, message: editProblem(undefined) };
  }
  const result = (data ?? {}) as { ok?: boolean; code?: string };
  if (!result.ok) return { ok: false, message: editProblem(result.code) };
  revalidatePath('/findings');
  return { ok: true };
}

/** v267 - book somebody to go and look, once the correction has been accepted. */
export async function scheduleEffectivenessCheck(input: {
  actionId: string;
  dueOn: string;
  passCriteria: string;
  checker?: string;
}): Promise<EshDecision> {
  await requireProfile();
  const actionId = uuid.safeParse(input.actionId);
  if (!actionId.success) return { ok: false, message: editProblem('not_found') };
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('esh_schedule_effectiveness_check', {
    p_action_id: actionId.data,
    p_due_on: day.safeParse(input.dueOn).success ? input.dueOn : null,
    p_pass_criteria: String(input.passCriteria ?? ''),
    p_checker: input.checker?.trim() || null,
  });
  if (error) {
    console.error(`[esh_schedule_effectiveness_check] ${error.message}`);
    return { ok: false, message: editProblem(undefined) };
  }
  const result = (data ?? {}) as { ok?: boolean; code?: string };
  if (!result.ok) return { ok: false, message: editProblem(result.code) };
  revalidatePath('/findings');
  return { ok: true };
}

/**
 * v267 — what was found when somebody looked.
 *
 * A failure raises a linked finding and leaves the original closure alone:
 * it was true on the day it was made, and it is the only evidence that the
 * fix was once in place.
 */
export async function recordEffectivenessCheck(input: {
  checkId: string;
  passed: boolean;
  note?: string;
}): Promise<EshDecision> {
  await requireProfile();
  const checkId = uuid.safeParse(input.checkId);
  if (!checkId.success) return { ok: false, message: editProblem('not_found') };
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('esh_record_effectiveness_check', {
    p_check_id: checkId.data,
    p_passed: Boolean(input.passed),
    p_note: String(input.note ?? ''),
  });
  if (error) {
    console.error(`[esh_record_effectiveness_check] ${error.message}`);
    return { ok: false, message: editProblem(undefined) };
  }
  const result = (data ?? {}) as { ok?: boolean; code?: string };
  if (!result.ok) return { ok: false, message: editProblem(result.code) };
  revalidatePath('/findings');
  return { ok: true };
}

/**
 * v209 — an outcome that is not a closure (§6); v227 — Cancel, Duplicate or
 * Raised in error.
 *
 * Administrative answers to a finding that should not have been raised, or
 * was raised twice. None of them claims ESH verified a correction, and none
 * of them deletes anything: the record stays, its outstanding work stops,
 * and a duplicate keeps a link to the finding it repeats.
 */
export async function resolveFinding(input: {
  findingId: string;
  outcome: FindingOutcomeKey;
  reason: string;
  duplicateOf?: string | null;
}): Promise<EshDecision> {
  await requireProfile();
  const findingId = uuid.safeParse(input.findingId);
  if (!findingId.success) return refused('not_found');
  const duplicateOf = input.duplicateOf ? uuid.safeParse(input.duplicateOf) : null;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('esh_resolve_finding', {
    p_finding_id: findingId.data,
    p_outcome: input.outcome,
    p_reason: String(input.reason ?? ''),
    p_duplicate_of: duplicateOf?.success ? duplicateOf.data : null,
  });
  if (error) {
    console.error(`[esh_resolve_finding] ${error.code ?? 'unknown'}: ${error.message}`);
    return refused(undefined);
  }
  const result = (data ?? {}) as { ok?: boolean; code?: string };
  if (!result.ok) return refused(result.code);
  refresh(findingId.data);
  return { ok: true };
}

export async function reassignAction(input: {
  actionId: string;
  findingId: string;
  ownerEmail: string;
  reason: string;
}): Promise<EshDecision> {
  await requireProfile();
  const actionId = uuid.safeParse(input.actionId);
  if (!actionId.success) return refused('not_found');
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('esh_reassign_action', {
    p_action_id: actionId.data,
    p_owner_email: String(input.ownerEmail ?? ''),
    p_reason: String(input.reason ?? ''),
  });
  if (error) {
    console.error(`[esh_reassign_action] ${error.code ?? 'unknown'}: ${error.message}`);
    return refused(undefined);
  }
  const result = (data ?? {}) as { ok?: boolean; code?: string; problems?: string[] };
  if (!result.ok) return refused(result.code, result.problems);
  await scheduleEshDispatch();
  refresh(input.findingId);
  return { ok: true };
}
