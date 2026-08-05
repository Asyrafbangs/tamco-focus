'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { createSupabaseServerClient, requireProfile } from '@/lib/supabase/server';
import type { OperationResult } from '@/domain/types';

/**
 * Server actions for high-impact task transitions.
 *
 * Each one is a thin, auditable wrapper: validate the input shape, call the
 * database procedure that owns the transaction, then revalidate the affected
 * pages. The business rules — focus counting, the over-target question,
 * version conflicts, evidence checks, audit events — all live in SQL, because
 * only the database can apply them atomically under a row lock.
 *
 * These actions deliberately do NOT re-derive whether an action is allowed.
 * Doing so would duplicate the rule and let the two copies drift.
 */

const uuid = z.string().uuid();

/** Idempotency key supplied by the client so a double-click is absorbed
 * (PRODUCTION_LOGIC.md section 6, item 4). */
const idempotencyKey = z.string().min(8).max(128).optional();

const activationReason = z.enum([
  'urgent_deadline',
  'workload_peak',
  'cannot_move_out',
  'external_request',
  'dependency',
  'other',
]);

/** Shape returned by every RPC in `20260805001100_operations.sql`. */
type RpcResult = { ok: boolean; code: string; message?: string; [key: string]: unknown };

/**
 * Calls a database procedure and normalises transport failures into the same
 * result shape the procedures themselves return, so callers have exactly one
 * thing to branch on.
 */
async function callProcedure(
  name: string,
  args: Record<string, unknown>,
  revalidate: readonly string[] = ['/today', '/work'],
): Promise<OperationResult> {
  await requireProfile();

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc(name, args);

  if (error) {
    // A database-level failure is not something to render raw: the message can
    // carry schema detail. Log it server-side, return something actionable.
    console.error(`[${name}] ${error.code ?? 'unknown'}: ${error.message}`);

    return {
      ok: false,
      code: 'unexpected_error',
      message: 'Something went wrong and nothing was changed. Try again.',
    };
  }

  const result = data as RpcResult;

  if (result?.ok) {
    for (const path of revalidate) revalidatePath(path);
  }

  return result as OperationResult;
}

// ---------------------------------------------------------------------------
// Activation and focus (section 7)
// ---------------------------------------------------------------------------

const activateSchema = z.object({
  taskId: uuid,
  expectedVersion: z.number().int().positive(),
  reasonCode: activationReason.nullish(),
  reasonNote: z.string().max(1000).nullish(),
  idempotencyKey,
});

/**
 * Activates Available Work.
 *
 * Returns `reason_required` — not an error — when this activation would cross
 * the focus target. The interface asks the single question from section 7.4 and
 * calls again with the answer. Activation is never blocked for being over
 * target; the question is the only thing that stands between the two calls.
 */
export async function activateTask(input: z.input<typeof activateSchema>) {
  const parsed = activateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, code: 'validation_failed' as const, message: 'Invalid request.' };
  }

  return callProcedure('activate_task', {
    p_task_id: parsed.data.taskId,
    p_expected_version: parsed.data.expectedVersion,
    p_reason_code: parsed.data.reasonCode ?? null,
    p_reason_note: parsed.data.reasonNote ?? null,
    p_idempotency_key: parsed.data.idempotencyKey ?? null,
  });
}

const moveOutSchema = z.object({
  taskId: uuid,
  expectedVersion: z.number().int().positive(),
  idempotencyKey,
});

/**
 * Moves Active work back to Available Work (section 7.5).
 *
 * One action. Owner, bucket, urgency, due date, progress, checklist, comments,
 * evidence, relationships, and history are all preserved — this is never a
 * cancel and never a delete.
 */
export async function moveTaskToAvailable(input: z.input<typeof moveOutSchema>) {
  const parsed = moveOutSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, code: 'validation_failed' as const, message: 'Invalid request.' };
  }

  return callProcedure('move_task_to_available', {
    p_task_id: parsed.data.taskId,
    p_expected_version: parsed.data.expectedVersion,
    p_idempotency_key: parsed.data.idempotencyKey ?? null,
  });
}

const pauseSchema = z.object({
  taskId: uuid,
  expectedVersion: z.number().int().positive(),
  reason: z.string().min(1).max(1000),
  restartAt: z.string().datetime().nullish(),
  idempotencyKey,
});

export async function pauseTask(input: z.input<typeof pauseSchema>) {
  const parsed = pauseSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false as const,
      code: 'validation_failed' as const,
      message: 'Record why this is paused and when it should restart or be reviewed.',
    };
  }

  return callProcedure('pause_task', {
    p_task_id: parsed.data.taskId,
    p_expected_version: parsed.data.expectedVersion,
    p_reason: parsed.data.reason,
    p_restart_at: parsed.data.restartAt ?? null,
    p_idempotency_key: parsed.data.idempotencyKey ?? null,
  });
}

export async function resumeTask(input: z.input<typeof activateSchema>) {
  const parsed = activateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, code: 'validation_failed' as const, message: 'Invalid request.' };
  }

  // Resuming returns work to Active, so it re-enters focus counting under the
  // same soft-target rules and can also come back as `reason_required`.
  return callProcedure('resume_task', {
    p_task_id: parsed.data.taskId,
    p_expected_version: parsed.data.expectedVersion,
    p_reason_code: parsed.data.reasonCode ?? null,
    p_reason_note: parsed.data.reasonNote ?? null,
    p_idempotency_key: parsed.data.idempotencyKey ?? null,
  });
}

// ---------------------------------------------------------------------------
// Completion (section 20)
// ---------------------------------------------------------------------------

const completeSchema = z.object({
  taskId: uuid,
  expectedVersion: z.number().int().positive(),
  completionNote: z.string().max(4000).nullish(),
  idempotencyKey,
});

/**
 * Submits completion.
 *
 * Returns `evidence_missing` with the exact outstanding items when required
 * checklist steps or evidence are absent, so the interface can say precisely
 * what is missing and how to fix it (section 20.1).
 */
export async function completeTask(input: z.input<typeof completeSchema>) {
  const parsed = completeSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, code: 'validation_failed' as const, message: 'Invalid request.' };
  }

  return callProcedure(
    'complete_task',
    {
      p_task_id: parsed.data.taskId,
      p_expected_version: parsed.data.expectedVersion,
      p_completion_note: parsed.data.completionNote ?? null,
      p_idempotency_key: parsed.data.idempotencyKey ?? null,
    },
    ['/today', '/work', '/more/records'],
  );
}

const cancelSchema = z.object({
  taskId: uuid,
  expectedVersion: z.number().int().positive(),
  reason: z.string().min(1).max(1000),
  idempotencyKey,
});

/** Cancels work into the archive. Section 6.1 — a terminal archived outcome,
 * not a working column, and not deletion (section 21.4). */
export async function cancelTask(input: z.input<typeof cancelSchema>) {
  const parsed = cancelSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false as const,
      code: 'validation_failed' as const,
      message: 'Record why this work is being cancelled.',
    };
  }

  return callProcedure('cancel_task', {
    p_task_id: parsed.data.taskId,
    p_expected_version: parsed.data.expectedVersion,
    p_reason: parsed.data.reason,
    p_idempotency_key: parsed.data.idempotencyKey ?? null,
  });
}

const reassignSchema = z.object({
  taskId: uuid,
  expectedVersion: z.number().int().positive(),
  newOwnerId: uuid,
  idempotencyKey,
});

export async function reassignTask(input: z.input<typeof reassignSchema>) {
  const parsed = reassignSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, code: 'validation_failed' as const, message: 'Invalid request.' };
  }

  return callProcedure(
    'reassign_task',
    {
      p_task_id: parsed.data.taskId,
      p_expected_version: parsed.data.expectedVersion,
      p_new_owner_id: parsed.data.newOwnerId,
      p_idempotency_key: parsed.data.idempotencyKey ?? null,
    },
    ['/today', '/work', '/team'],
  );
}

// ---------------------------------------------------------------------------
// Undo (section 24.3)
// ---------------------------------------------------------------------------

const undoSchema = z.object({ eventId: uuid, idempotencyKey });

/**
 * Undoes a recent reversible action.
 *
 * Never deletes history: the procedure performs the inverse transition and
 * writes a new event carrying `reversal_of_event_id`, so both the action and
 * its reversal stay readable.
 */
export async function undoEvent(input: z.input<typeof undoSchema>) {
  const parsed = undoSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, code: 'validation_failed' as const, message: 'Invalid request.' };
  }

  return callProcedure('undo_event', {
    p_event_id: parsed.data.eventId,
    p_idempotency_key: parsed.data.idempotencyKey ?? null,
  });
}

// ---------------------------------------------------------------------------
// Checklist (section 11)
// ---------------------------------------------------------------------------

const checklistSchema = z.object({
  itemId: uuid,
  completionNote: z.string().max(2000).nullish(),
  idempotencyKey,
});

/**
 * Completes a checklist step.
 *
 * The procedure recomputes task progress from the checklist, because when a
 * checklist exists it is the single progress source (section 11.3), and it
 * moves any dependent step from Waiting to Ready (section 13.3).
 */
export async function completeChecklistItem(input: z.input<typeof checklistSchema>) {
  const parsed = checklistSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, code: 'validation_failed' as const, message: 'Invalid request.' };
  }

  return callProcedure('complete_checklist_item', {
    p_item_id: parsed.data.itemId,
    p_completion_note: parsed.data.completionNote ?? null,
    p_idempotency_key: parsed.data.idempotencyKey ?? null,
  });
}

/** Section 11.4 — reopening creates a reversal event and never erases the
 * original completion event. */
export async function reopenChecklistItem(input: { itemId: string; reason?: string }) {
  const parsed = z
    .object({ itemId: uuid, reason: z.string().max(1000).optional() })
    .safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, code: 'validation_failed' as const, message: 'Invalid request.' };
  }

  return callProcedure('reopen_checklist_item', {
    p_item_id: parsed.data.itemId,
    p_reason: parsed.data.reason ?? null,
  });
}

// ---------------------------------------------------------------------------
// Barriers (section 14)
// ---------------------------------------------------------------------------

const barrierSchema = z.object({
  taskId: uuid,
  description: z.string().min(1).max(2000),
  supportNeeded: z.string().min(1).max(2000),
  impact: z.enum([
    'may_delay',
    'cannot_continue',
    'safety_or_compliance_risk',
    'management_decision_required',
  ]),
  addToMeetingQueue: z.boolean().default(false),
  idempotencyKey,
});

/**
 * Raises a barrier.
 *
 * A barrier does not by itself pause the task. Only `cannot_continue` does,
 * and the procedure records the restart information the paused state requires
 * (section 14.3).
 */
export async function raiseBarrier(input: z.input<typeof barrierSchema>) {
  const parsed = barrierSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false as const,
      code: 'validation_failed' as const,
      message: 'Describe the barrier and the support needed before submitting.',
    };
  }

  return callProcedure(
    'raise_barrier',
    {
      p_task_id: parsed.data.taskId,
      p_description: parsed.data.description,
      p_support_needed: parsed.data.supportNeeded,
      p_impact: parsed.data.impact,
      p_add_to_meeting_queue: parsed.data.addToMeetingQueue,
      p_idempotency_key: parsed.data.idempotencyKey ?? null,
    },
    ['/today', '/work', '/team'],
  );
}

export async function resolveBarrier(input: { barrierId: string; resolutionNote: string }) {
  const parsed = z
    .object({ barrierId: uuid, resolutionNote: z.string().min(1).max(2000) })
    .safeParse(input);

  if (!parsed.success) {
    return {
      ok: false as const,
      code: 'validation_failed' as const,
      message: 'Record how the barrier was resolved.',
    };
  }

  return callProcedure(
    'resolve_barrier',
    {
      p_barrier_id: parsed.data.barrierId,
      p_resolution_note: parsed.data.resolutionNote,
    },
    ['/today', '/work', '/team'],
  );
}

// ---------------------------------------------------------------------------
// Completion review (section 20.5)
// ---------------------------------------------------------------------------

const reviewSchema = z.object({
  taskId: uuid,
  decision: z.enum(['accepted', 'changes_requested']),
  note: z.string().max(4000).nullish(),
  idempotencyKey,
});

/**
 * Records the reviewer's explicit decision.
 *
 * Opening evidence is logged separately by `recordAttachmentView` and is NOT
 * acceptance (section 20.5). The outcome of Request Changes is read from
 * Settings by the procedure rather than decided here (section 20.6).
 */
export async function decideCompletionReview(input: z.input<typeof reviewSchema>) {
  const parsed = reviewSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, code: 'validation_failed' as const, message: 'Invalid request.' };
  }

  return callProcedure(
    'decide_completion_review',
    {
      p_task_id: parsed.data.taskId,
      p_decision: parsed.data.decision,
      p_note: parsed.data.note ?? null,
      p_idempotency_key: parsed.data.idempotencyKey ?? null,
    },
    ['/today', '/work', '/more/records'],
  );
}

/**
 * Records that a reviewer opened an attachment (section 20.4).
 *
 * Called automatically when evidence is opened. There is deliberately no manual
 * "Viewed" checkbox anywhere in the product.
 */
export async function recordAttachmentView(input: { attachmentId: string }) {
  const parsed = z.object({ attachmentId: uuid }).safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, code: 'validation_failed' as const, message: 'Invalid request.' };
  }

  return callProcedure('record_attachment_view', { p_attachment_id: parsed.data.attachmentId }, []);
}

// ---------------------------------------------------------------------------
// Routine findings (section 16.4)
// ---------------------------------------------------------------------------

const findingSchema = z.object({
  occurrenceTaskId: uuid,
  severity: z.enum(['minor', 'significant', 'immediate_risk']),
  description: z.string().min(1).max(2000),
  followUpOwnerId: uuid.nullish(),
});

/**
 * Records a finding on a routine occurrence.
 *
 * A minor finding closes inside the occurrence. Anything more severe creates
 * linked Operational AVAILABLE Work — the new owner then decides activation
 * under the ordinary focus rules, because a finding must never activate work on
 * someone's behalf.
 */
export async function recordRoutineFinding(input: z.input<typeof findingSchema>) {
  const parsed = findingSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false as const,
      code: 'validation_failed' as const,
      message: 'Describe the finding.',
    };
  }

  return callProcedure('record_routine_finding', {
    p_occurrence_task_id: parsed.data.occurrenceTaskId,
    p_severity: parsed.data.severity,
    p_description: parsed.data.description,
    p_follow_up_owner_id: parsed.data.followUpOwnerId ?? null,
  });
}
