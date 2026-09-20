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
