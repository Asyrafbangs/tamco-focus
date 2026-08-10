'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import type { OperationResult } from '@/domain/types';
import { createSupabaseServerClient, requireProfile } from '@/lib/supabase/server';

/**
 * Reading a notification is not doing the work (v42 section P).
 *
 * These actions only ever touch `read_at`. Marking the bell clear must never
 * complete, activate or dismiss the underlying task — the notification is a
 * pointer to work, and losing the pointer is not the same as finishing it.
 */
export async function markNotificationRead(input: {
  notificationId: string;
}): Promise<OperationResult> {
  const profile = await requireProfile();
  const parsed = z.object({ notificationId: z.string().uuid() }).safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: 'validation_failed', message: 'Invalid notification.' };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', parsed.data.notificationId)
    .eq('recipient_id', profile.id)
    .is('read_at', null);

  if (error) {
    console.error(`[markNotificationRead] ${error.message}`);
    return { ok: false, code: 'unexpected_error', message: 'That could not be marked as read.' };
  }

  revalidatePath('/', 'layout');
  return { ok: true, code: 'notification_read' };
}

export async function markAllNotificationsRead(): Promise<OperationResult> {
  const profile = await requireProfile();
  const supabase = await createSupabaseServerClient();

  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('recipient_id', profile.id)
    .is('read_at', null);

  if (error) {
    console.error(`[markAllNotificationsRead] ${error.message}`);
    return { ok: false, code: 'unexpected_error', message: 'Those could not be marked as read.' };
  }

  revalidatePath('/', 'layout');
  return { ok: true, code: 'notifications_read' };
}
