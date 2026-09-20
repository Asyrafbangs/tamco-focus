import { timingSafeEqual } from 'node:crypto';

import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import type { Database } from '@/lib/database.types';

export const dynamic = 'force-dynamic';

const eventSchema = z.object({
  eventId: z.string().min(4).max(200),
  messageId: z.string().min(1).max(200),
  type: z.enum(['delivered', 'bounced', 'failed']),
  occurredAt: z.iso.datetime({ offset: true }),
  detail: z.string().max(500).optional(),
});

function sameSecret(presented: string | null, expected: string): boolean {
  if (!presented?.startsWith('Bearer ')) return false;
  const actual = Buffer.from(presented.slice(7));
  const wanted = Buffer.from(expected);
  return actual.length === wanted.length && timingSafeEqual(actual, wanted);
}

/**
 * Provider-neutral delivery callback (§17). A production mail adapter maps
 * its signed event to this compact contract. Duplicate event IDs are accepted
 * idempotently; no link secret or message body is accepted or logged.
 */
export async function POST(request: Request) {
  const webhookSecret = process.env.ESH_DELIVERY_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return NextResponse.json({ error: 'not_configured' }, { status: 503 });
  }
  if (!sameSecret(request.headers.get('authorization'), webhookSecret)) {
    return NextResponse.json({ error: 'not_authorised' }, { status: 401 });
  }
  const parsed = eventSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid' }, { status: 400 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return NextResponse.json({ error: 'not_configured' }, { status: 503 });
  }
  const client = createClient<Database, 'public'>(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.rpc('esh_record_delivery_event', {
    p_provider_event_id: parsed.data.eventId,
    p_provider_message_id: parsed.data.messageId,
    p_event_type: parsed.data.type,
    p_occurred_at: parsed.data.occurredAt,
    p_detail: parsed.data.detail ?? undefined,
  });
  if (error) {
    console.error(`[esh-delivery] ${error.code ?? 'unknown'}: ${error.message}`);
    return NextResponse.json({ error: 'unavailable' }, { status: 503 });
  }
  const result = (data ?? {}) as { ok?: boolean; code?: string; duplicate?: boolean };
  if (!result.ok && result.code === 'message_not_found') {
    return NextResponse.json({ error: 'message_not_found' }, { status: 404 });
  }
  if (!result.ok) return NextResponse.json({ error: 'invalid' }, { status: 400 });
  return NextResponse.json({ ok: true, duplicate: Boolean(result.duplicate) });
}
