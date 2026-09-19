'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { evidenceProblem, safeEvidenceName } from '@/domain/esh-evidence';
import { createSupabaseServerClient, requireProfile } from '@/lib/supabase/server';
import { inspectUpload, removeObject, signedUploadFor } from '@/server/esh/evidence';
import { guestClient, guestSecret } from '@/server/esh/guest';

/**
 * Adding and removing files (v199, §23), for an owner through their guest
 * session and for ESH as themselves. Three steps: a procedure agrees and
 * names the object; the browser uploads it straight to private storage with
 * a one-time URL; the server reads it back, decides what it really is, and
 * records the answer. A file that is not what it claims is deleted and said
 * to be refused.
 */

const uuid = z.string().uuid();

export interface ReadyFile {
  id: string;
  name: string;
  type: string;
  size: number;
}

export type StartUpload =
  { ok: true; assetId: string; path: string; token: string } | { ok: false; message: string };

export type FinishUpload = { ok: true; file: ReadyFile } | { ok: false; message: string };

const START_PROBLEMS: Record<string, string> = {
  no_session: 'Your access on this device has ended. Get a new link to add files.',
  not_available: 'Files can no longer be added here.',
  action_closed: 'Files can no longer be added here.',
  finding_closed: 'Files can no longer be added here.',
  finding_not_found: 'Files can no longer be added here.',
  not_permitted: 'Only a Coordinator or Verifier can add files.',
  type_not_allowed: 'Attach a photo, PDF, Word, Excel, PowerPoint, CSV or text file.',
  too_large: 'Files can be up to 10 MB each.',
  too_many_files: 'Up to 10 files can go with one message. Send these first.',
  slow_down: 'That is a lot of files in a short time. Wait a little, then try again.',
};

const REFUSED: Record<string, string> = {
  missing: 'The upload did not arrive. Try again.',
  too_large: 'Files can be up to 10 MB each.',
  type_mismatch: 'This file is not what its name says, so it was refused.',
};

function startProblem(code: string | undefined) {
  return START_PROBLEMS[code ?? ''] ?? 'The file could not be added. Try again.';
}

async function signed(result: {
  ok?: boolean;
  code?: string;
  asset_id?: string;
  object_key?: string;
}) {
  if (!result.ok || !result.asset_id || !result.object_key) {
    return { ok: false as const, message: startProblem(result.code) };
  }
  const upload = await signedUploadFor(result.object_key);
  if (!upload.ok) return { ok: false as const, message: 'The file could not be added. Try again.' };
  return { ok: true as const, assetId: result.asset_id, path: upload.path, token: upload.token };
}

// ---------------------------------------------------------------------------
// The owner
// ---------------------------------------------------------------------------

export async function startOwnerUpload(input: {
  actionId: string;
  name: string;
  size: number;
}): Promise<StartUpload> {
  const actionId = uuid.safeParse(input.actionId);
  if (!actionId.success) return { ok: false, message: startProblem('not_available') };
  const name = safeEvidenceName(String(input.name ?? ''));
  const problem = evidenceProblem(name, Number(input.size));
  if (problem) return { ok: false, message: problem };
  const secret = await guestSecret();
  if (!secret) return { ok: false, message: startProblem('no_session') };
  const { data, error } = await guestClient().rpc('esh_guest_start_upload', {
    p_session: secret,
    p_action_id: actionId.data,
    p_name: name,
    p_size: Number(input.size),
  });
  if (error) {
    console.error(`[esh_guest_start_upload] ${error.code ?? 'unknown'}: ${error.message}`);
    return { ok: false, message: startProblem(undefined) };
  }
  return signed((data ?? {}) as Parameters<typeof signed>[0]);
}

export async function finishOwnerUpload(input: { assetId: string }): Promise<FinishUpload> {
  const assetId = uuid.safeParse(input.assetId);
  const secret = await guestSecret();
  if (!assetId.success || !secret) return { ok: false, message: startProblem('no_session') };
  const client = guestClient();
  const target = await client.rpc('esh_guest_upload_target', {
    p_session: secret,
    p_asset_id: assetId.data,
  });
  const found = (target.data ?? {}) as {
    ok?: boolean;
    code?: string;
    object_key?: string;
    name?: string;
  };
  if (target.error || !found.ok || !found.object_key || !found.name) {
    return { ok: false, message: startProblem(found.code) };
  }
  const inspection = await inspectUpload(found.object_key, found.name);
  const { data, error } = await client.rpc('esh_guest_finish_upload', {
    p_session: secret,
    p_asset_id: assetId.data,
    p_ok: inspection.ok,
    p_type: (inspection.ok ? inspection.type : null) as string,
    p_size: (inspection.ok ? inspection.size : null) as number,
    p_sha256: (inspection.ok ? inspection.sha256 : null) as string,
    p_reason: (inspection.ok ? null : inspection.reason) as string,
  });
  if (error || !(data as { ok?: boolean } | null)?.ok) {
    return { ok: false, message: 'The file could not be added. Try again.' };
  }
  if (!inspection.ok) return { ok: false, message: REFUSED[inspection.reason] ?? REFUSED.missing! };
  return {
    ok: true,
    file: { id: assetId.data, name: found.name, type: inspection.type, size: inspection.size },
  };
}

export async function removeOwnerUpload(input: { assetId: string }): Promise<{ ok: boolean }> {
  const assetId = uuid.safeParse(input.assetId);
  const secret = await guestSecret();
  if (!assetId.success || !secret) return { ok: false };
  const { data, error } = await guestClient().rpc('esh_guest_remove_upload', {
    p_session: secret,
    p_asset_id: assetId.data,
  });
  const result = (data ?? {}) as { ok?: boolean; object_key?: string };
  if (error || !result.ok) return { ok: false };
  if (result.object_key) await removeObject(result.object_key);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// ESH staff
// ---------------------------------------------------------------------------

export async function startStaffUpload(input: {
  findingId: string;
  actionId: string | null;
  purpose: 'original' | 'message';
  name: string;
  size: number;
}): Promise<StartUpload> {
  await requireProfile();
  const findingId = uuid.safeParse(input.findingId);
  const actionId = input.actionId ? uuid.safeParse(input.actionId) : null;
  if (!findingId.success || (actionId && !actionId.success)) {
    return { ok: false, message: startProblem('finding_not_found') };
  }
  const name = safeEvidenceName(String(input.name ?? ''));
  const problem = evidenceProblem(name, Number(input.size));
  if (problem) return { ok: false, message: problem };
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('esh_start_upload', {
    p_finding_id: findingId.data,
    p_action_id: (actionId?.success ? actionId.data : null) as string,
    p_purpose: input.purpose === 'original' ? 'original' : 'message',
    p_name: name,
    p_size: Number(input.size),
  });
  if (error) {
    console.error(`[esh_start_upload] ${error.code ?? 'unknown'}: ${error.message}`);
    return { ok: false, message: startProblem(undefined) };
  }
  return signed((data ?? {}) as Parameters<typeof signed>[0]);
}

export async function finishStaffUpload(input: {
  assetId: string;
  findingId: string;
}): Promise<FinishUpload> {
  await requireProfile();
  const assetId = uuid.safeParse(input.assetId);
  if (!assetId.success) return { ok: false, message: startProblem('not_available') };
  const supabase = await createSupabaseServerClient();
  // Read as the person: the policy shows them their own upload in progress,
  // and nobody else's.
  const { data: asset } = await supabase
    .from('esh_evidence_assets')
    .select('object_key, original_name, state, purpose')
    .eq('id', assetId.data)
    .maybeSingle();
  if (!asset || asset.state !== 'uploading') {
    return { ok: false, message: startProblem('not_available') };
  }
  const inspection = await inspectUpload(asset.object_key, asset.original_name);
  const { data, error } = await supabase.rpc('esh_finish_upload', {
    p_asset_id: assetId.data,
    p_ok: inspection.ok,
    p_type: (inspection.ok ? inspection.type : null) as string,
    p_size: (inspection.ok ? inspection.size : null) as number,
    p_sha256: (inspection.ok ? inspection.sha256 : null) as string,
    p_reason: (inspection.ok ? null : inspection.reason) as string,
  });
  if (error || !(data as { ok?: boolean } | null)?.ok) {
    return { ok: false, message: 'The file could not be added. Try again.' };
  }
  if (!inspection.ok) return { ok: false, message: REFUSED[inspection.reason] ?? REFUSED.missing! };
  if (asset.purpose === 'original' && uuid.safeParse(input.findingId).success) {
    revalidatePath(`/findings/${input.findingId}`);
  }
  return {
    ok: true,
    file: {
      id: assetId.data,
      name: asset.original_name,
      type: inspection.type,
      size: inspection.size,
    },
  };
}

export async function removeStaffUpload(input: {
  assetId: string;
  findingId: string;
}): Promise<{ ok: boolean }> {
  await requireProfile();
  const assetId = uuid.safeParse(input.assetId);
  if (!assetId.success) return { ok: false };
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('esh_remove_upload', { p_asset_id: assetId.data });
  const result = (data ?? {}) as { ok?: boolean; object_key?: string };
  if (error || !result.ok) return { ok: false };
  if (result.object_key) await removeObject(result.object_key);
  if (uuid.safeParse(input.findingId).success) revalidatePath(`/findings/${input.findingId}`);
  return { ok: true };
}
