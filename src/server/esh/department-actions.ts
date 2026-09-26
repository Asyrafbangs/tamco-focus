'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { departmentCodeProblem } from '@/domain/department-names';
import { createSupabaseServerClient, requireProfile } from '@/lib/supabase/server';

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

export interface AddDepartmentResult {
  ok: boolean;
  message: string;
  department?: { id: string; name: string };
}

const ADD_PROBLEMS: Record<string, string> = {
  not_authorised: 'Only an administrator can add a department.',
  name_required: 'Give the department a name.',
  code_invalid: 'A code is 2 to 32 letters, digits, dashes or underscores.',
  code_taken: 'Another department already uses that code.',
  not_found: 'That parent department does not exist.',
};

/**
 * v225 - add a department from the finding being recorded (§7, §31.2).
 *
 * §31.2 keeps department maintenance in shared administration and asks for no
 * organisation-chart editor here, and this adds neither: it is the same
 * administrator-only `create_department` the Organisation screen calls, with
 * the same validation and the same security log, reached from the one place the
 * gap is actually noticed. Somebody recording a finding about a department the
 * register has never heard of had to abandon a half-written finding to go and
 * make it.
 *
 * Nobody gains anything by a department existing: it grants no access, sees no
 * findings, and has no escalation route until ESH gives it one.
 */
export async function addDepartment(input: {
  name: string;
  code: string;
}): Promise<AddDepartmentResult> {
  const profile = await requireProfile();
  if (profile.role !== 'administrator') {
    return { ok: false, message: ADD_PROBLEMS.not_authorised! };
  }
  const name = String(input.name ?? '')
    .trim()
    .slice(0, 120);
  const code = String(input.code ?? '')
    .trim()
    .toUpperCase();
  if (!name) return { ok: false, message: ADD_PROBLEMS.name_required! };
  const codeProblem = departmentCodeProblem(code);
  if (codeProblem) return { ok: false, message: codeProblem };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('create_department', {
    p_name: name,
    p_code: code,
  });
  if (error) {
    console.error(`[create_department] ${error.code ?? 'unknown'}: ${error.message}`);
    return { ok: false, message: 'Something went wrong and no department was added.' };
  }
  const result = (data ?? {}) as { ok?: boolean; code?: string; id?: string };
  if (!result.ok || !result.id) {
    return {
      ok: false,
      message: ADD_PROBLEMS[result.code ?? ''] ?? 'That department could not be added.',
    };
  }

  revalidatePath('/findings/new');
  revalidatePath('/more/admin/organisation');
  return { ok: true, message: `${name} added.`, department: { id: result.id, name } };
}
