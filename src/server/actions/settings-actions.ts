'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import {
  createSupabaseServerClient,
  createSupabaseServiceRoleClient,
  requireProfile,
} from '@/lib/supabase/server';

export interface SettingsActionState {
  ok: boolean;
  code: string;
  message: string;
  detail?: Record<string, unknown>;
}

const initialError = (message: string): SettingsActionState => ({
  ok: false,
  code: 'validation_failed',
  message,
});

type RpcResult = {
  ok?: boolean;
  code?: string;
  message?: string;
  detail?: Record<string, unknown>;
  [key: string]: unknown;
};

function resultState(result: RpcResult, successMessage: string): SettingsActionState {
  return {
    ok: result.ok === true,
    code: result.code ?? (result.ok ? 'ok' : 'unexpected_error'),
    message: result.ok ? successMessage : (result.message ?? 'Nothing was changed. Try again.'),
    detail: result.detail,
  };
}

async function requireAdministrator() {
  const profile = await requireProfile();
  if (profile.role !== 'administrator') throw new Error('ADMIN_REQUIRED');
  return profile;
}

const checked = (formData: FormData, name: string) => formData.get(name) === 'on';

/** One auditable transaction owns all personal workspace, alert, and
 * accessibility preferences. */
export async function updateMyPreferencesAction(
  _previous: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  await requireProfile();
  const parsed = z
    .object({
      defaultLandingPage: z.enum(['today', 'work', 'plan', 'team', 'more']),
      dailyBriefMode: z.enum(['off', 'daily', 'workdays']),
      dailyBriefHour: z.coerce.number().int().min(0).max(23),
      quietHoursEnabled: z.boolean(),
      quietHoursStart: z.coerce.number().int().min(0).max(23),
      quietHoursEnd: z.coerce.number().int().min(0).max(23),
      firstDayOfWeek: z.coerce.number().int().min(0).max(6),
      themePreference: z.enum(['system', 'light', 'dark']),
      textSize: z.enum(['default', 'large', 'larger']),
      personalSummaryMode: z.enum(['off', 'focused', 'standard']),
    })
    .safeParse({
      defaultLandingPage: formData.get('defaultLandingPage'),
      dailyBriefMode: formData.get('dailyBriefMode'),
      dailyBriefHour: formData.get('dailyBriefHour'),
      quietHoursEnabled: checked(formData, 'quietHoursEnabled'),
      quietHoursStart: formData.get('quietHoursStart'),
      quietHoursEnd: formData.get('quietHoursEnd'),
      firstDayOfWeek: formData.get('firstDayOfWeek'),
      themePreference: formData.get('themePreference'),
      textSize: formData.get('textSize'),
      personalSummaryMode: formData.get('personalSummaryMode'),
    });

  if (!parsed.success) return initialError('Check the preference values and try again.');

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('update_my_preferences', {
    p_default_landing_page: parsed.data.defaultLandingPage,
    p_daily_brief_mode: parsed.data.dailyBriefMode,
    p_daily_brief_hour: parsed.data.dailyBriefHour,
    p_quiet_hours_enabled: parsed.data.quietHoursEnabled,
    p_quiet_hours_start: parsed.data.quietHoursStart,
    p_quiet_hours_end: parsed.data.quietHoursEnd,
    p_first_day_of_week: parsed.data.firstDayOfWeek,
    p_theme_preference: parsed.data.themePreference,
    p_text_size: parsed.data.textSize,
    p_reduced_motion: checked(formData, 'reducedMotion'),
    p_status_labels_always_visible: checked(formData, 'statusLabelsAlwaysVisible'),
    p_shortcut_hints: checked(formData, 'shortcutHints'),
    p_personal_summary_mode: parsed.data.personalSummaryMode,
    p_barrier_involving_me: checked(formData, 'barrierInvolvingMe'),
    p_assignment_changes: checked(formData, 'assignmentChanges'),
    p_collaboration_handoff: checked(formData, 'collaborationHandoff'),
    p_due_today_and_deadlines: checked(formData, 'dueTodayAndDeadlines'),
    p_routine_upcoming: checked(formData, 'routineUpcoming'),
  });

  if (error) {
    console.error(`[update_my_preferences] ${error.message}`);
    return initialError('Preferences could not be saved. Nothing was changed.');
  }

  const state = resultState(data as RpcResult, 'Your preferences were saved.');
  if (state.ok) revalidatePath('/more/settings');
  return state;
}

const orgSettingParsers: Record<string, z.ZodType> = {
  'focus.self_selection_allowed': z.boolean(),
  'focus.reason_required_when_replacing': z.boolean(),
  'focus.urgency_requires_review_by': z.boolean(),
  'focus.stale_update_threshold_days': z.number().int().min(1).max(90),
  'review.request_changes_outcome': z.enum(['reopen_active', 'return_to_available']),
  'review.target_days': z.number().int().min(1).max(90),
  'routine.occurrence_lead_days': z.number().int().min(1).max(365),
  'routine.ordinary_auto_archive': z.boolean(),
  'alerts.barrier_escalation_hours': z.number().int().min(1).max(720),
  'day.upcoming_window_days': z.number().int().min(1).max(90),
  'day.today_list_max_items': z.number().int().min(3).max(5),
  'retention.completed_task_years': z.number().int().min(1).max(50),
};

export async function updateOrgSettingAction(
  _previous: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  await requireProfile();
  const key = String(formData.get('key') ?? '');
  const parser = orgSettingParsers[key];
  if (!parser) return initialError('That setting is not available here.');

  const raw = String(formData.get('value') ?? '');
  let decoded: unknown = raw;
  if (raw === 'true' || raw === 'false') decoded = raw === 'true';
  else if (/^-?\d+$/.test(raw)) decoded = Number(raw);

  const parsed = parser.safeParse(decoded);
  if (!parsed.success) return initialError('Enter a valid value for this setting.');

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from('org_settings')
    .update({ value: parsed.data })
    .eq('key', key);

  if (error) {
    console.error(`[updateOrgSetting:${key}] ${error.message}`);
    return {
      ok: false,
      code: error.code === '42501' ? 'not_authorised' : 'unexpected_error',
      message:
        error.code === '42501'
          ? 'Your role cannot change this organisation setting.'
          : 'The setting could not be saved.',
    };
  }

  for (const path of ['/today', '/work', '/plan', '/more/settings']) revalidatePath(path);
  return { ok: true, code: 'setting_updated', message: 'Organisation setting saved.' };
}

/** The words the User directory uses for each role, so a read-back names the
 * same thing the dropdown does. */
const ROLE_LABELS = {
  team_member: 'Team member',
  manager: 'Manager',
  administrator: 'Administrator',
} as const;

const provisionSchema = z.object({
  fullName: z.string().trim().min(1).max(120),
  employeeId: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9][A-Za-z0-9-]{2,31}$/),
  email: z.string().trim().email().max(254),
  password: z.string().min(8).max(128),
  departmentId: z.string().uuid(),
  role: z.enum(['team_member', 'manager', 'administrator']),
  reportingManagerId: z.string().uuid().nullable(),
  personalSummaryMode: z.enum(['off', 'focused', 'standard']),
  teamSummaryMode: z.enum(['off', 'leadership', 'detailed']),
});

/** Creates the local Auth identity and application profile as one compensated
 * operation. A failed profile transaction removes the just-created identity. */
export async function provisionUserAction(
  _previous: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  const actor = await requireAdministrator();
  const parsed = provisionSchema.safeParse({
    fullName: formData.get('fullName'),
    employeeId: formData.get('employeeId'),
    email: formData.get('email'),
    password: formData.get('password'),
    departmentId: formData.get('departmentId'),
    role: formData.get('role'),
    reportingManagerId: formData.get('reportingManagerId') || null,
    personalSummaryMode: formData.get('personalSummaryMode'),
    teamSummaryMode: formData.get('teamSummaryMode'),
  });
  if (!parsed.success) return initialError('Complete every required identity field correctly.');

  const service = createSupabaseServiceRoleClient();
  const created = await service.auth.admin.createUser({
    email: parsed.data.email.toLowerCase(),
    password: parsed.data.password,
    email_confirm: true,
    user_metadata: { full_name: parsed.data.fullName },
  });
  if (created.error || !created.data.user) {
    return {
      ok: false,
      code: 'auth_identity_failed',
      message: created.error?.message ?? 'The sign-in identity could not be created.',
    };
  }

  const userId = created.data.user.id;
  const { data, error } = await service.rpc('provision_user_profile', {
    p_user_id: userId,
    p_employee_id: parsed.data.employeeId,
    p_email: parsed.data.email,
    p_full_name: parsed.data.fullName,
    p_department_id: parsed.data.departmentId,
    p_role: parsed.data.role,
    p_reporting_manager_id: parsed.data.reportingManagerId,
    p_personal_summary_mode: parsed.data.personalSummaryMode,
    p_team_summary_mode: parsed.data.teamSummaryMode,
    p_actor_id: actor.id,
  });

  const result = data as RpcResult | null;
  if (error || !result?.ok) {
    const cleanup = await service.auth.admin.deleteUser(userId);
    if (cleanup.error) console.error(`[provisionUser:compensation] ${cleanup.error.message}`);
    if (error) console.error(`[provision_user_profile] ${error.message}`);
    return resultState(result ?? {}, 'User created.');
  }

  revalidatePath('/more/admin/users');
  return { ok: true, code: 'user_created', message: `${parsed.data.fullName} can now sign in.` };
}

const userUpdateSchema = provisionSchema
  .omit({ employeeId: true, password: true })
  .extend({ userId: z.string().uuid() });

export async function updateUserAction(
  _previous: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  await requireAdministrator();
  const parsed = userUpdateSchema.safeParse({
    userId: formData.get('userId'),
    fullName: formData.get('fullName'),
    email: formData.get('email'),
    departmentId: formData.get('departmentId'),
    role: formData.get('role'),
    reportingManagerId: formData.get('reportingManagerId') || null,
    personalSummaryMode: formData.get('personalSummaryMode'),
    teamSummaryMode: formData.get('teamSummaryMode'),
  });
  if (!parsed.success) return initialError('Check the user details and try again.');

  const caller = await createSupabaseServerClient();
  const { data: current } = await caller
    .from('user_profiles')
    .select('email')
    .eq('id', parsed.data.userId)
    .maybeSingle();
  if (!current) return initialError('That user no longer exists.');

  const service = createSupabaseServiceRoleClient();
  const oldEmail = String(current.email);
  if (oldEmail.toLowerCase() !== parsed.data.email.toLowerCase()) {
    /*
     * Check the address is free before touching the auth record.
     *
     * The order used to be the other way round, which meant the common
     * mistake — typing an address somebody already has — was answered by
     * GoTrue rather than by us. Its duplicate-email failure arrives as an
     * `AuthRetryableFetchError` whose `message` is the literal string "{}",
     * and that was passed straight through, so the administrator was told
     * "Could not save: {}" and had to guess. Asking first means the sentence
     * comes from `update_user_profile`, which knows how to say it, and the
     * auth record is never changed for a save that cannot succeed.
     */
    const { data: clash } = await service
      .from('user_profiles')
      .select('id')
      .ilike('email', parsed.data.email)
      .neq('id', parsed.data.userId)
      .maybeSingle();
    if (clash) {
      return {
        ok: false,
        code: 'email_taken',
        message: 'That email address is already in use by another account.',
      };
    }

    const authUpdate = await service.auth.admin.updateUserById(parsed.data.userId, {
      email: parsed.data.email.toLowerCase(),
      email_confirm: true,
    });
    if (authUpdate.error) {
      // Logged raw, reported readably. The provider's message is sometimes not
      // a sentence at all, and an administrator cannot act on "{}".
      console.error(`[updateUser:auth] ${authUpdate.error.name}: ${authUpdate.error.message}`);
      return {
        ok: false,
        code: 'auth_update_failed',
        message:
          'The sign-in address could not be changed. Nothing else was saved. Try again, and tell an administrator if it persists.',
      };
    }
  }

  const { data, error } = await caller.rpc('update_user_profile', {
    p_user_id: parsed.data.userId,
    p_full_name: parsed.data.fullName,
    p_email: parsed.data.email,
    p_department_id: parsed.data.departmentId,
    p_role: parsed.data.role,
    p_reporting_manager_id: parsed.data.reportingManagerId,
    p_personal_summary_mode: parsed.data.personalSummaryMode,
    p_team_summary_mode: parsed.data.teamSummaryMode,
  });
  const result = data as RpcResult | null;
  if (error || !result?.ok) {
    if (oldEmail.toLowerCase() !== parsed.data.email.toLowerCase()) {
      const rollback = await service.auth.admin.updateUserById(parsed.data.userId, {
        email: oldEmail,
        email_confirm: true,
      });
      if (rollback.error) console.error(`[updateUser:compensation] ${rollback.error.message}`);
    }
    if (error) console.error(`[update_user_profile] ${error.message}`);
    return resultState(result ?? {}, 'User updated.');
  }

  /*
   * Report what the database now holds, not what was submitted.
   *
   * Both were previously indistinguishable on screen. The inputs are
   * uncontrolled, so they keep whatever was typed whether or not it was
   * written, and the banner only repeated the request back as "User details
   * saved." An administrator changing somebody's role had no way to tell a
   * successful save from one that had not taken, which is exactly the doubt
   * that made this screen untrustworthy. So the row is read back and the
   * stored values are named in the message.
   */
  const { data: stored } = await caller
    .from('user_profiles')
    .select('role,reporting_manager_id')
    .eq('id', parsed.data.userId)
    .maybeSingle();

  revalidatePath('/more/admin/users');

  if (!stored) {
    return { ok: true, code: 'user_updated', message: 'User details saved.' };
  }

  const storedRole = String(stored.role) as keyof typeof ROLE_LABELS;
  const storedManagerId = (stored.reporting_manager_id as string | null) ?? null;
  if (storedRole !== parsed.data.role || storedManagerId !== parsed.data.reportingManagerId) {
    return {
      ok: false,
      code: 'not_persisted',
      message: `The save was accepted but the record still reads ${ROLE_LABELS[storedRole] ?? storedRole}${
        storedManagerId ? '' : ' with no reporting manager'
      }. Nothing was changed. Tell an administrator, and do not assume the change took.`,
    };
  }

  let managerPhrase = 'no reporting manager';
  if (storedManagerId) {
    const { data: manager } = await caller
      .from('user_profiles')
      .select('full_name,employee_id')
      .eq('id', storedManagerId)
      .maybeSingle();
    managerPhrase = manager
      ? `reporting to ${String(manager.full_name)} (${String(manager.employee_id)})`
      : 'reporting to an account that no longer exists';
  }

  return {
    ok: true,
    code: 'user_updated',
    message: `Saved. The record now reads ${ROLE_LABELS[storedRole] ?? storedRole}, ${managerPhrase}.`,
  };
}

export async function changeUserStatusAction(
  _previous: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  await requireAdministrator();
  const parsed = z
    .object({
      userId: z.string().uuid(),
      intent: z.enum(['deactivate', 'deactivate_with_open_work', 'reactivate', 'delete']),
      employeeIdConfirmation: z.string().max(32).default(''),
    })
    .safeParse({
      userId: formData.get('userId'),
      intent: formData.get('intent'),
      employeeIdConfirmation: formData.get('employeeIdConfirmation') ?? '',
    });
  if (!parsed.success) return initialError('That account action is invalid.');

  const caller = await createSupabaseServerClient();
  const service = createSupabaseServiceRoleClient();
  const { userId, intent } = parsed.data;

  if (intent === 'delete') {
    const { data, error } = await caller.rpc('delete_user_permanently', {
      p_user_id: userId,
      p_employee_id_confirmation: parsed.data.employeeIdConfirmation,
    });
    const result = data as RpcResult | null;
    if (error || !result?.ok) return resultState(result ?? {}, 'Account permanently deleted.');

    const authDelete = await service.auth.admin.deleteUser(userId);
    if (authDelete.error) {
      console.error(`[deleteUser:auth] ${authDelete.error.message}`);
      return {
        ok: false,
        code: 'auth_cleanup_failed',
        message:
          'The application record was deleted, but the disabled local sign-in identity needs cleanup.',
      };
    }
    revalidatePath('/more/admin/users');
    redirect('/more/admin/users?notice=deleted');
  }

  if (intent === 'reactivate') {
    const { data, error } = await caller.rpc('reactivate_user', { p_user_id: userId });
    const result = data as RpcResult | null;
    if (error || !result?.ok) return resultState(result ?? {}, 'Account reactivated.');

    const unban = await service.auth.admin.updateUserById(userId, { ban_duration: 'none' });
    if (unban.error) {
      await caller.rpc('deactivate_user', { p_user_id: userId, p_allow_open_work: true });
      return { ok: false, code: 'auth_update_failed', message: unban.error.message };
    }
    revalidatePath('/more/admin/users');
    return { ok: true, code: 'user_reactivated', message: 'Account reactivated.' };
  }

  const allowOpenWork = intent === 'deactivate_with_open_work';
  const { data, error } = await caller.rpc('deactivate_user', {
    p_user_id: userId,
    p_allow_open_work: allowOpenWork,
  });
  const result = data as RpcResult | null;
  if (error || !result?.ok) return resultState(result ?? {}, 'Account deactivated.');

  const ban = await service.auth.admin.updateUserById(userId, { ban_duration: '876000h' });
  if (ban.error) {
    await caller.rpc('reactivate_user', { p_user_id: userId });
    return { ok: false, code: 'auth_update_failed', message: ban.error.message };
  }
  revalidatePath('/more/admin/users');
  return {
    ok: true,
    code: 'user_deactivated',
    message: 'Account deactivated; history is preserved.',
  };
}

/** The words the editor puts on each radio, so the confirmation names the one
 * that was chosen rather than its database spelling. */
const MODE_LABELS = {
  specific_only: 'Specific people only',
  direct_reports_plus: 'Direct reports + selected people',
  none: 'No team visibility',
} as const;

export async function setVisibilityAction(
  _previous: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  await requireAdministrator();
  const parsed = z
    .object({
      viewerId: z.string().uuid(),
      mode: z.enum(['specific_only', 'direct_reports_plus', 'none']),
      subjectIds: z.array(z.string().uuid()).max(500),
      reason: z.string().trim().max(1000).optional(),
    })
    .safeParse({
      viewerId: formData.get('viewerId'),
      mode: formData.get('mode'),
      subjectIds: formData.getAll('subjectIds').map(String),
      reason: String(formData.get('reason') ?? '') || undefined,
    });
  if (!parsed.success) return initialError('Choose a viewer and valid visibility scope.');

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('set_user_visibility', {
    p_viewer_id: parsed.data.viewerId,
    p_mode: parsed.data.mode,
    p_subject_ids: parsed.data.subjectIds,
    p_reason: parsed.data.reason ?? null,
  });
  if (error) {
    console.error(`[set_user_visibility] ${error.message}`);
    return initialError('Visibility rules could not be saved.');
  }
  const state = resultState(data as RpcResult, 'Visibility rules saved and audited.');
  if (!state.ok) return state;

  revalidatePath('/more/admin/visibility');
  // The same editor is on the person's own page in the User directory, so
  // saving from there has to refresh there too.
  revalidatePath('/more/admin/users');
  // Visibility decides who appears in My Team, which now lives inside Work.
  revalidatePath('/work');

  // Say what the rule now reaches, counted by the database rather than by the
  // form. "Saved" on its own was the complaint: it confirmed the request had
  // been sent, not that the rule had changed.
  const { data: preview } = await supabase.rpc('preview_effective_visibility', {
    p_viewer_id: parsed.data.viewerId,
  });
  const reach = Array.isArray(preview) ? Math.max(0, preview.length - 1) : null;
  return {
    ...state,
    message:
      reach === null
        ? state.message
        : `Saved. ${MODE_LABELS[parsed.data.mode]} — ${
            reach === 0 ? 'own work only' : `own work plus ${reach} people`
          }.`,
  };
}
