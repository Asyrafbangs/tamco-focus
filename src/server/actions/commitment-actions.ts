'use server';

import { z } from 'zod';

import type { OperationResult } from '@/domain/types';
import { createSupabaseServerClient, requireProfile } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';

/**
 * Server actions for this week's priorities (specification section 7).
 *
 * Thin, like the task actions beside them. Every rule the specification
 * describes — one reference per person per week, no parent beside its own step,
 * a target inside its week, a target that would outrun the work's deadline, and
 * who may agree what — belongs to the procedures, because only they can apply
 * it atomically. Re-deriving any of it here would create a second copy that
 * drifts from the one that actually runs.
 */

const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected yyyy-mm-dd');

async function callProcedure(
  name: string,
  args: Record<string, unknown>,
): Promise<OperationResult> {
  await requireProfile();
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc(name, args);

  if (error) {
    console.error(`[${name}] ${error.code ?? 'unknown'}: ${error.message}`);
    return {
      ok: false,
      code: 'unexpected_error',
      message: 'Something went wrong and nothing was changed. Try again.',
    };
  }

  const result = data as OperationResult;
  if (result?.ok) {
    revalidatePath('/work');
    revalidatePath('/today');
  }
  return result;
}

const proposeSchema = z.object({
  employeeId: uuid,
  taskId: uuid,
  expectedResult: z.string().trim().min(1).max(400),
  weekStart: isoDate.optional(),
  checklistItemId: uuid.optional(),
  targetDate: isoDate.optional(),
});

/** Puts an existing task or step forward as a result for a week. */
export async function proposeWeeklyCommitment(input: z.input<typeof proposeSchema>) {
  const parsed = proposeSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, code: 'validation_failed' as const, message: 'Invalid request.' };
  }
  return callProcedure('propose_weekly_commitment', {
    p_employee_id: parsed.data.employeeId,
    p_task_id: parsed.data.taskId,
    p_expected_result: parsed.data.expectedResult,
    p_week_start: parsed.data.weekStart ?? null,
    p_checklist_item_id: parsed.data.checklistItemId ?? null,
    p_target_date: parsed.data.targetDate ?? null,
    p_rank: null,
  });
}

export async function agreeWeeklyCommitment(input: { commitmentId: string; note?: string }) {
  const parsed = z
    .object({ commitmentId: uuid, note: z.string().trim().max(400).optional() })
    .safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, code: 'validation_failed' as const, message: 'Invalid request.' };
  }
  return callProcedure('agree_weekly_commitment', {
    p_commitment_id: parsed.data.commitmentId,
    p_note: parsed.data.note ?? null,
  });
}

export async function declineWeeklyCommitment(input: { commitmentId: string; note: string }) {
  const parsed = z
    .object({ commitmentId: uuid, note: z.string().trim().min(1).max(400) })
    .safeParse(input);
  if (!parsed.success) {
    // The procedure refuses an empty reason too; saying so here keeps the
    // message specific rather than "something went wrong".
    return {
      ok: false as const,
      code: 'reason_required' as const,
      message: 'Say why, so the person can act on it.',
    };
  }
  return callProcedure('decline_weekly_commitment', {
    p_commitment_id: parsed.data.commitmentId,
    p_note: parsed.data.note,
  });
}

export async function withdrawWeeklyCommitment(input: { commitmentId: string }) {
  const parsed = z.object({ commitmentId: uuid }).safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, code: 'validation_failed' as const, message: 'Invalid request.' };
  }
  return callProcedure('withdraw_weekly_commitment', {
    p_commitment_id: parsed.data.commitmentId,
  });
}

export async function carryForwardWeeklyCommitment(input: {
  commitmentId: string;
  weekStart?: string;
}) {
  const parsed = z.object({ commitmentId: uuid, weekStart: isoDate.optional() }).safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, code: 'validation_failed' as const, message: 'Invalid request.' };
  }
  return callProcedure('carry_forward_weekly_commitment', {
    p_commitment_id: parsed.data.commitmentId,
    p_week_start: parsed.data.weekStart ?? null,
  });
}

const changeSchema = z.object({
  commitmentId: uuid,
  kind: z.enum(['amend', 'remove', 'cannot_meet']),
  reason: z.string().trim().min(1).max(400),
  expectedResult: z.string().trim().max(400).optional(),
  targetDate: isoDate.optional(),
});

/** Asks to change an agreed commitment. The agreement stands until resolved. */
export async function requestWeeklyCommitmentChange(input: z.input<typeof changeSchema>) {
  const parsed = changeSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false as const,
      code: 'reason_required' as const,
      message: 'Say what changed and why.',
    };
  }
  const payload: Record<string, string> = {};
  if (parsed.data.expectedResult) payload.expected_result = parsed.data.expectedResult;
  if (parsed.data.targetDate) payload.target_date = parsed.data.targetDate;

  return callProcedure('request_weekly_commitment_change', {
    p_commitment_id: parsed.data.commitmentId,
    p_kind: parsed.data.kind,
    p_reason: parsed.data.reason,
    p_payload: payload,
  });
}

export async function resolveWeeklyCommitmentChange(input: {
  changeId: string;
  accept: boolean;
  note?: string;
}) {
  const parsed = z
    .object({ changeId: uuid, accept: z.boolean(), note: z.string().trim().max(400).optional() })
    .safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, code: 'validation_failed' as const, message: 'Invalid request.' };
  }
  return callProcedure('resolve_weekly_commitment_change', {
    p_change_id: parsed.data.changeId,
    p_accept: parsed.data.accept,
    p_note: parsed.data.note ?? null,
  });
}
