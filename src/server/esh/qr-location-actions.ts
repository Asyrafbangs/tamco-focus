'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { createSupabaseServerClient } from '@/lib/supabase/server';

/**
 * Creating and retiring the places a sticker can point at (v289).
 *
 * The code is never sent from here. It is generated inside the procedure,
 * because a sticker's code is the whole of its authorisation and a code
 * derived from an area's name is one anybody who has walked through the
 * building can guess.
 *
 * Retiring is the only way to take a sticker out of use, and it keeps the
 * row: a sticker already glued to a machine cannot be recalled, so the code
 * must stop resolving and must never be issued again.
 */

const uuid = z.string().uuid();
const label = z.string().trim().min(1).max(160);

export type QrLocationResult = { ok: true; code?: string } | { ok: false; message: string };

function refused(reason: string | undefined): QrLocationResult {
  switch (reason) {
    case 'not_permitted':
      return { ok: false, message: 'Only an ESH coordinator can manage QR locations.' };
    case 'label_required':
      return { ok: false, message: 'Say where the sticker goes, in words somebody will read.' };
    case 'department_not_yours':
      return {
        ok: false,
        message: 'That department is not one you cover, or it does not exist.',
      };
    case 'not_found':
      return { ok: false, message: 'That location is not one you cover, or no longer exists.' };
    default:
      return { ok: false, message: 'That could not be saved. Try again.' };
  }
}

export async function addQrLocation(input: {
  label: string;
  departmentId: string | null;
}): Promise<QrLocationResult> {
  const said = label.safeParse(input.label ?? '');
  if (!said.success) return refused('label_required');
  const department = input.departmentId ? uuid.safeParse(input.departmentId) : null;
  if (department && !department.success) return refused('department_not_yours');

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('esh_add_qr_location', {
    p_label: said.data,
    p_department_id: department ? department.data : null,
  });
  if (error) {
    console.error(`[esh_add_qr_location] ${error.code ?? 'unknown'}: ${error.message}`);
    return refused(undefined);
  }
  const answer = (data ?? {}) as { ok?: boolean; code?: string };
  if (!answer.ok) return refused(answer.code);

  revalidatePath('/findings/settings');
  return { ok: true, code: answer.code };
}

export async function retireQrLocation(input: { id: string }): Promise<QrLocationResult> {
  const id = uuid.safeParse(input.id);
  if (!id.success) return refused('not_found');

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('esh_retire_qr_location', {
    p_location_id: id.data,
  });
  if (error) {
    console.error(`[esh_retire_qr_location] ${error.code ?? 'unknown'}: ${error.message}`);
    return refused(undefined);
  }
  const answer = (data ?? {}) as { ok?: boolean; code?: string };
  if (!answer.ok) return refused(answer.code);

  revalidatePath('/findings/settings');
  return { ok: true };
}
