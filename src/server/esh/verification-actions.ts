'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { verificationProblem } from '@/domain/esh-verification';
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
