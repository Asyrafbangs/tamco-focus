import { notFound } from 'next/navigation';

import { AiWorkspace } from '@/components/AiWorkspace';
import { canUseAssistant, pairExchanges } from '@/domain/ai';
import { requireProfile } from '@/lib/supabase/server';
import { aiConfig } from '@/server/ai/config';
import { listConversations, loadThread } from '@/server/ai/conversations';

/**
 * TAMCO AI.
 *
 * The page resolves who is asking and what they have asked before; everything
 * else happens through the streaming route, which runs every tool as this
 * person. A conversation id in the address that is not theirs simply loads
 * nothing — the policy filters it out before this code sees it.
 *
 * Pairing the stored turns into question-and-answer lives in the domain, with
 * a test, because the rule it encodes is easy to get wrong: a tool result is
 * kept so somebody can audit what was read, and it is not an answer.
 */
export const dynamic = 'force-dynamic';

export default async function AiPage({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  const profile = await requireProfile();
  const config = aiConfig();
  /*
   * v299 — before the reads, not after. `notFound` for the same reason the
   * admin screens use it: a 404 tells somebody without the role that there is
   * nothing here for them, where a 403 would confirm there is something worth
   * asking about. Checked here and not only in the rail, because a hidden
   * link is still a reachable address.
   *
   * v301 — the configuration is now read before the gate rather than after
   * it, because the gate consults it. The named list lives there and not in
   * the domain, so that who may use this is a setting an owner changes rather
   * than a deploy an engineer runs.
   */
  if (!canUseAssistant(profile.role, profile.email, config.allowedEmails)) notFound();

  const params = await searchParams;
  const conversationId = /^[0-9a-f-]{36}$/i.test(params.c ?? '') ? params.c! : null;
  const [conversations, thread] = await Promise.all([
    listConversations(),
    conversationId ? loadThread(conversationId) : Promise.resolve([]),
  ]);

  return (
    <>
      <div className="pagehead">
        <div>
          <p className="eyebrow">TAMCO AI</p>
          <h1>Ask about your work</h1>
          <p>
            Answers come from the records you are authorised to see, with links to the ones I read.
          </p>
        </div>
      </div>
      <AiWorkspace
        conversations={conversations}
        initial={conversationId ? pairExchanges(thread) : []}
        conversationId={conversationId}
        enabled={config.enabled}
        disabledReason={
          config.enabled
            ? ''
            : `The assistant is not switched on for this installation. An administrator sets ${config.keyVariable} to enable it.`
        }
      />
    </>
  );
}
