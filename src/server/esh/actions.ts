'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { findingProblem, FINDING_WARNING_MESSAGES } from '@/domain/esh-findings';
import { createSupabaseServerClient, requireProfile } from '@/lib/supabase/server';
import { scheduleEshDispatch } from '@/server/esh/schedule-dispatch';

/**
 * Finding Management writes (v197).
 *
 * Thin by design: every rule — who may file what, which fields an assignment
 * needs, the escalation route, the held notification — lives in the database
 * procedures, which apply it atomically. These parse the form, call the
 * procedure and say what it answered.
 */

export interface FormProblem {
  field: string;
  message: string;
}

export interface SaveFindingState {
  ok: boolean;
  problems: FormProblem[];
  warnings: string[];
}

const uuid = z.string().uuid();

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
}

/**
 * The escalation route arrives as one hidden field per level holding a JSON
 * list of addresses, which is what the chip editor writes.
 */
function escalationFrom(formData: FormData): Array<{ level: number; email: string }> {
  const route: Array<{ level: number; email: string }> = [];
  for (let level = 1; level <= 9; level += 1) {
    const raw = formData.get(`escalation_level_${level}`);
    if (typeof raw !== 'string' || !raw) continue;
    try {
      const addresses = JSON.parse(raw) as unknown;
      if (!Array.isArray(addresses)) continue;
      for (const email of addresses) {
        if (typeof email === 'string' && email.trim()) route.push({ level, email: email.trim() });
      }
    } catch {
      // A field the editor did not write is ignored; the procedure validates.
    }
  }
  return route;
}

export async function saveFinding(
  _previous: SaveFindingState | null,
  formData: FormData,
): Promise<SaveFindingState> {
  await requireProfile();
  const assign = text(formData, 'intent') === 'assign';
  const findingId = uuid.safeParse(text(formData, 'finding_id'));
  const key = text(formData, 'idempotency_key');

  const payload = {
    title: text(formData, 'title'),
    description: text(formData, 'description'),
    source: text(formData, 'source'),
    source_reference: text(formData, 'source_reference'),
    reported_on: text(formData, 'reported_on'),
    location: text(formData, 'location'),
    accountable_department_id: text(formData, 'accountable_department_id'),
    risk_level: text(formData, 'risk_level'),
    is_restricted: formData.get('is_restricted') === 'on',
    action_title: text(formData, 'action_title'),
    required_outcome: text(formData, 'required_outcome'),
    evidence_instruction: text(formData, 'evidence_instruction'),
    priority: text(formData, 'priority'),
    owner_email: text(formData, 'owner_email'),
    due_date: text(formData, 'due_date'),
    due_time: text(formData, 'due_time'),
    reviewer_user_id: text(formData, 'reviewer_user_id'),
    escalation: escalationFrom(formData),
    no_further_escalation_reason:
      formData.get('no_further_escalation') === 'on'
        ? text(formData, 'no_further_escalation_reason')
        : '',
  };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('esh_save_finding', {
    // Sent as an explicit null for a new finding: an absent key matches no
    // function signature at all.
    p_finding_id: (findingId.success ? findingId.data : null) as string,
    p_payload: payload,
    p_assign: assign,
    p_idempotency_key: key || undefined,
  });

  if (error) {
    console.error(`[esh_save_finding] ${error.code ?? 'unknown'}: ${error.message}`);
    return {
      ok: false,
      problems: [
        { field: 'form', message: 'Something went wrong and nothing was saved. Try again.' },
      ],
      warnings: [],
    };
  }

  const result = (data ?? {}) as {
    ok?: boolean;
    code?: string;
    problems?: string[];
    warnings?: string[];
    finding_id?: string;
    notification?: string;
  };

  if (!result.ok || !result.finding_id) {
    const problems =
      result.code === 'invalid'
        ? (result.problems ?? []).map(findingProblem)
        : [
            {
              field: 'form',
              message:
                result.code === 'not_permitted'
                  ? 'You do not have permission to create findings.'
                  : result.code === 'not_a_draft'
                    ? 'This finding has already been assigned.'
                    : 'This finding could not be saved.',
            },
          ];
    return { ok: false, problems, warnings: [] };
  }

  // v198 - an owner whose access is on is emailed now, after this commits.
  if (result.notification === 'queued') await scheduleEshDispatch();
  revalidatePath('/findings', 'layout');
  const warnings = (result.warnings ?? []).filter((code) => FINDING_WARNING_MESSAGES[code]);
  const query = new URLSearchParams({ saved: assign ? 'assigned' : 'draft' });
  if (warnings.length) query.set('warn', warnings.join(','));
  redirect(`/findings/${result.finding_id}?${query.toString()}`);
}

export interface StaffAccessState {
  ok: boolean;
  message: string;
}

const NOT_ADMINISTRATOR = 'Only an administrator can change Finding Management access.';

const STAFF_ACCESS_MESSAGES: Record<string, string> = {
  not_permitted: NOT_ADMINISTRATOR,
  rollout_not_configured:
    'Finding Management has not been set up on this database, so access cannot be granted.',
  person_not_found: 'That account no longer exists.',
  account_not_active: 'A deactivated account cannot be given access.',
  preset_invalid: 'Choose Viewer, Coordinator or Verifier.',
  scope_required: 'Choose at least one department, or the whole organisation.',
  department_not_found: 'One of the chosen departments no longer exists.',
};

export async function setStaffEshAccess(
  _previous: StaffAccessState | null,
  formData: FormData,
): Promise<StaffAccessState> {
  const profile = await requireProfile();
  if (profile.role !== 'administrator') {
    return { ok: false, message: NOT_ADMINISTRATOR };
  }
  const userId = uuid.safeParse(text(formData, 'user_id'));
  if (!userId.success) return { ok: false, message: 'That account could not be found.' };

  const scopeAll = text(formData, 'scope') === 'all';
  const departmentIds = formData
    .getAll('department_ids')
    .filter((value): value is string => typeof value === 'string' && uuid.safeParse(value).success);

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('esh_set_staff_access', {
    p_user_id: userId.data,
    p_enabled: formData.get('enabled') === 'on',
    p_preset: text(formData, 'preset') || 'viewer',
    p_scope_all: scopeAll,
    p_department_ids: scopeAll ? [] : departmentIds,
    p_include_descendants: formData.get('include_descendants') === 'on',
    p_can_manage_reports: formData.get('can_manage_reports') === 'on',
    p_reason: text(formData, 'reason') || undefined,
  });

  if (error) {
    console.error(`[esh_set_staff_access] ${error.code ?? 'unknown'}: ${error.message}`);
    return { ok: false, message: 'Something went wrong and nothing was changed. Try again.' };
  }
  const result = (data ?? {}) as { ok?: boolean; code?: string; enabled?: boolean };
  if (!result.ok) {
    return {
      ok: false,
      message: STAFF_ACCESS_MESSAGES[result.code ?? ''] ?? 'Access could not be changed.',
    };
  }
  revalidatePath('/more/admin/users');
  return {
    ok: true,
    message: result.enabled
      ? 'Finding Management access saved.'
      : 'Finding Management access is off for this person.',
  };
}
