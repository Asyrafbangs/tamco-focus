import { NextResponse } from 'next/server';

import { createSupabaseServerClient } from '@/lib/supabase/server';
import { signedDownloadFor } from '@/server/esh/evidence';

/**
 * One evidence file, for ESH staff (v199, §23).
 *
 * Read as the signed-in person, so the finding's own policies decide: a file
 * of a finding outside their scope, or any file while their Finding access is
 * off, is simply not found. Only then is a five-minute link signed.
 *
 * `?source=1` asks for the file as it came off the camera instead of the
 * compressed copy (v271). Same row, same policy, same five minutes -- it is
 * one more object under one more key, and an asset with no preserved original
 * is a 404 rather than a quiet fall back to the copy, because somebody asking
 * for the full-size original has a reason to want exactly that.
 *
 * Staff only, and deliberately. The owner's own pages show the copy; the
 * source file is what ESH verifies and what an argument about a photograph
 * would turn on, and it is reachable only where the finding itself is.
 */
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function notFound() {
  return new NextResponse('Not found', {
    status: 404,
    headers: { 'Cache-Control': 'private, no-store' },
  });
}

export async function GET(request: Request, context: { params: Promise<{ assetId: string }> }) {
  const { assetId } = await context.params;
  if (!UUID.test(assetId)) return notFound();
  const wantsSource = new URL(request.url).searchParams.get('source') === '1';
  const supabase = await createSupabaseServerClient();
  const { data: file } = await supabase
    .from('esh_evidence_assets')
    .select(
      'object_key, original_name, content_type, state, source_object_key, source_file_name, source_state',
    )
    .eq('id', assetId)
    .eq('state', 'ready')
    .maybeSingle();
  if (!file?.content_type) return notFound();
  if (wantsSource && (file.source_state !== 'kept' || !file.source_object_key)) return notFound();
  /*
   * The source file always downloads rather than opening in place: it is the
   * eight-megabyte one, and it is wanted as a file to keep, not as something
   * to glance at. `application/octet-stream` is what forces that.
   */
  const url = wantsSource
    ? await signedDownloadFor(
        file.source_object_key as string,
        file.source_file_name ?? file.original_name,
        'application/octet-stream',
      )
    : await signedDownloadFor(file.object_key, file.original_name, file.content_type);
  if (!url) return notFound();
  return NextResponse.redirect(url, {
    status: 303,
    headers: { 'Cache-Control': 'private, no-store' },
  });
}
