'use server';

import { revalidatePath } from 'next/cache';

import { parseReportIntakeId } from '@/domain/esh-intake';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getEshAccess } from '@/server/esh/access';

export interface IntakeActionResult {
  ok: boolean;
  message: string;
}

/**
 * Today carries the intake counter and a preview of this queue, so a triage
 * decision has to clear both. Clearing only the queue left Today's number
 * showing the value it had before the decision.
 */
function revalidateIntake() {
  revalidatePath('/findings/intake');
  revalidatePath('/findings');
}

/**
 * Claim one private intake before an ESH coordinator begins triage.
 *
 * `takeOver` is the deliberate version (v310). Without it the procedure
 * refuses a report somebody else is holding, which is what keeps the
 * automatic claim inside `saveFinding` from quietly taking one; with it, a
 * report stuck with a colleague who is not coming back can be rescued, and
 * the audit keeps the person it was taken from.
 */
export async function claimReportIntake(input: {
  intakeId: string;
  takeOver?: boolean;
}): Promise<IntakeActionResult> {
  const intakeId = parseReportIntakeId(input.intakeId);
  if (!intakeId) return { ok: false, message: 'That report is no longer available.' };

  const access = await getEshAccess();
  if (!access.enabled || !access.canCoordinate) {
    return { ok: false, message: 'You do not have triage access.' };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('esh_claim_report_intake', {
    p_intake_id: intakeId,
    p_take_over: input.takeOver === true,
  });
  if (error) {
    console.error(`[esh_claim_report_intake] ${error.code ?? 'unknown'}: ${error.message}`);
    return { ok: false, message: 'The report could not be claimed.' };
  }

  const result = (data ?? {}) as { ok?: boolean; code?: string; taken_over?: boolean };
  if (result.ok) {
    revalidateIntake();
    return {
      ok: true,
      message: result.taken_over
        ? 'Taken over. The handover is recorded, and the report is yours to triage.'
        : 'Report claimed for triage.',
    };
  }
  if (result.code === 'held_by_other') {
    return { ok: false, message: 'Another coordinator is holding this report.' };
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
    revalidateIntake();
    return { ok: true, message: 'Report declined without creating an action.' };
  }
  if (result.code === 'reason_required') {
    return { ok: false, message: 'Explain why the report is being declined.' };
  }
  /*
   * v313 — declining a report a colleague is holding is theirs to do, not
   * yours. The screen does not offer this while somebody else holds it, so
   * reaching this answer means the hold changed under you.
   */
  if (result.code === 'held_by_other') {
    return {
      ok: false,
      message:
        'Another coordinator is holding this report. Take it over first if the decision should be yours.',
    };
  }
  return { ok: false, message: 'That report is no longer available.' };
}

/** Link a duplicate report to an existing visible Finding without new work. */
export async function markReportIntakeDuplicate(input: {
  intakeId: string;
  findingReference: string;
  reason: string;
}): Promise<IntakeActionResult> {
  const intakeId = parseReportIntakeId(input.intakeId);
  const findingReference = input.findingReference.trim();
  const reason = input.reason.trim();
  if (!intakeId) return { ok: false, message: 'That report is no longer available.' };
  if (!findingReference) return { ok: false, message: 'Enter the existing Finding reference.' };
  if (!reason) return { ok: false, message: 'Explain why this is a duplicate.' };
  const access = await getEshAccess();
  if (!access.enabled || !access.canCoordinate) {
    return { ok: false, message: 'You do not have triage access.' };
  }
  const supabase = await createSupabaseServerClient();
  // This only resolves a visible reference for usability. The write procedure
  // rechecks organization, status and department scope atomically.
  const { data: target, error: targetError } = await supabase
    .from('esh_findings')
    .select('id')
    .eq('reference', findingReference)
    .in('status', ['new', 'open'])
    .maybeSingle();
  if (targetError || !target) {
    if (targetError) {
      console.error(
        `[markReportIntakeDuplicate] ${targetError.code ?? 'unknown'}: ${targetError.message}`,
      );
    }
    return { ok: false, message: 'No visible open Finding has that reference.' };
  }
  const { data, error } = await supabase.rpc('esh_mark_report_intake_duplicate', {
    p_intake_id: intakeId,
    p_finding_id: target.id,
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
    revalidateIntake();
    return { ok: true, message: 'Linked as a duplicate without creating an action.' };
  }
  if (result.code === 'reason_required')
    return { ok: false, message: 'Explain why this is a duplicate.' };
  // v313 — as with declining: retiring the report belongs to whoever holds it.
  if (result.code === 'held_by_other') {
    return {
      ok: false,
      message:
        'Another coordinator is holding this report. Take it over first if the decision should be yours.',
    };
  }
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
  /*
   * The intake policy scopes rows by department, and `department_id = any(…)`
   * is NULL-safe-false, so a report with no department is visible only to a
   * coordinator who covers the whole organisation. Letting a scoped
   * coordinator record one would lose it the instant it was saved.
   */
  if (!access.scopeAll && !input.departmentId) {
    return { ok: false, message: 'Choose the department the report belongs to.' };
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
    revalidateIntake();
    return { ok: true, message: 'Private report recorded for triage.' };
  }
  if (result.code === 'department_not_found') {
    return { ok: false, message: 'Choose a department you cover.' };
  }
  return { ok: false, message: 'The manual report could not be saved.' };
}
