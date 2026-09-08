'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { IMPLAUSIBLE_YEARS_AHEAD, isImplausibleDate } from '@/domain/delivery';
import { classifyCapture } from '@/domain/classification';
import { endOfLocalDay } from '@/domain/duration';
import type { CaptureDestination, OperationResult } from '@/domain/types';
import { createSupabaseServerClient, requireProfile } from '@/lib/supabase/server';
import { scheduleNotificationEmailDispatch } from '@/server/workers/schedule-notification-email';
import { safeAttachmentFileName, validateAttachmentFiles } from '@/server/attachments';

const captureDestination = z.enum([
  'quick_action',
  'operational_available_work',
  'routine_template_request',
  'self_development_plan',
  'collaborative_contribution',
  'major_project_request',
  'mandatory_operational_action',
]);

export interface CaptureDraftResult {
  ok: boolean;
  code: string;
  message?: string;
  captureId?: string;
  recommendation?: ReturnType<typeof classifyCapture>;
}

export async function createCaptureDraft(formData: FormData): Promise<CaptureDraftResult> {
  const profile = await requireProfile();
  const parsed = z
    .object({
      title: z.string().trim().min(1).max(200),
      description: z.string().trim().max(4000).optional(),
      /** Chosen from a list. Never read out of the title. */
      workType: z.enum(['normal', 'routine', 'self_development', 'major_project']),
      /**
       * The answer to the follow-up question, or absent. Deliberately NOT
       * derived from `chosenDate`: a fortnight-away deadline says nothing about
       * how long the work takes.
       */
      requiresFollowUp: z.enum(['yes', 'no']).optional(),
      chosenDate: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional(),
      /** §11 — why this work exists. Absent when nobody answered. */
      workPurpose: z.enum(['reactive', 'planned_operations', 'improvement_development']).optional(),
      /** What completing this work will require as proof (v134). */
      completionEvidenceRule: z.enum(['optional', 'file_or_note', 'file']).default('optional'),
      completionEvidenceInstruction: z.string().trim().max(500).optional(),
      /**
       * Asked only for a Major Project, which is the one capture that goes to
       * somebody else for a decision. Everything else creates work the person
       * in front of us already owns, and needs no case made for it.
       */
      successMeasure: z.string().trim().max(2000).optional(),
      expectedMonths: z.coerce.number().int().min(1).max(60).optional(),
    })
    .safeParse({
      title: formData.get('title'),
      description: formData.get('description') || undefined,
      workType: formData.get('workType') || 'normal',
      workPurpose: formData.get('workPurpose') || undefined,
      requiresFollowUp: formData.get('requiresFollowUp') || undefined,
      chosenDate: formData.get('chosenDate') || undefined,
      completionEvidenceRule: formData.get('completionEvidenceRule') || 'optional',
      completionEvidenceInstruction: formData.get('completionEvidenceInstruction') || undefined,
      successMeasure: formData.get('successMeasure') || undefined,
      expectedMonths: formData.get('expectedMonths') || undefined,
    });

  if (!parsed.success) {
    return { ok: false, code: 'validation_failed', message: 'Add a title before creating work.' };
  }

  /*
   * A date a decade out is a slipped digit, not a plan.
   *
   * "15 Sep 2926" reached a manager's backlog because nothing questioned it,
   * and once there it is invisible: it is never overdue, never due today, and
   * never appears in any window, so it sits in Available forever looking
   * valid. The check belongs here rather than only in the browser, because a
   * form is not the only way into this action.
   */
  if (isImplausibleDate(parsed.data.chosenDate)) {
    return {
      ok: false,
      code: 'validation_failed',
      message: `That due date is more than ${IMPLAUSIBLE_YEARS_AHEAD} years away. Check the year - 2926 is easy to type for 2026.`,
    };
  }

  /*
   * A proposal without a reason cannot be decided on.
   *
   * `work_proposals.rationale` is this description, and the review drawer has
   * nothing else to show. When the description box was removed from New Work
   * every proposal started reaching its manager as a bare title — approve or
   * decline, no case either way. The requirement is deliberately narrow: it
   * applies to the one destination where somebody else has to judge the work.
   */
  if (parsed.data.workType === 'major_project' && !parsed.data.description) {
    return {
      ok: false,
      code: 'validation_failed',
      message: 'Explain why this needs to be a project. Your manager decides from this.',
    };
  }

  const files = formData
    .getAll('files')
    .filter((value): value is File => value instanceof File && value.size > 0);
  const fileError = validateAttachmentFiles(files);
  if (fileError) return { ok: false, code: 'validation_failed', message: fileError };

  const recommendation = classifyCapture({
    workType: parsed.data.workType,
    requiresFollowUp:
      parsed.data.requiresFollowUp === undefined ? null : parsed.data.requiresFollowUp === 'yes',
  });
  // The date is a commitment, not a signal. It sets when the work is due and
  // has no bearing on what kind of work it is.
  const dueAt = parsed.data.chosenDate
    ? endOfLocalDay(parsed.data.chosenDate, profile.timezone).toISOString()
    : null;
  const supabase = await createSupabaseServerClient();
  const { data: draft, error } = await supabase
    .from('work_captures')
    .insert({
      captured_by: profile.id,
      title: parsed.data.title,
      description: parsed.data.description || null,
      // Retained for records captured before the date stopped driving type.
      timing_choice: parsed.data.chosenDate ? 'choose_date' : 'no_date',
      due_at: dueAt,
      due_is_date_only: true,
      // Carried onto the task when `confirm_work_capture` links the two, so
      // the answer given here survives whichever destination is chosen.
      work_purpose: parsed.data.workPurpose ?? null,
      recommended_destination: recommendation.destination,
      recommendation_reason: recommendation.ruleText,
      // Section 12 — the rule travels with the capture so the task it becomes
      // can answer 'why was this created as Operational?' long afterwards.
      classification_rule_code: recommendation.ruleCode,
      classification_rule_text: recommendation.ruleText,
      urgency_question_asked: recommendation.urgencyQuestion !== null,
      followup_question: null,
      completion_evidence_rule: parsed.data.completionEvidenceRule,
      // Only meaningful where something is actually required: an instruction
      // for "optional" is a sentence nobody needs to read.
      completion_evidence_instruction:
        parsed.data.completionEvidenceRule === 'optional'
          ? null
          : parsed.data.completionEvidenceInstruction || null,
      // Carried into the proposal payload by `confirm_work_capture`, so the
      // person deciding sees scope and size next to the reason.
      success_measure:
        parsed.data.workType === 'major_project' ? parsed.data.successMeasure || null : null,
      expected_months:
        parsed.data.workType === 'major_project' ? (parsed.data.expectedMonths ?? null) : null,
    })
    .select('id')
    .single();

  if (error || !draft) {
    console.error(`[createCaptureDraft] ${error?.message ?? 'draft not returned'}`);
    return { ok: false, code: 'unexpected_error', message: 'The work was not saved. Try again.' };
  }

  const uploadedPaths: string[] = [];
  for (const file of files) {
    const path = `captures/${draft.id}/${crypto.randomUUID()}-${safeAttachmentFileName(file.name)}`;
    const upload = await supabase.storage.from('task-attachments').upload(path, file, {
      contentType: file.type,
      upsert: false,
    });
    if (upload.error) {
      if (uploadedPaths.length)
        await supabase.storage.from('task-attachments').remove(uploadedPaths);
      await supabase.from('work_captures').delete().eq('id', draft.id);
      console.error(`[createCaptureDraft:upload] ${upload.error.message}`);
      return {
        ok: false,
        code: 'unexpected_error',
        message: 'The attachment could not be saved, so nothing was created.',
      };
    }
    uploadedPaths.push(path);
    const metadata = await supabase.from('work_capture_attachments').insert({
      capture_id: draft.id,
      storage_path: path,
      file_name: file.name,
      mime_type: file.type,
      byte_size: file.size,
    });
    if (metadata.error) {
      await supabase.storage.from('task-attachments').remove(uploadedPaths);
      await supabase.from('work_captures').delete().eq('id', draft.id);
      console.error(`[createCaptureDraft:metadata] ${metadata.error.message}`);
      return {
        ok: false,
        code: 'unexpected_error',
        message: 'The attachment record could not be saved, so nothing was created.',
      };
    }
  }

  return { ok: true, code: 'draft_saved', captureId: draft.id as string, recommendation };
}

export async function answerCaptureQuestion(input: {
  captureId: string;
  question: 'urgency' | 'followup';
  answer: boolean;
}): Promise<CaptureDraftResult> {
  await requireProfile();
  const parsed = z
    .object({
      captureId: z.string().uuid(),
      question: z.enum(['urgency', 'followup']),
      answer: z.boolean(),
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false, code: 'validation_failed', message: 'Invalid answer.' };

  const supabase = await createSupabaseServerClient();
  const { data: capture, error } = await supabase
    .from('work_captures')
    .select(
      'id,title,description,timing_choice,urgency_question_asked,urgency_question_answer,followup_answer',
    )
    .eq('id', parsed.data.captureId)
    .eq('status', 'pending_confirmation')
    .single();
  if (error || !capture)
    return { ok: false, code: 'not_found', message: 'This captured work is no longer available.' };

  const urgencyAnswer =
    parsed.data.question === 'urgency' ? parsed.data.answer : capture.urgency_question_answer;
  const followupAnswer =
    parsed.data.question === 'followup'
      ? parsed.data.answer
      : capture.followup_answer === 'yes'
        ? true
        : capture.followup_answer === 'no'
          ? false
          : null;
  const recommendation = classifyCapture({
    // The stored capture predates chosen work types, so anything reclassified
    // through this path is ordinary work by definition — the specialised types
    // are picked up front and never re-derived here.
    workType: 'normal',
    needsImmediateControlledAction: urgencyAnswer,
    requiresFollowUp: followupAnswer,
  });

  const { error: updateError } = await supabase
    .from('work_captures')
    .update({
      recommended_destination: recommendation.destination,
      recommendation_reason: recommendation.ruleText,
      classification_rule_code: recommendation.ruleCode,
      classification_rule_text: recommendation.ruleText,
      urgency_question_asked: capture.urgency_question_asked || parsed.data.question === 'urgency',
      urgency_question_answer: urgencyAnswer,
      followup_question: null,
      followup_answer: followupAnswer == null ? null : followupAnswer ? 'yes' : 'no',
    })
    .eq('id', capture.id);
  if (updateError)
    return {
      ok: false,
      code: 'unexpected_error',
      message: 'Your answer was not saved. Try again.',
    };

  return { ok: true, code: 'answer_saved', captureId: capture.id as string, recommendation };
}

export async function discardCaptureDraft(input: { captureId: string }): Promise<OperationResult> {
  await requireProfile();
  const parsed = z.object({ captureId: z.string().uuid() }).safeParse(input);
  if (!parsed.success) return { ok: false, code: 'validation_failed', message: 'Invalid capture.' };

  const supabase = await createSupabaseServerClient();
  const { data: attachments } = await supabase
    .from('work_capture_attachments')
    .select('storage_path')
    .eq('capture_id', parsed.data.captureId);
  const paths = (attachments ?? []).map((row) => row.storage_path as string);
  if (paths.length) {
    const { error: storageError } = await supabase.storage.from('task-attachments').remove(paths);
    if (storageError)
      return {
        ok: false,
        code: 'unexpected_error',
        message: 'The saved draft could not be cleared safely.',
      };
  }

  const { error } = await supabase
    .from('work_captures')
    .delete()
    .eq('id', parsed.data.captureId)
    .eq('status', 'pending_confirmation');
  if (error)
    return {
      ok: false,
      code: 'unexpected_error',
      message: 'The saved draft could not be cleared.',
    };
  return { ok: true, code: 'draft_discarded' };
}

export async function confirmCapture(input: {
  captureId: string;
  destination: CaptureDestination;
  parentTaskId?: string | null;
  idempotencyKey?: string;
}): Promise<
  OperationResult<{ task_id?: string; proposal_id?: string; destination?: CaptureDestination }>
> {
  await requireProfile();
  const parsed = z
    .object({
      captureId: z.string().uuid(),
      destination: captureDestination,
      parentTaskId: z.string().uuid().nullish(),
      idempotencyKey: z.string().min(8).max(128).optional(),
    })
    .safeParse(input);
  if (!parsed.success)
    return { ok: false, code: 'validation_failed', message: 'Choose a valid work type.' };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('confirm_work_capture', {
    p_capture_id: parsed.data.captureId,
    p_destination: parsed.data.destination,
    p_parent_task_id: parsed.data.parentTaskId ?? null,
    p_idempotency_key: parsed.data.idempotencyKey ?? null,
  });
  if (error) {
    console.error(`[confirmCapture] ${error.code ?? 'unknown'}: ${error.message}`);
    return { ok: false, code: 'unexpected_error', message: 'Nothing was created. Try again.' };
  }
  const result = data as OperationResult<{
    task_id?: string;
    proposal_id?: string;
    destination?: CaptureDestination;
  }>;
  if (result.ok) {
    for (const path of ['/today', '/work', '/plan']) revalidatePath(path);
    await scheduleNotificationEmailDispatch();
  }
  return result;
}
