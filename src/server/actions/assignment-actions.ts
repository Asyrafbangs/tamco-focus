'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { endOfLocalDay } from '@/domain/duration';
import type { OperationResult } from '@/domain/types';
import { createSupabaseServerClient, requireProfile } from '@/lib/supabase/server';
import { scheduleNotificationEmailDispatch } from '@/server/workers/schedule-notification-email';

/**
 * Manager assignment (v40 sections 3 and 6).
 *
 * The manager states the four things a manager is actually responsible for —
 * what kind of work it is, how urgent, who owes it, and when it will be
 * reviewed — and the work then waits in that person's Available list. It does
 * not start. Deciding when to carry something is the employee's, and it is the
 * only decision the 1 / 5 / 1 focus model gives them; an assignment that could
 * set `active` would spend their focus budget on their behalf.
 *
 * Choosing several people creates several independent tasks rather than one
 * shared one. Use it only when each person separately owes the whole result —
 * "every department owner reviews their own HIRARC". When one result is owed
 * once, the answer is a single task with checklist items assigned to
 * contributors (section 7), which is a different action entirely.
 */

const ASSIGNABLE_WORK_CLASSES = [
  'operational_action',
  'major_project',
  'self_development',
] as const;

const schema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(4000).optional(),
  workClass: z.enum(ASSIGNABLE_WORK_CLASSES),
  ownerIds: z.array(z.string().uuid()).min(1).max(25),
  urgency: z.enum(['low', 'normal', 'high', 'critical']).default('normal'),
  dueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  reviewDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  idempotencyKey: z.string().min(8).max(128),
});

export interface AssignmentResultData {
  assignment_batch_id?: string;
  task_ids?: string[];
  created_count?: number;
}

export async function assignWork(
  input: z.input<typeof schema>,
): Promise<OperationResult<AssignmentResultData>> {
  const profile = await requireProfile();
  const parsed = schema.safeParse(input);

  if (!parsed.success) {
    return {
      ok: false,
      code: 'validation_failed',
      message: 'Give the work a title, a type, and at least one person.',
    };
  }

  // Dates arrive as calendar days. They are stored as the END of that day in
  // the organisation's time zone, so "due 14 Aug" is not quietly overdue at
  // 00:01 for somebody in a different zone.
  const dueAt = parsed.data.dueDate
    ? endOfLocalDay(parsed.data.dueDate, profile.timezone).toISOString()
    : null;
  const reviewAt = parsed.data.reviewDate
    ? endOfLocalDay(parsed.data.reviewDate, profile.timezone).toISOString()
    : null;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('assign_work_to_people', {
    p_title: parsed.data.title,
    p_description: parsed.data.description || null,
    p_work_class: parsed.data.workClass,
    p_owner_ids: parsed.data.ownerIds,
    p_urgency: parsed.data.urgency,
    p_due_at: dueAt,
    p_due_is_date_only: true,
    p_review_at: reviewAt,
    p_idempotency_key: parsed.data.idempotencyKey,
  });

  if (error) {
    console.error(`[assignWork] ${error.code ?? 'unknown'}: ${error.message}`);
    return { ok: false, code: 'unexpected_error', message: 'Nothing was assigned. Try again.' };
  }

  const result = data as OperationResult<AssignmentResultData>;
  if (result.ok) {
    for (const path of ['/today', '/work', '/plan']) revalidatePath(path);
    await scheduleNotificationEmailDispatch();
  }
  return result;
}

/** People this manager may assign to. RLS decides the list, not this query. */
export async function getAssignablePeople(): Promise<
  Array<{ id: string; fullName: string; employeeId: string }>
> {
  const profile = await requireProfile();
  if (profile.role !== 'manager' && profile.role !== 'administrator') return [];

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('user_profiles')
    .select('id, full_name, employee_id')
    .eq('status', 'active')
    .neq('id', profile.id)
    .order('full_name')
    .limit(200);

  if (error) {
    console.error(`[getAssignablePeople] ${error.message}`);
    return [];
  }

  return (data ?? []).map((row) => ({
    id: String(row.id),
    fullName: String(row.full_name),
    employeeId: String(row.employee_id),
  }));
}
