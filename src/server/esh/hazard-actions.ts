'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { createSupabaseServerClient } from '@/lib/supabase/server';

/**
 * Recording what kind of hazard a finding is (v287, §4).
 *
 * The person who reported it does not classify it — they described what they
 * saw, which is the whole point of the public form. ESH decides the category
 * during review, from a short approved list, and may change or remove it
 * afterwards: a classification is a judgement, and a judgement that cannot be
 * corrected gets avoided instead of made.
 *
 * Every rule lives in `esh_set_finding_hazard`: who may classify, which
 * findings are theirs, that the category exists and is still in use, and that
 * a secondary differs from the primary. This turns its refusal codes into
 * sentences and nothing else.
 */

const uuid = z.string().uuid();
const code = z
  .string()
  .regex(/^[a-z][a-z_]{2,31}$/)
  .nullable();

export type HazardDecision = { ok: true } | { ok: false; message: string };

function refused(reason: string | undefined): HazardDecision {
  switch (reason) {
    case 'not_permitted':
      return { ok: false, message: 'Only an ESH coordinator can classify a finding.' };
    case 'not_found':
      return {
        ok: false,
        message: 'That finding is not one of those you cover, or does not exist.',
      };
    case 'unknown_category':
      return { ok: false, message: 'That category is no longer in use. Choose another.' };
    case 'same_category_twice':
      return { ok: false, message: 'The second category has to be a different one.' };
    case 'secondary_without_primary':
      return { ok: false, message: 'Choose the main category before adding a second one.' };
    default:
      return { ok: false, message: 'The category could not be saved. Try again.' };
  }
}

export async function setFindingHazard(input: {
  findingId: string;
  primary: string | null;
  secondary: string | null;
}): Promise<HazardDecision> {
  const findingId = uuid.safeParse(input.findingId);
  if (!findingId.success) return refused('not_found');

  /*
   * An empty select is a cleared classification, not an invalid one: the
   * screen offers "Not categorised" as a choice because an uncategorised
   * finding is a real, countable state rather than a gap to be hidden.
   */
  const primary = code.safeParse(input.primary || null);
  const secondary = code.safeParse(input.secondary || null);
  if (!primary.success || !secondary.success) return refused('unknown_category');

  /*
   * Clearing the primary clears both, rather than being refused for the
   * secondary left behind. The procedure does refuse that shape — it has to,
   * for anything calling it directly — but from this screen it is not a
   * mistake to report: the coordinator chose "Not categorised", and telling
   * them to choose a main category first would be an argument about a field
   * the form has already hidden.
   */
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('esh_set_finding_hazard', {
    p_finding_id: findingId.data,
    p_primary: primary.data,
    p_secondary: primary.data ? secondary.data : null,
  });
  if (error) {
    console.error(`[esh_set_finding_hazard] ${error.code ?? 'unknown'}: ${error.message}`);
    return refused(undefined);
  }
  const answer = (data ?? {}) as { ok?: boolean; code?: string };
  if (!answer.ok) return refused(answer.code);

  revalidatePath(`/findings/${findingId.data}`);
  revalidatePath('/findings/register');
  revalidatePath('/findings/patterns');
  return { ok: true };
}
