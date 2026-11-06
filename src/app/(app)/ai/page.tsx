import { AiWorkspace, type Exchange } from '@/components/AiWorkspace';
import { requireProfile } from '@/lib/supabase/server';
import { aiConfig } from '@/server/ai/config';
import { listConversations, loadThread, type StoredMessage } from '@/server/ai/conversations';

/**
 * TAMCO AI.
 *
 * The page resolves who is asking and what they have asked before; everything
 * else happens through the streaming route, which runs every tool as this
 * person. A conversation id in the address that is not theirs simply loads
 * nothing — the policy filters it out before this code sees it.
 */
export const dynamic = 'force-dynamic';

/**
 * The stored turns, paired into question-and-answer.
 *
 * Tool turns are skipped: they are kept for auditing what was read, not for
 * reading back. What a person sees is what they asked and what came of it,
 * with the citations the tools produced.
 */
function exchangesFrom(stored: readonly StoredMessage[]): Exchange[] {
  const exchanges: Exchange[] = [];
  for (const message of stored) {
    if (message.role === 'user') {
      exchanges.push({ id: `m${message.seq}`, question: message.content, answer: '', sources: [] });
      continue;
    }
    if (message.role !== 'assistant' || !message.content.trim()) continue;
    const last = exchanges[exchanges.length - 1];
    if (!last) continue;
    last.answer = last.answer ? `${last.answer}\n\n${message.content}` : message.content;
    if (message.sources?.length) last.sources = message.sources;
  }
  return exchanges;
}

export default async function AiPage({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  await requireProfile();
  const params = await searchParams;
  const conversationId = /^[0-9a-f-]{36}$/i.test(params.c ?? '') ? params.c! : null;
  const [conversations, thread] = await Promise.all([
    listConversations(),
    conversationId ? loadThread(conversationId) : Promise.resolve([]),
  ]);
  const config = aiConfig();

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
        initial={conversationId ? exchangesFrom(thread) : []}
        conversationId={conversationId}
        enabled={config.enabled}
        disabledReason={
          config.enabled
            ? ''
            : 'The assistant is not switched on for this installation. An administrator sets GROQ_API_KEY to enable it.'
        }
      />
    </>
  );
}
