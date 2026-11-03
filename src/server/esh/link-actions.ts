'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { createSupabaseServerClient, requireProfile } from '@/lib/supabase/server';

/**
 * Relating two findings, and unrelating them (v279, §6).
 *
 * The directed links are not managed here. What a finding duplicates is part
 * of its outcome and belongs to `resolveFinding`; what a failed effectiveness
 * check raised belongs to the check that failed. This is the undirected case
 * only: two findings that inform each other, where neither replaces the
 * other.
 */

const uuid = z.string().uuid();

export type LinkDecision = { ok: true } | { ok: false; message: string };

function refused(code: string | undefined): LinkDecision {
  switch (code) {
    case 'not_permitted':
      return { ok: false, message: 'Only an ESH coordinator can relate findings.' };
    case 'same_finding':
      return { ok: false, message: 'A finding cannot be related to itself.' };
    case 'finding_required':
      return { ok: false, message: 'Name the finding to relate this one to.' };
    case 'not_found':
    case 'related_not_found':
      return {
        ok: false,
        message: 'That finding is not one of those you cover, or does not exist.',
      };
    default:
      return { ok: false, message: 'The link could not be saved. Try again.' };
  }
}

function refresh(findingId: string, relatedId: string) {
  revalidatePath(`/findings/${findingId}`);
  revalidatePath(`/findings/${relatedId}`);
}

/**
 * What the coordinator typed, as a finding id.
 *
 * A reference is what the register shows them, so that is what the field asks
 * for; a pasted detail-page address works too, because copying the link is
 * the other obvious way to name a finding. The lookup runs under the reader's
 * own policies, so a finding they cannot see does not resolve — the same
 * answer as one that does not exist, which is the point.
 */
async function findingIdFor(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  typed: string,
): Promise<string | null> {
  const text = typed.trim();
  if (!text) return null;

  // A pasted address, down to its last path segment.
  const tail = (text.split('?')[0] ?? text).split('#')[0]?.split('/').pop() ?? text;
  const asId = uuid.safeParse(tail);
  if (asId.success) return asId.data;

  const { data } = await supabase
    .from('esh_findings')
    .select('id')
    .eq('reference', text.toUpperCase())
    .maybeSingle();
  return data?.id ? String(data.id) : null;
}

export async function relateFinding(input: {
  findingId: string;
  related: string;
  note: string;
}): Promise<LinkDecision> {
  await requireProfile();
  const findingId = uuid.safeParse(input.findingId);
  if (!findingId.success) return refused('not_found');

  const supabase = await createSupabaseServerClient();
  const relatedId = await findingIdFor(supabase, input.related ?? '');
  if (!relatedId) return refused(input.related?.trim() ? 'related_not_found' : 'finding_required');

  const { data, error } = await supabase.rpc('esh_link_related_findings', {
    p_finding_id: findingId.data,
    p_related_finding_id: relatedId,
    p_note: (input.note?.trim() || null) as string,
  });
  if (error) {
    console.error(`[esh_link_related_findings] ${error.code ?? 'unknown'}: ${error.message}`);
    return refused(undefined);
  }
  const result = (data ?? {}) as { ok?: boolean; code?: string };
  if (!result.ok) return refused(result.code);
  refresh(findingId.data, relatedId);
  return { ok: true };
}

export async function unrelateFinding(input: {
  findingId: string;
  relatedFindingId: string;
}): Promise<LinkDecision> {
  await requireProfile();
  const findingId = uuid.safeParse(input.findingId);
  const relatedId = uuid.safeParse(input.relatedFindingId);
  if (!findingId.success || !relatedId.success) return refused('not_found');

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('esh_unlink_related_findings', {
    p_finding_id: findingId.data,
    p_related_finding_id: relatedId.data,
  });
  if (error) {
    console.error(`[esh_unlink_related_findings] ${error.code ?? 'unknown'}: ${error.message}`);
    return refused(undefined);
  }
  const result = (data ?? {}) as { ok?: boolean; code?: string };
  if (!result.ok) return refused(result.code);
  refresh(findingId.data, relatedId.data);
  return { ok: true };
}
