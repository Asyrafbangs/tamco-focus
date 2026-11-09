'use server';

import { canUseAssistant } from '@/domain/ai';
import { aiBriefFilename } from '@/domain/ai-brief';
import { requireProfile } from '@/lib/supabase/server';
import { gatherAiBrief } from '@/server/ai-brief';
import { aiConfig } from '@/server/ai/config';

/**
 * One read-only action: assemble the brief and hand back the text.
 *
 * v317. It returns a string rather than writing a file or calling anything.
 * The client copies it to the clipboard or saves it; nothing leaves the
 * browser by the product's doing, and no record is changed by producing it.
 *
 * The gate is `canUseAssistant`, the same one the page behind this control
 * uses. It is asked again here and not inherited from the page, for the
 * reason v299 wrote down about the old assistant: a hidden link is still a
 * reachable address, and a server action is an address.
 */
export interface AiBriefActionResult {
  ok: boolean;
  markdown?: string;
  filename?: string;
  message?: string;
}

export async function exportAiBrief(): Promise<AiBriefActionResult> {
  const profile = await requireProfile();
  const config = aiConfig();

  if (!canUseAssistant(profile.role, profile.email, config.allowedEmails)) {
    return {
      ok: false,
      message: 'This account is not authorised to export the AI brief.',
    };
  }

  try {
    const { markdown } = await gatherAiBrief();
    return { ok: true, markdown, filename: aiBriefFilename(new Date()) };
  } catch (cause) {
    /*
     * The gather itself turns a failed READ into a named gap in the document,
     * so reaching here means something structural went wrong rather than one
     * source being unavailable. Say so plainly and change nothing.
     */
    console.error(`[exportAiBrief] ${String(cause)}`);
    return {
      ok: false,
      message: 'The brief could not be assembled. Nothing was changed. Try again in a moment.',
    };
  }
}
