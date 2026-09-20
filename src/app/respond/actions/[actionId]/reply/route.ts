import { NextResponse, type NextRequest } from 'next/server';

import { newAccessSecret } from '@/server/esh/dispatch';
import { acknowledgeEscalation, sendOwnerUpdate } from '@/server/esh/guest-actions';

/**
 * No-JavaScript fallback for the escalation reply form. The guest cookie is
 * SameSite=Lax and this endpoint additionally accepts only a same-origin
 * browser form POST, so a cross-site page cannot spend the guest session.
 */
export async function POST(
  request: NextRequest,
  context: RouteContext<'/respond/actions/[actionId]/reply'>,
) {
  if (request.headers.get('sec-fetch-site') !== 'same-origin') {
    return new Response('Forbidden', { status: 403 });
  }
  const { actionId } = await context.params;
  const formData = await request.formData();
  const destination = new URL(`/respond/actions/${actionId}`, request.url);
  if (formData.get('intent') === 'acknowledge') {
    const result = await acknowledgeEscalation({ actionId });
    if (result.ok) destination.searchParams.set('acknowledged', String(result.level ?? 1));
  } else {
    await sendOwnerUpdate({
      actionId,
      body: String(formData.get('body') ?? ''),
      clientKey: newAccessSecret(),
    });
  }
  return NextResponse.redirect(destination, 303);
}
