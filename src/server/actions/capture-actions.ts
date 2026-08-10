'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { classifyCapture } from '@/domain/classification';
import { endOfLocalDay, localDateString } from '@/domain/duration';
import type { CaptureDestination, CaptureTiming, OperationResult } from '@/domain/types';
import { createSupabaseServerClient, requireProfile } from '@/lib/supabase/server';
import { safeAttachmentFileName, validateAttachmentFiles } from '@/server/attachments';

const captureTiming = z.enum(['today', 'this_week', 'choose_date', 'no_date']);
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

function dueAtFor(
  timing: CaptureTiming,
  chosenDate: string | null,
  timeZone: string,
): string | null {
  if (timing === 'no_date') return null;
  if (timing === 'choose_date') return endOfLocalDay(chosenDate ?? '', timeZone).toISOString();

  const today = localDateString(new Date(), timeZone);
  if (timing === 'today') return endOfLocalDay(today, timeZone).toISOString();

  const [year, month, day] = today.split('-').map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day!));
  const daysUntilSunday = (7 - date.getUTCDay()) % 7;
  date.setUTCDate(date.getUTCDate() + daysUntilSunday);
  return endOfLocalDay(date.toISOString().slice(0, 10), timeZone).toISOString();
}

export async function createCaptureDraft(formData: FormData): Promise<CaptureDraftResult> {
  const profile = await requireProfile();
  const parsed = z
    .object({
      title: z.string().trim().min(1).max(200),
      description: z.string().trim().max(4000).optional(),
      timing: captureTiming,
      chosenDate: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional(),
    })
    .safeParse({
      title: formData.get('title'),
      description: formData.get('description') || undefined,
      timing: formData.get('timing'),
      chosenDate: formData.get('chosenDate') || undefined,
    });

  if (!parsed.success || (parsed.data?.timing === 'choose_date' && !parsed.data.chosenDate)) {
    return { ok: false, code: 'validation_failed', message: 'Add a title and valid timing.' };
  }

  const files = formData
    .getAll('files')
    .filter((value): value is File => value instanceof File && value.size > 0);
  const fileError = validateAttachmentFiles(files);
  if (fileError) return { ok: false, code: 'validation_failed', message: fileError };

  const classificationText = [parsed.data.title, parsed.data.description]
    .filter(Boolean)
    .join(' — ');
  const recommendation = classifyCapture({ title: classificationText, timing: parsed.data.timing });
  const dueAt = dueAtFor(parsed.data.timing, parsed.data.chosenDate ?? null, profile.timezone);
  const supabase = await createSupabaseServerClient();
  const { data: draft, error } = await supabase
    .from('work_captures')
    .insert({
      captured_by: profile.id,
      title: parsed.data.title,
      description: parsed.data.description || null,
      timing_choice: parsed.data.timing,
      due_at: dueAt,
      due_is_date_only: true,
      recommended_destination: recommendation.destination,
      recommendation_reason: recommendation.reason,
      urgency_question_asked: recommendation.urgencyQuestion !== null,
      followup_question: recommendation.followUpQuestion,
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
    title: [capture.title, capture.description].filter(Boolean).join(' — '),
    timing: capture.timing_choice as CaptureTiming,
    needsImmediateControlledAction: urgencyAnswer,
    requiresFollowUp: followupAnswer,
  });

  const { error: updateError } = await supabase
    .from('work_captures')
    .update({
      recommended_destination: recommendation.destination,
      recommendation_reason: recommendation.reason,
      urgency_question_asked: capture.urgency_question_asked || parsed.data.question === 'urgency',
      urgency_question_answer: urgencyAnswer,
      followup_question: recommendation.followUpQuestion,
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
  }
  return result;
}
