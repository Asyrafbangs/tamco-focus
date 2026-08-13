'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import type { OperationResult } from '@/domain/types';
import { createSupabaseServerClient, requireProfile } from '@/lib/supabase/server';

/**
 * Managing routines.
 *
 * The cadence somebody chooses in the interface is a phrase — "Quarterly", "Every
 * 2 weeks" — and the database stores the four fields
 * `focus.next_occurrence_date` actually reads. `ROUTINE_CADENCES` in
 * `@/domain/routines` is the single place that translation lives, so the words
 * on screen and the dates generated cannot drift apart.
 */

const frequency = z.enum(['daily', 'weekly', 'monthly']);

const shapeSchema = {
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(4000).nullish(),
  frequency,
  intervalCount: z.number().int().min(1).max(52),
  weekday: z.number().int().min(1).max(7).nullish(),
  dayOfMonth: z.number().int().min(1).max(31).nullish(),
  dueTime: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .default('17:00'),
  evidenceRequired: z.boolean().default(false),
  requiresCompletionReview: z.boolean().default(false),
};

const createSchema = z.object({
  ...shapeSchema,
  ownerId: z.string().uuid().nullish(),
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullish(),
  idempotencyKey: z.string().min(8).max(128).optional(),
});

type RoutineResult = OperationResult<{
  routine_template_id?: string;
  is_active?: boolean;
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
    for (const path of ['/work/routine', '/work', '/today']) revalidatePath(path);
  }
  return result;
}

export async function createRoutineTemplate(input: z.input<typeof createSchema>) {
  await requireProfile();
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false as const,
      code: 'validation_failed' as const,
      message: 'Give the routine a name and a valid schedule.',
    };
  }

  return call('create_routine_template', {
    p_title: parsed.data.title,
    p_description: parsed.data.description ?? null,
    p_owner_id: parsed.data.ownerId ?? null,
    p_frequency: parsed.data.frequency,
    p_interval_count: parsed.data.intervalCount,
    p_weekday: parsed.data.weekday ?? null,
    p_day_of_month: parsed.data.dayOfMonth ?? null,
    p_due_time: parsed.data.dueTime,
    p_start_date: parsed.data.startDate ?? null,
    p_evidence_required: parsed.data.evidenceRequired,
    p_requires_completion_review: parsed.data.requiresCompletionReview,
    p_idempotency_key: parsed.data.idempotencyKey ?? null,
  });
}

const updateSchema = z.object({
  ...shapeSchema,
  templateId: z.string().uuid(),
  idempotencyKey: z.string().min(8).max(128).optional(),
});

export async function updateRoutineTemplate(input: z.input<typeof updateSchema>) {
  await requireProfile();
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false as const,
      code: 'validation_failed' as const,
      message: 'Give the routine a name and a valid schedule.',
    };
  }

  return call('update_routine_template', {
    p_template_id: parsed.data.templateId,
    p_title: parsed.data.title,
    p_description: parsed.data.description ?? null,
    p_frequency: parsed.data.frequency,
    p_interval_count: parsed.data.intervalCount,
    p_weekday: parsed.data.weekday ?? null,
    p_day_of_month: parsed.data.dayOfMonth ?? null,
    p_due_time: parsed.data.dueTime,
    p_evidence_required: parsed.data.evidenceRequired,
    p_requires_completion_review: parsed.data.requiresCompletionReview,
    p_idempotency_key: parsed.data.idempotencyKey ?? null,
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
    return { ok: false as const, code: 'validation_failed' as const, message: 'Invalid request.' };
  }

  return call('set_routine_template_active', {
    p_template_id: parsed.data.templateId,
    p_active: parsed.data.active,
    p_idempotency_key: parsed.data.idempotencyKey ?? null,
  });
}
