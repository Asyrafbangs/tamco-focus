import { NextResponse } from 'next/server';

import { createSupabaseServerClient } from '@/lib/supabase/server';
import { signedDownloadFor } from '@/server/esh/evidence';

/**
 * One evidence file, for ESH staff (v199, §23).
 *
 * Read as the signed-in person, so the finding's own policies decide: a file
 * of a finding outside their scope, or any file while their Finding access is
 * off, is simply not found. Only then is a five-minute link signed.
 */
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function notFound() {
  return new NextResponse('Not found', {
    status: 404,
    headers: { 'Cache-Control': 'private, no-store' },
  });
}

export async function GET(_request: Request, context: { params: Promise<{ assetId: string }> }) {
  const { assetId } = await context.params;
  if (!UUID.test(assetId)) return notFound();
  const supabase = await createSupabaseServerClient();
  const { data: file } = await supabase
    .from('esh_evidence_assets')
    .select('object_key, original_name, content_type, state')
    .eq('id', assetId)
    .eq('state', 'ready')
    .maybeSingle();
  if (!file?.content_type) return notFound();
  const url = await signedDownloadFor(file.object_key, file.original_name, file.content_type);
  if (!url) return notFound();
  return NextResponse.redirect(url, {
    status: 303,
    headers: { 'Cache-Control': 'private, no-store' },
  });
}
