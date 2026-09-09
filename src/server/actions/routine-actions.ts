'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import type { OperationResult } from '@/domain/types';
import { createSupabaseServerClient, requireProfile } from '@/lib/supabase/server';
import { scheduleNotificationEmailDispatch } from '@/server/workers/schedule-notification-email';

/**
 * Managing routines.
 *
 * The interface builds a recurrence pattern — frequency, interval, which days,
 * a start and an end — and these procedures store it in the columns
 * `focus.next_occurrence_date` reads. `@/domain/routines` owns the translation
 * in both directions, so the sentence on screen and the dates generated cannot
 * drift apart.
 */

const frequency = z.enum(['daily', 'weekly', 'monthly', 'yearly']);

const patternSchema = {
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(4000).nullish(),
  frequency,
  intervalCount: z.number().int().min(1).max(99),
  weekdays: z.array(z.number().int().min(1).max(7)).nullish(),
  monthlyMode: z.enum(['day_of_month', 'nth_weekday']).nullish(),
  dayOfMonth: z.number().int().min(1).max(31).nullish(),
  /** 1-4, or -1 for the last such weekday in the month. */
  nthWeekday: z
    .union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(-1)])
    .nullish(),
  nthWeekdayDow: z.number().int().min(1).max(7).nullish(),
  monthOfYear: z.number().int().min(1).max(12).nullish(),
  dueTime: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .default('17:00'),
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullish(),
  endsMode: z.enum(['never', 'after', 'on_date']).default('never'),
  endsAfterCount: z.number().int().min(1).max(999).nullish(),
  endsOnDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullish(),
  evidenceRequired: z.boolean().default(false),
  /**
   * What to attach, decided once by whoever sets the schedule up.
   *
   * The person doing the work should never have to judge whether this
   * occurrence needs a photo, so the answer travels with the schedule rather
   * than with them.
   */
  evidenceInstruction: z.string().trim().max(300).nullish(),
  requiresCompletionReview: z.boolean().default(false),
};

const createSchema = z.object({
  ...patternSchema,
  ownerId: z.string().uuid().nullish(),
  idempotencyKey: z.string().min(8).max(128).optional(),
});

const updateSchema = z.object({
  ...patternSchema,
  templateId: z.string().uuid(),
  idempotencyKey: z.string().min(8).max(128).optional(),
});

type RoutineResult = OperationResult<{
  routine_template_id?: string;
  is_active?: boolean;
  future_occurrences_cleared?: number;
}>;

async function call(name: string, args: Record<string, unknown>): Promise<RoutineResult> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc(name as never, args as never);

  if (error) {
    console.error(`[${name}] ${error.code ?? 'unknown'}: ${error.message}`);
    return { ok: false, code: 'unexpected_error', message: 'Nothing changed. Try again.' };
  }

  const result = data as RoutineResult;
  if (result.ok) {
    // The Bin and the calendar both read routines now, so neither can be left
    // showing a schedule that has just changed.
    for (const path of ['/work/routine', '/work', '/today', '/plan']) revalidatePath(path);
    await scheduleNotificationEmailDispatch();
  }
  return result;
}

/** The pattern arguments both procedures share, in their SQL names. */
function patternArgs(input: z.infer<typeof createSchema> | z.infer<typeof updateSchema>) {
  return {
    p_title: input.title,
    p_description: input.description ?? null,
    p_frequency: input.frequency,
    p_interval_count: input.intervalCount,
    p_weekdays: input.frequency === 'weekly' ? (input.weekdays ?? []) : null,
    p_monthly_mode: input.monthlyMode ?? null,
    p_day_of_month: input.dayOfMonth ?? null,
    p_nth_weekday: input.nthWeekday ?? null,
    p_nth_weekday_dow: input.nthWeekdayDow ?? null,
    p_month_of_year: input.monthOfYear ?? null,
    p_due_time: input.dueTime,
    p_start_date: input.startDate ?? null,
    p_ends_mode: input.endsMode,
    p_ends_after_count: input.endsAfterCount ?? null,
    p_ends_on_date: input.endsOnDate ?? null,
    p_evidence_required: input.evidenceRequired,
    // Only carried when evidence is required; the procedure drops it either
    // way, so a routine switched to optional cannot keep a stale sentence.
    p_evidence_instruction: input.evidenceRequired ? (input.evidenceInstruction ?? null) : null,
    p_requires_completion_review: input.requiresCompletionReview,
    p_idempotency_key: input.idempotencyKey ?? null,
  };
}

export async function createRoutineTemplate(input: z.input<typeof createSchema>) {
  await requireProfile();
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, code: 'validation_failed', message: 'Check the routine details.' };
  }
  return call('create_routine_template', {
    ...patternArgs(parsed.data),
    p_owner_id: parsed.data.ownerId ?? null,
  });
}

export async function updateRoutineTemplate(input: z.input<typeof updateSchema>) {
  await requireProfile();
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, code: 'validation_failed', message: 'Check the routine details.' };
  }
  return call('update_routine_template', {
    ...patternArgs(parsed.data),
    p_template_id: parsed.data.templateId,
  });
}

export async function setRoutineActive(input: {
  templateId: string;
  active: boolean;
  idempotencyKey?: string;
}) {
  await requireProfile();
  const parsed = z
    .object({
      templateId: z.string().uuid(),
      active: z.boolean(),
      idempotencyKey: z.string().min(8).max(128).optional(),
    })
    .safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, code: 'validation_failed', message: 'Nothing changed.' };
  }
  return call('set_routine_template_active', {
    p_template_id: parsed.data.templateId,
    p_active: parsed.data.active,
    p_idempotency_key: parsed.data.idempotencyKey ?? null,
  });
}

/**
 * Deleting is for a mistake at creation, which is why it is offered next to
 * Pause rather than instead of it. Pausing stops a schedule that was right;
 * deleting removes one that should not exist. The procedure enforces that only
 * the person who set it up may do the second.
 */
export async function deleteRoutineTemplate(input: {
  templateId: string;
  idempotencyKey?: string;
}) {
  await requireProfile();
  const parsed = z
    .object({
      templateId: z.string().uuid(),
      idempotencyKey: z.string().min(8).max(128).optional(),
    })
    .safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, code: 'validation_failed', message: 'Nothing changed.' };
  }
  return call('delete_routine_template', {
    p_template_id: parsed.data.templateId,
    p_idempotency_key: parsed.data.idempotencyKey ?? null,
  });
}

/**
 * Emptying one routine out of the Bin, for good. Refused unless it is already
 * binned, so the reversible step always happens first.
 */
export async function purgeRoutineTemplate(input: { templateId: string; idempotencyKey?: string }) {
  await requireProfile();
  const parsed = z
    .object({
      templateId: z.string().uuid(),
      idempotencyKey: z.string().min(8).max(128).optional(),
    })
    .safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, code: 'validation_failed', message: 'Nothing changed.' };
  }
  return call('purge_routine_template', {
    p_template_id: parsed.data.templateId,
    p_idempotency_key: parsed.data.idempotencyKey ?? null,
  });
}

export async function restoreRoutineTemplate(input: {
  templateId: string;
  idempotencyKey?: string;
}) {
  await requireProfile();
  const parsed = z
    .object({
      templateId: z.string().uuid(),
      idempotencyKey: z.string().min(8).max(128).optional(),
    })
    .safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, code: 'validation_failed', message: 'Nothing changed.' };
  }
  return call('restore_routine_template', {
    p_template_id: parsed.data.templateId,
    p_idempotency_key: parsed.data.idempotencyKey ?? null,
  });
}

/**
 * The second of a routine occurrence's two outcomes.
 *
 * "I did it" is `completeTask`, which already exists and already records who,
 * when, which steps and what evidence. This is the other one: the work
 * genuinely did not apply this time. It is the only thing about a routine that
 * the system cannot work out for itself, which is why it is the only thing an
 * employee is asked to type - and for the common reasons, not even that.
 */
export async function markRoutineNotRequired(input: {
  taskId: string;
  reasonCode: 'no_applicable_work' | 'activity_cancelled' | 'other';
  reasonNote?: string | null;
  idempotencyKey?: string;
}) {
  await requireProfile();
  const parsed = z
    .object({
      taskId: z.string().uuid(),
      reasonCode: z.enum(['no_applicable_work', 'activity_cancelled', 'other']),
      reasonNote: z.string().trim().max(500).nullish(),
      idempotencyKey: z.string().min(8).max(128).optional(),
    })
    .refine((value) => value.reasonCode !== 'other' || Boolean(value.reasonNote), {
      message: 'Say briefly why it was not required.',
      path: ['reasonNote'],
    })
    .safeParse(input);
  if (!parsed.success) {
    return {
      ok: false as const,
      code: 'validation_failed',
      message: parsed.error.issues[0]?.message ?? 'Choose a reason.',
    };
  }
  return call('mark_routine_not_required', {
    p_task_id: parsed.data.taskId,
    p_reason_code: parsed.data.reasonCode,
    p_reason_note: parsed.data.reasonNote ?? null,
    p_idempotency_key: parsed.data.idempotencyKey ?? null,
  });
}

/**
 * Accept is one click. Returning it costs a sentence, because the person has
 * to know what still needs doing.
 */
export async function decideRoutineException(input: {
  exceptionId: string;
  accept: boolean;
  note?: string | null;
  idempotencyKey?: string;
}) {
  await requireProfile();
  const parsed = z
    .object({
      exceptionId: z.string().uuid(),
      accept: z.boolean(),
      note: z.string().trim().max(500).nullish(),
      idempotencyKey: z.string().min(8).max(128).optional(),
    })
    .refine((value) => value.accept || Boolean(value.note), {
      message: 'Say why it is coming back.',
      path: ['note'],
    })
    .safeParse(input);
  if (!parsed.success) {
    return {
      ok: false as const,
      code: 'validation_failed',
      message: parsed.error.issues[0]?.message ?? 'Nothing changed.',
    };
  }
  return call('decide_routine_exception', {
    p_exception_id: parsed.data.exceptionId,
    p_accept: parsed.data.accept,
    p_note: parsed.data.note ?? null,
    p_idempotency_key: parsed.data.idempotencyKey ?? null,
  });
}

/**
 * Taking a skip request back (§15).
 *
 * The employee's own retraction, not a second route to a decision. The
 * database refuses it for anybody but the person who raised it, and refuses it
 * once somebody has answered — so a manager cannot have their decision undone
 * by whoever asked the question.
 */
export async function withdrawRoutineException(input: {
  exceptionId: string;
  idempotencyKey?: string;
}) {
  await requireProfile();
  const parsed = z
    .object({
      exceptionId: z.string().uuid(),
      idempotencyKey: z.string().min(8).max(128).optional(),
    })
    .safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, code: 'validation_failed', message: 'Nothing changed.' };
  }
  return call('withdraw_routine_exception', {
    p_exception_id: parsed.data.exceptionId,
    p_idempotency_key: parsed.data.idempotencyKey ?? null,
  });
}
