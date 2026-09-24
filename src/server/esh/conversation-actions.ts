'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { contactAccessProblem, releaseProblem, staffMessageProblem } from '@/domain/esh-guest';
import { createSupabaseServerClient, requireProfile } from '@/lib/supabase/server';
import { scheduleEshDispatch } from '@/server/esh/schedule-dispatch';

/**
 * ESH's side of the owner conversation, releasing held email, and contact
 * access (v198). As with every Finding write, the procedures decide; these
 * pass the request on as the signed-in person and say what came back.
 */

const uuid = z.string().uuid();

export type StaffResult = { ok: true } | { ok: false; message: string };

/** ESH writes to the owner (§13). The owner is told there is a reply. */
export async function postEshMessage(input: {
  actionId: string;
  findingId: string;
  body: string;
  clientKey: string;
  assetIds?: string[];
}): Promise<StaffResult> {
  await requireProfile();
  const actionId = uuid.safeParse(input.actionId);
  if (!actionId.success) return { ok: false, message: staffMessageProblem('action_not_found') };
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('esh_post_message', {
    p_action_id: actionId.data,
    p_body: String(input.body ?? ''),
    p_client_key: String(input.clientKey ?? ''),
    p_asset_ids: (Array.isArray(input.assetIds) ? input.assetIds : [])
      .filter((id) => uuid.safeParse(id).success)
      .slice(0, 10),
  });
  if (error) {
    console.error(`[esh_post_message] ${error.code ?? 'unknown'}: ${error.message}`);
    return { ok: false, message: staffMessageProblem('invalid') };
  }
  const result = (data ?? {}) as { ok?: boolean; code?: string; notification?: string };
  if (!result.ok) {
    return {
      ok: false,
      message: staffMessageProblem(result.code),
    };
  }
  if (result.notification === 'queued') await scheduleEshDispatch();
  if (uuid.safeParse(input.findingId).success) revalidatePath(`/findings/${input.findingId}`);
  return { ok: true };
}

/**
 * Release one held notification (§43.4). Deliberately separate from
 * switching the contact on (FM106).
 */
export async function releaseHeldNotification(input: {
  outboxId: string;
  findingId: string;
}): Promise<StaffResult> {
  await requireProfile();
  const failure = 'Something went wrong and nothing was released. Try again.';
  const outboxId = uuid.safeParse(input.outboxId);
  if (!outboxId.success) return { ok: false, message: releaseProblem('notification_not_found') };
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('esh_release_notification', {
    p_outbox_id: outboxId.data,
  });
  if (error) {
    console.error(`[esh_release_notification] ${error.code ?? 'unknown'}: ${error.message}`);
    return { ok: false, message: failure };
  }
  const result = (data ?? {}) as { ok?: boolean; code?: string };
  if (!result.ok) {
    return { ok: false, message: releaseProblem(result.code) };
  }
  await scheduleEshDispatch();
  if (uuid.safeParse(input.findingId).success) revalidatePath(`/findings/${input.findingId}`);
  revalidatePath('/findings/register');
  return { ok: true };
}

export interface ContactAccessState {
  ok: boolean;
  message: string;
}

export interface BulkContactAccessResult {
  ok: boolean;
  message: string;
  enabled: number;
  refused: Array<{ email: string; message: string }>;
}

/**
 * v213 - several contacts cleared in one deliberate act (§43.2).
 *
 * The rollout gate is meant to stop a half-configured module writing to real
 * people; it is not meant to be met one finding at a time. An administrator
 * still chooses exactly who, and still says why, but they can do it for the
 * dozen supervisors who will own actions rather than returning to this screen
 * after every assignment.
 *
 * Each contact is switched on by the same audited procedure as before, in its
 * own call: one that is refused does not take the others with it, and the
 * answer says which. Enabling still sends nothing.
 */
export async function enableContacts(input: {
  principalIds: string[];
  reason: string;
}): Promise<BulkContactAccessResult> {
  const profile = await requireProfile();
  if (profile.role !== 'administrator') {
    return { ok: false, message: contactAccessProblem('not_permitted'), enabled: 0, refused: [] };
  }
  const reason = String(input.reason ?? '').trim();
  if (reason.length < 3) {
    return {
      ok: false,
      message: 'Say why these contacts may be written to.',
      enabled: 0,
      refused: [],
    };
  }
  const ids = (input.principalIds ?? [])
    .map((id) => uuid.safeParse(id))
    .filter((parsed) => parsed.success)
    .map((parsed) => parsed.data);
  if (ids.length === 0) {
    return { ok: false, message: 'Choose at least one contact.', enabled: 0, refused: [] };
  }
  // A ceiling, so a stray select-all cannot clear an entire directory at once.
  if (ids.length > 50) {
    return {
      ok: false,
      message: 'Fifty at a time. Enable the people who own work now, not the whole directory.',
      enabled: 0,
      refused: [],
    };
  }

  const supabase = await createSupabaseServerClient();
  const refused: Array<{ email: string; message: string }> = [];
  let enabled = 0;
  for (const id of ids) {
    const { data, error } = await supabase.rpc('esh_set_contact_access', {
      p_principal_id: id,
      p_enabled: true,
      p_reason: reason,
    });
    if (error) {
      console.error(`[enableContacts] ${error.code ?? 'unknown'}: ${error.message}`);
      refused.push({ email: id, message: 'Something went wrong for this one.' });
      continue;
    }
    const result = (data ?? {}) as { ok?: boolean; code?: string; unchanged?: boolean };
    if (!result.ok) {
      refused.push({ email: id, message: contactAccessProblem(result.code) });
      continue;
    }
    if (!result.unchanged) enabled += 1;
  }
  revalidatePath('/more/admin/users');
  revalidatePath('/more/admin/contacts');
  return {
    ok: refused.length === 0,
    enabled,
    refused,
    message:
      refused.length === 0
        ? `${enabled} contact${enabled === 1 ? '' : 's'} cleared to receive email. Nothing has been sent: each finding still releases its own held notice.`
        : `${enabled} cleared, ${refused.length} refused.`,
  };
}

/**
 * v212 - the same switch, thrown from the finding that is waiting on it.
 *
 * An assignment that is held says so on the finding, and until now the only
 * way to unblock it was to know that contact access lives under Identity and
 * access, in another part of the application, and to go and find it. Findings
 * were recorded and then sat silent because nobody made that journey. This is
 * the identical audited act, offered where the problem is visible.
 */
export async function enableContactForFinding(input: {
  principalId: string;
  findingId: string;
  reason: string;
}): Promise<ContactAccessState> {
  const profile = await requireProfile();
  if (profile.role !== 'administrator') {
    return { ok: false, message: contactAccessProblem('not_permitted') };
  }
  const principalId = uuid.safeParse(input.principalId);
  const findingId = uuid.safeParse(input.findingId);
  if (!principalId.success || !findingId.success) {
    return { ok: false, message: contactAccessProblem('contact_not_found') };
  }
  const reason = String(input.reason ?? '').trim();
  if (reason.length < 3) {
    return { ok: false, message: 'Say why this contact may be written to.' };
  }
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('esh_set_contact_access', {
    p_principal_id: principalId.data,
    p_enabled: true,
    p_reason: reason,
  });
  if (error) {
    console.error(`[esh_set_contact_access] ${error.code ?? 'unknown'}: ${error.message}`);
    return { ok: false, message: 'Something went wrong and nothing was changed. Try again.' };
  }
  const result = (data ?? {}) as { ok?: boolean; code?: string; unchanged?: boolean };
  if (!result.ok) return { ok: false, message: contactAccessProblem(result.code) };
  revalidatePath(`/findings/${findingId.data}`);
  revalidatePath('/more/admin/contacts');
  return {
    ok: true,
    // Enabling is not sending: the release below it is still a separate press.
    message: 'Access on. Nothing has been sent yet — release the held email below.',
  };
}

/** An administrator switches an email contact's access on or off (§31.3, §43.2). */
export async function setContactAccess(
  _previous: ContactAccessState | null,
  formData: FormData,
): Promise<ContactAccessState> {
  const profile = await requireProfile();
  if (profile.role !== 'administrator') {
    return { ok: false, message: contactAccessProblem('not_permitted') };
  }
  const failure = 'Something went wrong and nothing was changed. Try again.';
  const principalId = uuid.safeParse(String(formData.get('principal_id') ?? ''));
  if (!principalId.success)
    return { ok: false, message: contactAccessProblem('contact_not_found') };
  const enabled = formData.get('enabled') === 'on';
  const reason = String(formData.get('reason') ?? '').trim();
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('esh_set_contact_access', {
    p_principal_id: principalId.data,
    p_enabled: enabled,
    p_reason: (reason || null) as string,
  });
  if (error) {
    console.error(`[esh_set_contact_access] ${error.code ?? 'unknown'}: ${error.message}`);
    return { ok: false, message: failure };
  }
  const result = (data ?? {}) as { ok?: boolean; code?: string; unchanged?: boolean };
  if (!result.ok) {
    return { ok: false, message: contactAccessProblem(result.code) };
  }
  revalidatePath('/more/admin/contacts');
  revalidatePath('/more/admin/users');
  return {
    ok: true,
    message: result.unchanged
      ? 'Nothing to change.'
      : enabled
        ? 'Access on. Nothing has been sent: ESH releases held notifications from each finding.'
        : 'Access off. Their links and sessions have stopped working; their work is unchanged.',
  };
}

export interface ContactAdminState {
  ok: boolean;
  message: string;
  redirectPrincipalId?: string;
}

const CONTACT_ADMIN_MESSAGES: Record<string, string> = {
  not_permitted: 'Only a platform administrator can manage email-link contacts.',
  contact_not_found: 'That contact no longer exists.',
  reason_required: 'Record why this access change is needed.',
  access_not_enabled: 'Enable this contact before sending a fresh access link.',
  no_live_participation: 'That contact no longer has the selected live participation.',
  purpose_invalid: 'That access purpose is not available.',
  access_kind_invalid: 'That access item cannot be revoked.',
  access_not_found: 'That access item has already ended.',
  email_invalid: 'Enter a valid new email address.',
  email_unchanged: 'The new address is the same as the current address.',
  email_in_use:
    'That address already belongs to another managed contact. Nothing was merged or moved.',
  relationship_required: 'Choose which live relationships move to the corrected address.',
};

async function requireContactAdministrator(): Promise<ContactAdminState | null> {
  const profile = await requireProfile();
  return profile.role === 'administrator'
    ? null
    : { ok: false, message: CONTACT_ADMIN_MESSAGES.not_permitted! };
}

function contactProblem(code?: string) {
  return CONTACT_ADMIN_MESSAGES[code ?? ''] ?? 'Nothing was changed. Try again.';
}

export async function resendContactAccess(
  _previous: ContactAdminState,
  formData: FormData,
): Promise<ContactAdminState> {
  const refused = await requireContactAdministrator();
  if (refused) return refused;
  const parsed = z
    .object({
      principalId: uuid,
      purpose: z.enum(['owner_inbox', 'owner_action', 'escalation_action']),
      actionId: z.union([uuid, z.literal('')]).default(''),
      reason: z.string().trim().min(1).max(300),
    })
    .safeParse({
      principalId: formData.get('principal_id'),
      purpose: formData.get('purpose'),
      actionId: formData.get('action_id') || '',
      reason: formData.get('reason'),
    });
  if (!parsed.success) return { ok: false, message: 'Choose valid access and record a reason.' };
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('esh_admin_resend_contact_access', {
    p_principal_id: parsed.data.principalId,
    p_purpose: parsed.data.purpose,
    p_action_id: parsed.data.actionId || undefined,
    p_reason: parsed.data.reason,
  });
  if (error) {
    console.error(`[esh_admin_resend_contact_access] ${error.message}`);
    return { ok: false, message: 'The fresh access email could not be queued.' };
  }
  const result = (data ?? {}) as { ok?: boolean; code?: string };
  if (!result.ok) return { ok: false, message: contactProblem(result.code) };
  await scheduleEshDispatch();
  revalidatePath('/more/admin/users');
  return { ok: true, message: 'Fresh access queued after checking the live participation.' };
}

export async function revokeContactAccessItem(
  _previous: ContactAdminState,
  formData: FormData,
): Promise<ContactAdminState> {
  const refused = await requireContactAdministrator();
  if (refused) return refused;
  const parsed = z
    .object({
      principalId: uuid,
      kind: z.enum(['grant', 'session', 'entitlement']),
      accessId: uuid,
      reason: z.string().trim().min(1).max(300),
    })
    .safeParse({
      principalId: formData.get('principal_id'),
      kind: formData.get('kind'),
      accessId: formData.get('access_id'),
      reason: formData.get('reason'),
    });
  if (!parsed.success) return { ok: false, message: 'Choose valid access and record a reason.' };
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('esh_admin_revoke_contact_access', {
    p_principal_id: parsed.data.principalId,
    p_kind: parsed.data.kind,
    p_access_id: parsed.data.accessId,
    p_reason: parsed.data.reason,
  });
  if (error) {
    console.error(`[esh_admin_revoke_contact_access] ${error.message}`);
    return { ok: false, message: 'That access item could not be revoked.' };
  }
  const result = (data ?? {}) as { ok?: boolean; code?: string };
  if (!result.ok) return { ok: false, message: contactProblem(result.code) };
  revalidatePath('/more/admin/users');
  return { ok: true, message: 'That access item is revoked.' };
}

export async function disableContact(
  _previous: ContactAdminState,
  formData: FormData,
): Promise<ContactAdminState> {
  const refused = await requireContactAdministrator();
  if (refused) return refused;
  const parsed = z
    .object({ principalId: uuid, reason: z.string().trim().min(1).max(300) })
    .safeParse({ principalId: formData.get('principal_id'), reason: formData.get('reason') });
  if (!parsed.success) return { ok: false, message: 'Record why the contact is being disabled.' };
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('esh_admin_disable_contact', {
    p_principal_id: parsed.data.principalId,
    p_reason: parsed.data.reason,
  });
  if (error) {
    console.error(`[esh_admin_disable_contact] ${error.message}`);
    return { ok: false, message: 'The contact could not be disabled.' };
  }
  const result = (data ?? {}) as {
    ok?: boolean;
    code?: string;
    open_actions?: number;
    configured_escalations?: number;
  };
  if (!result.ok) return { ok: false, message: contactProblem(result.code) };
  revalidatePath('/more/admin/users');
  return {
    ok: true,
    message: `Contact disabled. ${Number(result.open_actions ?? 0)} open action(s) and ${Number(
      result.configured_escalations ?? 0,
    )} escalation route(s) still need ESH attention; none was closed or deleted.`,
  };
}

export async function correctContactEmail(
  _previous: ContactAdminState,
  formData: FormData,
): Promise<ContactAdminState> {
  const refused = await requireContactAdministrator();
  if (refused) return refused;
  const parsed = z
    .object({
      principalId: uuid,
      newEmail: z.string().trim().email().max(254),
      transferActions: z.boolean(),
      transferEscalations: z.boolean(),
      reason: z.string().trim().min(1).max(300),
    })
    .safeParse({
      principalId: formData.get('principal_id'),
      newEmail: formData.get('new_email'),
      transferActions: formData.get('transfer_actions') === 'on',
      transferEscalations: formData.get('transfer_escalations') === 'on',
      reason: formData.get('reason'),
    });
  if (!parsed.success) {
    return {
      ok: false,
      message: 'Enter the corrected address, choose what moves, and record why.',
    };
  }
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('esh_admin_correct_contact_email', {
    p_principal_id: parsed.data.principalId,
    p_new_email: parsed.data.newEmail,
    p_transfer_actions: parsed.data.transferActions,
    p_transfer_escalations: parsed.data.transferEscalations,
    p_reason: parsed.data.reason,
  });
  if (error) {
    console.error(`[esh_admin_correct_contact_email] ${error.message}`);
    return { ok: false, message: 'The email correction could not be completed.' };
  }
  const result = (data ?? {}) as {
    ok?: boolean;
    code?: string;
    new_principal_id?: string;
    moved_actions?: number;
    moved_escalations?: number;
  };
  if (!result.ok) return { ok: false, message: contactProblem(result.code) };
  await scheduleEshDispatch();
  revalidatePath('/more/admin/users');
  return {
    ok: true,
    redirectPrincipalId: result.new_principal_id,
    message: `Email corrected. ${Number(result.moved_actions ?? 0)} action(s) and ${Number(
      result.moved_escalations ?? 0,
    )} escalation route(s) moved; historical authorship stayed with the old identity.`,
  };
}
