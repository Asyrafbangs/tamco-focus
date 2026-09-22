'use server';

import { revalidatePath } from 'next/cache';

import type { BulkResult } from '@/domain/esh-bulk';
import { EVIDENCE_BUCKET } from '@/server/esh/evidence';
import { guestClient, guestSecret } from '@/server/esh/guest';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/server';
import { scheduleEshDispatch } from '@/server/esh/schedule-dispatch';

/**
 * Several actions at once, for an Action Owner (v206, §40).
 *
 * Every one of these is a wrapper around the single-action routine the chat
 * already uses, so a message sent to eleven actions obeys exactly the rules a
 * message sent to one obeys. The answer is per item: what went, what was
 * skipped because it is no longer theirs, and what failed and can be tried
 * again on its own.
 */

export type BulkOutcome = { ok: true; result: BulkResult } | { ok: false; code?: string };

function shape(data: unknown): BulkResult {
  const value = (data ?? {}) as {
    operation_id?: string;
    requested?: number;
    succeeded?: number;
    failed?: number;
    skipped?: number;
    items?: Array<{ action_id?: string; state?: string; code?: string | null }>;
  };
  return {
    operationId: String(value.operation_id ?? ''),
    requested: Number(value.requested ?? 0),
    succeeded: Number(value.succeeded ?? 0),
    failed: Number(value.failed ?? 0),
    skipped: Number(value.skipped ?? 0),
    items: (value.items ?? []).map((item) => ({
      actionId: String(item.action_id ?? ''),
      state: (item.state === 'succeeded' || item.state === 'skipped'
        ? item.state
        : 'failed') as BulkResult['items'][number]['state'],
      code: item.code ?? null,
    })),
  };
}

async function finish(data: unknown): Promise<BulkOutcome> {
  const value = (data ?? {}) as { ok?: boolean; code?: string };
  if (!value.ok) return { ok: false, code: value.code };
  revalidatePath('/respond/my-actions');
  await scheduleEshDispatch();
  return { ok: true, result: shape(data) };
}

export async function sendBulkUpdate(input: {
  actionIds: string[];
  body: string;
  clientKey: string;
}): Promise<BulkOutcome> {
  const secret = await guestSecret();
  if (!secret) return { ok: false, code: 'no_session' };
  const { data, error } = await guestClient().rpc('esh_guest_bulk_update', {
    p_session: secret,
    p_action_ids: input.actionIds,
    p_body: input.body,
    p_operation_key: input.clientKey,
  });
  if (error) {
    console.error(`[sendBulkUpdate] ${error.code ?? 'unknown'}: ${error.message}`);
    return { ok: false };
  }
  return finish(data);
}

export async function requestBulkExtension(input: {
  actionIds: string[];
  body: string;
  proposedDate: string;
  clientKey: string;
}): Promise<BulkOutcome> {
  const secret = await guestSecret();
  if (!secret) return { ok: false, code: 'no_session' };
  const { data, error } = await guestClient().rpc('esh_guest_bulk_extension', {
    p_session: secret,
    p_action_ids: input.actionIds,
    p_body: input.body,
    p_proposed_date: input.proposedDate,
    p_operation_key: input.clientKey,
  });
  if (error) {
    console.error(`[requestBulkExtension] ${error.code ?? 'unknown'}: ${error.message}`);
    return { ok: false };
  }
  return finish(data);
}

export async function submitBulkActions(input: {
  rows: Array<{
    actionId: string;
    resultText: string;
    assetIds: string[];
    reuseMessageId?: string;
  }>;
  clientKey: string;
}): Promise<BulkOutcome> {
  const secret = await guestSecret();
  if (!secret) return { ok: false, code: 'no_session' };
  const { data, error } = await guestClient().rpc('esh_guest_bulk_submit', {
    p_session: secret,
    p_rows: input.rows.map((row) => ({
      action_id: row.actionId,
      result_text: row.resultText,
      asset_ids: row.assetIds,
      reuse_message_id: row.reuseMessageId ?? null,
    })),
    p_operation_key: input.clientKey,
  });
  if (error) {
    console.error(`[submitBulkActions] ${error.code ?? 'unknown'}: ${error.message}`);
    return { ok: false };
  }
  return finish(data);
}

/**
 * One of the owner's files, attached to several of their actions.
 *
 * Each action gets its own copy of the object, so the association it carries
 * is its own: removing it later cannot reach into another action's evidence or
 * into a submission that has already been made (§40).
 */
export async function shareEvidence(input: {
  assetId: string;
  actionIds: string[];
  clientKey: string;
}): Promise<BulkOutcome> {
  const secret = await guestSecret();
  if (!secret) return { ok: false, code: 'no_session' };
  const client = guestClient();
  const prepared = await client.rpc('esh_guest_share_prepare', {
    p_session: secret,
    p_asset_id: input.assetId,
    p_action_ids: input.actionIds,
    p_operation_key: input.clientKey,
  });
  if (prepared.error) {
    console.error(`[shareEvidence] ${prepared.error.code ?? 'unknown'}: ${prepared.error.message}`);
    return { ok: false };
  }
  const plan = (prepared.data ?? {}) as {
    ok?: boolean;
    code?: string;
    operation_id?: string;
    source_key?: string;
    copies?: Array<{ asset_id: string; object_key: string }>;
    items?: unknown[];
  };
  if (!plan.ok) return { ok: false, code: plan.code };
  // A replayed operation comes back as its own result, with nothing to copy.
  if (!plan.copies) return { ok: true, result: shape(prepared.data) };

  const storage = createSupabaseServiceRoleClient().storage.from(EVIDENCE_BUCKET);
  const arrived: string[] = [];
  for (const copy of plan.copies) {
    const { error } = await storage.copy(plan.source_key!, copy.object_key);
    if (error) {
      console.error(`[shareEvidence] copy failed: ${error.message}`);
      continue;
    }
    arrived.push(copy.asset_id);
  }

  const { data, error } = await client.rpc('esh_guest_share_finish', {
    p_session: secret,
    p_operation_id: plan.operation_id!,
    p_arrived: arrived,
  });
  if (error) {
    console.error(`[shareEvidence] ${error.code ?? 'unknown'}: ${error.message}`);
    return { ok: false };
  }
  return finish(data);
}
