import { NextResponse } from 'next/server';

import { createSupabaseServerClient } from '@/lib/supabase/server';
import { signedDownloadFor } from '@/server/esh/evidence';

/**
 * One photograph from a public report, for ESH staff (v288, §5).
 *
 * The row is read as the signed-in person, so the intake policy decides: a
 * report outside their scope, or any report while their Finding access is off,
 * is simply not found. Only then is a five-minute link signed — the same shape
 * as v199's evidence route, and the same reason: the bucket is private and has
 * no policy for anybody.
 *
 * A photograph that is not `ready` is a 404 rather than a broken image. An
 * upload that never finished is not a picture of anything, and v286's sweep is
 * what clears it.
 *
 * A read that did NOT ANSWER is a third thing again, and it is not a 404: the
 * row read and the signing both used to leave by `notFound()`, which told ESH
 * that a report has no such photograph whenever the database or Storage
 * blinked. The two evidence routes were corrected the same way and for the
 * same reason — this one is new since, and inherits it.
 */
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function notFound() {
  return new NextResponse('Not found', {
    status: 404,
    headers: { 'Cache-Control': 'private, no-store' },
  });
}

/** A read that did not happen, which is not a photograph that is not there. */
function unavailable() {
  return new NextResponse('The photograph could not be fetched. Try again.', {
    status: 503,
    headers: { 'Cache-Control': 'private, no-store' },
  });
}

export async function GET(_request: Request, context: { params: Promise<{ photoId: string }> }) {
  const { photoId } = await context.params;
  if (!UUID.test(photoId)) return notFound();

  const supabase = await createSupabaseServerClient();
  const { data: photo, error } = await supabase
    .from('esh_report_intake_photos')
    .select('object_key, original_name, content_type')
    .eq('id', photoId)
    .eq('state', 'ready')
    .maybeSingle();
  if (error) {
    console.error(`[intake-photo] ${error.code ?? 'unknown'}: ${error.message}`);
    return unavailable();
  }
  if (!photo?.content_type) return notFound();

  const signed = await signedDownloadFor(
    String(photo.object_key),
    String(photo.original_name),
    String(photo.content_type),
  );
  if (signed.failed) return unavailable();
  if (!signed.url) return notFound();
  return NextResponse.redirect(signed.url, {
    status: 303,
    headers: { 'Cache-Control': 'private, no-store' },
  });
}
