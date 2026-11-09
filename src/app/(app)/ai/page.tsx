import { notFound } from 'next/navigation';

import { canUseAssistant } from '@/domain/ai';
import { requireProfile } from '@/lib/supabase/server';
import { aiConfig } from '@/server/ai/config';

import { ExportAiBrief } from './ExportAiBrief';

/**
 * TAMCO AI — the brief, not the conversation.
 *
 * v317. The owner analyses the team's week in an assistant of their own
 * choosing and wanted the facts extracted in one press rather than retyped
 * off the screens. So this address now offers the export, and the chat that
 * used to live here is at `/ai/chat`: hidden, because nothing links to it,
 * and working, because the code and its tests are untouched.
 *
 * The gate is unchanged. `canUseAssistant` decides who sees the rail entry and
 * who may open this page, and it is asked here as well as in the action
 * behind the buttons, for the reason v299 recorded: a hidden link is still a
 * reachable address. `notFound` rather than a refusal, like the admin
 * screens - a 404 says there is nothing here for you, where a 403 confirms
 * there is something worth asking about.
 *
 * Nothing on this page reads a record. The export action does that when
 * pressed, through the same permission-scoped queries the screens use.
 */
export const dynamic = 'force-dynamic';

export default async function AiBriefPage() {
  const profile = await requireProfile();
  const config = aiConfig();
  if (!canUseAssistant(profile.role, profile.email, config.allowedEmails)) notFound();

  return (
    <>
      <div className="pagehead">
        <div>
          <p className="eyebrow">TAMCO AI</p>
          <h1>Export AI brief</h1>
          <p>
            Take your team&rsquo;s open work, blockers, updates and findings out as one document,
            ready to paste into an assistant for analysis.
          </p>
        </div>
      </div>

      <ExportAiBrief />

      <section className="section-block" aria-labelledby="ai-brief-contents-title">
        <h2 id="ai-brief-contents-title">What the brief contains</h2>
        <ul>
          <li>
            Open team tasks: owner, status, deadline, reported progress and the written scope.
          </li>
          <li>Open checklist actions, dependencies, barriers and review state.</li>
          <li>The latest update on each task, with its author, date and words as written.</li>
          <li>
            Open ESH findings with risk level, action state, overdue status and whether a verified
            interim control is in place.
          </li>
          <li>Your own open work, for the management overview.</li>
          <li>
            The snapshot time, your timezone, record identifiers, direct links, what each source
            covered, and any read that failed.
          </li>
        </ul>
        <p className="form-hint">
          Deliberately excluded: hours, effort and capacity figures, because this product records
          none; attachments and their contents; restricted ESH findings, which the register keeps
          out of leadership reports and their counts; and identifiers matching a known pattern in
          free text. The brief states each exclusion and its count, so nothing is missing silently.
        </p>
      </section>
    </>
  );
}
