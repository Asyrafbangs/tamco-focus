import { NextResponse } from 'next/server';

import { signedDownloadFor } from '@/server/esh/evidence';
import { guestClient, guestSecret } from '@/server/esh/guest';

/**
 * One evidence file, for an Action Owner (v199, §20.4, §23, FM49).
 *
 * The guest procedure decides whether this session may open this file — one
 * on their action's conversation, or their finding's original evidence — and
 * only then is a five-minute link signed. Anything else is a plain 404, with
 * nothing said about whether the file exists.
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
  const secret = await guestSecret();
  if (!secret || !UUID.test(assetId)) return notFound();
  const { data, error } = await guestClient().rpc('esh_guest_file', {
    p_session: secret,
    p_asset_id: assetId,
  });
  const file = (data ?? {}) as { ok?: boolean; object_key?: string; name?: string; type?: string };
  if (error || !file.ok || !file.object_key || !file.name || !file.type) return notFound();
  const url = await signedDownloadFor(file.object_key, file.name, file.type);
  if (!url) return notFound();
  return NextResponse.redirect(url, {
    status: 303,
    headers: { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' },
  });
}
