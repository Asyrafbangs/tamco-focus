import 'server-only';

import { notFound } from 'next/navigation';
import { cache } from 'react';

import { NO_ESH_ACCESS, type EshAccess, type EshPreset } from '@/domain/esh-findings';
import { createSupabaseServerClient } from '@/lib/supabase/server';

/**
 * The signed-in person's Finding Management access, as the database decides it
 * (`esh_current_access`, v197).
 *
 * Read once per request. The screens use it to choose what to show; the
 * database applies the same rule again to every read and write, so hiding
 * something here is presentation, never the protection (§43.3).
 *
 * A failed read is treated as no access: the module fails closed.
 */
export const getEshAccess = cache(async (): Promise<EshAccess> => {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('esh_current_access');
  if (error) {
    console.error(`[getEshAccess] ${error.code ?? 'unknown'}: ${error.message}`);
    return NO_ESH_ACCESS;
  }
  const raw = (data ?? {}) as {
    enabled?: boolean;
    preset?: EshPreset;
    scope_all?: boolean;
    department_ids?: string[];
    can_coordinate?: boolean;
    can_verify?: boolean;
    can_manage_reports?: boolean;
    authorization_version?: number;
  };
  if (!raw.enabled || !raw.preset) return NO_ESH_ACCESS;
  return {
    enabled: true,
    preset: raw.preset,
    scopeAll: Boolean(raw.scope_all),
    departmentIds: raw.department_ids ?? [],
    canCoordinate: Boolean(raw.can_coordinate),
    canVerify: Boolean(raw.can_verify),
    canManageReports: Boolean(raw.can_manage_reports),
    authorizationVersion: raw.authorization_version ?? null,
  };
});

/**
 * For a Finding route: the access, or a plain 404.
 *
 * Not a "you need permission" page: during the restricted rollout a disabled
 * person must not learn from the response that the module exists (§43.3).
 */
export async function requireEshAccess(
  capability?: 'coordinate' | 'verify' | 'manage_reports',
): Promise<EshAccess> {
  const access = await getEshAccess();
  if (!access.enabled) notFound();
  if (capability === 'coordinate' && !access.canCoordinate) notFound();
  if (capability === 'verify' && !access.canVerify) notFound();
  if (capability === 'manage_reports' && !access.canManageReports) notFound();
  return access;
}
