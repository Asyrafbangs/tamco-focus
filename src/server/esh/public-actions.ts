'use server';

import { headers } from 'next/headers';

import {
  PUBLIC_PHOTO_MAX,
  PUBLIC_PHOTO_MAX_UPLOAD_BYTES,
  PUBLIC_REPORT_MAX_CONTACT,
  reportTextProblem,
} from '@/domain/esh-public-report';
import { attachPublicPhoto, submitPublicReport, throttleBucket } from '@/server/esh/public-report';

/**
 * Sending a public safety report (v288, §2).
 *
 * The caller is not signed in, so this is the trust boundary: it resolves the
 * QR code, applies the rate limit, and decides what happens to each
 * photograph. Nothing in the database is reachable by the anonymous role.
 *
 * Photographs arrive in the same request as the text, as form data. The
 * browser has already shrunk each one to 2560px, so three of them come to a
 * couple of megabytes — inside the body limit, and one round trip instead of
 * three per photo. A report whose photographs fail is still a report: the text
 * is what ESH acts on, and losing somebody's observation because their camera
 * roll disagreed with us would be the worse outcome.
 */

export type ReportResult =
  | { ok: true; reference: string; photosAttached: number; photosRefused: number }
  | { ok: false; message: string };

function refused(code: string | undefined): ReportResult {
  switch (code) {
    case 'not_enabled':
      return {
        ok: false,
        message: 'Reporting from this link is not open yet. Tell your supervisor instead.',
      };
    case 'unknown_location':
      return {
        ok: false,
        message: 'This sticker is not in use. Tell your supervisor, and mention the code on it.',
      };
    case 'too_many_reports':
      return {
        ok: false,
        message: 'That is several reports in a few minutes. Wait a little, then send this one.',
      };
    case 'description_required':
      return { ok: false, message: 'Say what you saw.' };
    case 'description_too_long':
      return { ok: false, message: 'That is longer than this form can take.' };
    case 'contact_too_long':
      return { ok: false, message: 'That contact line is too long.' };
    default:
      return { ok: false, message: 'The report could not be sent. Try again in a moment.' };
  }
}

export async function sendPublicReport(form: FormData): Promise<ReportResult> {
  const code = String(form.get('code') ?? '').trim();
  const text = String(form.get('text') ?? '');
  const where = String(form.get('where') ?? '').trim();
  const contact = String(form.get('contact') ?? '').trim();

  const problem = reportTextProblem(text);
  if (problem) return { ok: false, message: problem };
  if (contact.length > PUBLIC_REPORT_MAX_CONTACT) return refused('contact_too_long');

  /*
   * The photographs, up to three. A fourth is dropped here rather than
   * refusing the whole report: the database refuses it too, and a person who
   * managed to send four has still told us something worth keeping.
   */
  const photos = form
    .getAll('photos')
    .filter((entry): entry is File => entry instanceof File && entry.size > 0)
    .slice(0, PUBLIC_PHOTO_MAX);

  /*
   * `x-forwarded-for` is what Vercel sets. It is read, hashed with a daily
   * salt and used as a counter key; the address itself is never stored, and
   * nothing links a counter to a report.
   */
  const requestHeaders = await headers();
  const bucket = throttleBucket(
    requestHeaders.get('x-forwarded-for') ?? requestHeaders.get('x-real-ip'),
  );

  const submitted = await submitPublicReport({
    code,
    text: text.trim(),
    reportedLocation: where || null,
    contact: contact || null,
    bucket,
    withPhotos: photos.length > 0,
  });
  if (!submitted.ok) return refused(submitted.code);

  let attached = 0;
  let refusedPhotos = 0;
  for (const photo of photos) {
    if (photo.size > PUBLIC_PHOTO_MAX_UPLOAD_BYTES) {
      refusedPhotos += 1;
      continue;
    }
    const bytes = new Uint8Array(await photo.arrayBuffer());
    const result = await attachPublicPhoto({
      reference: submitted.report.reference,
      tokenHash: submitted.report.photoTokenHash,
      name: photo.name,
      bytes,
    });
    if (result.ok) attached += 1;
    else refusedPhotos += 1;
  }

  return {
    ok: true,
    reference: submitted.report.reference,
    photosAttached: attached,
    photosRefused: refusedPhotos,
  };
}
