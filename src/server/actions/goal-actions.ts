'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { createSupabaseServerClient, requireProfile } from '@/lib/supabase/server';
import type { OperationResult } from '@/domain/types';
import { safeAttachmentFileName, validateAttachmentFiles } from '@/server/attachments';
import { scheduleNotificationEmailDispatch } from '@/server/workers/schedule-notification-email';

const uuid = z.string().uuid();
const idempotencyKey = z.string().min(8).max(128);
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const progress = z.coerce
  .number()
  .int()
  .min(0)
  .max(100)
  .refine((value) => value % 5 === 0);
const optionalText = (maximum = 4000) => z.string().trim().max(maximum).nullish();
const milestoneSchema = z.object({
  id: uuid.optional(),
  source_milestone_id: uuid.nullish(),
  title: z.string().trim().min(1).max(500),
  completion_definition: z.string().trim().min(1).max(2000),
  weight_percent: z.number().int().min(1).max(100).nullish(),
  progress_percent: progress.default(0),
});
const successMeasureSchema = z.object({
  description: z.string().trim().min(1).max(1000),
  optionalTargetDate: dateOnly.nullish(),
});

type RpcResult = { ok: boolean; code: string; message?: string; [key: string]: unknown };

async function formalWeightGuard({
  ownerId,
  proposedWeight,
  excludeGoalId,
}: {
  ownerId: string;
  proposedWeight: number;
  excludeGoalId?: string;
}): Promise<OperationResult | null> {
  await requireProfile();
  const supabase = await createSupabaseServerClient();
  let query = supabase
    .from('goals')
    .select('id,weight_percent')
    .eq('owner_id', ownerId)
    .in('status', ['active', 'completed']);
  if (excludeGoalId) query = query.neq('id', excludeGoalId);
  const { data, error } = await query.limit(100);
  if (error) {
    console.error(`[formalWeightGuard] ${error.message}`);
    return {
      ok: false,
      code: 'unexpected_error',
      message: 'The formal Goal allocation could not be checked, so activation was not attempted.',
    };
  }
  const activeWeight = (data ?? []).reduce(
    (total, goal) => total + Number(goal.weight_percent ?? 0),
    0,
  );
  if (activeWeight + proposedWeight <= 100) return null;
  return {
    ok: false,
    code: 'invalid_target',
    message: `This Goal would bring the allocation to ${activeWeight + proposedWeight}%. Adjust the weight before activation.`,
  };
}

async function callGoalProcedure(
  name: string,
  args: Record<string, unknown>,
  paths: readonly string[] = ['/goals', '/today'],
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
  const result = data as RpcResult;
  if (result?.ok) {
    for (const path of paths) revalidatePath(path);
    await scheduleNotificationEmailDispatch();
  }
  return result as OperationResult;
}

export interface GoalMilestoneInput {
  id?: string;
  source_milestone_id?: string | null;
  title: string;
  completion_definition: string;
  weight_percent?: number | null;
  progress_percent?: number;
}

const createSchema = z.object({
  ownerId: uuid,
  expectedResult: z.string().trim().min(1).max(500),
  successMeasures: z.array(successMeasureSchema).min(1).max(10),
  targetDate: dateOnly,
  employeeApproach: optionalText(),
  supportAgreed: optionalText(),
  dependencies: optionalText(),
  baseline: optionalText(),
  purpose: optionalText(),
  weightPercent: z.number().int().min(1).max(100),
  category: z.enum(['performance', 'improvement', 'development']).default('performance'),
  milestones: z.array(milestoneSchema).max(5),
  submissionMode: z.enum(['draft', 'discussion', 'active']).default('discussion'),
  idempotencyKey,
});

export async function createGoal(input: z.input<typeof createSchema>): Promise<OperationResult> {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      code: 'validation_failed',
      message: 'Add a clear result, success measures, target date and formal weight.',
    };
  }
  if (parsed.data.submissionMode === 'active') {
    const blocked = await formalWeightGuard({
      ownerId: parsed.data.ownerId,
      proposedWeight: parsed.data.weightPercent,
    });
    if (blocked) return blocked;
  }
  return callGoalProcedure('create_lean_goal', {
    p_owner_id: parsed.data.ownerId,
    p_expected_result: parsed.data.expectedResult,
    p_target_date: parsed.data.targetDate,
    p_agreed_approach: parsed.data.employeeApproach || null,
    p_support_needed: parsed.data.supportAgreed || null,
    p_dependencies: parsed.data.dependencies || null,
    p_baseline: parsed.data.baseline || null,
    p_purpose: parsed.data.purpose || null,
    p_weight_percent: parsed.data.weightPercent,
    p_measures: parsed.data.successMeasures.map((measure) => ({
      description: measure.description,
      optional_target_date: measure.optionalTargetDate || null,
    })),
    p_category: parsed.data.category,
    p_milestones: parsed.data.milestones,
    p_submission_mode: parsed.data.submissionMode,
    p_idempotency_key: parsed.data.idempotencyKey,
  });
}

interface UploadedGoalFiles {
  attachments: Array<{
    id: string;
    storage_path: string;
    file_name: string;
    mime_type: string;
    byte_size: number;
  }>;
  paths: string[];
}

async function uploadGoalFiles(goalId: string, files: File[]): Promise<UploadedGoalFiles | string> {
  const validation = validateAttachmentFiles(files);
  if (validation) return validation;
  const supabase = await createSupabaseServerClient();
  const result: UploadedGoalFiles = { attachments: [], paths: [] };
  for (const file of files) {
    const id = crypto.randomUUID();
    const path = `goals/${goalId}/${id}-${safeAttachmentFileName(file.name)}`;
    const { error } = await supabase.storage.from('task-attachments').upload(path, file, {
      contentType: file.type,
      upsert: false,
    });
    if (error) {
      if (result.paths.length) await supabase.storage.from('task-attachments').remove(result.paths);
      console.error(`[uploadGoalFiles] ${error.message}`);
      return 'The files could not be saved, so nothing was posted.';
    }
    result.paths.push(path);
    result.attachments.push({
      id,
      storage_path: path,
      file_name: file.name,
      mime_type: file.type,
      byte_size: file.size,
    });
  }
  return result;
}

async function cleanupGoalFiles(paths: string[]) {
  if (!paths.length) return;
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.storage.from('task-attachments').remove(paths);
  if (error) console.error(`[cleanupGoalFiles] ${error.message}`);
}

/*
 * v53 section 22 - the per-Goal cadence entry points are gone.
 *
 * `postGoalUpdate`, `postGoalMonthlyCheckin`, `saveGoalQuarterlyCheckin` and
 * `saveGoalYearEndResult` each drove one Goal through its own month, quarter
 * or year end. Section 11 replaced that with one employee session covering
 * every Active Goal at once, and section 17 replaced the year-end finalise
 * with an explicit Complete. Nothing called these any more; leaving them
 * would have left a second way to record a month that the session engine
 * could not see.
 *
 * `submitGoalMonthlySession`, `completeGoalQuarterlySession` and
 * `completeGoal` below are the live paths.
 */

export async function postGoalMilestoneUpdate(formData: FormData): Promise<OperationResult> {
  await requireProfile();
  const parsed = z
    .object({
      goalId: uuid,
      milestoneId: uuid,
      expectedVersion: z.coerce.number().int().positive(),
      progress,
      comment: z.string().trim().min(1).max(4000),
      nextStep: optionalText(),
      supportRequested: z.enum(['true', 'false']).default('false'),
      supportDetails: optionalText(),
      markComplete: z.enum(['true', 'false']).default('false'),
      idempotencyKey,
    })
    .safeParse({
      goalId: formData.get('goalId'),
      milestoneId: formData.get('milestoneId'),
      expectedVersion: formData.get('expectedVersion'),
      progress: formData.get('progress'),
      comment: formData.get('comment'),
      nextStep: formData.get('nextStep') || null,
      supportRequested: formData.get('supportRequested') === 'on' ? 'true' : 'false',
      supportDetails: formData.get('supportDetails') || null,
      markComplete: formData.get('markComplete') === 'true' ? 'true' : 'false',
      idempotencyKey: formData.get('idempotencyKey'),
    });
  if (
    !parsed.success ||
    (parsed.data.supportRequested === 'true' && !parsed.data.supportDetails) ||
    (parsed.data.supportRequested === 'true' && parsed.data.markComplete === 'true')
  ) {
    return {
      ok: false,
      code: 'validation_failed',
      message:
        'Use a valid progress value, record what changed, and describe support when requested. Complete milestones and support requests must be saved separately.',
    };
  }

  const milestoneComment = [
    parsed.data.comment,
    parsed.data.nextStep ? `Next step: ${parsed.data.nextStep}` : null,
    parsed.data.supportRequested === 'true'
      ? `Support requested: ${parsed.data.supportDetails}`
      : null,
  ]
    .filter((value): value is string => Boolean(value))
    .join('\n\n');
  const files = formData
    .getAll('files')
    .filter((value): value is File => value instanceof File && value.size > 0);
  const uploaded = await uploadGoalFiles(parsed.data.goalId, files);
  if (typeof uploaded === 'string') {
    return { ok: false, code: 'validation_failed', message: uploaded };
  }
  const result = await callGoalProcedure('post_goal_milestone_checkin', {
    p_goal_id: parsed.data.goalId,
    p_milestone_id: parsed.data.milestoneId,
    p_expected_version: parsed.data.expectedVersion,
    p_progress: parsed.data.progress,
    p_comment: milestoneComment,
    p_what_changed: parsed.data.comment,
    p_next_step: parsed.data.nextStep || null,
    p_support_requested: parsed.data.supportRequested === 'true',
    p_support_details: parsed.data.supportDetails || null,
    p_mark_complete: parsed.data.markComplete === 'true',
    p_attachments: uploaded.attachments,
    p_idempotency_key: parsed.data.idempotencyKey,
  });
  if (!result.ok) {
    await cleanupGoalFiles(uploaded.paths);
    return result;
  }
  return result;
}

const proposalSchema = z.object({
  goalId: uuid,
  expectedVersion: z.number().int().positive(),
  expectedResult: z.string().trim().min(1).max(500),
  successMeasures: z.array(successMeasureSchema).min(1).max(10),
  targetDate: dateOnly,
  employeeApproach: optionalText(),
  supportAgreed: optionalText(),
  dependencies: optionalText(),
  baseline: optionalText(),
  purpose: optionalText(),
  weightPercent: z.number().int().min(0).max(100),
  milestones: z.array(milestoneSchema).max(5),
  submissionMode: z.enum(['draft', 'discussion']).default('discussion'),
  revisionReason: optionalText(2000),
  idempotencyKey,
});

export async function proposeGoalVersion(input: z.input<typeof proposalSchema>) {
  const parsed = proposalSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false as const,
      code: 'validation_failed' as const,
      message: 'Complete the result, success measures, target date and formal weight.',
    };
  }
  const supabase = await createSupabaseServerClient();
  const { data: goal, error } = await supabase
    .from('goals')
    .select('status')
    .eq('id', parsed.data.goalId)
    .maybeSingle();
  if (error || !goal) {
    return {
      ok: false as const,
      code: 'not_found' as const,
      message: 'This Goal no longer exists.',
    };
  }
  if (goal.status === 'active' && !parsed.data.revisionReason) {
    return {
      ok: false as const,
      code: 'reason_required' as const,
      message: 'Record why the Active Goal agreement is changing.',
    };
  }
  const sharedArgs = {
    p_goal_id: parsed.data.goalId,
    p_expected_version: parsed.data.expectedVersion,
    p_expected_result: parsed.data.expectedResult,
    p_target_date: parsed.data.targetDate,
    p_agreed_approach: parsed.data.employeeApproach || null,
    p_support_needed: parsed.data.supportAgreed || null,
    p_dependencies: parsed.data.dependencies || null,
    p_baseline: parsed.data.baseline || null,
    p_purpose: parsed.data.purpose || null,
    p_weight_percent: parsed.data.weightPercent,
    p_measures: parsed.data.successMeasures.map((measure) => ({
      description: measure.description,
      optional_target_date: measure.optionalTargetDate || null,
    })),
    p_milestones: parsed.data.milestones,
    p_idempotency_key: parsed.data.idempotencyKey,
  };
  return goal.status === 'active'
    ? callGoalProcedure('revise_lean_goal_version', {
        ...sharedArgs,
        p_revision_reason: parsed.data.revisionReason,
      })
    : callGoalProcedure('save_goal_candidate_version', {
        ...sharedArgs,
        p_submission_mode: parsed.data.submissionMode,
      });
}

export async function agreeGoalVersion(input: {
  goalId: string;
  pendingVersionId: string;
  expectedVersion: number;
  idempotencyKey: string;
}) {
  const parsed = z
    .object({
      goalId: uuid,
      pendingVersionId: uuid,
      expectedVersion: z.number().int().positive(),
      idempotencyKey,
    })
    .safeParse(input);
  if (!parsed.success)
    return { ok: false as const, code: 'validation_failed' as const, message: 'Invalid request.' };
  const supabase = await createSupabaseServerClient();
  const [{ data: goal }, { data: pendingVersion }] = await Promise.all([
    supabase.from('goals').select('owner_id').eq('id', parsed.data.goalId).maybeSingle(),
    supabase
      .from('goal_versions')
      .select('weight_percent')
      .eq('id', parsed.data.pendingVersionId)
      .eq('goal_id', parsed.data.goalId)
      .maybeSingle(),
  ]);
  if (goal && pendingVersion) {
    const blocked = await formalWeightGuard({
      ownerId: goal.owner_id,
      proposedWeight: Number(pendingVersion.weight_percent),
      excludeGoalId: parsed.data.goalId,
    });
    if (blocked) return blocked;
  }
  return callGoalProcedure('agree_lean_goal_version', {
    p_goal_id: parsed.data.goalId,
    p_pending_version_id: parsed.data.pendingVersionId,
    p_expected_version: parsed.data.expectedVersion,
    p_idempotency_key: parsed.data.idempotencyKey,
  });
}

export async function requestGoalUpdate(input: {
  goalId: string;
  expectedVersion: number;
  message?: string;
  idempotencyKey: string;
}) {
  const parsed = z
    .object({
      goalId: uuid,
      expectedVersion: z.number().int().positive(),
      message: optionalText(1000),
      idempotencyKey,
    })
    .safeParse(input);
  if (!parsed.success)
    return { ok: false as const, code: 'validation_failed' as const, message: 'Invalid request.' };
  return callGoalProcedure('request_goal_update', {
    p_goal_id: parsed.data.goalId,
    p_expected_version: parsed.data.expectedVersion,
    p_message: parsed.data.message || null,
    p_idempotency_key: parsed.data.idempotencyKey,
  });
}

export async function resolveGoalSupport(input: {
  supportRequestId: string;
  resolutionNote: string;
  idempotencyKey: string;
}) {
  const parsed = z
    .object({
      supportRequestId: uuid,
      resolutionNote: z.string().trim().min(1).max(2000),
      idempotencyKey,
    })
    .safeParse(input);
  if (!parsed.success)
    return {
      ok: false as const,
      code: 'validation_failed' as const,
      message: 'Record how the support was resolved.',
    };
  return callGoalProcedure('resolve_goal_support', {
    p_support_request_id: parsed.data.supportRequestId,
    p_resolution_note: parsed.data.resolutionNote,
    p_idempotency_key: parsed.data.idempotencyKey,
  });
}

export async function linkGoalWork(input: {
  goalId: string;
  taskId: string;
  milestoneId?: string | null;
  expectedVersion: number;
  idempotencyKey: string;
}) {
  const parsed = z
    .object({
      goalId: uuid,
      taskId: uuid,
      milestoneId: uuid.nullish(),
      expectedVersion: z.number().int().positive(),
      idempotencyKey,
    })
    .safeParse(input);
  if (!parsed.success)
    return {
      ok: false as const,
      code: 'validation_failed' as const,
      message: 'Select valid work to link.',
    };
  return callGoalProcedure('link_goal_work', {
    p_goal_id: parsed.data.goalId,
    p_task_id: parsed.data.taskId,
    p_milestone_id: parsed.data.milestoneId || null,
    p_expected_version: parsed.data.expectedVersion,
    p_idempotency_key: parsed.data.idempotencyKey,
  });
}

/*
 * v53 section 17 — there is no generic "close a Goal" any more.
 *
 * `closeGoal` asked one question, "why is this being closed", and used it for
 * two different endings. A Goal that ran its course and a Goal that stopped
 * being relevant are not the same fact, and a single verb made the record
 * unable to tell them apart afterwards. `completeGoal` and `cancelGoal` below
 * ask what each ending actually needs.
 */

const sessionHealth = z.enum(['on_track', 'at_risk', 'off_track', 'no_material_change']);

export async function submitGoalMonthlySession(input: {
  employeeId: string;
  performancePeriodId: string;
  periodYear: number;
  periodMonth: number;
  items: Array<{
    goalId: string;
    health: z.infer<typeof sessionHealth>;
    updateText?: string | null;
    supportRequested?: boolean;
    supportDetails?: string | null;
    actionRequiredFrom?: string | null;
  }>;
  idempotencyKey: string;
}) {
  const parsed = z
    .object({
      employeeId: uuid,
      performancePeriodId: uuid,
      periodYear: z.number().int().min(2000).max(2200),
      periodMonth: z.number().int().min(1).max(12),
      items: z
        .array(
          z.object({
            goalId: uuid,
            health: sessionHealth,
            updateText: optionalText(4000),
            supportRequested: z.boolean().default(false),
            supportDetails: optionalText(4000),
            actionRequiredFrom: uuid.nullish(),
          }),
        )
        .min(1),
      idempotencyKey,
    })
    .safeParse(input);
  if (!parsed.success) {
    return {
      ok: false as const,
      code: 'validation_failed' as const,
      message: 'Review every Active Goal before completing the month.',
    };
  }
  for (const item of parsed.data.items) {
    if (['at_risk', 'off_track'].includes(item.health) && !item.updateText) {
      return {
        ok: false as const,
        code: 'validation_failed' as const,
        message: 'Explain each Goal marked At risk or Off track.',
      };
    }
    if (item.supportRequested && (!item.supportDetails || !item.actionRequiredFrom)) {
      return {
        ok: false as const,
        code: 'validation_failed' as const,
        message: 'Describe the support needed and choose who needs to act.',
      };
    }
  }
  return callGoalProcedure('submit_goal_monthly_session', {
    p_employee_id: parsed.data.employeeId,
    p_performance_period_id: parsed.data.performancePeriodId,
    p_period_year: parsed.data.periodYear,
    p_period_month: parsed.data.periodMonth,
    p_items: parsed.data.items.map((item) => ({
      goal_id: item.goalId,
      health: item.health,
      update_text: item.updateText || null,
      support_requested: item.supportRequested,
      support_details: item.supportDetails || null,
      action_required_from: item.actionRequiredFrom || null,
    })),
    p_idempotency_key: parsed.data.idempotencyKey,
  });
}

export async function completeGoalQuarterlySession(input: {
  employeeId: string;
  performancePeriodId: string;
  periodYear: number;
  periodQuarter: number;
  summary?: string | null;
  items: Array<{
    goalId: string;
    health: z.infer<typeof sessionHealth>;
    attentionText?: string | null;
    supportAdjustment?: string | null;
  }>;
  idempotencyKey: string;
}) {
  const parsed = z
    .object({
      employeeId: uuid,
      performancePeriodId: uuid,
      periodYear: z.number().int().min(2000).max(2200),
      periodQuarter: z.number().int().min(1).max(4),
      summary: optionalText(4000),
      items: z
        .array(
          z.object({
            goalId: uuid,
            health: sessionHealth,
            attentionText: optionalText(4000),
            supportAdjustment: optionalText(4000),
          }),
        )
        .min(1),
      idempotencyKey,
    })
    .safeParse(input);
  if (!parsed.success) {
    return {
      ok: false as const,
      code: 'validation_failed' as const,
      message: 'Review every Active Goal before completing the quarter.',
    };
  }
  return callGoalProcedure('complete_goal_quarterly_session', {
    p_employee_id: parsed.data.employeeId,
    p_performance_period_id: parsed.data.performancePeriodId,
    p_period_year: parsed.data.periodYear,
    p_period_quarter: parsed.data.periodQuarter,
    p_items: parsed.data.items.map((item) => ({
      goal_id: item.goalId,
      health: item.health,
      attention_text: item.attentionText || null,
      support_adjustment: item.supportAdjustment || null,
    })),
    p_summary: parsed.data.summary || null,
    p_idempotency_key: parsed.data.idempotencyKey,
  });
}

export async function finalizeGoalPlan(input: {
  employeeId: string;
  performancePeriodId: string;
  expectedVersion: number;
  idempotencyKey: string;
}) {
  const parsed = z
    .object({
      employeeId: uuid,
      performancePeriodId: uuid,
      expectedVersion: z.number().int().positive(),
      idempotencyKey,
    })
    .safeParse(input);
  if (!parsed.success)
    return { ok: false as const, code: 'validation_failed' as const, message: 'Invalid plan.' };
  return callGoalProcedure('finalize_goal_plan', {
    p_employee_id: parsed.data.employeeId,
    p_performance_period_id: parsed.data.performancePeriodId,
    p_expected_version: parsed.data.expectedVersion,
    p_idempotency_key: parsed.data.idempotencyKey,
  });
}

export async function completeGoal(input: {
  goalId: string;
  expectedVersion: number;
  finalResultSummary: string;
  measureResults: Array<{ measureId: string; actualResult: string }>;
  idempotencyKey: string;
}) {
  const parsed = z
    .object({
      goalId: uuid,
      expectedVersion: z.number().int().positive(),
      finalResultSummary: z.string().trim().min(1).max(4000),
      measureResults: z
        .array(z.object({ measureId: uuid, actualResult: z.string().trim().min(1).max(4000) }))
        .min(1),
      idempotencyKey,
    })
    .safeParse(input);
  if (!parsed.success) {
    return {
      ok: false as const,
      code: 'validation_failed' as const,
      message: 'Record the final result and an actual result for every success measure.',
    };
  }
  return callGoalProcedure('complete_goal', {
    p_goal_id: parsed.data.goalId,
    p_expected_version: parsed.data.expectedVersion,
    p_final_result_summary: parsed.data.finalResultSummary,
    p_measure_results: parsed.data.measureResults.map((measure) => ({
      measure_id: measure.measureId,
      actual_result: measure.actualResult,
    })),
    p_idempotency_key: parsed.data.idempotencyKey,
  });
}

export async function cancelGoal(input: {
  goalId: string;
  expectedVersion: number;
  reason: string;
  idempotencyKey: string;
}) {
  const parsed = z
    .object({
      goalId: uuid,
      expectedVersion: z.number().int().positive(),
      reason: z.string().trim().min(1).max(2000),
      idempotencyKey,
    })
    .safeParse(input);
  if (!parsed.success) {
    return {
      ok: false as const,
      code: 'validation_failed' as const,
      message: 'Record why this Goal no longer applies.',
    };
  }
  return callGoalProcedure('cancel_goal', {
    p_goal_id: parsed.data.goalId,
    p_expected_version: parsed.data.expectedVersion,
    p_reason: parsed.data.reason,
    p_idempotency_key: parsed.data.idempotencyKey,
  });
}
