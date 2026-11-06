import { NextResponse } from 'next/server';

import { AGENT_LIMITS, REFUSAL_WORDS, estimateTokens, sendRefusal } from '@/domain/ai';
import { getCurrentProfile } from '@/lib/supabase/server';
import { runInvestigation } from '@/server/ai/agent';
import { aiConfig } from '@/server/ai/config';
import {
  appendTurn,
  historyFor,
  loadThread,
  startConversation,
  usageWindow,
} from '@/server/ai/conversations';
import { providerFor } from '@/server/ai/providers';
import { getEshAccess } from '@/server/esh/access';

/**
 * One question, streamed.
 *
 * Server-sent events rather than a plain response, because an investigation
 * that reads several records takes long enough that a spinner alone would
 * look broken. The events say which step it is on and which records it has
 * read, and the answer arrives as it is written.
 *
 * `maxDuration` is the plan's ceiling, and the loop's own deadline is set
 * below it in `AGENT_LIMITS` so a turn stops itself with something to show
 * rather than being killed with nothing.
 */
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

function event(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

export async function POST(request: Request) {
  const profile = await getCurrentProfile();
  if (!profile) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  }

  let body: { question?: unknown; conversationId?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'That request could not be read.' }, { status: 400 });
  }
  const question = typeof body.question === 'string' ? body.question.trim() : '';
  const conversationId = typeof body.conversationId === 'string' ? body.conversationId : null;
  if (!question) {
    return NextResponse.json({ error: 'Ask a question.' }, { status: 400 });
  }

  const config = aiConfig();
  const provider = providerFor(config);
  const used = await usageWindow();
  const refusal = sendRefusal({
    enabled: config.enabled,
    hasKey: Boolean(provider),
    questionLength: question.length,
    maxQuestionLength: AGENT_LIMITS.maxQuestionLength,
    inFlight: false,
    requestsToday: used.requestsToday,
    tokensToday: used.tokensToday,
    spentTodayUsd: used.chargedTodayUsd,
    tokensThisMinute: used.tokensThisMinute,
    /*
     * A floor on what the first step will cost: the question, the system
     * prompt and the tool list, plus room for a reply. Enough to refuse
     * before spending anything when the minute's allowance is already gone.
     */
    estimatedTokens: estimateTokens(question) + 2_600 + AGENT_LIMITS.maxOutputTokens,
    limits: config.limits,
    dailySpendLimitUsd: config.dailySpendLimitUsd,
  });
  if (refusal || !provider) {
    return NextResponse.json(
      { error: REFUSAL_WORDS[refusal ?? 'no_key'], reason: refusal ?? 'no_key' },
      // 429 for an allowance, 503 for a switched-off or unconfigured one:
      // one is "wait", the other is "an administrator has to act".
      { status: refusal === 'disabled' || refusal === 'no_key' || !provider ? 503 : 429 },
    );
  }

  const thread = conversationId ? await loadThread(conversationId) : [];
  /*
   * A conversation id that returns nothing is one that is not this person's -
   * the policy filtered it out. Answering into a new thread rather than
   * refusing would be the right behaviour for a first message and the wrong
   * one for a stolen id, so it is refused when an id was given.
   */
  if (conversationId && thread.length === 0) {
    return NextResponse.json({ error: 'That conversation is not available.' }, { status: 404 });
  }
  const id = conversationId ?? (await startConversation({ userId: profile.id, question }));
  if (!id) {
    return NextResponse.json({ error: 'The conversation could not be started.' }, { status: 500 });
  }

  const access = await getEshAccess();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encode = new TextEncoder();
      const send = (data: unknown) => controller.enqueue(encode.encode(event(data)));
      send({ type: 'conversation', id });
      try {
        const run = runInvestigation({
          provider,
          history: historyFor(thread),
          question,
          caller: {
            userId: profile.id,
            fullName: profile.full_name ?? 'this person',
            timezone: profile.timezone ?? 'Asia/Kuala_Lumpur',
          },
          eshAccess: access.enabled
            ? `${access.canCoordinate ? 'coordinator' : 'reader'}${
                access.scopeAll ? ', all departments' : ', limited departments'
              }`
            : 'none',
          limits: config.limits,
          tokensUsedThisMinute: used.tokensThisMinute,
        });
        let result = await run.next();
        while (!result.done) {
          send(result.value);
          result = await run.next();
        }
        const finished = result.value;
        await appendTurn({
          conversationId: id,
          userId: profile.id,
          messages: finished.messages,
          sources: finished.sources,
          usage: finished.usage,
          requests: finished.toolCalls.length > 0 ? finished.toolCalls.length + 1 : 1,
          chargedUsd: finished.chargedUsd,
          listPriceUsd: finished.listPriceUsd,
          provider: provider.id,
          model: provider.model,
          toolCalls: finished.toolCalls,
        });
      } catch (cause) {
        /*
         * The log keeps the cause; the reader gets a sentence. An upstream
         * error message can carry request content, and this one is somebody's
         * private conversation. What the reader never gets is a fabricated
         * answer: the turn says it failed and changed nothing.
         */
        console.error(`[ai:chat] ${String(cause)}`);
        send({
          type: 'error',
          message:
            'The assistant could not finish that. Nothing was changed. Try again, or ask a narrower question.',
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store, no-transform',
      connection: 'keep-alive',
    },
  });
}
