'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { createSupabaseServerClient } from '@/lib/supabase/server';

const uuid = z.string().uuid();

export interface DepartmentEscalationState {
  ok: boolean;
  message: string;
}

const PROBLEMS: Record<string, string> = {
  not_permitted: 'Only an ESH Verifier can set a department’s escalation route.',
  department_not_found: 'That department is not in your scope.',
  level_invalid: 'Levels run from 1 to 9.',
  email_invalid: 'One of those addresses is not a valid email address.',
  invalid: 'That route could not be read.',
};

/**
 * v223 - record the route a department normally uses (§7).
 *
 * It is a default offered at assignment, not a policy that assigns anybody:
 * ESH still confirms the actual action-specific route on the finding, and
 * nobody named here is written to or given access by being listed.
 */
export async function setDepartmentEscalation(input: {
  departmentId: string;
  levels: Array<{ level: number; email: string }>;
}): Promise<DepartmentEscalationState> {
  const departmentId = uuid.safeParse(input.departmentId);
  if (!departmentId.success) return { ok: false, message: PROBLEMS.department_not_found! };
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('esh_set_department_escalation', {
    p_department_id: departmentId.data,
    p_levels: (input.levels ?? []).map((entry) => ({
      level: entry.level,
      email: String(entry.email ?? '').trim(),
    })),
  });
  if (error) {
    console.error(`[setDepartmentEscalation] ${error.code ?? 'unknown'}: ${error.message}`);
    return { ok: false, message: 'Something went wrong and nothing was changed. Try again.' };
  }
  const result = (data ?? {}) as { ok?: boolean; code?: string; written?: number };
  if (!result.ok) {
    return { ok: false, message: PROBLEMS[result.code ?? 'invalid'] ?? PROBLEMS.invalid! };
  }
  revalidatePath('/findings/settings');
  revalidatePath('/findings/new');
  return {
    ok: true,
    message:
      result.written === 0
        ? 'Route cleared. New findings in this department will ask for one.'
        : `Route saved. New findings in this department will offer these ${result.written} recipients.`,
  };
}
