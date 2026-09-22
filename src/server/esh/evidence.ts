import 'server-only';

import { createHash } from 'node:crypto';

import {
  EVIDENCE_MAX_BYTES,
  INLINE_TYPES,
  sniffEvidenceType,
  type EvidenceType,
} from '@/domain/esh-evidence';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/server';

/**
 * The private evidence bucket (v199, §23).
 *
 * Nobody reads or writes `finding-evidence` directly. Whoever may add a file
 * has already been checked by a procedure, which names the object; this module
 * then hands the browser a one-time signed URL to put exactly that object,
 * reads the bytes back to decide what the file really is, and issues
 * five-minute download links only after another check.
 */

export const EVIDENCE_BUCKET = 'finding-evidence';

/** Download links last five minutes at most (§18). */
const DOWNLOAD_SECONDS = 300;

function storage() {
  return createSupabaseServiceRoleClient().storage.from(EVIDENCE_BUCKET);
}

/** A one-time URL the browser uploads this one object to. */
export async function signedUploadFor(
  objectKey: string,
): Promise<{ ok: true; path: string; token: string } | { ok: false }> {
  const { data, error } = await storage().createSignedUploadUrl(objectKey);
  if (error || !data) {
    console.error(`[esh-evidence] could not sign an upload: ${error?.message ?? 'no data'}`);
    return { ok: false };
  }
  return { ok: true, path: data.path, token: data.token };
}

export type Inspection =
  | { ok: true; type: EvidenceType; size: number; sha256: string }
  | { ok: false; reason: 'missing' | 'too_large' | 'type_mismatch' };

/**
 * What was actually uploaded. The bytes decide the type, checked against the
 * name; a file that is not what it says is removed at once, so nothing
 * unverified stays in the bucket.
 */
export async function inspectUpload(objectKey: string, name: string): Promise<Inspection> {
  const { data, error } = await storage().download(objectKey);
  if (error || !data) return { ok: false, reason: 'missing' };
  const bytes = new Uint8Array(await data.arrayBuffer());
  if (bytes.byteLength === 0) {
    await removeObject(objectKey);
    return { ok: false, reason: 'missing' };
  }
  if (bytes.byteLength > EVIDENCE_MAX_BYTES) {
    await removeObject(objectKey);
    return { ok: false, reason: 'too_large' };
  }
  const type = sniffEvidenceType(bytes.subarray(0, 8192), name);
  if (!type) {
    await removeObject(objectKey);
    return { ok: false, reason: 'type_mismatch' };
  }
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  return { ok: true, type, size: bytes.byteLength, sha256 };
}

/** The bytes themselves, for a file the server has to read rather than serve. */
export async function readObject(objectKey: string): Promise<Buffer | null> {
  const { data, error } = await storage().download(objectKey);
  if (error || !data) {
    console.error(`[esh-evidence] could not read an object: ${error?.message ?? 'no data'}`);
    return null;
  }
  return Buffer.from(await data.arrayBuffer());
}

export async function removeObject(objectKey: string): Promise<void> {
  const { error } = await storage().remove([objectKey]);
  if (error) console.error(`[esh-evidence] could not remove an object: ${error.message}`);
}

/**
 * A short-lived link to one file. Photos and PDFs open in the browser; every
 * other type downloads, so nothing active is rendered from our origin (§23).
 */
export async function signedDownloadFor(
  objectKey: string,
  name: string,
  type: string,
): Promise<string | null> {
  const { data, error } = await storage().createSignedUrl(objectKey, DOWNLOAD_SECONDS, {
    download: INLINE_TYPES.has(type) ? false : name,
  });
  if (error || !data?.signedUrl) {
    console.error(`[esh-evidence] could not sign a download: ${error?.message ?? 'no data'}`);
    return null;
  }
  return data.signedUrl;
}
