'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import {
  releaseSummary,
  rolloutModeProblem,
  type ReleaseOutcome,
  type RolloutMode,
} from '@/domain/esh-rollout';
import { createSupabaseServerClient, requireProfile } from '@/lib/supabase/server';
import { scheduleEshDispatch } from '@/server/esh/schedule-dispatch';

/**
 * The rollout gate's two widest acts (v224, §43.2, §43.4).
 *
 * Both are the procedure's decision, not this layer's: an administrator for
 * the mode, an ESH Coordinator for a release, and the reasons are checked in
 * the database so no other caller can skip them.
 */

const uuid = z.string().uuid();

export interface RolloutModeResult {
  ok: boolean;
  message: string;
}

/**
 * Open or close the rollout (§43.2).
 *
 * Opening it does not send anything. That is the point of FM106 and it is also
 * the safer shape: an administrator decides who may be written to, and ESH
 * decides when the letters go.
 */
export async function setRolloutMode(input: {
  mode: RolloutMode;
  reason: string;
}): Promise<RolloutModeResult> {
  const profile = await requireProfile();
  if (profile.role !== 'administrator') {
    return { ok: false, message: rolloutModeProblem('not_permitted') };
  }
  const mode = input.mode === 'live' ? 'live' : 'restricted';
  const reason = String(input.reason ?? '').trim();
  if (reason.length < 10) {
    return { ok: false, message: rolloutModeProblem('reason_required') };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('esh_set_rollout_mode', {
    p_mode: mode,
    p_reason: reason,
  });
  if (error) {
    console.error(`[esh_set_rollout_mode] ${error.code ?? 'unknown'}: ${error.message}`);
    return { ok: false, message: 'Something went wrong and the rollout was not changed.' };
  }
  const result = (data ?? {}) as {
    ok?: boolean;
    code?: string;
    unchanged?: boolean;
    notifications_held?: number;
    sessions_ended?: number;
  };
  if (!result.ok) return { ok: false, message: rolloutModeProblem(result.code) };

  revalidatePath('/more/admin/users');
  revalidatePath('/esh');
  revalidatePath('/findings/register');
  if (result.unchanged) {
    return { ok: true, message: 'The rollout was already set that way.' };
  }
  if (mode === 'live') {
    return {
      ok: true,
      message:
        'The rollout is open: every active contact can be written to, apart from anyone switched off by name. Nothing has been sent — release what is held when you are ready.',
    };
  }
  const ended = Number(result.sessions_ended ?? 0);
  const held = Number(result.notifications_held ?? 0);
  return {
    ok: true,
    message: `The rollout is closed. ${ended} open session${ended === 1 ? '' : 's'} ended and ${held} notification${held === 1 ? '' : 's'} went back to held. No work changed.`,
  };
}

export interface ReleaseHeldResult {
  ok: boolean;
  message: string;
  released: number;
  stillHeld: number;
}

/**
 * Release every held notification at once (§43.4).
 *
 * The rules are untouched: the database calls the same single-notification
 * procedure for each letter, so a contact who is not cleared is still not
 * written to, an owner who has been replaced still gets nothing, and an
 * assignment still goes before the replies that would repeat it.
 */
export async function releaseHeldNotifications(input?: {
  importBatchId?: string;
}): Promise<ReleaseHeldResult> {
  await requireProfile();
  const batch = input?.importBatchId ? uuid.safeParse(input.importBatchId) : null;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('esh_release_held_notifications', {
    p_import_batch_id: batch?.success ? batch.data : undefined,
  });
  if (error) {
    console.error(`[esh_release_held_notifications] ${error.code ?? 'unknown'}: ${error.message}`);
    return {
      ok: false,
      message: 'Something went wrong and nothing was released.',
      released: 0,
      stillHeld: 0,
    };
  }
  const result = (data ?? {}) as {
    ok?: boolean;
    code?: string;
    released?: number;
    covered?: number;
    skipped?: number;
    reasons?: Record<string, number>;
    still_held?: number;
  };
  if (!result.ok) {
    return {
      ok: false,
      message:
        result.code === 'not_permitted'
          ? 'Only a Coordinator or Verifier can release notifications.'
          : 'Those notifications could not be found.',
      released: 0,
      stillHeld: 0,
    };
  }

  const outcome: ReleaseOutcome = {
    released: Number(result.released ?? 0),
    covered: Number(result.covered ?? 0),
    skipped: Number(result.skipped ?? 0),
    reasons: result.reasons ?? {},
    stillHeld: Number(result.still_held ?? 0),
  };
  if (outcome.released > 0) await scheduleEshDispatch();
  revalidatePath('/esh');
  revalidatePath('/findings/register');
  revalidatePath('/more/admin/users');
  if (input?.importBatchId) revalidatePath(`/findings/import/${input.importBatchId}`);
  return {
    ok: true,
    message: releaseSummary(outcome),
    released: outcome.released,
    stillHeld: outcome.stillHeld,
  };
}
