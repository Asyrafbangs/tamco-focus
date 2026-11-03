import 'server-only';

import { createHash, randomBytes } from 'node:crypto';

import { pixelProblem, sniffEvidenceType } from '@/domain/esh-evidence';
import { rebuildImage } from '@/domain/esh-image-rebuild';
import {
  PUBLIC_PHOTO_MAX,
  PUBLIC_PHOTO_MAX_UPLOAD_BYTES,
  PUBLIC_PHOTO_TYPES,
} from '@/domain/esh-public-report';
import { throttleBucket } from '@/domain/esh-throttle';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/server';

/**
 * Public QR reporting, server side (v288, §2, §3, §6).
 *
 * The person submitting is not signed in to anything, so this module is the
 * whole trust boundary. Nothing in the database is granted to the anonymous
 * role — the procedures below are `service_role` only — which means the
 * browser can reach exactly what a Server Action chooses to do on its behalf
 * and nothing else.
 *
 * Every photograph is rebuilt before it is stored, never after. The browser
 * has already redrawn it through a canvas, which applies the orientation and
 * drops the EXIF block; this rebuild is what makes that a guarantee rather
 * than a hope, and it also removes anything appended to the file that the
 * signature check cannot see.
 */

const BUCKET = 'finding-evidence';

export interface PublicLocation {
  code: string;
  label: string;
}

/** The QR code's location, or null when the code or the channel is closed. */
export async function publicLocationFor(code: string): Promise<PublicLocation | null> {
  const client = createSupabaseServiceRoleClient();
  const { data, error } = await client.rpc('esh_qr_location_for', { p_public_code: code });
  if (error) {
    console.error(`[publicLocationFor] ${error.code ?? 'unknown'}: ${error.message}`);
    return null;
  }
  const answer = (data ?? {}) as { ok?: boolean; label?: string; code?: string };
  if (!answer.ok || !answer.label || !answer.code) return null;
  return { code: answer.code, label: answer.label };
}

export interface SubmittedReport {
  reference: string;
  intakeId: string;
  /** The plaintext token, held only for this request's photo uploads. */
  photoToken: string;
  photoTokenHash: string;
}

export type SubmitAnswer = { ok: true; report: SubmittedReport } | { ok: false; code: string };

export async function submitPublicReport(input: {
  code: string;
  text: string;
  reportedLocation: string | null;
  contact: string | null;
  bucket: string | null;
  withPhotos: boolean;
}): Promise<SubmitAnswer> {
  const client = createSupabaseServiceRoleClient();
  /*
   * The token is minted here and never stored in plaintext. It authorises the
   * photographs for this one report, for twenty minutes, and the sweep clears
   * the hash as soon as it expires: authorisation that outlives its purpose is
   * only a liability.
   */
  const photoToken = randomBytes(32).toString('base64url');
  const photoTokenHash = createHash('sha256').update(photoToken, 'utf8').digest('hex');

  const { data, error } = await client.rpc('esh_public_report_submit', {
    p_public_code: input.code,
    p_text: input.text,
    p_reported_location: input.reportedLocation,
    p_contact: input.contact,
    p_bucket: input.bucket,
    p_photo_token_hash: input.withPhotos ? photoTokenHash : null,
  });
  if (error) {
    console.error(`[submitPublicReport] ${error.code ?? 'unknown'}: ${error.message}`);
    return { ok: false, code: 'unavailable' };
  }
  const answer = (data ?? {}) as {
    ok?: boolean;
    code?: string;
    reference?: string;
    intake_id?: string;
  };
  if (!answer.ok || !answer.reference || !answer.intake_id) {
    return { ok: false, code: answer.code ?? 'unavailable' };
  }
  return {
    ok: true,
    report: {
      reference: answer.reference,
      intakeId: answer.intake_id,
      photoToken,
      photoTokenHash,
    },
  };
}

export type PhotoAnswer = { ok: true } | { ok: false; code: string };

/**
 * One photograph, from the bytes the browser sent to an object in the private
 * bucket.
 *
 * The order matters. The procedure agrees first — it is what enforces the cap
 * of three and the input limit, and it is what checks the token — then the
 * bytes are examined, then rebuilt, and only the rebuilt bytes are ever
 * written. A photograph that cannot be rebuilt is refused rather than stored
 * as it arrived, because "as it arrived" is the version that still knows where
 * it was taken.
 */
export async function attachPublicPhoto(input: {
  reference: string;
  tokenHash: string;
  name: string;
  bytes: Uint8Array;
}): Promise<PhotoAnswer> {
  const client = createSupabaseServiceRoleClient();

  if (input.bytes.byteLength > PUBLIC_PHOTO_MAX_UPLOAD_BYTES) {
    return { ok: false, code: 'too_large' };
  }

  const { data, error } = await client.rpc('esh_public_photo_start', {
    p_reference: input.reference,
    p_token_hash: input.tokenHash,
    p_name: input.name,
    p_size: input.bytes.byteLength,
    p_max_photos: PUBLIC_PHOTO_MAX,
  });
  if (error) {
    console.error(`[attachPublicPhoto] start: ${error.code ?? 'unknown'}: ${error.message}`);
    return { ok: false, code: 'unavailable' };
  }
  const agreed = (data ?? {}) as {
    ok?: boolean;
    code?: string;
    photo_id?: string;
    object_key?: string;
  };
  if (!agreed.ok || !agreed.photo_id || !agreed.object_key) {
    return { ok: false, code: agreed.code ?? 'unavailable' };
  }

  const refuse = async (code: string): Promise<PhotoAnswer> => {
    await client.rpc('esh_public_photo_finish', {
      p_photo_id: agreed.photo_id,
      p_ok: false,
      p_type: null,
      p_size: null,
      p_sha256: null,
      p_reason: code,
    });
    return { ok: false, code };
  };

  // What the bytes really are, against the name — never what the browser said.
  const type = sniffEvidenceType(input.bytes.subarray(0, 8192), input.name);
  if (!type || !PUBLIC_PHOTO_TYPES.has(type)) return refuse('type_mismatch');
  if (pixelProblem(input.bytes.subarray(0, 65536), type)) return refuse('image_too_large');

  const rebuilt = rebuildImage(input.bytes, type);
  if (!rebuilt) return refuse('unreadable');

  const upload = await client.storage
    .from(BUCKET)
    .upload(agreed.object_key, new Blob([rebuilt as BlobPart], { type }), {
      contentType: type,
      upsert: false,
    });
  if (upload.error) {
    console.error(`[attachPublicPhoto] upload: ${upload.error.message}`);
    return refuse('upload_failed');
  }

  const sha256 = createHash('sha256').update(rebuilt).digest('hex');
  const { data: finished, error: finishError } = await client.rpc('esh_public_photo_finish', {
    p_photo_id: agreed.photo_id,
    p_ok: true,
    p_type: type,
    p_size: rebuilt.byteLength,
    p_sha256: sha256,
    p_reason: null,
  });
  if (finishError || !(finished as { ok?: boolean } | null)?.ok) {
    /*
     * The object is in the bucket and the row cannot be completed. Removing
     * the object keeps the two in step; the row stays `uploading` and v286's
     * sweep takes it, which is exactly what that sweep is for.
     */
    await client.storage.from(BUCKET).remove([agreed.object_key]);
    console.error(`[attachPublicPhoto] finish: ${finishError?.message ?? 'refused'}`);
    return { ok: false, code: 'unavailable' };
  }
  return { ok: true };
}

/** Re-exported so a caller needs one import for the public-report server side. */
export { throttleBucket };
