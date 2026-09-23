'use server';

import { revalidatePath } from 'next/cache';

import {
  followupPolicyProblems,
  parseCalendarExceptionLines,
  type FollowupPolicyInput,
} from '@/domain/esh-followup';
import { createSupabaseServerClient, requireProfile } from '@/lib/supabase/server';

export interface FollowupFormState {
  ok: boolean;
  message: string;
  problems?: string[];
}

function integer(formData: FormData, name: string): number {
  const value = formData.get(name);
  return typeof value === 'string' && /^-?\d+$/.test(value) ? Number(value) : Number.NaN;
}

export async function saveFollowupPolicy(
  _previous: FollowupFormState | null,
  formData: FormData,
): Promise<FollowupFormState> {
  await requireProfile();
  const input: FollowupPolicyInput = {
    preDueDays: integer(formData, 'pre_due_days'),
    remindOnDue: formData.get('remind_on_due') === 'on',
    overdueEveryDays: integer(formData, 'overdue_every_days'),
    levelDays: formData
      .getAll('level_days')
      .filter((value): value is string => typeof value === 'string' && value !== '')
      .map(Number),
    reviewReminderDays: integer(formData, 'review_reminder_days'),
  };
  const problems = followupPolicyProblems(input);
  if (problems.length) return { ok: false, message: 'Correct the policy below.', problems };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('esh_set_followup_policy', {
    p_pre_due_days: input.preDueDays,
    p_remind_on_due: input.remindOnDue,
    p_overdue_every_days: input.overdueEveryDays,
    p_level_days: input.levelDays,
    p_review_reminder_days: input.reviewReminderDays,
  });
  if (error) {
    console.error(`[esh_set_followup_policy] ${error.code ?? 'unknown'}: ${error.message}`);
    return { ok: false, message: 'The policy could not be saved. Try again.' };
  }
  const result = (data ?? {}) as { ok?: boolean; code?: string; problems?: string[] };
  if (!result.ok) {
    return {
      ok: false,
      message:
        result.code === 'not_permitted'
          ? 'Only an ESH Verifier can change follow-up policy.'
          : 'Correct the policy below.',
      problems: result.problems,
    };
  }
  revalidatePath('/findings/settings');
  return {
    ok: true,
    message:
      'Policy saved for new assignments. Work already assigned keeps the policy version it started under.',
  };
}

export async function saveWorkingCalendar(
  _previous: FollowupFormState | null,
  formData: FormData,
): Promise<FollowupFormState> {
  await requireProfile();
  const weekdays = formData
    .getAll('working_weekdays')
    .filter((value): value is string => typeof value === 'string' && /^[1-7]$/.test(value))
    .map(Number);
  const nonWorking = parseCalendarExceptionLines(
    String(formData.get('non_working_dates') ?? ''),
    false,
  );
  const working = parseCalendarExceptionLines(
    String(formData.get('additional_working_dates') ?? ''),
    true,
  );
  const exceptions = [...nonWorking.rows, ...working.rows];
  const duplicates = exceptions.filter(
    (row, index) => exceptions.findIndex((candidate) => candidate.date === row.date) !== index,
  );
  const problems = [...nonWorking.problems, ...working.problems];
  if (weekdays.length === 0) problems.push('Choose at least one usual working weekday.');
  if (duplicates.length) problems.push('A date can appear only once across both exception lists.');
  const confirmed = String(formData.get('confirmed_through') ?? '');
  if (confirmed && !/^\d{4}-\d{2}-\d{2}$/.test(confirmed)) {
    problems.push('Calendar confirmation must be a date.');
  }
  if (problems.length) return { ok: false, message: 'Correct the calendar below.', problems };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('esh_set_working_calendar', {
    p_working_weekdays: weekdays,
    p_confirmed_through: (confirmed || null) as string,
    p_exceptions: exceptions,
  });
  if (error) {
    console.error(`[esh_set_working_calendar] ${error.code ?? 'unknown'}: ${error.message}`);
    return { ok: false, message: 'The working-day calendar could not be saved. Try again.' };
  }
  const result = (data ?? {}) as { ok?: boolean; code?: string };
  if (!result.ok) {
    return {
      ok: false,
      message:
        result.code === 'not_permitted'
          ? 'Only an ESH Verifier can change the working-day calendar.'
          : 'Correct the calendar below.',
    };
  }
  revalidatePath('/findings/settings');
  return { ok: true, message: 'Working-day calendar saved.' };
}

/**
 * v209 — quiet hours and the catch-up rule (§16).
 *
 * Both belong to the policy rather than to the code: an organisation that
 * wants every missed stage after an outage should be able to say so, and one
 * that does not want routine mail at midnight should be able to say that too.
 */
export async function saveQuietHours(
  _previous: FollowupFormState | null,
  formData: FormData,
): Promise<FollowupFormState> {
  await requireProfile();
  const from = String(formData.get('quiet_from') ?? '').trim();
  const to = String(formData.get('quiet_to') ?? '').trim();
  if ((from === '') !== (to === '')) {
    return { ok: false, message: 'Give both a start and an end, or neither.' };
  }
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('esh_set_followup_quiet_hours', {
    p_quiet_from: from === '' ? null : from,
    p_quiet_to: to === '' ? null : to,
    p_catch_up: String(formData.get('catch_up') ?? 'coalesce'),
  });
  if (error) {
    console.error(`[esh_set_followup_quiet_hours] ${error.code ?? 'unknown'}: ${error.message}`);
    return { ok: false, message: 'Quiet hours could not be saved.' };
  }
  const result = (data ?? {}) as { ok?: boolean; code?: string };
  if (!result.ok) {
    return {
      ok: false,
      message:
        result.code === 'not_permitted'
          ? 'Only an ESH Verifier can change follow-up policy.'
          : 'Quiet hours could not be saved.',
    };
  }
  revalidatePath('/findings/settings');
  return { ok: true, message: 'Quiet hours saved.' };
}

/** A schedule for one risk level or one priority, or its removal (§16). */
export async function saveFollowupRule(
  _previous: FollowupFormState | null,
  formData: FormData,
): Promise<FollowupFormState> {
  await requireProfile();
  const remove = formData.get('remove') === 'true';
  const levelDays = formData
    .getAll('level_days')
    .filter((value): value is string => typeof value === 'string' && value !== '')
    .map(Number);
  const input: FollowupPolicyInput = {
    preDueDays: integer(formData, 'pre_due_days'),
    remindOnDue: formData.get('remind_on_due') === 'on',
    overdueEveryDays: integer(formData, 'overdue_every_days'),
    levelDays,
    reviewReminderDays: integer(formData, 'review_reminder_days'),
  };
  if (!remove) {
    const problems = followupPolicyProblems(input);
    if (problems.length) return { ok: false, message: 'Correct the rule below.', problems };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('esh_set_followup_rule', {
    p_applies_to: String(formData.get('applies_to') ?? ''),
    p_applies_value: String(formData.get('applies_value') ?? ''),
    p_pre_due_days: remove ? null : input.preDueDays,
    p_remind_on_due: remove ? null : input.remindOnDue,
    p_overdue_every_days: remove ? null : input.overdueEveryDays,
    p_level_days: remove ? null : input.levelDays,
    p_review_reminder_days: remove ? null : input.reviewReminderDays,
    p_remove: remove,
  });
  if (error) {
    console.error(`[esh_set_followup_rule] ${error.code ?? 'unknown'}: ${error.message}`);
    return { ok: false, message: 'The rule could not be saved.' };
  }
  const result = (data ?? {}) as { ok?: boolean; code?: string };
  if (!result.ok) {
    const messages: Record<string, string> = {
      not_permitted: 'Only an ESH Verifier can change follow-up policy.',
      not_configured: 'The organisation policy has to exist before a rule can differ from it.',
      invalid: 'Check the risk level or priority and the days you entered.',
      levels_invalid: 'Escalation days must be different from each other.',
    };
    return { ok: false, message: messages[result.code ?? ''] ?? 'The rule could not be saved.' };
  }
  revalidatePath('/findings/settings');
  return { ok: true, message: remove ? 'Rule removed.' : 'Rule saved.' };
}
