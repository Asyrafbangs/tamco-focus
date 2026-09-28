'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { departmentProblem } from '@/domain/esh-departments';
import { ownerEmailProblem, type OwnerEmailMode } from '@/domain/esh-owner-email';
import { createSupabaseServerClient, requireProfile } from '@/lib/supabase/server';
import { scheduleEshDispatch } from '@/server/esh/schedule-dispatch';

/**
 * Configuration that people should not have to re-enter (v223): whether owner
 * email is held or live, releasing everything held at once, adding a
 * department where a finding is recorded, and a department's usual
 * escalation route. Each is one database procedure; authority is decided
 * there, not here.
 */

const uuid = z.string().uuid();

export type SettingResult = { ok: true; message?: string } | { ok: false; message: string };

function refreshModule() {
  revalidatePath('/findings/register');
  revalidatePath('/findings/settings');
}

export async function setOwnerEmailMode(input: {
  mode: OwnerEmailMode;
  reason: string;
}): Promise<SettingResult> {
  await requireProfile();
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('esh_set_owner_notices', {
    p_mode: input.mode === 'live' ? 'live' : 'held',
    p_reason: String(input.reason ?? ''),
  });
  if (error) {
    console.error(`[esh_set_owner_notices] ${error.code ?? 'unknown'}: ${error.message}`);
    return { ok: false, message: ownerEmailProblem(undefined) };
  }
  const result = (data ?? {}) as { ok?: boolean; code?: string };
  if (!result.ok) return { ok: false, message: ownerEmailProblem(result.code) };
  refreshModule();
  return { ok: true };
}

export async function releaseAllHeld(input: { reason: string }): Promise<SettingResult> {
  await requireProfile();
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('esh_release_all_held', {
    p_reason: String(input.reason ?? ''),
  });
  if (error) {
    console.error(`[esh_release_all_held] ${error.code ?? 'unknown'}: ${error.message}`);
    return { ok: false, message: ownerEmailProblem(undefined) };
  }
  const result = (data ?? {}) as {
    ok?: boolean;
    code?: string;
    released?: number;
    still_held?: number;
  };
  if (!result.ok) return { ok: false, message: ownerEmailProblem(result.code) };
  await scheduleEshDispatch();
  refreshModule();
  const released = Number(result.released ?? 0);
  const stillHeld = Number(result.still_held ?? 0);
  return {
    ok: true,
    message:
      `${released} email${released === 1 ? '' : 's'} released.` +
      (stillHeld > 0
        ? ` ${stillHeld} stay held because an administrator switched those contacts off.`
        : ''),
  };
}

export type DepartmentResult =
  { ok: true; id: string; name: string; existed: boolean } | { ok: false; message: string };

export async function createDepartment(input: { name: string }): Promise<DepartmentResult> {
  await requireProfile();
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('esh_create_department', {
    p_name: String(input.name ?? ''),
  });
  if (error) {
    console.error(`[esh_create_department] ${error.code ?? 'unknown'}: ${error.message}`);
    return { ok: false, message: departmentProblem(undefined) };
  }
  const result = (data ?? {}) as { ok?: boolean; code?: string; id?: string; name?: string };
  // An existing department is the answer, not a failure: the form selects it.
  if (result.code === 'exists' && result.id) {
    return { ok: true, id: result.id, name: String(result.name ?? ''), existed: true };
  }
  if (!result.ok || !result.id) return { ok: false, message: departmentProblem(result.code) };
  revalidatePath('/findings/new');
  revalidatePath('/findings/settings');
  return { ok: true, id: result.id, name: String(result.name ?? ''), existed: false };
}

const ROUTE_PROBLEMS: Record<string, string> = {
  not_permitted: 'Only an ESH Verifier can change a department’s route.',
  department_not_found: 'That department no longer exists.',
  escalation_level_invalid: 'Escalation levels run from 1 to 9.',
  escalation_email_invalid: 'One of the addresses is not an email address.',
  escalation_levels_have_gaps: 'Levels start at 1 and do not skip one.',
};

export async function setDepartmentRoute(input: {
  departmentId: string;
  route: Array<{ level: number; email: string }>;
}): Promise<SettingResult> {
  await requireProfile();
  const departmentId = uuid.safeParse(input.departmentId);
  if (!departmentId.success) {
    return { ok: false, message: 'That department no longer exists.' };
  }
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('esh_set_department_route', {
    p_department_id: departmentId.data,
    p_route: input.route,
  });
  if (error) {
    console.error(`[esh_set_department_route] ${error.code ?? 'unknown'}: ${error.message}`);
    return { ok: false, message: 'The route could not be saved. Try again.' };
  }
  const result = (data ?? {}) as { ok?: boolean; code?: string };
  if (!result.ok) {
    return {
      ok: false,
      message:
        (result.code ? ROUTE_PROBLEMS[result.code] : undefined) ??
        'The route could not be saved. Try again.',
    };
  }
  revalidatePath('/findings/settings');
  revalidatePath('/findings/new');
  return { ok: true };
}
