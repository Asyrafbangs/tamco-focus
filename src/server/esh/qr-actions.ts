'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { createSupabaseServerClient } from '@/lib/supabase/server';

/**
 * Opening and closing public QR reporting (v288, §6).
 *
 * The widest access decision in the module after the rollout itself: it is the
 * difference between a private staff workflow and a channel every employee and
 * contractor on site can post into. So it belongs where the rollout switch
 * already lives — with the administrator who signs for it — and it demands a
 * reason, which is kept on the row and in the audit trail.
 *
 * Closing it stops new reports. The ones already received stay in the queue,
 * because a report somebody took the trouble to send does not stop being true
 * when the channel closes.
 */

export type QrIntakeDecision = { ok: true; enabled: boolean } | { ok: false; message: string };

const reason = z.string().trim().min(10).max(400);

export async function setPublicQrIntake(input: {
  enabled: boolean;
  reason: string;
}): Promise<QrIntakeDecision> {
  const said = reason.safeParse(input.reason ?? '');
  if (!said.success) {
    return { ok: false, message: 'Say why, in a sentence somebody will read in a year.' };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('esh_set_qr_intake', {
    p_enabled: Boolean(input.enabled),
    p_reason: said.data,
  });
  if (error) {
    console.error(`[esh_set_qr_intake] ${error.code ?? 'unknown'}: ${error.message}`);
    return { ok: false, message: 'That could not be saved. Try again.' };
  }
  const answer = (data ?? {}) as { ok?: boolean; code?: string; enabled?: boolean };
  if (!answer.ok) {
    switch (answer.code) {
      case 'not_permitted':
        return { ok: false, message: 'Only an administrator can open or close public reporting.' };
      case 'reason_required':
        return { ok: false, message: 'Say why, in a sentence somebody will read in a year.' };
      case 'intake_not_configured':
        return {
          ok: false,
          message: 'Public reporting is not configured for this organisation.',
        };
      default:
        return { ok: false, message: 'That could not be saved. Try again.' };
    }
  }

  revalidatePath('/more/admin/users');
  return { ok: true, enabled: Boolean(answer.enabled) };
}
