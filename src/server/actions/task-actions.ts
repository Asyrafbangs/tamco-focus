'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { IMPLAUSIBLE_YEARS_AHEAD, isImplausibleDate } from '@/domain/delivery';
import { endOfLocalDay, localDateTimeToInstant } from '@/domain/duration';
import type { OperationResult } from '@/domain/types';
import { createSupabaseServerClient, requireProfile } from '@/lib/supabase/server';
import { attachmentPolicy } from '@/lib/env';
import { safeAttachmentFileName, validateAttachmentFiles } from '@/server/attachments';
import { scheduleNotificationEmailDispatch } from '@/server/workers/schedule-notification-email';

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
    await scheduleNotificationEmailDispatch();
  }

  return result as OperationResult;
}

interface UploadedAttachmentMetadata {
  id: string;
  storage_path: string;
  file_name: string;
  mime_type: string;
  byte_size: number;
  is_evidence: boolean;
}

async function uploadTaskFiles(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  taskId: string,
  files: readonly File[],
  isEvidence: boolean,
): Promise<
  | { ok: true; paths: string[]; attachments: UploadedAttachmentMetadata[] }
  | { ok: false; message: string }
> {
  const paths: string[] = [];
  const attachments: UploadedAttachmentMetadata[] = [];

  for (const file of files) {
    const id = crypto.randomUUID();
    const path = `tasks/${taskId}/${id}-${safeAttachmentFileName(file.name)}`;
    const { error } = await supabase.storage.from('task-attachments').upload(path, file, {
      contentType: file.type,
      upsert: false,
    });
    if (error) {
      if (paths.length) await supabase.storage.from('task-attachments').remove(paths);
      console.error(`[uploadTaskFiles] ${error.message}`);
      return { ok: false, message: 'The files could not be saved, so nothing was changed.' };
    }
    paths.push(path);
    attachments.push({
      id,
      storage_path: path,
      file_name: file.name,
      mime_type: file.type,
      byte_size: file.size,
      is_evidence: isEvidence,
    });
  }

  return { ok: true, paths, attachments };
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

/**
 * Completion, with its evidence, in one action.
 *
 * The alternative was to make somebody attach files first and then press
 * Complete, which is two operations for one intention and leaves a window
 * where the evidence exists and the completion does not. Here the files are
 * stored, linked to the task as completion evidence, and only then is the
 * completion submitted — and a failure at any point leaves the task open with
 * nothing half-attached.
 *
 * `FormData` rather than a typed object because files cannot cross a Server
 * Action boundary any other way.
 */
/**
 * One evidence file, uploaded and attached to the work on its own.
 *
 * Deliberately one file per call. A single request carrying five photographs
 * fails as one thing: the person is told "the evidence could not be saved",
 * every file is discarded, and they start again from the camera roll — which
 * on a phone, on a plant network, is where somebody gives up and completes the
 * work without evidence at all.
 *
 * Per file, a failure is one row saying which file and offering Retry, and the
 * four that worked stay attached. Progress means something too, because the
 * client knows how many of how many have finished rather than watching one
 * request that either returns or does not.
 *
 * The file is attached to the WORK, not to a pending completion, so nothing is
 * in limbo if the person never presses Complete: it is evidence on an open
 * task, which is a state the product already has and the completion gate
 * already counts.
 */
export async function uploadTaskEvidence(formData: FormData) {
  const taskId = String(formData.get('taskId') ?? '');
  if (!uuid.safeParse(taskId).success) {
    return { ok: false as const, code: 'validation_failed' as const, message: 'Invalid request.' };
  }

  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false as const, code: 'validation_failed' as const, message: 'No file was sent.' };
  }

  const invalid = validateAttachmentFiles([file]);
  if (invalid) {
    return { ok: false as const, code: 'validation_failed' as const, message: invalid };
  }

  const profile = await requireProfile();
  const supabase = await createSupabaseServerClient();

  /*
   * Authorisation is the database's, not this function's. Reading the task
   * through the same view the interface uses means somebody who cannot see the
   * work cannot attach to it either, without this action having its own
   * opinion about who may.
   */
  const { data: task, error: taskError } = await supabase
    .from('task_overview')
    .select('id, evidence_count')
    .eq('id', taskId)
    .maybeSingle();
  if (taskError || !task) {
    return {
      ok: false as const,
      code: 'not_authorised' as const,
      message: 'This work is not available to you.',
    };
  }

  // A cap per piece of work, not only per upload: attaching one file forty
  // times in a row is the same storage as attaching forty at once.
  if (Number(task.evidence_count ?? 0) >= attachmentPolicy.maxEvidencePerTask) {
    return {
      ok: false as const,
      code: 'validation_failed' as const,
      message: `This work already has ${attachmentPolicy.maxEvidencePerTask} pieces of evidence attached.`,
    };
  }

  const path = `tasks/${taskId}/${crypto.randomUUID()}-${safeAttachmentFileName(file.name)}`;
  const upload = await supabase.storage.from('task-attachments').upload(path, file, {
    contentType: file.type,
    upsert: false,
  });
  if (upload.error) {
    console.error(`[uploadTaskEvidence:upload] ${upload.error.message}`);
    return {
      ok: false as const,
      code: 'unexpected_error' as const,
      message: 'That file could not be saved. Try it again.',
    };
  }

  const metadata = await supabase.from('attachments').insert({
    task_id: taskId,
    checklist_item_id: null,
    update_id: null,
    storage_path: path,
    file_name: file.name,
    mime_type: file.type,
    byte_size: file.size,
    is_evidence: true,
    uploaded_by: profile.id,
  });
  if (metadata.error) {
    // The blob is removed rather than left orphaned: storage nothing points at
    // is invisible, permanent and billed.
    await supabase.storage.from('task-attachments').remove([path]);
    console.error(`[uploadTaskEvidence:metadata] ${metadata.error.message}`);
    return {
      ok: false as const,
      code: 'unexpected_error' as const,
      message: 'That file could not be recorded. Try it again.',
    };
  }

  return { ok: true as const, code: 'evidence_attached' as const, message: 'Attached.' };
}

export async function completeTaskWithEvidence(formData: FormData) {
  const parsed = completeSchema.safeParse({
    taskId: formData.get('taskId'),
    expectedVersion: Number(formData.get('expectedVersion') ?? 0),
    completionNote: formData.get('completionNote') || undefined,
    idempotencyKey: formData.get('idempotencyKey') || undefined,
  });
  if (!parsed.success) {
    return { ok: false as const, code: 'validation_failed' as const, message: 'Invalid request.' };
  }

  const files = formData.getAll('files').filter((entry): entry is File => entry instanceof File);
  const realFiles = files.filter((file) => file.size > 0);

  if (realFiles.length === 0) {
    return completeTask(parsed.data);
  }

  const invalid = validateAttachmentFiles(realFiles);
  if (invalid) {
    return { ok: false as const, code: 'validation_failed' as const, message: invalid };
  }

  const profile = await requireProfile();
  const supabase = await createSupabaseServerClient();

  /*
   * Uploaded before the completion is submitted, and removed again if any part
   * of it fails. Completing first and attaching afterwards would leave a task
   * closed with the proof missing, which is the one outcome an evidence rule
   * exists to prevent.
   */
  const uploadedPaths: string[] = [];
  const cleanUp = async () => {
    if (uploadedPaths.length) {
      await supabase.storage.from('task-attachments').remove(uploadedPaths);
    }
  };

  for (const file of realFiles) {
    const path = `tasks/${parsed.data.taskId}/${crypto.randomUUID()}-${safeAttachmentFileName(file.name)}`;
    const upload = await supabase.storage.from('task-attachments').upload(path, file, {
      contentType: file.type,
      upsert: false,
    });
    if (upload.error) {
      await cleanUp();
      console.error(`[completeTaskWithEvidence:upload] ${upload.error.message}`);
      return {
        ok: false as const,
        code: 'unexpected_error' as const,
        message: 'The evidence could not be saved, so the work was not completed.',
      };
    }
    uploadedPaths.push(path);

    const metadata = await supabase.from('attachments').insert({
      task_id: parsed.data.taskId,
      // Neither a step's evidence nor an update's payload: this is evidence
      // for the work as a whole, which is what makes it survive in the
      // completed record rather than inside one update.
      checklist_item_id: null,
      update_id: null,
      storage_path: path,
      file_name: file.name,
      mime_type: file.type,
      byte_size: file.size,
      is_evidence: true,
      uploaded_by: profile.id,
    });
    if (metadata.error) {
      await cleanUp();
      console.error(`[completeTaskWithEvidence:metadata] ${metadata.error.message}`);
      return {
        ok: false as const,
        code: 'unexpected_error' as const,
        message: 'The evidence record could not be saved, so the work was not completed.',
      };
    }
  }

  const result = await completeTask(parsed.data);
  if (!result.ok) {
    // The completion was refused, so its evidence should not be left behind
    // attached to work that is still open and may be completed differently.
    await cleanUp();
    await supabase.storage.from('task-attachments').remove(uploadedPaths);
  }
  return result;
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

const deleteSchema = z.object({
  taskId: uuid,
  expectedVersion: z.number().int().positive(),
  idempotencyKey,
});

/**
 * Moves a task to the Bin.
 *
 * Distinct from `cancelTask`, which records a decision not to do real work and
 * demands a reason. This is for a task that should not have existed — a typo,
 * a duplicate — where making somebody justify the removal would put noise into
 * the cancellation record rather than keep it clean.
 *
 * Recoverable by design: every table referencing `tasks` cascades on delete,
 * so a true DELETE would take the audit history with it.
 */
export async function deleteTask(input: z.input<typeof deleteSchema>) {
  const parsed = deleteSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, code: 'validation_failed' as const, message: 'Invalid request.' };
  }

  return callProcedure(
    'delete_task',
    {
      p_task_id: parsed.data.taskId,
      p_expected_version: parsed.data.expectedVersion,
      p_idempotency_key: parsed.data.idempotencyKey ?? null,
    },
    ['/today', '/work', '/more/records'],
  );
}

const restoreSchema = z.object({ taskId: uuid, idempotencyKey });

export async function restoreTask(input: z.input<typeof restoreSchema>) {
  const parsed = restoreSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, code: 'validation_failed' as const, message: 'Invalid request.' };
  }

  return callProcedure(
    'restore_task',
    {
      p_task_id: parsed.data.taskId,
      p_idempotency_key: parsed.data.idempotencyKey ?? null,
    },
    ['/today', '/work', '/more/records'],
  );
}

/**
 * Emptying one task out of the Bin, for good.
 *
 * Separate from `restoreTask` and deliberately not reachable from a live task:
 * the procedure refuses anything that is not already binned, so deleting — the
 * step that can be undone — always comes first.
 */
export async function purgeTask(input: z.input<typeof restoreSchema>) {
  const parsed = restoreSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, code: 'validation_failed' as const, message: 'Invalid request.' };
  }

  return callProcedure(
    'purge_task',
    {
      p_task_id: parsed.data.taskId,
      p_idempotency_key: parsed.data.idempotencyKey ?? null,
    },
    ['/today', '/work', '/more/records'],
  );
}

const editSchema = z.object({
  taskId: uuid,
  expectedVersion: z.number().int().positive(),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(4000).nullish(),
  idempotencyKey,
});

/**
 * Edits a task's own content — title and details, and nothing else.
 *
 * Ownership is not in the schema, so this cannot move it even by accident.
 * Changing who is accountable is `reassignTask`, deliberately a separate
 * action with separate authority (section J).
 */
export async function updateTaskDetails(input: z.input<typeof editSchema>) {
  const parsed = editSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false as const,
      code: 'validation_failed' as const,
      message: 'Give the work a title of 200 characters or fewer.',
    };
  }

  return callProcedure(
    'update_task_details',
    {
      p_task_id: parsed.data.taskId,
      p_expected_version: parsed.data.expectedVersion,
      p_title: parsed.data.title,
      p_description: parsed.data.description ?? null,
      p_idempotency_key: parsed.data.idempotencyKey ?? null,
    },
    ['/today', '/work'],
  );
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
    ['/today', '/work'],
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
// Due commitment (v38)
// ---------------------------------------------------------------------------

const dueDateCommandSchema = z.object({
  taskId: uuid,
  expectedVersion: z.number().int().positive(),
  dueValue: z.string().min(1).max(32),
  dueIsDateOnly: z.boolean(),
  reason: z.string().trim().max(1000).nullish(),
  idempotencyKey,
});

export async function changeTaskDueDate(input: z.input<typeof dueDateCommandSchema>): Promise<
  OperationResult<{
    version: number;
    due_at: string;
    due_is_date_only: boolean;
    changed: boolean;
  }>
> {
  const parsed = dueDateCommandSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      code: 'validation_failed',
      message: 'Choose a valid new due date.',
    };
  }

  // The same guard as New Work: a year is four characters and one of them is
  // easy to get wrong, and the result is a commitment nobody can act on.
  if (isImplausibleDate(parsed.data.dueValue)) {
    return {
      ok: false,
      code: 'validation_failed',
      message: `That due date is more than ${IMPLAUSIBLE_YEARS_AHEAD} years away. Check the year - 2926 is easy to type for 2026.`,
    };
  }

  const profile = await requireProfile();
  let newDue: Date;
  try {
    newDue = parsed.data.dueIsDateOnly
      ? endOfLocalDay(parsed.data.dueValue, profile.timezone)
      : localDateTimeToInstant(parsed.data.dueValue, profile.timezone);
  } catch {
    return {
      ok: false,
      code: 'validation_failed',
      message: 'Choose a valid new due date.',
    };
  }

  return (await callProcedure(
    'change_task_due_date',
    {
      p_task_id: parsed.data.taskId,
      p_expected_version: parsed.data.expectedVersion,
      p_new_due_at: newDue.toISOString(),
      p_due_is_date_only: parsed.data.dueIsDateOnly,
      p_reason: parsed.data.reason || null,
      p_idempotency_key: parsed.data.idempotencyKey ?? null,
    },
    ['/today', '/work', '/plan'],
  )) as OperationResult<{
    version: number;
    due_at: string;
    due_is_date_only: boolean;
    changed: boolean;
  }>;
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
/** Required evidence metadata and checklist completion commit together. */
export async function completeChecklistItemWithEvidence(
  formData: FormData,
): Promise<OperationResult> {
  await requireProfile();
  const parsed = z
    .object({
      taskId: uuid,
      itemId: uuid,
      completionNote: z.string().trim().max(2000).optional(),
      idempotencyKey: z.string().min(8).max(128),
    })
    .safeParse({
      taskId: formData.get('taskId'),
      itemId: formData.get('itemId'),
      completionNote: formData.get('completionNote') || undefined,
      idempotencyKey: formData.get('idempotencyKey'),
    });

  if (!parsed.success) {
    return { ok: false, code: 'validation_failed', message: 'The evidence details are invalid.' };
  }

  const files = formData
    .getAll('files')
    .filter((value): value is File => value instanceof File && value.size > 0);
  const fileError = validateAttachmentFiles(files);
  if (fileError) return { ok: false, code: 'validation_failed', message: fileError };
  if (files.length === 0) {
    return {
      ok: false,
      code: 'evidence_missing',
      message: 'Choose a file, photo, or screenshot before completing this step.',
    };
  }

  const supabase = await createSupabaseServerClient();
  const uploaded = await uploadTaskFiles(supabase, parsed.data.taskId, files, true);
  if (!uploaded.ok) {
    return { ok: false, code: 'unexpected_error', message: uploaded.message };
  }

  const { data, error } = await supabase.rpc('complete_checklist_item_with_evidence', {
    p_item_id: parsed.data.itemId,
    p_attachments: uploaded.attachments,
    p_completion_note: parsed.data.completionNote ?? null,
    p_idempotency_key: parsed.data.idempotencyKey,
  });

  if (error) {
    await supabase.storage.from('task-attachments').remove(uploaded.paths);
    console.error(
      `[completeChecklistItemWithEvidence] ${error.code ?? 'unknown'}: ${error.message}`,
    );
    return {
      ok: false,
      code: 'unexpected_error',
      message: 'The evidence was not recorded and the checklist item was not changed.',
    };
  }

  const result = data as OperationResult;
  if (!result.ok) {
    const cleanup = await supabase.storage.from('task-attachments').remove(uploaded.paths);
    if (cleanup.error) {
      console.error(`[completeChecklistItemWithEvidence:cleanup] ${cleanup.error.message}`);
    }
    return result;
  }

  for (const path of ['/today', '/work']) revalidatePath(path);
  return result;
}

/** Reopening writes a reversal event; it never erases the completion event. */
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
// Updates and attachments (section 12)
// ---------------------------------------------------------------------------

/**
 * Uploads private objects and commits their metadata with the written update in
 * one database procedure. If the procedure refuses the update, the narrowly
 * scoped orphan-cleanup policy removes only the objects that never gained an
 * authoritative attachment row.
 */
export async function postTaskUpdate(formData: FormData): Promise<OperationResult> {
  await requireProfile();
  const parsed = z
    .object({
      taskId: uuid,
      body: z.string().trim().max(4000).optional(),
      evidenceOnly: z.enum(['true', 'false']).default('false'),
      checklistItemId: uuid.optional(),
      idempotencyKey: z.string().min(8).max(128),
    })
    .safeParse({
      taskId: formData.get('taskId'),
      body: formData.get('body') || undefined,
      evidenceOnly: formData.get('evidenceOnly') || 'false',
      checklistItemId: formData.get('checklistItemId') || undefined,
      idempotencyKey: formData.get('idempotencyKey'),
    });

  if (!parsed.success) {
    return {
      ok: false,
      code: 'validation_failed',
      message: 'The update details are invalid.',
    };
  }

  const files = formData
    .getAll('files')
    .filter((value): value is File => value instanceof File && value.size > 0);
  const fileError = validateAttachmentFiles(files);
  if (fileError) return { ok: false, code: 'validation_failed', message: fileError };

  if (!parsed.data.body && files.length === 0) {
    return {
      ok: false,
      code: 'validation_failed',
      message: 'Write an update or attach at least one file.',
    };
  }

  const mentionIds = formData
    .getAll('mentionIds')
    .map(String)
    .filter((value) => uuid.safeParse(value).success);
  const isEvidence = parsed.data.evidenceOnly === 'true' || Boolean(parsed.data.checklistItemId);
  const supabase = await createSupabaseServerClient();
  const uploaded = await uploadTaskFiles(supabase, parsed.data.taskId, files, isEvidence);
  if (!uploaded.ok) {
    return { ok: false, code: 'unexpected_error', message: uploaded.message };
  }

  const { data, error } = await supabase.rpc('post_task_update', {
    p_task_id: parsed.data.taskId,
    p_body: parsed.data.body ?? null,
    p_is_evidence_only: parsed.data.evidenceOnly === 'true',
    p_checklist_item_id: parsed.data.checklistItemId ?? null,
    p_mention_ids: mentionIds,
    p_attachments: uploaded.attachments,
    p_idempotency_key: parsed.data.idempotencyKey,
  });

  if (error) {
    if (uploaded.paths.length)
      await supabase.storage.from('task-attachments').remove(uploaded.paths);
    console.error(`[postTaskUpdate] ${error.code ?? 'unknown'}: ${error.message}`);
    return {
      ok: false,
      code: 'unexpected_error',
      message: 'The update was not posted. Nothing was changed.',
    };
  }

  const result = data as OperationResult;
  if (!result.ok && uploaded.paths.length) {
    const cleanup = await supabase.storage.from('task-attachments').remove(uploaded.paths);
    if (cleanup.error) console.error(`[postTaskUpdate:cleanup] ${cleanup.error.message}`);
  }
  if (result.ok) {
    for (const path of ['/today', '/work']) revalidatePath(path);
  }
  return result;
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
  /** v44 section 14 — decision / approval / support / escalation / other. */
  actionType: z.enum(['decision', 'approval', 'support', 'escalation', 'other']).default('support'),
  /** Who must act. Server falls back to the reporting manager when absent. */
  actionRequiredFrom: z.string().uuid().nullish(),
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
      // v44 section 14 — what kind of action, and who is being asked. Null
      // recipient still falls back to the reporting manager server-side, so an
      // older client cannot produce a barrier that reaches nobody.
      p_action_type: parsed.data.actionType ?? 'support',
      p_action_required_from: parsed.data.actionRequiredFrom ?? null,
      p_add_to_meeting_queue: parsed.data.addToMeetingQueue,
      p_idempotency_key: parsed.data.idempotencyKey ?? null,
    },
    ['/today', '/work'],
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
    ['/today', '/work'],
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

/*
 * v53 section 22 — the attachment-view wrapper is gone, not the recording.
 *
 * Opening evidence is logged by `record_attachment_view` (section 20.4), and
 * the only thing that can honestly say an attachment was opened is the route
 * that serves the bytes: `src/app/api/attachments/[id]/route.ts` calls the
 * procedure itself. This action was a second door onto the same write that no
 * screen used — and one a client could have called without opening anything.
 */

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

/**
 * Converts a Quick Action into an Operational Action (v40 section 10).
 *
 * The escape hatch that lets Quick Action stay small. When work turns out to
 * need several days, evidence, collaboration or coordination, it is not a
 * Quick Action any more, and the answer is to change what it is rather than to
 * grow the Quick Action interface until it can hold all of that.
 *
 * It lands in Available, not Active: taking on sustained work spends a focus
 * slot, and that decision stays with the person.
 */
export async function convertQuickAction(input: {
  taskId: string;
  expectedVersion: number;
  reason?: string | null;
  idempotencyKey: string;
}): Promise<OperationResult> {
  const parsed = z
    .object({
      taskId: z.string().uuid(),
      expectedVersion: z.number().int().positive(),
      reason: z.string().trim().max(500).nullish(),
      idempotencyKey: z.string().min(8).max(128),
    })
    .safeParse(input);

  if (!parsed.success) {
    return { ok: false, code: 'validation_failed', message: 'Invalid conversion request.' };
  }

  return callProcedure('convert_quick_action', {
    p_task_id: parsed.data.taskId,
    p_expected_version: parsed.data.expectedVersion,
    p_reason: parsed.data.reason ?? null,
    p_idempotency_key: parsed.data.idempotencyKey,
  });
}

/**
 * Adds a checklist step (v41 sections 7, 8, 9).
 *
 * Deliberately available while the parent is still in Available: planning what
 * a piece of work involves is exactly what you do before deciding to carry it,
 * and requiring activation first would force people to spend a focus slot in
 * order to think.
 *
 * Assigning a step to somebody other than the primary owner is the ONLY way a
 * Shared contribution comes into existence. No second task is created — Shared
 * is a projection of this row (section 23).
 */
export async function addChecklistStep(input: {
  taskId: string;
  action: string;
  assignedTo?: string | null;
  evidenceRule?: 'not_required' | 'optional' | 'required';
  dueDate?: string | null;
  dependsOnItemId?: string | null;
}): Promise<OperationResult> {
  const parsed = z
    .object({
      taskId: uuid,
      action: z.string().trim().min(1).max(300),
      assignedTo: z.string().uuid().nullish(),
      evidenceRule: z.enum(['not_required', 'optional', 'required']).default('not_required'),
      dueDate: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .nullish(),
      dependsOnItemId: z.string().uuid().nullish(),
    })
    .safeParse(input);

  if (!parsed.success) {
    return { ok: false, code: 'validation_failed', message: 'Describe what needs to be done.' };
  }

  const profile = await requireProfile();
  const supabase = await createSupabaseServerClient();

  // The default assignee is the primary owner, so an unassigned step never
  // silently becomes somebody else's Shared contribution.
  const { data: task } = await supabase
    .from('tasks')
    .select('primary_owner_id')
    .eq('id', parsed.data.taskId)
    .maybeSingle();

  if (!task) {
    return { ok: false, code: 'not_found', message: 'That work no longer exists.' };
  }

  const { data: lastItem } = await supabase
    .from('task_checklist_items')
    .select('position')
    .eq('task_id', parsed.data.taskId)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle();

  const { error } = await supabase.from('task_checklist_items').insert({
    task_id: parsed.data.taskId,
    position: Number(lastItem?.position ?? 0) + 1,
    action: parsed.data.action,
    assigned_to: parsed.data.assignedTo ?? String(task.primary_owner_id),
    evidence_rule: parsed.data.evidenceRule,
    due_at: parsed.data.dueDate
      ? endOfLocalDay(parsed.data.dueDate, profile.timezone).toISOString()
      : null,
    depends_on_item_id: parsed.data.dependsOnItemId ?? null,
  });

  if (error) {
    // RLS refuses when the caller may not edit this task, which is the
    // authority check — this action does not re-implement it.
    console.error(`[addChecklistStep] ${error.message}`);
    return {
      ok: false,
      code: 'not_authorised',
      message: 'The step was not added. You may not be able to edit this work.',
    };
  }

  for (const path of ['/today', '/work']) revalidatePath(path);
  await scheduleNotificationEmailDispatch();
  return { ok: true, code: 'checklist_step_added' };
}

/**
 * Puts a barrier on the meeting agenda (v46 sections 18-19).
 *
 * Secondary to responding, never instead of it: a barrier that is only ever
 * discussed is a barrier nobody answered. The database refuses a second entry
 * for the same open barrier, so a repeated press reports the existing item.
 */
export async function addBarrierToMeetingQueue(input: {
  barrierId: string;
  idempotencyKey: string;
}): Promise<OperationResult> {
  const parsed = z.object({ barrierId: uuid, idempotencyKey }).safeParse(input);

  if (!parsed.success) {
    return {
      ok: false,
      code: 'validation_failed',
      message: 'That barrier could not be identified.',
    };
  }

  return callProcedure(
    'add_barrier_to_meeting_queue',
    {
      p_barrier_id: parsed.data.barrierId,
      p_idempotency_key: parsed.data.idempotencyKey,
    },
    ['/today', '/work', '/more/records'],
  );
}

/**
 * Records that a manager reviewed an over-target workload and accepted it
 * (v48 Â§23, fixed in v52).
 *
 * The panel previously showed a confirmation and persisted nothing, so the
 * decision existed only until the page was refreshed and the audit trail could
 * not distinguish an accepted overload from one nobody had looked at.
 */
export async function acceptWorkloadReview(input: {
  personId: string;
  bucket: 'major' | 'operational' | 'self_development';
  activeCount: number;
  recommendedTarget: number;
  idempotencyKey: string;
}): Promise<OperationResult> {
  const parsed = z
    .object({
      personId: uuid,
      bucket: z.enum(['major', 'operational', 'self_development']),
      activeCount: z.number().int().min(0).max(999),
      recommendedTarget: z.number().int().min(0).max(999),
      idempotencyKey,
    })
    .safeParse(input);

  if (!parsed.success) {
    return { ok: false, code: 'validation_failed', message: 'That review could not be recorded.' };
  }

  return callProcedure(
    'accept_workload_review',
    {
      p_person_id: parsed.data.personId,
      p_bucket: parsed.data.bucket,
      p_active_count: parsed.data.activeCount,
      p_recommended_target: parsed.data.recommendedTarget,
      p_idempotency_key: parsed.data.idempotencyKey,
    },
    ['/work', '/today'],
  );
}

/**
 * Schedules a queued discussion (v47 sections 24-25).
 *
 * Creates an event on the calendar the application already has. It records a
 * time, and deliberately nothing else: the manager still owes the answer the
 * barrier asked for.
 */
export async function scheduleMeetingQueueItem(input: {
  itemId: string;
  startsAt: string;
  durationMinutes?: number;
  participantIds?: string[];
  idempotencyKey: string;
}): Promise<OperationResult> {
  const parsed = z
    .object({
      itemId: uuid,
      // A `datetime-local` value, read in the organisation's zone rather than
      // the browser's, so two people scheduling from different laptops agree.
      startsAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
      durationMinutes: z.number().int().min(5).max(480).default(30),
      participantIds: z.array(z.string().uuid()).max(20).default([]),
      idempotencyKey,
    })
    .safeParse(input);

  if (!parsed.success) {
    return { ok: false, code: 'validation_failed', message: 'Choose a date and time.' };
  }

  const profile = await requireProfile();

  return callProcedure(
    'schedule_meeting_queue_item',
    {
      p_item_id: parsed.data.itemId,
      p_starts_at: localDateTimeToInstant(parsed.data.startsAt, profile.timezone).toISOString(),
      p_duration_minutes: parsed.data.durationMinutes,
      p_participant_ids: parsed.data.participantIds,
      p_idempotency_key: parsed.data.idempotencyKey,
    },
    ['/today', '/work', '/plan'],
  );
}

/** Takes a topic off the agenda (v47 section 17). */
export async function removeMeetingQueueItem(input: {
  itemId: string;
  idempotencyKey: string;
}): Promise<OperationResult> {
  const parsed = z.object({ itemId: uuid, idempotencyKey }).safeParse(input);

  if (!parsed.success) {
    return { ok: false, code: 'validation_failed', message: 'That topic could not be identified.' };
  }

  return callProcedure(
    'remove_meeting_queue_item',
    {
      p_item_id: parsed.data.itemId,
      p_idempotency_key: parsed.data.idempotencyKey,
    },
    ['/today', '/work', '/plan'],
  );
}

/**
 * Edits a checklist step (v45 sections 16-22).
 *
 * The whole step is sent, not a patch: the drawer shows every field, so an
 * absent due date means the person cleared it. The database owns the rules —
 * who may restructure, what a completed step allows, whether a prerequisite
 * would deadlock — because a second copy of them here would drift.
 */
export async function updateChecklistStep(input: {
  itemId: string;
  action: string;
  assignedTo: string;
  evidenceRule: 'not_required' | 'optional' | 'required';
  dueDate?: string | null;
  dependsOnItemId?: string | null;
  idempotencyKey: string;
}): Promise<OperationResult> {
  const parsed = z
    .object({
      itemId: uuid,
      action: z.string().trim().min(1).max(300),
      assignedTo: uuid,
      evidenceRule: z.enum(['not_required', 'optional', 'required']),
      dueDate: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .nullish(),
      dependsOnItemId: z.string().uuid().nullish(),
      idempotencyKey,
    })
    .safeParse(input);

  if (!parsed.success) {
    return {
      ok: false,
      code: 'validation_failed',
      message: 'Describe what needs to be done, and choose who is responsible.',
    };
  }

  const profile = await requireProfile();

  return callProcedure('update_checklist_step', {
    p_item_id: parsed.data.itemId,
    p_action: parsed.data.action,
    p_assigned_to: parsed.data.assignedTo,
    p_evidence_rule: parsed.data.evidenceRule,
    // A date the person picked is their local end of day, not midnight UTC —
    // the same conversion Add step uses, so the two cannot disagree.
    p_due_at: parsed.data.dueDate
      ? endOfLocalDay(parsed.data.dueDate, profile.timezone).toISOString()
      : null,
    p_depends_on_item_id: parsed.data.dependsOnItemId ?? null,
    p_idempotency_key: parsed.data.idempotencyKey,
  });
}

/**
 * Removes a checklist step (v45 section 23).
 *
 * Refuses in the database when something would be lost silently: a completed
 * step, attached evidence, or another step waiting on this one.
 */
export async function removeChecklistStep(input: {
  itemId: string;
  idempotencyKey: string;
}): Promise<OperationResult> {
  const parsed = z.object({ itemId: uuid, idempotencyKey }).safeParse(input);

  if (!parsed.success) {
    return { ok: false, code: 'validation_failed', message: 'That step could not be identified.' };
  }

  return callProcedure('remove_checklist_step', {
    p_item_id: parsed.data.itemId,
    p_idempotency_key: parsed.data.idempotencyKey,
  });
}

/**
 * Posts a reply on a barrier (v44 section 16).
 *
 * A response is not a resolution. "I will confirm with Operations by 3pm"
 * changes nothing about whether the work can continue, so this deliberately
 * cannot close the barrier — only `resolveBarrier` does that, and only once
 * the blocker is actually gone.
 */
export async function postBarrierResponse(input: {
  barrierId: string;
  message: string;
  expectedVersion?: number | null;
  /** v45 section 41 — an approval answers yes or no; everything else answers. */
  kind?: 'answer' | 'approved' | 'changes_requested';
  idempotencyKey: string;
}): Promise<OperationResult> {
  const parsed = z
    .object({
      barrierId: uuid,
      message: z.string().trim().min(1).max(2000),
      expectedVersion: z.number().int().positive().nullish(),
      kind: z.enum(['answer', 'approved', 'changes_requested']).default('answer'),
      idempotencyKey,
    })
    .safeParse(input);

  if (!parsed.success) {
    return { ok: false, code: 'validation_failed', message: 'Write a response before sending.' };
  }

  return callProcedure(
    'post_barrier_response',
    {
      p_barrier_id: parsed.data.barrierId,
      p_message: parsed.data.message,
      // Â§52 — refuse to overwrite a barrier somebody else changed meanwhile.
      p_expected_version: parsed.data.expectedVersion ?? null,
      p_kind: parsed.data.kind,
      p_idempotency_key: parsed.data.idempotencyKey,
    },
    ['/today', '/work'],
  );
}

/* ------------------------------------------------------------------------- */
/* v140 §8 — the work somebody says they are on                              */
/* ------------------------------------------------------------------------- */

const currentFocusSchema = z.object({
  taskId: uuid,
  /** Set when the selection is a step of somebody else's work. */
  checklistItemId: uuid.optional(),
});

/**
 * Records an explicit "Working on" selection.
 *
 * Deliberately thin. Whether the work has been started, whether the step
 * belongs to this person, and what happens to the selection when the work is
 * finished are all the database's to decide — a second copy of those rules here
 * would drift from the one that actually runs.
 */
export async function setCurrentFocus(input: z.input<typeof currentFocusSchema>) {
  const parsed = currentFocusSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, code: 'validation_failed' as const, message: 'Invalid request.' };
  }

  return callProcedure('set_current_focus', {
    p_task_id: parsed.data.taskId,
    p_checklist_item_id: parsed.data.checklistItemId ?? null,
  });
}

export async function clearCurrentFocus() {
  return callProcedure('clear_current_focus', {});
}

/** "Still on this" — moves the confirmation, not the selection. */
export async function confirmCurrentFocus() {
  return callProcedure('confirm_current_focus', {});
}
