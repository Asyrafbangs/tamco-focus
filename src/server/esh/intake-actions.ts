'use server';

import { revalidatePath } from 'next/cache';

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
  if (result.ok) {
    revalidatePath('/findings/intake');
    return { ok: true, message: 'Report claimed for triage.' };
  }
  if (result.code === 'not_available') {
    return { ok: false, message: 'Another coordinator has already started this report.' };
  }
  return { ok: false, message: 'That report is no longer available.' };
}

/** Decline an invalid intake without creating any Finding or owner action. */
export async function declineReportIntake(input: {
  intakeId: string;
  reason: string;
}): Promise<IntakeActionResult> {
  const intakeId = parseReportIntakeId(input.intakeId);
  const reason = input.reason.trim();
  if (!intakeId) return { ok: false, message: 'That report is no longer available.' };
  if (!reason) return { ok: false, message: 'Explain why the report is being declined.' };

  const access = await getEshAccess();
  if (!access.enabled || !access.canCoordinate) {
    return { ok: false, message: 'You do not have triage access.' };
  }
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('esh_decline_report_intake', {
    p_intake_id: intakeId,
    p_reason: reason,
  });
  if (error) {
    console.error(`[esh_decline_report_intake] ${error.code ?? 'unknown'}: ${error.message}`);
    return { ok: false, message: 'The report could not be declined.' };
  }
  const result = (data ?? {}) as { ok?: boolean; code?: string };
  if (result.ok) {
    revalidatePath('/findings/intake');
    return { ok: true, message: 'Report declined without creating an action.' };
  }
  if (result.code === 'reason_required') {
    return { ok: false, message: 'Explain why the report is being declined.' };
  }
  return { ok: false, message: 'That report is no longer available.' };
}

/** Link a duplicate report to an existing visible Finding without new work. */
export async function markReportIntakeDuplicate(input: {
  intakeId: string;
  findingId: string;
  reason: string;
}): Promise<IntakeActionResult> {
  const intakeId = parseReportIntakeId(input.intakeId);
  const findingId = parseReportIntakeId(input.findingId);
  const reason = input.reason.trim();
  if (!intakeId || !findingId) return { ok: false, message: 'That report is no longer available.' };
  if (!reason) return { ok: false, message: 'Explain why this is a duplicate.' };
  const access = await getEshAccess();
  if (!access.enabled || !access.canCoordinate) {
    return { ok: false, message: 'You do not have triage access.' };
  }
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('esh_mark_report_intake_duplicate', {
    p_intake_id: intakeId,
    p_finding_id: findingId,
    p_reason: reason,
  });
  if (error) {
    console.error(
      `[esh_mark_report_intake_duplicate] ${error.code ?? 'unknown'}: ${error.message}`,
    );
    return { ok: false, message: 'The duplicate link could not be saved.' };
  }
  const result = (data ?? {}) as { ok?: boolean; code?: string };
  if (result.ok) {
    revalidatePath('/findings/intake');
    return { ok: true, message: 'Linked as a duplicate without creating an action.' };
  }
  if (result.code === 'reason_required')
    return { ok: false, message: 'Explain why this is a duplicate.' };
  return { ok: false, message: 'That report or Finding is no longer available.' };
}

/** Record an ESH-verbal report as private intake, never as an assigned Finding. */
export async function createManualReportIntake(input: {
  reportText: string;
  reportedLocation?: string;
  departmentId?: string;
}): Promise<IntakeActionResult> {
  const reportText = input.reportText.trim();
  if (!reportText || reportText.length > 4000) {
    return { ok: false, message: 'Describe what was reported in up to 4,000 characters.' };
  }
  const access = await getEshAccess();
  if (!access.enabled || !access.canCoordinate) {
    return { ok: false, message: 'You do not have triage access.' };
  }
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('esh_create_manual_report_intake', {
    p_report_text: reportText,
    p_reported_location: input.reportedLocation?.trim() || null,
    p_department_id: input.departmentId || null,
  });
  if (error) {
    console.error(`[esh_create_manual_report_intake] ${error.code ?? 'unknown'}: ${error.message}`);
    return { ok: false, message: 'The manual report could not be saved.' };
  }
  const result = (data ?? {}) as { ok?: boolean; code?: string };
  if (result.ok) {
    revalidatePath('/findings/intake');
    return { ok: true, message: 'Private report recorded for triage.' };
  }
  return { ok: false, message: 'The manual report could not be saved.' };
}
