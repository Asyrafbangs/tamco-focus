import { AiWorkspace, type Exchange } from '@/components/AiWorkspace';
import type { SourceLink } from '@/domain/ai';
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
 */
export const dynamic = 'force-dynamic';

/** The stored blocks, flattened into what the screen shows. */
function exchangesFrom(stored: Awaited<ReturnType<typeof loadThread>>): Exchange[] {
  const exchanges: Exchange[] = [];
  for (const message of stored) {
    const blocks = Array.isArray(message.content) ? message.content : [];
    const text = blocks
      .filter((block) => (block as { type?: string }).type === 'text')
      .map((block) => String((block as { text?: string }).text ?? ''))
      .join('\n\n');
    if (message.role === 'user') {
      exchanges.push({ id: `m${message.seq}`, question: text, answer: '', sources: [] });
      continue;
    }
    const sources = blocks
      .filter((block) => (block as { type?: string }).type === 'tamco_sources')
      .flatMap((block) => (block as { sources?: SourceLink[] }).sources ?? []);
    const last = exchanges[exchanges.length - 1];
    if (last) {
      last.answer = text;
      last.sources = sources;
    }
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
            : 'The assistant is not switched on for this installation. An administrator sets ANTHROPIC_API_KEY to enable it.'
        }
      />
    </>
  );
}
