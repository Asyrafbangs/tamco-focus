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
  return {
    ok: true,
    message: result.unchanged
      ? 'Nothing to change.'
      : enabled
        ? 'Access on. Nothing has been sent: ESH releases held notifications from each finding.'
        : 'Access off. Their links and sessions have stopped working; their work is unchanged.',
  };
}
