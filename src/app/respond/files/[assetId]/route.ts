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

/**
 * A read that did not happen, kept apart from the 404 above.
 *
 * The 404 is deliberately uninformative: an owner must not learn from it
 * whether a file exists, only that they cannot have this one. That rule is
 * about what the ANSWER discloses, and it is untouched here — this says the
 * service failed, which reveals nothing about any asset, and is the only way
 * an owner can tell "try again" from "not yours". A refusal and an outage both
 * returning 404 meant an owner with an outage gave up on a file that was there
 * and that they were entitled to.
 */
function unavailable() {
  return new NextResponse('The file could not be fetched. Try again.', {
    status: 503,
    headers: { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' },
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
  // A procedure that did not answer is not a procedure that said no.
  if (error) {
    console.error(`[esh-guest-file] ${error.code ?? 'unknown'}: ${error.message}`);
    return unavailable();
  }
  if (!file.ok || !file.object_key || !file.name || !file.type) return notFound();
  const signed = await signedDownloadFor(file.object_key, file.name, file.type);
  if (signed.failed) return unavailable();
  if (!signed.url) return notFound();
  return NextResponse.redirect(signed.url, {
    status: 303,
    headers: { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' },
  });
}
