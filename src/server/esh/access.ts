import 'server-only';

import { notFound } from 'next/navigation';
import { cache } from 'react';

import { accessFromAnswer, type EshAccess, type EshAccessAnswer } from '@/domain/esh-findings';
import { createSupabaseServerClient } from '@/lib/supabase/server';

/**
 * The signed-in person's Finding Management access, as the database decides it
 * (`esh_current_access`, v197).
 *
 * Read once per request. The screens use it to choose what to show; the
 * database applies the same rule again to every read and write, so hiding
 * something here is presentation, never the protection (§43.3).
 *
 * A read that SAYS no access is no access, and the module fails closed. A read
 * that FAILS is a different thing and is no longer treated as the same: see
 * `accessFromAnswer` below.
 */

export const getEshAccess = cache(async (): Promise<EshAccess> => {
  const supabase = await createSupabaseServerClient();
  /*
   * One retry, because the failure this guards against is a gateway 502 that
   * does not survive being asked again. A second failure is reported rather
   * than swallowed.
   */
  let attempt = await supabase.rpc('esh_current_access');
  if (attempt.error) {
    console.error(
      `[getEshAccess] ${attempt.error.code ?? 'unknown'}: ${attempt.error.message} (retrying once)`,
    );
    attempt = await supabase.rpc('esh_current_access');
  }
  if (attempt.error) {
    console.error(`[getEshAccess] ${attempt.error.code ?? 'unknown'}: ${attempt.error.message}`);
  }
  return accessFromAnswer(
    (attempt.data ?? null) as EshAccessAnswer | null,
    attempt.error ? { code: attempt.error.code, message: attempt.error.message } : null,
  );
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
