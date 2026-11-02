'use server';

import { parseReportIntakeId } from '@/domain/esh-intake';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getEshAccess } from '@/server/esh/access';

export interface IntakeActionResult {
  ok: boolean;
  message: string;
}

/** Claim one private intake before an ESH coordinator begins triage. */
export async function claimReportIntake(input: { intakeId: string }): Promise<IntakeActionResult> {
  const intakeId = parseReportIntakeId(input.intakeId);
  if (!intakeId) return { ok: false, message: 'That report is no longer available.' };

  const access = await getEshAccess();
  if (!access.enabled || !access.canCoordinate) {
    return { ok: false, message: 'You do not have triage access.' };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('esh_claim_report_intake', {
    p_intake_id: intakeId,
  });
  if (error) {
    console.error(`[esh_claim_report_intake] ${error.code ?? 'unknown'}: ${error.message}`);
    return { ok: false, message: 'The report could not be claimed.' };
  }

  const result = (data ?? {}) as { ok?: boolean; code?: string };
  if (result.ok) return { ok: true, message: 'Report claimed for triage.' };
  if (result.code === 'not_available') {
    return { ok: false, message: 'Another coordinator has already started this report.' };
  }
  return { ok: false, message: 'That report is no longer available.' };
}
