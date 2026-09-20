'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { ACCESS_SECRET_SHAPE, type ExchangeProblem } from '@/domain/esh-guest';
import { looksLikeEmail } from '@/domain/esh-findings';
import { requestOrigin } from '@/lib/env';
import { newAccessSecret } from '@/server/esh/dispatch';
import { GUEST_COOKIE, guestClient, guestSecret } from '@/server/esh/guest';
import { scheduleEshDispatch } from '@/server/esh/schedule-dispatch';

/**
 * What an Action Owner can do (v198). Each call is a Server Action, so the
 * framework refuses one posted from another site (§18: CSRF), and each goes
 * through a guest procedure that re-checks the session and the live
 * assignment. Nothing here reads the staff login, and nothing here writes it.
 */

/** The organisation a typed email is looked up in. There is one. */
const ORGANIZATION_SLUG = 'tamco';

const uuid = z.string().uuid();
const challengeShape = /^[A-Za-z0-9-]{16,64}$/;

async function setGuestCookie(secret: string, expiresAt: string | undefined) {
  const origin = await requestOrigin();
  const jar = await cookies();
  jar.set(GUEST_COOKIE, secret, {
    httpOnly: true,
    // Lax, so the first visit from a mail client carries it; the session is
    // only ever spent by a same-site POST.
    sameSite: 'lax',
    secure: origin.startsWith('https:'),
    path: '/respond',
    expires: expiresAt ? new Date(expiresAt) : new Date(Date.now() + 12 * 3_600_000),
  });
}

async function clearGuestCookie() {
  const jar = await cookies();
  jar.delete({ name: GUEST_COOKIE, path: '/respond' });
}

export type OpenLinkResult =
  { ok: true; destination: string } | { ok: false; problem: ExchangeProblem };

/**
 * Exchange a link's secret for a session (§19). `consume` false only asks
 * whether this browser's session already reaches the destination, and spends
 * nothing; the button press is what spends the link.
 */
export async function openAccessLink(input: {
  secret: string;
  challenge: string;
  consume: boolean;
}): Promise<OpenLinkResult> {
  if (!ACCESS_SECRET_SHAPE.test(input.secret ?? '')) return { ok: false, problem: 'invalid' };
  const challenge = challengeShape.test(input.challenge ?? '') ? input.challenge : null;
  const sessionSecret = newAccessSecret();
  const { data, error } = await guestClient().rpc('esh_guest_exchange', {
    p_token: input.secret,
    p_new_session: sessionSecret,
    p_existing_session: (await guestSecret()) as string,
    p_challenge: challenge as string,
    p_consume: Boolean(input.consume),
  });
  if (error) {
    console.error(`[esh_guest_exchange] ${error.code ?? 'unknown'}: ${error.message}`);
    return { ok: false, problem: 'unavailable' };
  }
  const result = (data ?? {}) as {
    ok?: boolean;
    code?: ExchangeProblem;
    destination?: string;
    new_session?: boolean;
    session_expires_at?: string;
  };
  if (!result.ok || !result.destination?.startsWith('/respond/')) {
    return { ok: false, problem: result.code ?? 'invalid' };
  }
  if (result.new_session) await setGuestCookie(sessionSecret, result.session_expires_at);
  return { ok: true, destination: result.destination };
}

async function queueDispatchIf(result: unknown) {
  if (result && typeof result === 'object' && 'outbox_id' in result) {
    await scheduleEshDispatch();
  }
}

/**
 * A fresh link for a link that no longer opens (§19): the link itself says
 * whose it was, so nothing is typed. The answer never says whether anything
 * was sent.
 */
export async function requestFreshLink(input: { secret: string }): Promise<{ ok: true }> {
  if (!ACCESS_SECRET_SHAPE.test(input.secret ?? '')) return { ok: true };
  const { data, error } = await guestClient().rpc('esh_guest_request_link', {
    p_session: null as unknown as string,
    p_token: input.secret,
    p_email: null as unknown as string,
    p_organization_slug: ORGANIZATION_SLUG,
  });
  if (error) console.error(`[esh_guest_request_link] ${error.code ?? 'unknown'}: ${error.message}`);
  else await queueDispatchIf(data);
  return { ok: true };
}

export interface RequestByEmailState {
  sent: boolean;
  problem: string | null;
}

/** A link by typed email (§19, FM44): the same answer for every address. */
export async function requestLinkByEmail(
  _previous: RequestByEmailState | null,
  formData: FormData,
): Promise<RequestByEmailState> {
  const email = String(formData.get('email') ?? '').trim();
  if (!looksLikeEmail(email)) {
    return { sent: false, problem: 'Enter the email address your actions were assigned to.' };
  }
  const { data, error } = await guestClient().rpc('esh_guest_request_link', {
    p_session: null as unknown as string,
    p_token: null as unknown as string,
    p_email: email,
    p_organization_slug: ORGANIZATION_SLUG,
  });
  if (error) console.error(`[esh_guest_request_link] ${error.code ?? 'unknown'}: ${error.message}`);
  else await queueDispatchIf(data);
  return { sent: true, problem: null };
}

/**
 * My Actions from an action-only session (§9): a new inbox link, sent to the
 * address already identified. It does not widen the session in hand.
 */
export async function requestInboxLink(): Promise<{ ok: true }> {
  const secret = await guestSecret();
  if (!secret) return { ok: true };
  const { data, error } = await guestClient().rpc('esh_guest_request_link', {
    p_session: secret,
    p_token: null as unknown as string,
    p_email: null as unknown as string,
    p_organization_slug: ORGANIZATION_SLUG,
  });
  if (error) console.error(`[esh_guest_request_link] ${error.code ?? 'unknown'}: ${error.message}`);
  else await queueDispatchIf(data);
  return { ok: true };
}

export type SendUpdateResult = { ok: true; messageId: string } | { ok: false; code: string };

function assetIdsFrom(value: unknown): string[] {
  return (Array.isArray(value) ? value : [])
    .filter((id): id is string => typeof id === 'string' && uuid.safeParse(id).success)
    .slice(0, 10);
}

/** Send update (§12): a message, with files or without, never a submission. */
export async function sendOwnerUpdate(input: {
  actionId: string;
  body: string;
  clientKey: string;
  assetIds?: string[];
}): Promise<SendUpdateResult> {
  const actionId = uuid.safeParse(input.actionId);
  if (!actionId.success) return { ok: false, code: 'not_available' };
  const secret = await guestSecret();
  if (!secret) return { ok: false, code: 'no_session' };
  const { data, error } = await guestClient().rpc('esh_guest_send_message', {
    p_session: secret,
    p_action_id: actionId.data,
    p_body: String(input.body ?? ''),
    p_client_key: String(input.clientKey ?? ''),
    p_asset_ids: assetIdsFrom(input.assetIds),
  });
  if (error) {
    console.error(`[esh_guest_send_message] ${error.code ?? 'unknown'}: ${error.message}`);
    return { ok: false, code: 'invalid' };
  }
  const result = (data ?? {}) as {
    ok?: boolean;
    code?: string;
    message_id?: string;
    notifications?: number;
  };
  if (!result.ok || !result.message_id) return { ok: false, code: result.code ?? 'invalid' };
  if ((result.notifications ?? 0) > 0) await scheduleEshDispatch();
  revalidatePath(`/respond/actions/${actionId.data}`);
  return { ok: true, messageId: result.message_id };
}

/**
 * Record that an activated escalation recipient has seen the request. This
 * never changes the action state, owner, due date or submission (§15).
 */
export async function acknowledgeEscalation(input: {
  actionId: string;
}): Promise<{ ok: true; level: number | null } | { ok: false; code: string }> {
  const actionId = uuid.safeParse(input.actionId);
  if (!actionId.success) return { ok: false, code: 'not_available' };
  const secret = await guestSecret();
  if (!secret) return { ok: false, code: 'no_session' };
  const { data, error } = await guestClient().rpc('esh_guest_acknowledge', {
    p_session: secret,
    p_action_id: actionId.data,
  });
  if (error) {
    console.error(`[esh_guest_acknowledge] ${error.code ?? 'unknown'}: ${error.message}`);
    return { ok: false, code: 'invalid' };
  }
  const result = (data ?? {}) as { ok?: boolean; code?: string; level?: number };
  if (!result.ok) return { ok: false, code: result.code ?? 'invalid' };
  revalidatePath(`/respond/actions/${actionId.data}`);
  return { ok: true, level: result.level ?? null };
}

export type SubmitResult = { ok: true } | { ok: false; code: string; problems?: string[] };

/**
 * Submit for review (§12): the draft in the composer, or one update already
 * sent, chosen by the owner. ESH is emailed after it commits.
 */
export async function submitOwnerWork(input: {
  actionId: string;
  body: string;
  assetIds: string[];
  reuseMessageId: string | null;
  clientKey: string;
}): Promise<SubmitResult> {
  const actionId = uuid.safeParse(input.actionId);
  if (!actionId.success) return { ok: false, code: 'not_available' };
  const reuse = input.reuseMessageId ? uuid.safeParse(input.reuseMessageId) : null;
  if (reuse && !reuse.success) return { ok: false, code: 'message_not_yours' };
  const secret = await guestSecret();
  if (!secret) return { ok: false, code: 'no_session' };
  const { data, error } = await guestClient().rpc('esh_guest_submit', {
    p_session: secret,
    p_action_id: actionId.data,
    p_body: String(input.body ?? ''),
    p_asset_ids: assetIdsFrom(input.assetIds),
    p_reuse_message_id: (reuse?.success ? reuse.data : null) as string,
    p_client_key: String(input.clientKey ?? ''),
  });
  if (error) {
    console.error(`[esh_guest_submit] ${error.code ?? 'unknown'}: ${error.message}`);
    return { ok: false, code: 'invalid' };
  }
  const result = (data ?? {}) as {
    ok?: boolean;
    code?: string;
    problems?: string[];
    duplicate?: boolean;
  };
  if (!result.ok) return { ok: false, code: result.code ?? 'invalid', problems: result.problems };
  if (!result.duplicate) await scheduleEshDispatch();
  revalidatePath(`/respond/actions/${actionId.data}`);
  return { ok: true };
}

/** Withdraw to revise (§12, FM22). The submitted version stays in history. */
export async function withdrawOwnerSubmission(input: {
  actionId: string;
}): Promise<{ ok: true } | { ok: false; code: string }> {
  const actionId = uuid.safeParse(input.actionId);
  if (!actionId.success) return { ok: false, code: 'not_available' };
  const secret = await guestSecret();
  if (!secret) return { ok: false, code: 'no_session' };
  const { data, error } = await guestClient().rpc('esh_guest_withdraw', {
    p_session: secret,
    p_action_id: actionId.data,
    p_reason: null as unknown as string,
  });
  if (error) {
    console.error(`[esh_guest_withdraw] ${error.code ?? 'unknown'}: ${error.message}`);
    return { ok: false, code: 'invalid' };
  }
  const result = (data ?? {}) as { ok?: boolean; code?: string };
  if (!result.ok) return { ok: false, code: result.code ?? 'invalid' };
  await scheduleEshDispatch();
  revalidatePath(`/respond/actions/${actionId.data}`);
  return { ok: true };
}

/** End access on this device (§10): the session ends at once, server-side. */
export async function endGuestAccess(): Promise<void> {
  const secret = await guestSecret();
  if (secret) {
    const { error } = await guestClient().rpc('esh_guest_end_session', { p_session: secret });
    if (error)
      console.error(`[esh_guest_end_session] ${error.code ?? 'unknown'}: ${error.message}`);
  }
  await clearGuestCookie();
  redirect('/respond/ended');
}
